/**
 * Shared DSH credential document, supporting flat and version-1 layouts.
 */

import { credentialsPath } from './paths.ts'
import { readYamlUnknown, writeYamlFile } from './io.ts'
import { withFileLock } from './file-lock.ts'
import { TuiError } from '../errors/index.ts'
import { randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'

const REF = /^[A-Za-z_][A-Za-z0-9_]*$/

export async function readCredentials(home: string): Promise<Record<string, string>> {
  return withCredentialsLock(home, async () => {
    const loaded = await readYamlUnknown(credentialsPath(home), { secret: true })
    if (loaded.missing) return {}
    const credentials = asStringMap(loaded.value)
    const legacyKey = credentials.COCODE_CLOUD_API_KEY
    if (legacyKey !== undefined && credentials.COCODE_NUT_API_KEY === undefined) {
      await patchCredential(home, 'COCODE_NUT_API_KEY', legacyKey)
      await patchCredential(home, 'COCODE_CLOUD_API_KEY', undefined)
      credentials.COCODE_NUT_API_KEY = legacyKey
      delete credentials.COCODE_CLOUD_API_KEY
    }
    return credentials
  })
}

/**
 * Read credentials for an interactive channel transition.
 *
 * A stale or hand-edited credentials document must not prevent a user from
 * signing in again. Preserve the invalid secret file under a private backup
 * name, then let the next write create a clean document.
 */
export async function readCredentialsRecovering(home: string): Promise<Record<string, string>> {
  return withCredentialsLock(home, async () => {
    try {
      return await readCredentials(home)
    } catch (error) {
      if (!isRecoverableCredentialError(error)) throw error
      const path = credentialsPath(home)
      await rename(path, `${path}.invalid-${Date.now()}-${randomUUID()}`)
      return {}
    }
  })
}

export async function patchCredential(
  home: string,
  ref: string,
  value: string | undefined,
): Promise<void> {
  if (!REF.test(ref)) throw new TuiError('AUTH_CREDENTIAL_REF', { ref })
  return withCredentialsLock(home, async () => {
    const path = credentialsPath(home)
    const loaded = await readYamlUnknown(path, { secret: true })
    const document = loaded.missing ? undefined : asCredentialDocument(loaded.value)
    const current = document?.refs ?? {}
    if (value === undefined) {
      delete current[ref]
    } else {
      const trimmed = value.trim()
      if (trimmed === '') throw new TuiError('AUTH_CREDENTIAL_EMPTY')
      current[ref] = trimmed
    }
    await writeYamlFile(path, document === undefined || document.version === undefined
      ? { version: 1, refs: current }
      : { ...document.raw, version: 1, refs: current }, 0o600)
  })
}

function withCredentialsLock<T>(home: string, operation: () => Promise<T>): Promise<T> {
  return withFileLock(credentialsPath(home), operation)
}

function asStringMap(value: unknown): Record<string, string> {
  return asCredentialDocument(value).refs
}

type CredentialDocument = { version?: number; refs: Record<string, string>; raw: Record<string, unknown> }

function asCredentialDocument(value: unknown): CredentialDocument {
  if (value === null || value === undefined) return { refs: {}, raw: {} }
  if (typeof value !== 'object' || Array.isArray(value)) throw new TuiError('AUTH_CREDENTIALS_PARSE')
  const raw = value as Record<string, unknown>
  const version = raw.version
  if (version !== undefined && version !== 1) throw new TuiError('AUTH_CREDENTIALS_PARSE')
  if (version === 1 && Object.keys(raw).some((key) => !['version', 'refs', 'records'].includes(key))) throw new TuiError('AUTH_CREDENTIALS_PARSE')
  const section = version === 1 ? raw.refs : raw
  if (section === null || section === undefined) return { version, refs: {}, raw }
  if (typeof section !== 'object' || Array.isArray(section)) throw new TuiError('AUTH_CREDENTIALS_PARSE')
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(section as Record<string, unknown>)) {
    if (version === 1 && ['version', 'refs', 'records'].includes(key)) continue
    if (typeof item !== 'string' || !REF.test(key) || item.trim() === '') {
      throw new TuiError('AUTH_CREDENTIALS_PARSE')
    }
    out[key] = item
  }
  return { ...(version === undefined ? {} : { version }), refs: out, raw }
}

function isRecoverableCredentialError(error: unknown): boolean {
  return error instanceof TuiError && (error.code === 'AUTH_CREDENTIALS_PARSE' || error.code === 'IO_PARSE')
}
