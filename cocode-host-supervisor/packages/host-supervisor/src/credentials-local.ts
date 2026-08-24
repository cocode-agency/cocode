import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Document, parseDocument } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export const DOCUMENT_VERSION = 1

export type CredentialsLayout = 'flat' | 'v1' | 'empty'
export type CredentialRefMap = Map<string, string>
export type CredentialRecord = Record<string, unknown>
export type CredentialRecordMap = Map<string, CredentialRecord>

export type CredentialsDocument = {
  readonly layout: CredentialsLayout
  readonly refs: CredentialRefMap
  readonly records: CredentialRecordMap
  readonly text: string
}

export type CredentialsErrorCode =
  | 'CREDENTIALS_INVALID_YAML'
  | 'CREDENTIALS_PERMISSION_INVALID'
  | 'CREDENTIALS_SYMLINK_REJECTED'
  | 'CREDENTIALS_NOT_A_FILE'
  | 'CREDENTIALS_UNSUPPORTED_VERSION'
  | 'CREDENTIALS_UNKNOWN_TOP_LEVEL_KEY'
  | 'CREDENTIALS_INVALID_REF'
  | 'CREDENTIALS_EMPTY_VALUE'
  | 'CREDENTIALS_WRITE_FAILED'
  | 'CREDENTIALS_RELOAD_FAILED'

export class CredentialsError extends Error {
  readonly name = 'CredentialsError'
  constructor(
    readonly code: CredentialsErrorCode,
    message: string,
    readonly filename?: string,
    readonly line?: number,
    readonly column?: number,
    readonly field?: string,
  ) {
    super(`${code}: ${message}`)
  }
}

const REF = /^[A-Za-z_][A-Za-z0-9_]*$/
const TOP_LEVEL_KEYS = new Set(['version', 'refs', 'records'])

function sourcePosition(document: ReturnType<typeof parseDocument>, text: string): { line?: number; column?: number } {
  const first = document.errors[0]
  const pos = first?.pos
  if (!Array.isArray(pos)) return {}
  const source = text.slice(0, pos[0] ?? 0)
  const lines = source.split(/\r?\n/)
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function parseYaml(text: string, filename: string): { document: ReturnType<typeof parseDocument>; root: Record<string, unknown> } {
  let document: ReturnType<typeof parseDocument>
  try {
    document = parseDocument(text, { prettyErrors: false, uniqueKeys: true })
  } catch {
    throw new CredentialsError('CREDENTIALS_INVALID_YAML', 'YAML parse failed', filename)
  }
  if (document.errors.length > 0) {
    const position = sourcePosition(document, text)
    throw new CredentialsError('CREDENTIALS_INVALID_YAML', 'YAML parse failed', filename, position.line, position.column)
  }
  const value = document.toJS() as unknown
  if (value === null || value === undefined) return { document, root: {} }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CredentialsError('CREDENTIALS_INVALID_YAML', 'document root must be a mapping', filename)
  }
  return { document, root: value as Record<string, unknown> }
}

function ensureRef(ref: string, filename?: string): void {
  if (!REF.test(ref)) throw new CredentialsError('CREDENTIALS_INVALID_REF', `invalid credential ref ${ref}`, filename, undefined, undefined, ref)
}

function refsFrom(value: unknown, filename: string, allowNull: boolean): CredentialRefMap {
  if (value === null || value === undefined) {
    if (allowNull) return new Map()
    throw new CredentialsError('CREDENTIALS_INVALID_REF', 'flat document must be a mapping', filename)
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CredentialsError('CREDENTIALS_INVALID_REF', 'refs must be a mapping', filename)
  }
  const refs = new Map<string, string>()
  for (const [ref, item] of Object.entries(value as Record<string, unknown>)) {
    ensureRef(ref, filename)
    if (typeof item !== 'string') throw new CredentialsError('CREDENTIALS_EMPTY_VALUE', `credential ${ref} must be a string`, filename, undefined, undefined, ref)
    if (item.length === 0) throw new CredentialsError('CREDENTIALS_EMPTY_VALUE', `credential ${ref} must not be empty`, filename, undefined, undefined, ref)
    refs.set(ref, item)
  }
  return refs
}

function recordsFrom(value: unknown, filename: string): CredentialRecordMap {
  if (value === null || value === undefined) return new Map()
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CredentialsError('CREDENTIALS_INVALID_YAML', 'records must be a mapping', filename, undefined, undefined, 'records')
  }
  const records = new Map<string, CredentialRecord>()
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new CredentialsError('CREDENTIALS_INVALID_YAML', `record ${key} must be a mapping`, filename, undefined, undefined, key)
    }
    records.set(key, item as CredentialRecord)
  }
  return records
}

export function detectCredentialsLayout(text: string, filename: string): CredentialsLayout {
  const { root } = parseYaml(text, filename)
  if (Object.keys(root).length === 0) return 'empty'
  const layout = Object.keys(root).some((key) => TOP_LEVEL_KEYS.has(key)) ? 'v1' : 'flat'
  if (layout === 'flat') {
    refsFrom(root, filename, false)
    return layout
  }
  if (root.version !== DOCUMENT_VERSION) {
    throw new CredentialsError('CREDENTIALS_UNSUPPORTED_VERSION', 'version must be numeric 1', filename, undefined, undefined, 'version')
  }
  for (const key of Object.keys(root)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new CredentialsError('CREDENTIALS_UNKNOWN_TOP_LEVEL_KEY', `unknown top-level key ${key}`, filename, undefined, undefined, key)
  }
  refsFrom(root.refs, filename, true)
  recordsFrom(root.records, filename)
  return layout
}

export function parseCredentialsDocument(text: string, filename: string): CredentialsDocument {
  const { root } = parseYaml(text, filename)
  if (Object.keys(root).length === 0) return { layout: 'empty', refs: new Map(), records: new Map(), text }
  const layout = detectCredentialsLayout(text, filename)
  if (layout === 'flat') return { layout, refs: refsFrom(root, filename, false), records: new Map(), text }

  if (root.version !== DOCUMENT_VERSION) {
    throw new CredentialsError('CREDENTIALS_UNSUPPORTED_VERSION', 'version must be numeric 1', filename, undefined, undefined, 'version')
  }
  for (const key of Object.keys(root)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new CredentialsError('CREDENTIALS_UNKNOWN_TOP_LEVEL_KEY', `unknown top-level key ${key}`, filename, undefined, undefined, key)
  }
  return {
    layout,
    refs: refsFrom(root.refs, filename, true),
    records: recordsFrom(root.records, filename),
    text,
  }
}

async function assertPrivateFile(filename: string): Promise<void> {
  try {
    const parent = await lstat(dirname(filename))
    if (parent.isSymbolicLink()) throw new CredentialsError('CREDENTIALS_SYMLINK_REJECTED', 'credential directory must not be a symlink', dirname(filename))
    if (!parent.isDirectory()) throw new CredentialsError('CREDENTIALS_NOT_A_FILE', 'credential parent must be a directory', dirname(filename))
    if (process.platform !== 'win32' && (parent.mode & 0o077) !== 0) throw new CredentialsError('CREDENTIALS_PERMISSION_INVALID', 'credential directory must be owner-only', dirname(filename))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    const metadata = await lstat(filename)
    if (metadata.isSymbolicLink()) throw new CredentialsError('CREDENTIALS_SYMLINK_REJECTED', 'credential file must not be a symlink', filename)
    if (!metadata.isFile()) throw new CredentialsError('CREDENTIALS_NOT_A_FILE', 'credential path must be a regular file', filename)
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) throw new CredentialsError('CREDENTIALS_PERMISSION_INVALID', 'credential file must be owner-only', filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

async function ensurePrivateDirectory(filename: string): Promise<void> {
  const directory = dirname(filename)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(directory, 0o700)
}

async function readText(filename: string): Promise<string | undefined> {
  try { return await readFile(filename, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function loadCredentials(filename: string): Promise<CredentialsDocument> {
  await assertPrivateFile(filename)
  const text = await readText(filename)
  if (text === undefined) return { layout: 'empty', refs: new Map(), records: new Map(), text: '' }
  return parseCredentialsDocument(text, filename)
}

export function renderCredentialsUpdate(document: CredentialsDocument, ref: string, value: string | undefined): string {
  ensureRef(ref, '<credentials>')
  if (value !== undefined && value.length === 0) throw new CredentialsError('CREDENTIALS_EMPTY_VALUE', `credential ${ref} must not be empty`, undefined, undefined, undefined, ref)
  if (document.layout === 'empty') {
    const next = document.text.trim() === ''
      ? new Document()
      : parseDocument(document.text, { uniqueKeys: true })
    if (value !== undefined) next.set(ref, value)
    return next.toString()
  }
  const next = parseDocument(document.text, { uniqueKeys: true })
  if (document.layout === 'flat') {
    if (value === undefined) next.delete(ref)
    else next.set(ref, value)
  } else {
    if (next.get('refs') === null || next.get('refs') === undefined) next.set('refs', {})
    if (value === undefined) next.deleteIn(['refs', ref])
    else next.setIn(['refs', ref], value)
  }
  return next.toString()
}

export async function writeCredentialRef(filename: string, ref: string, value: string | undefined): Promise<void> {
  ensureRef(ref, filename)
  if (value !== undefined && value.length === 0) throw new CredentialsError('CREDENTIALS_EMPTY_VALUE', `credential ${ref} must not be empty`, filename, undefined, undefined, ref)
  await assertPrivateFile(filename)
  await ensurePrivateDirectory(filename)
  try {
    await withFileLock(filename, async () => {
      await assertPrivateFile(filename)
      const current = await readText(filename)
      const document = current === undefined || current.trim() === ''
        ? { layout: 'empty', refs: new Map(), records: new Map(), text: current ?? '' } satisfies CredentialsDocument
        : parseCredentialsDocument(current, filename)
      await writeFileAtomic(filename, renderCredentialsUpdate(document, ref, value), { mode: 0o600, dirMode: 0o700 })
    })
  } catch (error) {
    if (error instanceof CredentialsError) throw error
    throw new CredentialsError('CREDENTIALS_WRITE_FAILED', 'credential write failed', filename)
  }
}

export async function moveCredentialRef(filename: string, from: string, to: string): Promise<void> {
  ensureRef(from, filename)
  ensureRef(to, filename)
  if (from === to) return
  await assertPrivateFile(filename)
  await ensurePrivateDirectory(filename)
  try {
    await withFileLock(filename, async () => {
      await assertPrivateFile(filename)
      const current = await readText(filename)
      if (current === undefined || current.trim() === '') return
      const document = parseCredentialsDocument(current, filename)
      const value = document.refs.get(from)
      if (value === undefined || document.refs.has(to)) return
      const next = parseDocument(current, { uniqueKeys: true })
      if (document.layout === 'flat') {
        next.set(to, value)
        next.delete(from)
      } else {
        next.setIn(['refs', to], value)
        next.deleteIn(['refs', from])
      }
      await writeFileAtomic(filename, next.toString(), { mode: 0o600, dirMode: 0o700 })
    })
  } catch (error) {
    if (error instanceof CredentialsError) throw error
    throw new CredentialsError('CREDENTIALS_WRITE_FAILED', 'credential move failed', filename)
  }
}

export async function refreshCredentials(filename: string, _previous: CredentialsDocument): Promise<CredentialsDocument> {
  try {
    return await loadCredentials(filename)
  } catch (error) {
    if (error instanceof CredentialsError) throw new CredentialsError('CREDENTIALS_RELOAD_FAILED', error.message, filename, error.line, error.column, error.field)
    throw new CredentialsError('CREDENTIALS_RELOAD_FAILED', 'credential reload failed', filename)
  }
}

export async function readCredentials(filename: string): Promise<Record<string, string>> {
  return Object.fromEntries((await loadCredentials(filename)).refs)
}

export async function patchCredential(filename: string, ref: string, value: string | undefined): Promise<void> {
  await writeCredentialRef(filename, ref, value)
}
