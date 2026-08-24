import net from 'node:net'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { endpointFor, descriptorPath, leaseDirectory, lockPath, scopePath } from './paths.js'
import { resolveCocodeLogLayout } from './observability.js'
import { listenLineServer, writeLineFrame } from './ipc.js'
import {
  createLeaseRecord,
  HOST_ACQUIRE_ABANDONED_MESSAGE,
  isLeaseActive,
  type LeaseRecord,
} from './lifecycle.js'
import { canonicalizeScope, HOST_PROTOCOL_REVISION, hostKey, isHostDescriptorCompatible, leaseId as makeLeaseId, LEASE_TTL_MS, SUPERVISOR_BUILD_REVISION, SUPERVISOR_PROTOCOL_REVISION, type AcquireHostRequest, type HostDescriptor, type HostScope } from './protocol.js'
import { mergeHostRuntimeEnv, prepareRuntimeSlot } from './runtime.js'
import { HostLogger } from './logging.js'
import { loadCredentials } from './credentials-local.js'

type AcquireRequest = AcquireHostRequest & { clientPid?: number }
type HostProcess = { child: ReturnType<typeof spawn> | null; descriptor: HostDescriptor; idleTimer?: NodeJS.Timeout }

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
/**
 * How long a Host may take to unwind before it is killed. Workbench shutdown
 * disposes PTYs and browser contexts, which regularly overran the original two
 * seconds and forced a SIGKILL on an otherwise healthy exit.
 */
const HOST_TERMINATE_GRACE_MS = Number(process.env.COCODE_HOST_TERMINATE_GRACE_MS ?? 8_000)
const HOST_KILL_GRACE_MS = 2_000

export async function runSupervisorService(stateDirectory: string): Promise<void> {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
  const scope = JSON.parse(readFileSync(scopePath(stateDirectory), 'utf8')) as HostScope
  const logger = new HostLogger({
    stateDirectory,
    scope,
    logDirectory: join(resolveCocodeLogLayout().host, hostKey(scope)),
  })
  const service = new SupervisorService(stateDirectory, scope, logger)
  const signals = installShutdownSignals(service, logger)
  try {
    await service.start()
    await service.wait()
  } catch (error) {
    logger.log('fatal', 'supervisor.failed', { error: error instanceof Error ? error.message : String(error) })
    throw error
  } finally {
    signals.dispose()
    logger.close()
  }
}

/**
 * Idle shutdown lives in this process, so a Supervisor that exits without
 * stopping its Host strands one that nothing will ever reclaim.
 */
function installShutdownSignals(service: SupervisorService, logger: HostLogger): { dispose: () => void } {
  const registered = SHUTDOWN_SIGNALS.map((signal) => {
    const handler = (): void => {
      logger.log('info', 'supervisor.signal.received', { signal })
      void service.stop()
    }
    process.on(signal, handler)
    return { signal, handler }
  })
  return {
    dispose: (): void => {
      for (const { signal, handler } of registered) process.off(signal, handler)
    },
  }
}

class SupervisorService {
  private get endpoint(): string { return endpointFor(this.directory) }
  private readonly leases = new Map<string, LeaseRecord>()
  private host: HostProcess | null = null
  private server: net.Server | null = null
  private stopped = false
  private hadHost = false
  private lockOwned = false
  private stopPromise: Promise<void> | null = null
  private hostStopPromise: Promise<void> | null = null

  constructor(private readonly directory: string, private readonly scope: HostScope, private readonly logger: HostLogger) {}

  async start(): Promise<void> {
    this.logger.log('info', 'supervisor.start', { pid: process.pid })
    mkdirSync(leaseDirectory(this.directory), { recursive: true, mode: 0o700 })
    this.acquireLock()
    this.loadLeases()
    this.server = net.createServer((socket) => this.accept(socket))
    await listenLineServer(this.server, this.endpoint)
    if (process.platform !== 'win32') {
      const fs = await import('node:fs/promises')
      await fs.chmod(this.endpoint, 0o600).catch(() => undefined)
    }
    await this.recoverExistingHost()
  }

  wait(): Promise<void> {
    return new Promise((resolve) => {
      const poll = () => {
        if (this.stopped) { void (this.stopPromise ?? Promise.resolve()).then(resolve); return }
        this.cleanupLeases()
        if (this.hadHost && !this.host && this.hostStopPromise === null && this.leases.size === 0) {
          void this.stop().then(resolve)
          return
        }
        setTimeout(poll, 2_000).unref()
      }
      poll()
    })
  }

  private accept(socket: net.Socket): void {
    let buffer = ''
    let chain = Promise.resolve()
    const connection = new AbortController()
    const onError = (): void => {
      if (!socket.destroyed) socket.destroy()
    }
    const onLine = (chunk: Buffer | string) => {
      buffer += chunk.toString()
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        chain = chain.then(() => this.handleRaw(socket, line, connection.signal)).catch(() => undefined)
      }
    }
    socket.on('data', onLine)
    socket.on('error', onError)
    socket.once('close', () => {
      connection.abort()
      socket.off('data', onLine)
      socket.off('error', onError)
    })
  }

  private async handleRaw(socket: net.Socket, line: string, signal: AbortSignal): Promise<void> {
    let frame: { id?: number; method?: string; params?: Record<string, unknown> }
    try { frame = JSON.parse(line) } catch { return }
    if (typeof frame.id !== 'number' || typeof frame.method !== 'string') return
    try {
      const result = await this.handle(frame.method, frame.params ?? {}, signal)
      writeLineFrame(socket, { jsonrpc: '2.0', id: frame.id, result })
    } catch (error) {
      const details = error as { code?: unknown }
      writeLineFrame(socket, {
        jsonrpc: '2.0',
        id: frame.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
          ...(typeof details.code === 'string' ? { data: { code: details.code } } : {}),
        },
      })
    }
  }

  private async handle(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    switch (method) {
      case 'acquire': return this.acquire(params as unknown as AcquireRequest, signal)
      case 'renew': return this.renew(String(params.leaseId))
      case 'release': return this.release(String(params.leaseId))
      case 'status': return this.status()
      case 'stop': {
        const descriptor = await this.status()
        await this.stop(params.force === true)
        return { stopped: true, descriptor }
      }
      case 'doctor': return this.doctor()
      default: throw new Error(`unknown supervisor method: ${method}`)
    }
  }

  private async acquire(request: AcquireRequest, signal: AbortSignal): Promise<{ leaseId: string; expiresAt: string; descriptor: HostDescriptor }> {
    this.cleanupLeases()
    this.logger.log('debug', 'host.lease.acquire.started', { clientKind: request.clientKind, hostKey: hostKey(this.scope), requiredServices: request.requiredServices.join(',') })
    const requestedScope = canonicalizeScope(request.scope)
    if (JSON.stringify(requestedScope) !== JSON.stringify(this.scope)) {
      throw new Error('Host scope does not match this Supervisor scope')
    }
    if (this.hostStopPromise !== null) await this.hostStopPromise
    if (!this.host || !isHostDescriptorCompatible(this.host.descriptor, this.scope, request)) {
      if (this.host && this.leases.size > 0) throw new Error('existing Host is incompatible while leases are active')
      if (this.host) await this.stopHost()
      try {
        await this.startHost(request)
      } catch (error) {
        // A failed first boot must not leave a Supervisor holding the scope
        // lock forever. The next client should be able to start fresh code.
        await this.stop()
        throw error
      }
    }
    const id = makeLeaseId()
    const record = createLeaseRecord({
      leaseId: id,
      clientKind: request.clientKind,
      clientPid: request.clientPid,
      fallbackPid: process.ppid,
      signal,
    })
    if (record === undefined) {
      this.logger.log('info', 'host.lease.acquire.abandoned', { clientKind: request.clientKind })
      if (this.host && this.leases.size === 0) this.armIdleShutdown()
      throw new Error(HOST_ACQUIRE_ABANDONED_MESSAGE)
    }
    this.leases.set(id, record)
    this.persistLease(record)
    if (this.host?.idleTimer) { clearTimeout(this.host.idleTimer); delete this.host.idleTimer }
    this.logger.log('info', 'host.lease.acquired', { clientKind: request.clientKind, leaseId: shortId(id), leaseCount: this.leases.size })
    return { leaseId: id, expiresAt: record.expiresAt, descriptor: this.host!.descriptor }
  }

  private async startHost(request: AcquireHostRequest): Promise<void> {
    const jsonRpcEndpoint = process.platform === 'win32' ? `\\\\.\\pipe\\cocode-dsh-jsonrpc-${hostKey(this.scope)}` : join(this.directory, 'dsh-jsonrpc.sock')
    const credentials = await loadCredentials(join(this.scope.dshHome, '.credentials.yaml'))
    this.logger.log('info', 'credentials.document.loaded', { layout: credentials.layout })
    const pluginPath = fileURLToPath(new URL('./host-jsonrpc-plugin.js', import.meta.url))
    const slot = prepareRuntimeSlot(this.scope, jsonRpcEndpoint, pluginPath, request.runtimeEnv)
    const workspace = join(this.scope.dshHome, 'workspaces', 'default')
    mkdirSync(workspace, { recursive: true })
    const args = this.scope.profile === 'web' ? ['web'] : ['--profile', this.scope.profile]
    args.push('--patch', slot.patch, '--port', '0')
    this.logger.log('info', 'dsh.host.spawn.started', { profile: this.scope.profile, runtimeChannel: this.scope.runtimeChannel })
    const child = spawn(process.execPath, [slot.entry, ...args], {
      cwd: workspace,
      env: {
        ...mergeHostRuntimeEnv(process.env, request.runtimeEnv, this.scope.dshHome, this.scope.profile),
        DSH_PROFILE: this.scope.profile,
        COCODE_DSH_PROFILE: this.scope.profile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // A Host owns its descendants.  On POSIX this gives us a stable process
      // group so shutdown can terminate the whole tree instead of only the
      // Node leader.  Windows uses taskkill /T in terminateProcessTree below.
      detached: process.platform !== 'win32',
      // The Supervisor that spawns this Host has no console of its own, so
      // Windows would give the Host a fresh console window whose close button
      // terminates the runtime under the client.  Both output streams are piped
      // into the Supervisor log, so the Host never needs a console.
      windowsHide: true,
    })
    const startupBuffer = new RingBuffer(256 * 1024)
    const streamBuffers = { stdout: '', stderr: '' }
    let readyObserved = false
    const consume = (stream: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const value = chunk.toString()
      startupBuffer.push(value)
      streamBuffers[stream] += value
      const lines = streamBuffers[stream].split(/\r?\n/)
      streamBuffers[stream] = lines.pop() ?? ''
      for (const line of lines) if (line.length > 0) this.logger.hostLine(stream, line)
      if (Buffer.byteLength(streamBuffers[stream], 'utf8') > 32 * 1024) {
        this.logger.hostLine(stream, `${streamBuffers[stream].slice(0, 32 * 1024)} [truncated]`)
        streamBuffers[stream] = ''
      }
    }
    const flushPartialLines = (): void => {
      for (const stream of ['stdout', 'stderr'] as const) {
        const line = streamBuffers[stream]
        if (line.length > 0) this.logger.hostLine(stream, line)
        streamBuffers[stream] = ''
      }
    }
    const rejectStartup = (reject: (error: Error) => void, error: Error): void => {
      if (readyObserved) return
      readyObserved = true
      reject(error)
    }
    const ready = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => rejectStartup(reject, startupFailureError(`DSH Host startup timed out.\n${startupBuffer.value}`, startupBuffer.value)), 60_000)
      const inspect = (chunk: Buffer | string) => {
        consume('stdout', chunk)
        const match = startupBuffer.value.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
        if (match?.[1] && !readyObserved) { readyObserved = true; clearTimeout(timer); resolve(match[1]) }
      }
      child.stdout?.on('data', inspect)
      child.stderr?.on('data', (chunk) => consume('stderr', chunk))
      child.once('error', (error) => {
        clearTimeout(timer)
        this.logger.log('error', 'dsh.host.spawn.failed', { errorCode: String((error as NodeJS.ErrnoException).code ?? 'unknown') })
        rejectStartup(reject, error instanceof Error ? error : new Error(String(error)))
      })
      child.once('exit', (code, signal) => {
        flushPartialLines()
        clearTimeout(timer)
        // An exit this Supervisor asked for is the normal end of a session; only
        // one it did not ask for signals a problem worth surfacing as an error.
        const expected = readyObserved && this.hostStopPromise !== null
        this.logger.log(expected ? 'info' : 'error', readyObserved ? 'dsh.host.exit' : 'dsh.host.exit.before-ready', {
          exitCode: code ?? -1,
          signal: signal ?? 'none',
          hostPid: child.pid ?? -1,
        })
        if (!readyObserved) rejectStartup(reject, startupFailureError(`DSH Host exited before ready: ${String(code ?? signal ?? 'unknown')}\n${startupBuffer.value}`, startupBuffer.value))
        if (this.host?.child === child) {
          this.host = null
          rmSync(descriptorPath(this.directory), { force: true })
        }
      })
    })
    let webUrl: string
    try {
      webUrl = await ready
      startupBuffer.clear()
      await waitHttp(webUrl)
      await waitJsonRpc(jsonRpcEndpoint)
    } catch (error) {
      await terminateChild(child)
      rmSync(descriptorPath(this.directory), { force: true })
      if (process.platform !== 'win32') rmSync(jsonRpcEndpoint, { force: true })
      throw error
    }
    const runtimeVersion = slot.version
    const descriptor: HostDescriptor = {
      schemaVersion: 1,
      hostKey: hostKey(this.scope),
      supervisorProtocolRevision: SUPERVISOR_PROTOCOL_REVISION,
      hostPid: child.pid ?? -1,
      supervisorPid: process.pid,
      dshHome: this.scope.dshHome,
      profile: this.scope.profile,
      runtimeVersion,
      ...(slot.buildId === undefined ? {} : { buildId: slot.buildId }),
      hostProtocolRevision: HOST_PROTOCOL_REVISION,
      hostConfigFingerprint: this.scope.hostConfigFingerprint,
      services: [
        { service: 'web', transport: 'tcp', endpoint: webUrl, protocolRevision: '1.0' },
        { service: 'jsonrpc', transport: process.platform === 'win32' ? 'named-pipe' : 'unix', endpoint: jsonRpcEndpoint, protocolRevision: '1.0' },
      ],
      capabilities: ['web', 'jsonrpc', 'session', 'event', 'workspace', 'approval', 'question'],
      startedAt: new Date().toISOString(),
    }
    this.host = { child, descriptor }
    this.hadHost = true
    this.writeDescriptor(descriptor)
    this.logger.log('info', 'dsh.host.ready', { hostPid: child.pid ?? -1, endpoint: webUrl })
  }

  private async status(): Promise<HostDescriptor | null> { return this.host?.descriptor ?? this.readDescriptor() }
  private renew(id: string): { expiresAt: string } { const record = this.leases.get(id); if (!record) throw new Error('unknown lease'); record.expiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString(); this.persistLease(record); this.logger.log('debug', 'host.lease.renewed', { leaseId: shortId(id) }); return { expiresAt: record.expiresAt } }
  private async release(id: string): Promise<Record<string, never>> { const existed = this.leases.delete(id); rmSync(join(leaseDirectory(this.directory), `${id}.json`), { force: true }); this.logger.log(existed ? 'info' : 'warn', existed ? 'host.lease.released' : 'host.lease.release.unknown', { leaseId: shortId(id), leaseCount: this.leases.size }); if (this.leases.size === 0 && this.host) this.armIdleShutdown(); return {} }
  private armIdleShutdown(): void { if (!this.host || this.host.idleTimer) return; const timeoutMs = Number(process.env.COCODE_HOST_IDLE_TIMEOUT_MS ?? 20_000); this.logger.log('info', 'dsh.host.idle-shutdown.armed', { timeoutMs }); this.host.idleTimer = setTimeout(() => { void this.stopHost() }, timeoutMs); this.host.idleTimer.unref?.() }
  private stopHost(): Promise<void> {
    if (this.hostStopPromise !== null) return this.hostStopPromise
    const host = this.host
    if (!host) return Promise.resolve()
    this.hostStopPromise = this.terminateHost(host).finally(() => {
      if (this.host === host) this.host = null
      this.hostStopPromise = null
      rmSync(descriptorPath(this.directory), { force: true })
      this.logger.log('info', 'dsh.host.stop.completed', { hostPid: host.child?.pid ?? host.descriptor.hostPid })
    })
    this.logger.log('info', 'dsh.host.stop.started', { hostPid: host.child?.pid ?? host.descriptor.hostPid })
    return this.hostStopPromise
  }
  private async terminateHost(host: HostProcess): Promise<void> {
    const pid = host.child?.pid ?? host.descriptor.hostPid
    await terminateProcessTree(
      pid,
      () => {
        if (process.platform === 'win32') {
          if (host.child !== null) host.child.kill('SIGTERM')
          else process.kill(pid, 'SIGTERM')
        } else {
          signalProcessGroup(pid, 'SIGTERM')
        }
      },
      () => this.logger.log('warn', 'dsh.host.stop.escalated', { hostPid: pid, graceMs: HOST_TERMINATE_GRACE_MS }),
    )
    this.logger.log('info', 'dsh.host.process-tree.stopped', { hostPid: pid })
  }
  private cleanupLeases(): void {
    const now = Date.now()
    let removed = false
    for (const record of this.leases.values()) {
      if (isLeaseActive(record, now, isProcessAlive)) continue
      removed = true
      this.leases.delete(record.leaseId)
      rmSync(join(leaseDirectory(this.directory), `${record.leaseId}.json`), { force: true })
      this.logger.log('warn', 'host.lease.expired', { leaseId: shortId(record.leaseId), clientKind: record.clientKind })
    }
    if (removed && this.leases.size === 0 && this.host) this.armIdleShutdown()
  }
  private loadLeases(): void {
    const now = Date.now()
    for (const file of readdirSync(leaseDirectory(this.directory), { withFileTypes: true })) {
      if (!file.name.endsWith('.json')) continue
      const path = join(leaseDirectory(this.directory), file.name)
      try {
        const record = JSON.parse(readFileSync(path, 'utf8')) as LeaseRecord
        if (isLeaseActive(record, now, isProcessAlive)) this.leases.set(record.leaseId, record)
        else rmSync(path, { force: true })
      } catch { rmSync(path, { force: true }) }
    }
  }
  private persistLease(record: LeaseRecord): void { writeFileSync(join(leaseDirectory(this.directory), `${record.leaseId}.json`), JSON.stringify(record) + '\n', { mode: 0o600 }) }
  private writeDescriptor(descriptor: HostDescriptor): void { const temp = `${descriptorPath(this.directory)}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(descriptor, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, descriptorPath(this.directory)) }
  private readDescriptor(): HostDescriptor | null { try { return JSON.parse(readFileSync(descriptorPath(this.directory), 'utf8')) as HostDescriptor } catch { return null } }
  private doctor(): Record<string, unknown> { return { supervisorProtocolRevision: SUPERVISOR_PROTOCOL_REVISION, supervisorBuildRevision: SUPERVISOR_BUILD_REVISION, scope: this.scope, descriptor: this.readDescriptor(), leaseCount: this.leases.size, pid: process.pid } }
  stop(force = true): Promise<void> {
    if (this.stopPromise !== null) return this.stopPromise
    this.cleanupLeases()
    if (!force && this.leases.size > 0) {
      throw new Error(`Cannot stop Host while ${this.leases.size} client lease(s) are active. Re-run with --force after closing GUI/TUI clients.`)
    }
    if (force) {
      for (const record of this.leases.values()) rmSync(join(leaseDirectory(this.directory), `${record.leaseId}.json`), { force: true })
      this.leases.clear()
    }
    this.stopped = true
    this.stopPromise = (async () => {
      await this.stopHost()
      this.server?.close()
      if (this.lockOwned) rmSync(lockPath(this.directory), { force: true })
      if (process.platform !== 'win32') rmSync(this.endpoint, { force: true })
    })()
    return this.stopPromise
  }

  private acquireLock(): void {
    for (;;) {
      try {
        const fd = openSync(lockPath(this.directory), 'wx', 0o600)
        try {
          writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n')
        } finally {
          closeSync(fd)
        }
        this.lockOwned = true
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        let pid: number | undefined
        try {
          const record = JSON.parse(readFileSync(lockPath(this.directory), 'utf8')) as { pid?: number }
          pid = record.pid
        } catch { /* stale or partially written lock */ }
        if (pid !== undefined && isProcessAlive(pid)) {
          throw new Error(`Host Supervisor is already running for ${this.directory}`)
        }
        rmSync(lockPath(this.directory), { force: true })
      }
    }
  }

  private async recoverExistingHost(): Promise<void> {
    const descriptor = this.readDescriptor()
    if (descriptor === null) return
    if (
      descriptor.hostKey !== hostKey(this.scope) ||
      descriptor.dshHome !== this.scope.dshHome ||
      descriptor.profile !== this.scope.profile ||
      descriptor.hostConfigFingerprint !== this.scope.hostConfigFingerprint
    ) {
      rmSync(descriptorPath(this.directory), { force: true })
      return
    }
    if (!isProcessAlive(descriptor.hostPid) || !(await hostHealth(descriptor))) {
      rmSync(descriptorPath(this.directory), { force: true })
      return
    }
    this.host = { child: null, descriptor }
    this.hadHost = true
    if (this.leases.size === 0) this.armIdleShutdown()
  }
}

function startupFailureError(message: string, output: string): Error {
  const error = new Error(message)
  const code = output.match(/\b(CREDENTIALS_[A-Z0-9_]+)\b/)?.[1]
  if (code !== undefined) Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

function shortId(value: string): string { return value.slice(0, 8) }

class RingBuffer {
  private buffer = Buffer.alloc(0)

  constructor(private readonly maxBytes: number) {}

  push(value: string): void {
    const incoming = Buffer.from(value)
    this.buffer = Buffer.concat([this.buffer, incoming])
    if (this.buffer.byteLength <= this.maxBytes) return
    this.buffer = this.buffer.subarray(-this.maxBytes)
  }

  get value(): string { return this.buffer.toString('utf8') }

  clear(): void { this.buffer = Buffer.alloc(0) }
}

async function waitHttp(url: string): Promise<void> { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { try { const response = await fetch(url); if (response.ok) return } catch {} await new Promise((resolve) => setTimeout(resolve, 100)) } throw new Error(`DSH Web service did not become ready at ${url}`) }
async function waitJsonRpc(endpoint: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const socket = net.createConnection(endpoint)
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve())
        socket.once('error', reject)
      })
      socket.destroy()
      return
    } catch { /* retry until the Host plugin has bound its endpoint */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`DSH JSON-RPC service did not become ready at ${endpoint}`)
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && isProcessAlive(pid)) await new Promise((resolve) => setTimeout(resolve, 100))
}

async function terminateChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.pid === undefined) return
  await terminateProcessTree(child.pid, () => {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else signalProcessGroup(child.pid!, 'SIGTERM')
  })
}

async function terminateProcess(pid: number, terminate: () => void, onEscalate?: () => void): Promise<void> {
  if (pid <= 0 || !isProcessAlive(pid)) return
  try { terminate() } catch { /* the process may have exited between checks */ }
  await waitForProcessExit(pid, HOST_TERMINATE_GRACE_MS)
  if (!isProcessAlive(pid)) return
  onEscalate?.()
  try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  await waitForProcessExit(pid, HOST_KILL_GRACE_MS)
}

/** Terminate a Host and every descendant it owns, not only the leader PID. */
async function terminateProcessTree(pid: number, terminate: () => void, onEscalate?: () => void): Promise<void> {
  if (pid <= 0 || !isProcessAlive(pid)) return
  try { terminate() } catch { /* the process may have exited between checks */ }
  await waitForProcessTreeExit(pid, HOST_TERMINATE_GRACE_MS)
  if (!isProcessTreeAlive(pid)) return
  onEscalate?.()
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      signalProcessGroup(pid, 'SIGKILL')
    }
  } catch { /* already gone */ }
  await waitForProcessTreeExit(pid, HOST_KILL_GRACE_MS)
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  // The Host is spawned detached on POSIX, so -pid addresses its process group.
  process.kill(-pid, signal)
}

function isProcessTreeAlive(pid: number): boolean {
  if (!isProcessAlive(pid)) return false
  if (process.platform === 'win32') return true
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function waitForProcessTreeExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && isProcessTreeAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function hostHealth(descriptor: HostDescriptor): Promise<boolean> {
  const web = descriptor.services.find((service) => service.service === 'web')
  const jsonrpc = descriptor.services.find((service) => service.service === 'jsonrpc')
  if (web === undefined || jsonrpc === undefined) return false
  try {
    await fetch(web.endpoint)
    const socket = net.createConnection(jsonrpc.endpoint)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('error', reject)
    })
    socket.destroy()
    return true
  } catch {
    return false
  }
}
