import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { watch } from 'chokidar'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { CredentialProvider, credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
} from '@deepseek-ai/dsh-credentials'
import {
  deleteCredentialRecord,
  loadCredentials,
  modifyCredentialRecord,
  refreshCredentials,
  sameCredentialRecord,
  writeCredentialRef,
  type CredentialsDocument,
} from './credentials-local.js'

function spec(config: { path?: string; dshHome?: string; watch?: boolean; debounceMs?: number }) {
  return {
    filename: config.path!,
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 100,
  }
}

export class LocalCredentialProvider extends CredentialProvider {
  static Config = z.object({
    path: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
  })

  private readonly spec: ReturnType<typeof spec>
  private document: CredentialsDocument = { layout: 'empty', refs: new Map(), records: new Map(), text: '' }
  private closed = false
  private operations = Promise.resolve()

  constructor(ctx: Context, private readonly config: { path: string; dshHome: string; watch?: boolean; debounceMs?: number }) {
    super(ctx)
    this.spec = spec(config)
  }

  private inherited(ref: string): string | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['process'])
    return entry?.value?.length ? entry.value : undefined
  }

  private fallback(ref: string) {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['project-env', 'user-env'])
    return entry?.value?.length ? entry : undefined
  }

  private async loadCurrent(): Promise<void> {
    this.document = await loadCredentials(this.spec.filename)
    this.ctx.logger.info(`credentials-local: document-layout=${this.document.layout}`)
  }

  private notifyDocumentChanges(previous: CredentialsDocument, next: CredentialsDocument): void {
    for (const ref of new Set([...previous.refs.keys(), ...next.refs.keys()])) {
      if (previous.refs.get(ref) !== next.refs.get(ref)) this.notifyUpdated(credentialRef(ref))
    }
    for (const key of new Set([...previous.records.keys(), ...next.records.keys()])) {
      if (sameCredentialRecord(previous.records.get(key), next.records.get(key))) continue
      this.notifyRecordUpdated(parseCredentialKey(key))
    }
  }

  async *[Service.init]() {
    yield async () => { this.closed = true; await this.operations }
    await this.loadCurrent()
    if (!this.spec.watch) return
    const watcher = watch(this.spec.filename, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.spec.debounceMs,
        pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)),
      },
    })
    watcher.on('all', () => { if (!this.closed) this.queueRefresh() })
    yield async () => { this.closed = true; await watcher.close(); await this.operations }
  }

  resolve(ref: string) {
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return Promise.resolve({ value: inherited, source: 'env' })
    const value = this.document.refs.get(ref)
    if (value !== undefined) return Promise.resolve({ value, source: 'file' })
    const fallback = this.fallback(ref)
    return Promise.resolve(fallback === undefined ? undefined : { value: fallback.value, source: fallback.source })
  }

  describe(ref: string) {
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return Promise.resolve({ configured: true, source: 'env', writable: false })
    if (this.document.refs.has(ref)) return Promise.resolve({ configured: true, source: 'file', writable: true })
    const fallback = this.fallback(ref)
    return Promise.resolve(fallback === undefined ? { configured: false, writable: true } : { configured: true, source: fallback.source, writable: true })
  }

  set(ref: string, value: string) {
    if (!value.length) throw new Error('credentials-local: empty value')
    return this.write(ref, value)
  }

  unset(ref: string) {
    return this.write(ref, undefined)
  }

  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.document.records.get(key) as CredentialRecord | undefined)
  }

  describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = this.document.records.get(key)
    return Promise.resolve(stored === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: stored.kind as CredentialRecord['kind'], writable: true })
  }

  listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.document.records].map(([key, record]) => ({
      key: parseCredentialKey(key),
      kind: record.kind as CredentialRecord['kind'],
    })))
  }

  modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    if (this.closed) throw new Error(`credentials-local: disposed; cannot modify "${key}"`)
    const task = this.operations.then(async () => {
      if (this.closed) throw new Error(`credentials-local: disposed before modifying "${key}"`)
      const result = await modifyCredentialRecord(this.spec.filename, key, async current => mutate(current as CredentialRecord | undefined))
      const previous = this.document
      this.document = result.document
      if (result.changed && !sameCredentialRecord(previous.records.get(key), this.document.records.get(key))) {
        this.notifyRecordUpdated(key)
      }
      return result.record as CredentialRecord | undefined
    })
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  deleteRecord(key: CredentialKey): Promise<void> {
    if (this.closed) throw new Error(`credentials-local: disposed; cannot delete "${key}"`)
    const task = this.operations.then(async () => {
      if (this.closed) throw new Error(`credentials-local: disposed before deleting "${key}"`)
      const result = await deleteCredentialRecord(this.spec.filename, key)
      const previous = this.document
      this.document = result.document
      if (result.changed && previous.records.has(key)) this.notifyRecordUpdated(key)
    })
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  private write(ref: string, value: string | undefined) {
    const credential = credentialRef(ref)
    if (this.inherited(ref) !== undefined) throw new Error(`credentials-local: "${ref}" is supplied by the launching environment`)
    const task = this.operations.then(async () => {
      await writeCredentialRef(this.spec.filename, credential, value)
      const previous = this.document
      await this.loadCurrent()
      this.notifyDocumentChanges(previous, this.document)
    })
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  private queueRefresh() {
    const task = this.operations.then(async () => {
      if (this.closed) return
      const previous = this.document
      try {
        const next = await refreshCredentials(this.spec.filename, previous)
        this.document = next
        this.notifyDocumentChanges(previous, next)
      } catch (error) {
        const details = error as { code?: unknown; line?: unknown; column?: unknown; field?: unknown }
        const code = typeof details.code === 'string' ? details.code : 'CREDENTIALS_RELOAD_FAILED'
        const location = Number.isInteger(details.line) && Number.isInteger(details.column)
          ? ` at ${String(details.line)}:${String(details.column)}`
          : ''
        const field = typeof details.field === 'string' ? ` field=${details.field}` : ''
        this.ctx.logger.warn(`credentials-local: reload failed (${code}${field}${location})`)
      }
    })
    this.operations = task.then(() => undefined, () => undefined)
  }
}

export default LocalCredentialProvider
