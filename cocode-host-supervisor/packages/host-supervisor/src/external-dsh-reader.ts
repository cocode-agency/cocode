import { createHash } from 'node:crypto'
import { existsSync, lstatSync, realpathSync, watch as watchSync, type FSWatcher } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'

export type ExternalDshSourceStatus = {
  source: 'shared-dsh'
  sourceHome: string
  canMutate: boolean
  concurrency: 'no-concurrent-writes'
  sharedWritePolicy: 'enabled'
  concurrentMutation: 'unsupported'
  homePatch: 'shared'
  homePatchIsolation: 'unavailable'
  profileFallback: 'shared'
  state: 'available' | 'unavailable' | 'incompatible' | 'permission-denied'
  reason?: 'source-missing' | 'source-unreadable' | 'workspace-schema-version' | 'session-format-version' | 'session-storage-record' | 'source-overlaps-runtime'
  sessionCount?: number
  workspaceCount?: number
}

export type ExternalSessionSummary = {
  source: 'shared-dsh'
  canMutate: true
  concurrency: 'no-concurrent-writes'
  id: string
  createdAt: number
  updatedAt?: number
  cwd?: string
  title?: string
  preview?: string
  parentSession?: string
  seedLength?: number
  formatVersion?: number
  status?: 'ok' | 'incompatible'
  path: string
  tailIncomplete?: boolean
}

export type ExternalSessionEvent = {
  type: string
  seq: number
  time: number
  data: unknown
  ignorable?: boolean
}

export type ExternalSessionHistory = {
  source: 'shared-dsh'
  canMutate: true
  concurrency: 'no-concurrent-writes'
  session: ExternalSessionSummary
  events: ExternalSessionEvent[]
  tailIncomplete: boolean
  status: 'ok' | 'incomplete' | 'incompatible'
  reason?: string
}

export type ExternalWorkspace = {
  source: 'shared-dsh'
  canMutate: true
  concurrency: 'no-concurrent-writes'
  workspaceId: string
  path: string
  title?: string
  sessionIds: string[]
  archivedSessionIds: string[]
  createdAt?: string
  updatedAt?: string
}

export type ExternalWorkspaceSnapshot = {
  source: 'shared-dsh'
  canMutate: true
  concurrency: 'no-concurrent-writes'
  revision: string
  workspaces: ExternalWorkspace[]
}

export type ExternalProjectionSnapshot = {
  source: 'shared-dsh'
  canMutate: true
  concurrency: 'no-concurrent-writes'
  sessionId: string
  revision: number
  identity?: { createdAt?: number; cwd?: string }
  values: Record<string, unknown>
}

export type ExternalAttachmentRef = {
  path: string
  digest?: string
  mimeType?: string
  maxBytes?: number
}

export type VerifiedAttachment = {
  source: 'shared-dsh'
  canMutate: true
  concurrency: 'no-concurrent-writes'
  bytes: Uint8Array
  digest: string
  mimeType: string
  width: number
  height: number
}

export type ExternalDshChange = {
  kind: 'sessions' | 'workspace' | 'projection-cache' | 'attachments'
  path: string
}

export type ExternalDshConflictStatus = {
  source: 'shared-dsh'
  kind: 'session' | 'workspace'
  id?: string
  state: 'clean' | 'conflict' | 'unavailable'
  expectedRevision?: string
  currentRevision?: string
}

export type ExternalDshReadSourceOptions = {
  sourceHome?: string
  /** Optional Cocode runtime root used to enforce the source/runtime boundary. */
  runtimeHome?: string
  enableProjectionCache?: boolean
  enableAttachments?: boolean
  maxAttachmentBytes?: number
  maxImageDimension?: number
  maxImagePixels?: number
  watch?: boolean
}

export interface ExternalDshReadSource {
  readonly source: 'shared-dsh'
  readonly sourceHome: string
  getStatus(): Promise<ExternalDshSourceStatus>
  listSessions(): Promise<ExternalSessionSummary[]>
  readSessionHistory(sessionId: string, options?: { beforeSeq?: number; limit?: number }): Promise<ExternalSessionHistory>
  listWorkspaces(): Promise<ExternalWorkspaceSnapshot>
  getSessionRevision?(sessionId: string): Promise<string | undefined>
  getWorkspaceRevision?(): Promise<string | undefined>
  checkSessionRevision?(sessionId: string, expectedRevision: string): Promise<ExternalDshConflictStatus>
  checkWorkspaceRevision?(expectedRevision: string): Promise<ExternalDshConflictStatus>
  readProjectionCache?(sessionId: string): Promise<ExternalProjectionSnapshot | undefined>
  readAttachment?(reference: ExternalAttachmentRef): Promise<VerifiedAttachment | undefined>
  subscribe(listener: (change: ExternalDshChange) => void): () => void
  dispose(): Promise<void>
}

const SOURCE = 'shared-dsh' as const
const MAX_HISTORY_EVENTS = 100_000
const WORKSPACE_FILE = 'workspace.json'
const PROJECTION_FILE = 'session_projcache.json'
const SUPPORTED_SESSION_VERSIONS = new Set([0, 1])

export class ExternalDshReader implements ExternalDshReadSource {
  readonly source = SOURCE
  readonly sourceHome: string
  private readonly projectionEnabled: boolean
  private readonly attachmentsEnabled: boolean
  private readonly maxAttachmentBytes: number
  private readonly maxImageDimension: number
  private readonly maxImagePixels: number
  private readonly boundaryViolation: boolean
  private readonly listeners = new Set<(change: ExternalDshChange) => void>()
  private readonly watchers: FSWatcher[] = []
  private disposed = false

  constructor(options: ExternalDshReadSourceOptions = {}) {
    this.sourceHome = resolve(expandHome(options.sourceHome ?? process.env.COCODE_DSH_HOME ?? process.env.COCODE_DSH_SOURCE_HOME ?? join(homedir(), '.dsh')))
    this.boundaryViolation = options.runtimeHome !== undefined
      && pathsOverlap(boundaryPath(this.sourceHome), boundaryPath(resolve(options.runtimeHome)))
    this.projectionEnabled = options.enableProjectionCache !== false
    this.attachmentsEnabled = options.enableAttachments === true
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? 25 * 1024 * 1024
    this.maxImageDimension = options.maxImageDimension ?? 16_384
    this.maxImagePixels = options.maxImagePixels ?? 64 * 1024 * 1024
    if (options.watch !== false && !this.boundaryViolation) this.startWatchers()
  }

  async getStatus(): Promise<ExternalDshSourceStatus> {
    const base = {
      source: SOURCE,
      sourceHome: this.sourceHome,
      canMutate: true,
      concurrency: 'no-concurrent-writes' as const,
      sharedWritePolicy: 'enabled' as const,
      concurrentMutation: 'unsupported' as const,
      homePatch: 'shared' as const,
      homePatchIsolation: 'unavailable' as const,
      profileFallback: 'shared' as const,
    }
    if (this.boundaryViolation) return { ...base, canMutate: false, state: 'incompatible', reason: 'source-overlaps-runtime' }
    try {
      const source = await realpath(this.sourceHome)
      const sessionCount = (await this.listSessions()).length
      let workspaceCount: number | undefined
      try { workspaceCount = (await this.listWorkspaces()).workspaces.length } catch (error) {
        if (error instanceof Error && error.message.includes('workspace schema/version')) {
          return { ...base, canMutate: false, state: 'incompatible', reason: 'workspace-schema-version', sessionCount }
        }
        workspaceCount = undefined
      }
      return { ...base, state: 'available', sessionCount, ...(workspaceCount === undefined ? {} : { workspaceCount }) }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') return { ...base, canMutate: false, state: 'unavailable', reason: 'source-missing' }
      if (code === 'EACCES' || code === 'EPERM') return { ...base, canMutate: false, state: 'permission-denied', reason: 'source-unreadable' }
      return { ...base, canMutate: false, state: 'unavailable', reason: 'source-unreadable' }
    }
  }

  async listSessions(): Promise<ExternalSessionSummary[]> {
    this.assertUsable()
    const root = await this.sessionsRoot()
    const result: ExternalSessionSummary[] = []
    let projects
    try { projects = await readdir(root, { withFileTypes: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return []
      throw error
    }
    for (const project of projects) {
      if (project.isSymbolicLink()) throw new Error('external DSH symlink escape')
      if (!project.isDirectory()) continue
      const projectRoot = await this.safeChild(root, project.name)
      let entries
      try { entries = await readdir(projectRoot, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new Error('external DSH symlink escape')
        if (!entry.isDirectory()) continue
        const sessionRoot = await this.safeChild(projectRoot, entry.name)
        const file = await this.findSessionFile(sessionRoot)
        if (file === undefined) continue
        const parsed = await this.readSessionFile(file, { headerOnly: false })
        if (parsed.header === undefined) continue
        const display = foldDisplay(parsed.events)
        const cachedTitle = display.title === undefined
          ? await this.readProjectionTitle(parsed.header.id, parsed.events)
          : undefined
        result.push({
          source: SOURCE,
          canMutate: true,
          concurrency: 'no-concurrent-writes',
          ...parsed.header,
          ...(parsed.incompatible
            ? { status: 'incompatible' as const, title: 'Untitled' }
            : { ...display, title: display.title ?? cachedTitle ?? 'Untitled' }),
          path: file,
          ...(parsed.tailIncomplete ? { tailIncomplete: true } : {}),
        })
      }
    }
    result.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || a.id.localeCompare(b.id))
    return result
  }

  async readSessionHistory(sessionId: string, options: { beforeSeq?: number; limit?: number } = {}): Promise<ExternalSessionHistory> {
    this.assertUsable()
    if (!isSafeId(sessionId)) throw new Error('invalid external session id')
    const sessions = await this.listSessions()
    const session = sessions.find((item) => item.id === sessionId)
    if (session === undefined) throw new Error(`external session not found: ${sessionId}`)
    const parsed = await this.readSessionFile(session.path, { headerOnly: false })
    const filtered = parsed.events.filter((event) => options.beforeSeq === undefined || event.seq < options.beforeSeq)
    const requestedLimit = options.limit === undefined ? MAX_HISTORY_EVENTS : Math.max(0, options.limit)
    const events = requestedLimit === 0 ? [] : filtered.slice(-requestedLimit)
    const title = await this.readProjectionTitle(sessionId, parsed.events)
    const enriched = title === undefined || session.title !== undefined ? session : { ...session, title }
    if (parsed.incompatible) {
      const reason = parsed.reason ?? 'session-format-version'
      return {
        source: SOURCE,
        canMutate: true,
        concurrency: 'no-concurrent-writes',
        session: { ...session, status: 'incompatible' },
        events: [],
        tailIncomplete: false,
        status: 'incompatible',
        reason,
      }
    }
    return {
      source: SOURCE,
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      session: enriched,
      events,
      tailIncomplete: parsed.tailIncomplete,
      status: parsed.tailIncomplete ? 'incomplete' : 'ok',
    }
  }

  async listWorkspaces(): Promise<ExternalWorkspaceSnapshot> {
    this.assertUsable()
    const file = await this.allowedFile(join(this.sourceHome, 'storages', WORKSPACE_FILE))
    let raw = ''
    let second = ''
    let stable = false
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const first = await this.fileRevision(file)
      raw = await readFile(file, 'utf8')
      second = await this.fileRevision(file)
      if (first === second) { stable = true; break }
    }
    if (!stable) throw new Error('workspace snapshot changed during read')
    let value: unknown
    try { value = JSON.parse(raw) } catch { throw new Error('workspace schema/version is invalid') }
    const record = asRecord(value)
    const unit = asRecord(record?.unit)
    if (unit?.name !== 'workspace' || typeof unit.version !== 'number' || unit.version < 1) throw new Error('workspace schema/version is invalid')
    const tables = asRecord(record?.tables)
    const workspaces = asRecord(tables?.workspaces)
    const global = asRecord(record?.global)
    const archived = arrayOfStrings(global?.archivedSessionIds)
    const rows: ExternalWorkspace[] = []
    for (const [workspaceId, row] of Object.entries(workspaces ?? {})) {
      const item = asRecord(row)
      if (item === undefined || typeof item.path !== 'string') continue
      rows.push({ source: SOURCE, canMutate: true, concurrency: 'no-concurrent-writes', workspaceId, path: item.path, ...(typeof item.title === 'string' ? { title: item.title } : {}), sessionIds: arrayOfStrings(item.sessionIds), archivedSessionIds: archived, ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}), ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}) })
    }
    return { source: SOURCE, canMutate: true, concurrency: 'no-concurrent-writes', revision: second, workspaces: rows }
  }

  async getSessionRevision(sessionId: string): Promise<string | undefined> {
    this.assertUsable()
    if (!isSafeId(sessionId)) return undefined
    const sessions = await this.listSessions()
    const session = sessions.find((item) => item.id === sessionId)
    if (session === undefined) return undefined
    try { return await this.fileRevision(session.path) } catch { return undefined }
  }

  async getWorkspaceRevision(): Promise<string | undefined> {
    this.assertUsable()
    try {
      const file = await this.allowedFile(join(this.sourceHome, 'storages', WORKSPACE_FILE))
      return await this.fileRevision(file)
    } catch { return undefined }
  }

  async checkSessionRevision(sessionId: string, expectedRevision: string): Promise<ExternalDshConflictStatus> {
    const currentRevision = await this.getSessionRevision(sessionId)
    return {
      source: SOURCE,
      kind: 'session',
      id: sessionId,
      expectedRevision,
      ...(currentRevision === undefined ? { state: 'unavailable' as const } : { state: currentRevision === expectedRevision ? 'clean' as const : 'conflict' as const, currentRevision }),
    }
  }

  async checkWorkspaceRevision(expectedRevision: string): Promise<ExternalDshConflictStatus> {
    const currentRevision = await this.getWorkspaceRevision()
    return {
      source: SOURCE,
      kind: 'workspace',
      expectedRevision,
      ...(currentRevision === undefined ? { state: 'unavailable' as const } : { state: currentRevision === expectedRevision ? 'clean' as const : 'conflict' as const, currentRevision }),
    }
  }

  async readProjectionCache(sessionId: string): Promise<ExternalProjectionSnapshot | undefined> {
    this.assertUsable()
    if (!this.projectionEnabled || !isSafeId(sessionId)) return undefined
    let file: string
    try { file = await this.allowedFile(join(this.sourceHome, 'storages', PROJECTION_FILE)) } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined
      return undefined
    }
    let value: unknown
    try { value = JSON.parse(await readFile(file, 'utf8')) } catch { return undefined }
    const row = asRecord(asRecord(asRecord(value)?.tables)?.sessions)?.[sessionId]
    const session = asRecord(row)
    const identity = asRecord(session?.identity)
    if (session === undefined || identity === undefined) return undefined
    const unit = asRecord(asRecord(value)?.unit)
    if (unit?.name !== PROJECTION_FILE.replace('.json', '') || typeof unit.version !== 'number' || unit.version < 1) return undefined
    const rows = asRecord(session.rows)
    const values: Record<string, unknown> = {}
    let revision = 0
    for (const [key, raw] of Object.entries(rows ?? {})) {
      const item = asRecord(raw)
      if (item === undefined || typeof item.seq !== 'number' || !('val' in item)) continue
      revision = Math.max(revision, item.seq)
      values[key] = item.val
    }
    return {
      source: SOURCE,
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      sessionId,
      revision,
      identity: {
        ...(typeof identity.createdAt === 'number' ? { createdAt: identity.createdAt } : {}),
        ...(typeof identity.cwd === 'string' ? { cwd: identity.cwd } : {}),
      },
      values,
    }
  }

  async readAttachment(reference: ExternalAttachmentRef): Promise<VerifiedAttachment | undefined> {
    this.assertUsable()
    if (!this.attachmentsEnabled) return undefined
    const relativePath = reference.path.replaceAll('\\', '/')
    if (relativePath.startsWith('/') || relativePath.includes('..')) throw new Error('invalid external attachment reference')
    const file = await this.allowedFile(join(this.sourceHome, 'attachments', relativePath))
    const info = await stat(file)
    const max = Math.min(reference.maxBytes ?? this.maxAttachmentBytes, this.maxAttachmentBytes)
    if (info.size > max) throw new Error('external attachment exceeds configured limit')
    const bytes = new Uint8Array(await readFile(file))
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (reference.digest !== undefined && reference.digest !== digest) throw new Error('external attachment digest mismatch')
    const image = inspectImage(bytes)
    if (reference.mimeType !== undefined && reference.mimeType !== image.mimeType) throw new Error('external attachment format mismatch')
    if (image.width > this.maxImageDimension || image.height > this.maxImageDimension || image.width * image.height > this.maxImagePixels) {
      throw new Error('external attachment dimensions exceed configured limit')
    }
    return { source: SOURCE, canMutate: true, concurrency: 'no-concurrent-writes', bytes, digest, ...image }
  }

  subscribe(listener: (change: ExternalDshChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private assertUsable(): void {
    if (this.boundaryViolation) throw new Error('external DSH source overlaps the Cocode runtime home')
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const watcher of this.watchers.splice(0)) watcher.close()
    this.listeners.clear()
  }

  private startWatchers(): void {
    const targets = [
      { path: join(this.sourceHome, 'sessions'), kind: 'sessions' as const },
      { path: join(this.sourceHome, 'storages', WORKSPACE_FILE), kind: 'workspace' as const },
      ...(this.projectionEnabled ? [{ path: join(this.sourceHome, 'storages', PROJECTION_FILE), kind: 'projection-cache' as const }] : []),
      ...(this.attachmentsEnabled ? [{ path: join(this.sourceHome, 'attachments'), kind: 'attachments' as const }] : []),
    ]
    for (const target of targets) {
      // Never fall back to watching the source-home or storages parent when an
      // allowlisted target is absent. A parent watch would observe profile,
      // credentials, settings, and unrelated storage mutations outside this
      // reader's contract. Missing targets are reported by the next explicit
      // refresh instead.
      if (!existsSync(target.path)) continue
      try {
        if (lstatSync(target.path).isSymbolicLink()) continue
      } catch {
        continue
      }
      const watchTarget = target.path
      try {
        const watcher = watchSync(watchTarget, { persistent: false }, (_event, filename) => {
          if (this.disposed) return
          const name = filename?.toString() ?? ''
          this.listeners.forEach((listener) => listener({ kind: target.kind, path: join(target.path, name) }))
        })
        this.watchers.push(watcher)
      } catch { /* watcher is an optional acceleration */ }
    }
  }

  private async sessionsRoot(): Promise<string> {
    const source = await realpath(this.sourceHome)
    const candidate = join(source, 'sessions')
    try { return await this.canonicalAllowedRoot(candidate, source) } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return candidate
      throw error
    }
  }

  private async canonicalAllowedRoot(candidate: string, source: string): Promise<string> {
    const canonical = await realpath(candidate)
    const expected = join(source, basename(candidate))
    if (canonical !== expected) throw new Error('external DSH allowlist symlink escape')
    return canonical
  }

  private async allowedFile(candidate: string): Promise<string> {
    const source = await realpath(this.sourceHome)
    const target = await realpath(candidate)
    const allowed = [join(source, 'sessions'), join(source, 'storages'), join(source, 'attachments')]
    if (!allowed.some((root) => isWithin(target, root))) throw new Error('external DSH path is outside the allowlist')
    const relativePath = relative(source, target).replaceAll('\\', '/')
    if (relativePath === `storages/${WORKSPACE_FILE}` || relativePath === `storages/${PROJECTION_FILE}` || relativePath.startsWith('sessions/') || relativePath.startsWith('attachments/')) return target
    throw new Error('external DSH path is outside the allowlist')
  }

  private async safeChild(parent: string, name: string): Promise<string> {
    if (!isSafePathSegment(name)) throw new Error('invalid external DSH path segment')
    const child = join(parent, name)
    const canonical = await realpath(child)
    if (!isWithin(canonical, parent)) throw new Error('external DSH symlink escape')
    return canonical
  }

  private async findSessionFile(directory: string): Promise<string | undefined> {
    const candidates = [join(directory, 'session.jsonl.zstd'), join(directory, 'session.jsonl')]
    const found: string[] = []
    for (const candidate of candidates) {
      try {
        const info = await stat(candidate)
        if (info.isFile()) found.push(await this.allowedFile(candidate))
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw error
      }
    }
    return found.length === 1 ? found[0] : undefined
  }

  private async readSessionFile(file: string, options: { headerOnly: boolean }): Promise<{ header?: Omit<ExternalSessionSummary, 'source' | 'canMutate' | 'concurrency' | 'path'>; events: ExternalSessionEvent[]; tailIncomplete: boolean; incompatible?: boolean; reason?: string }> {
    const safeFile = await this.allowedFile(file)
    const bytes = await readFile(safeFile)
    const decoded = safeFile.endsWith('.zstd') ? decodeZstdFrames(bytes) : { bytes, tailIncomplete: false }
    const lines = decoded.bytes.toString('utf8').split('\n')
    const first = lines.shift() ?? ''
    let tailIncomplete = decoded.tailIncomplete
    const headerValue = parseJson(first)
    const headerRecord = asRecord(headerValue)
    if (headerRecord?.type !== 'session' || typeof headerRecord.id !== 'string' || typeof headerRecord.createdAt !== 'number') return { events: [], tailIncomplete }
    const formatVersion = typeof headerRecord.version === 'number' ? headerRecord.version : 0
    const header = { id: headerRecord.id, createdAt: headerRecord.createdAt, formatVersion, ...(typeof headerRecord.cwd === 'string' ? { cwd: headerRecord.cwd } : {}), ...(typeof headerRecord.parentSession === 'string' ? { parentSession: headerRecord.parentSession } : {}), ...(typeof headerRecord.seedLength === 'number' ? { seedLength: headerRecord.seedLength } : {}) }
    if (!SUPPORTED_SESSION_VERSIONS.has(formatVersion)) return { header, events: [], tailIncomplete: false, incompatible: true, reason: 'session-format-version' }
    if (options.headerOnly) return { header, events: [], tailIncomplete }
    const events: ExternalSessionEvent[] = []
    for (const line of lines) {
      if (line.trim() === '') continue
      const value = parseJson(line)
      const record = asRecord(value)
      if (record === undefined) { tailIncomplete = true; continue }
      if (typeof record.type !== 'string' || record.type === 'session') { tailIncomplete = true; continue }
      let decodedRecords: readonly unknown[]
      try {
        decodedRecords = decodeStorageRecord(record)
      } catch {
        return { header, events: [], tailIncomplete: false, incompatible: true, reason: 'session-storage-record' }
      }
      for (const event of decodedRecords) {
        const item = asRecord(event)
        const seq = typeof item?.seq === 'number' ? item.seq : undefined
        const time = typeof item?.time === 'number' ? item.time : undefined
        if (typeof item?.type !== 'string' || seq === undefined || time === undefined || !('data' in item)) {
          return { header, events: [], tailIncomplete: false, incompatible: true, reason: 'session-storage-record' }
        }
        events.push({ type: item.type, seq, time, data: item.data, ...(item.ignorable === true ? { ignorable: true } : {}) })
      }
    }
    return { header, events, tailIncomplete }
  }

  private async fileRevision(file: string): Promise<string> {
    const info = await stat(file)
    return `${info.mtimeMs}:${info.size}:${info.ino ?? ''}`
  }

  private async readProjectionTitle(sessionId: string, events: readonly ExternalSessionEvent[] = []): Promise<string | undefined> {
    const cache = await this.readProjectionCache(sessionId)
    const maxEventSeq = events.reduce((max, event) => Math.max(max, event.seq), -1)
    if (cache !== undefined && cache.revision < maxEventSeq) return undefined
    const title = cache?.values.title
    return typeof title === 'string' && title.trim() !== '' ? title : undefined
  }
}

export function createExternalDshReadSource(options: ExternalDshReadSourceOptions = {}): ExternalDshReadSource {
  return new ExternalDshReader(options)
}

function foldDisplay(events: readonly ExternalSessionEvent[]): { title?: string; preview?: string; updatedAt?: number } {
  let title: string | undefined
  let preview: string | undefined
  let updatedAt: number | undefined
  for (const event of events) {
    updatedAt = event.time
    const data = asRecord(event.data)
    if (event.type === 'session/title' && typeof data?.title === 'string') title = cleanText(data.title)
    if (preview === undefined && event.type === 'user/message') {
      const content = data?.content
      if (typeof content === 'string') preview = cleanText(content)
      else if (Array.isArray(content)) preview = cleanText(content.map((item) => asRecord(item)?.text).filter((item): item is string => typeof item === 'string').join(' '))
    }
  }
  return { ...(title === undefined ? {} : { title }), ...(preview === undefined ? {} : { preview }), ...(updatedAt === undefined ? {} : { updatedAt }) }
}

function cleanText(value: string): string | undefined {
  const normalized = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (normalized === '') return undefined
  return Array.from(normalized).length > 72 ? `${Array.from(normalized).slice(0, 71).join('')}…` : normalized
}

function inspectImage(bytes: Uint8Array): { mimeType: string; width: number; height: number } {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && ascii(bytes, 12, 16) === 'IHDR') {
    return validDimensions('image/png', readU32Be(bytes, 16), readU32Be(bytes, 20))
  }
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF89a' || ascii(bytes, 0, 6) === 'GIF87a')) {
    return validDimensions('image/gif', readU16Le(bytes, 6), readU16Le(bytes, 8))
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    const chunk = ascii(bytes, 12, 16)
    if (chunk === 'VP8X') return validDimensions('image/webp', 1 + readU24Le(bytes, 24), 1 + readU24Le(bytes, 27))
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return validDimensions('image/webp', readU16Le(bytes, 26) & 0x3fff, readU16Le(bytes, 28) & 0x3fff)
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const width = 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8)
      const height = 1 + ((bytes[22]! & 0xc0) >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10)
      return validDimensions('image/webp', width, height)
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]!
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
      if (marker === 0xda) break
      const length = readU16Be(bytes, offset + 2)
      if (length < 2 || offset + length + 2 > bytes.length) break
      if (isJpegStartOfFrame(marker)) {
        return validDimensions('image/jpeg', readU16Be(bytes, offset + 7), readU16Be(bytes, offset + 5))
      }
      offset += length + 2
    }
  }
  throw new Error('unsupported external attachment format')
}

function validDimensions(mimeType: string, width: number, height: number): { mimeType: string; width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('external attachment dimensions are invalid')
  }
  return { mimeType, width, height }
}

function isJpegStartOfFrame(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder().decode(bytes.slice(start, end))
}

function readU16Be(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]! }
function readU16Le(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8) }
function readU24Le(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) }
function readU32Be(bytes: Uint8Array, offset: number): number { return ((bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0 }

/** DSH writes one JSONL record per concatenated Zstandard frame. Node's
 * streaming decoder stops at the first frame, so decode frames independently;
 * a truncated final frame is retained as an in-memory incomplete tail. */
function decodeZstdFrames(input: Buffer): { bytes: Buffer; tailIncomplete: boolean } {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const starts: number[] = []
  for (let index = 0; index <= input.length - magic.length; index += 1) {
    if (input.subarray(index, index + magic.length).equals(magic)) starts.push(index)
  }
  if (starts.length === 0 || starts[0] !== 0) return { bytes: Buffer.alloc(0), tailIncomplete: true }
  const chunks: Buffer[] = []
  let current = 0
  let startIndex = 0
  let tailIncomplete = false
  while (current < input.length) {
    while (startIndex < starts.length && starts[startIndex]! <= current) startIndex += 1
    let decoded: Buffer | undefined
    let next = input.length
    for (let endIndex = startIndex; endIndex < starts.length; endIndex += 1) {
      const end = starts[endIndex]!
      try {
        decoded = zstdDecompressSync(input.subarray(current, end))
        next = end
        break
      } catch {
        // The candidate ended in the middle of this frame; try the next magic.
      }
    }
    if (decoded === undefined) {
      try {
        decoded = zstdDecompressSync(input.subarray(current))
        next = input.length
      } catch {
        // Preserve complete frames and expose the final incomplete tail.
      }
    }
    if (decoded === undefined) { tailIncomplete = true; break }
    chunks.push(decoded)
    current = next
    if (current === input.length) break
    if (starts[startIndex] !== current) { tailIncomplete = true; break }
  }
  return { bytes: Buffer.concat(chunks), tailIncomplete }
}

function isWithin(target: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function isSafeId(value: string): boolean { return /^[A-Za-z0-9._-]+$/.test(value) }
function isSafePathSegment(value: string): boolean { return value !== '' && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') }
function expandHome(value: string): string { return value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value }
function parseJson(value: string): unknown { try { return JSON.parse(value) } catch { return undefined } }
function asRecord(value: unknown): Record<string, any> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, any> : undefined }
function arrayOfStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }

function boundaryPath(value: string): string {
  try { return realpathSync.native(value) } catch { return resolve(value) }
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}
