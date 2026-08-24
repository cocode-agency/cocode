import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { watch } from 'chokidar'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Document, parseDocument } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { canonicalizeWatchPath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'

const VERSION = 1
const FILE = '.credentials.yaml'

function spec(config) { return { filename: resolve(config.path ?? join(resolveDshHome(config.dshHome), FILE)), watch: config.watch ?? true, debounceMs: config.debounceMs ?? 100 } }
function missing(error) { return error?.code === 'ENOENT' }
async function ownerOnly(filename) {
  try {
    const mode = (await stat(filename)).mode
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) throw new Error(`credentials-local: ${filename} is readable beyond its owner`)
  } catch (error) {
    if (!missing(error)) throw error
    await canonicalizeWatchPath(filename)
  }
}
function parseValues(text, filename) {
  const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(`credentials-local: invalid document at ${filename}`)
  const root = document.toJS() ?? {}
  if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new TypeError(`credentials-local: ${filename} must be a mapping`)
  if (root.version !== undefined && root.version !== VERSION) throw new Error(`credentials-local: unsupported document version`)
  if (root.version === VERSION && Object.keys(root).some(key => !['version', 'refs', 'records'].includes(key))) throw new Error(`credentials-local: unknown top-level field`)
  const section = root.version === VERSION ? root.refs ?? {} : root
  if (typeof section !== 'object' || section === null || Array.isArray(section)) throw new TypeError(`credentials-local: refs must be a mapping`)
  const values = new Map()
  for (const [key, value] of Object.entries(section)) {
    if (root.version !== VERSION && ['version', 'refs', 'records'].includes(key)) continue
    credentialRef(key)
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`credentials-local: invalid value for ${key}`)
    values.set(key, value)
  }
  return { values, versioned: root.version === VERSION }
}
function render(text, ref, value) {
  const parsed = text === undefined ? { values: new Map(), versioned: true } : parseValues(text, FILE)
  const document = text === undefined ? new Document({ version: VERSION, refs: {} }) : parsed.versioned ? parseDocument(text) : new Document({ version: VERSION, refs: Object.fromEntries(parsed.values) })
  document.setIn(['version'], VERSION)
  if (value === undefined) document.deleteIn(['refs', ref])
  else document.setIn(['refs', ref], value)
  return document.toString()
}

export class LocalCredentialProvider extends CredentialProvider {
  static Config = z.object({ path: z.string(), dshHome: z.string(), watch: z.boolean().default(true), debounceMs: z.number().min(0).default(100) })
  constructor(ctx, config) { super(ctx); this.spec = spec(config); this.values = new Map(); this.text = undefined; this.closed = false; this.operations = Promise.resolve() }
  inherited(ref) { const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['process']); return entry?.value?.length ? entry.value : undefined }
  fallback(ref) { const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['project-env', 'user-env']); return entry?.value?.length ? entry : undefined }
  async *[Service.init]() {
    yield async () => { this.closed = true; await this.operations }
    await this.load()
    if (!this.spec.watch) return
    const watcher = watch(await canonicalizeWatchPath(this.spec.filename), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: this.spec.debounceMs, pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)) } })
    watcher.on('all', () => { if (!this.closed) this.queueRefresh() })
    yield async () => { this.closed = true; await watcher.close(); await this.operations }
  }
  resolve(ref) { const inherited = this.inherited(ref); if (inherited !== undefined) return Promise.resolve({ value: inherited, source: 'env' }); if (this.values.has(ref)) return Promise.resolve({ value: this.values.get(ref), source: 'file' }); const fallback = this.fallback(ref); return Promise.resolve(fallback === undefined ? undefined : { value: fallback.value, source: fallback.source }) }
  describe(ref) { if (this.inherited(ref) !== undefined) return Promise.resolve({ configured: true, source: 'env', writable: false }); if (this.values.has(ref)) return Promise.resolve({ configured: true, source: 'file', writable: true }); const fallback = this.fallback(ref); return Promise.resolve(fallback === undefined ? { configured: false, writable: true } : { configured: true, source: fallback.source, writable: true }) }
  set(ref, value) { if (!value.length) throw new Error(`credentials-local: empty value`); return this.write(ref, value) }
  unset(ref) { return this.write(ref, undefined) }
  write(ref, value) { if (this.inherited(ref) !== undefined) throw new Error(`credentials-local: "${ref}" is supplied by the launching environment`); const task = this.operations.then(async () => { await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 }); await withFileLock(this.spec.filename, async () => { await this.refreshFromDisk(); const text = render(this.text, ref, value); await writeFileAtomic(this.spec.filename, text, { mode: 0o600, dirMode: 0o700 }); this.text = text; value === undefined ? this.values.delete(ref) : this.values.set(ref, value); this.notifyUpdated(ref) }) }); this.operations = task.then(() => undefined, () => undefined); return task }
  async load() { await ownerOnly(this.spec.filename); try { this.text = await readFile(this.spec.filename, 'utf8') } catch (error) { if (missing(error)) return; throw error }; this.values = parseValues(this.text, this.spec.filename).values }
  queueRefresh() { this.enqueue(() => this.refreshFromDisk()).catch((error) => { this.ctx.logger.warn(`credentials-local: reload failed at ${this.spec.filename}`); this.ctx.logger.warn(error) }) }
  async refresh() { if (!this.closed) await this.enqueue(() => this.refreshFromDisk()) }
  async refreshFromDisk() { await ownerOnly(this.spec.filename); let text; try { text = await readFile(this.spec.filename, 'utf8') } catch (error) { if (missing(error)) text = undefined; else throw error }; if (text === this.text || this.closed) return; const previous = this.values; const next = text === undefined ? new Map() : parseValues(text, this.spec.filename).values; this.values = next; this.text = text; for (const ref of new Set([...previous.keys(), ...next.keys()])) if (previous.get(ref) !== next.get(ref)) this.notifyUpdated(ref) }
}
export default LocalCredentialProvider
