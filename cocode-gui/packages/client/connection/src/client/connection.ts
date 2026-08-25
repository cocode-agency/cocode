import type { HostDescription, IApiClient, HostFrame, MuxFrame, RpcRequest } from './api.ts'

/** Reconnect/backoff tunables (deployment-varying — no hardcoded tunables; these become the
 *  future `ctx.connection` plugin's Config). All fields optional; defaults below. */
export interface ConnectionConfig {
  /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
  backoffBaseMs?: number
  /** Exponential growth factor per consecutive failed attempt. */
  backoffFactor?: number
  /** Upper bound for the backoff cap in ms. */
  backoffMaxMs?: number
  /** Interval between unary Host liveness probes after a generation connects. */
  livenessIntervalMs?: number
  /** Maximum time allowed for one Host liveness probe. */
  livenessTimeoutMs?: number
  /** Cap on waiting for both streams' onOpen before onConnected, in ms. The strict handshake
   *  waits for mux+host stream establishment plus describe; a carrier that never
   *  fires onOpen (misbehaving proxy) must not wedge the connection forever — on timeout the
   *  generation proceeds as connected and the live-gap repair path covers stragglers. */
  streamOpenTimeoutMs?: number
}

const CONNECTION_DEFAULTS: Required<ConnectionConfig> = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  livenessIntervalMs: 15_000,
  livenessTimeoutMs: 5_000,
  streamOpenTimeoutMs: 3_000,
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** Coarse connection state for the UI: 'connected' after each generation's handshake,
 *  'reconnecting' the moment the generation fails (covers the whole backoff+retry span). */
export type ConnectionState = 'connected' | 'reconnecting'

/** Frame sink callbacks: the Controller owns the physical streams; business dispatch belongs to
 *  SessionManager. */
export interface ConnectionSinks {
  onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void
  onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void
  /** After each connection generation is established (both streams open + describe succeeded), first connect included. */
  onConnected?: (description: HostDescription) => void
  /** Coarse state transitions (deduplicated: fires only on change). The initial pre-connect
   *  span reports nothing — the UI treats "no state yet" as connecting, not as an outage. */
  onStateChange?: (state: ConnectionState) => void
  /** Host handshake failed before a generation became connected. */
  onTransportFailure?: (reason: 'host_unreachable') => void
}

/**
 * Opens both streams and keeps iterating (pull mode: nothing reads the socket and the tap
 * never fires unless someone for-awaits), reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * The pump body feeds each frame to a sink (sink exceptions must
 * not kill the pump — a broken business layer must not drag down the connection layer).
 */
export class ConnectionController {
  private generation = 0
  private attempt = 0
  private current: AbortController | null = null
  private retryWake: AbortController | null = null
  /** Monotonic transport rebind marker used to close the tiny gap between a
   * generation ending and its retry timer being installed. */
  private rebindEpoch = 0
  private running = false
  private lastState: ConnectionState | null = null
  private readonly config: Required<ConnectionConfig>

  constructor(
    private readonly api: IApiClient,
    private readonly sinks: ConnectionSinks = {},
    config: ConnectionConfig = {},
  ) {
    this.config = { ...CONNECTION_DEFAULTS, ...config }
  }

  /** Idempotent: begin the connect/pump/reconnect loop. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  /** Stop the loop and abort the current generation's streams. */
  stop(): void {
    this.running = false
    this.current?.abort()
    this.retryWake?.abort()
    this.current = null
    this.retryWake = null
  }

  /** Abort the current generation and wake the backoff so the next generation
   * reconnects immediately against the newly rebound transport origin. */
  rebind(): void {
    if (!this.running) return
    this.rebindEpoch += 1
    this.attempt = 0
    this.current?.abort()
    this.retryWake?.abort()
  }

  private backoffDelay(attempt: number): number {
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config
    const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1))
    return cap / 2 + Math.random() * (cap / 2)
  }

  /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
  private isRunning(): boolean {
    return this.running
  }

  /** Re-read both mutable liveness guards after a potentially reentrant sink. */
  private isGenerationActive(controller: AbortController): boolean {
    return this.isRunning() && !controller.signal.aborted
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const rebindEpoch = this.rebindEpoch
      const gen = ++this.generation
      const ac = new AbortController()
      this.current = ac

      /* v8 ignore next -- initializer placeholder: the Promise executor
       * below runs synchronously and replaces it before anyone can call it. */
      let muxOpened = (): void => {}
      /* v8 ignore next -- same placeholder pattern as muxOpened. */
      let hostOpened = (): void => {}
      const streamsOpen = Promise.all([
        new Promise<void>((resolve) => { muxOpened = resolve }),
        new Promise<void>((resolve) => { hostOpened = resolve }),
      ])

      const failed = new Promise<void>((resolve) => {
        const settle = (): void => {
          if (gen === this.generation && !ac.signal.aborted) ac.abort()
          resolve()
        }
        void this.pumpStream(this.api.events.mux({}, ac.signal, muxOpened), this.sinks.onMuxEnvelope, settle)
        void this.pumpStream(this.api.events.host({}, ac.signal, hostOpened), this.sinks.onHostEnvelope, settle)
      })

      try {
        // Strict readiness handshake: describe proves unary reachability, onOpen
        // proves each physical stream is established before any frame —
        // only then may onConnected fire, so the resync it triggers cannot outrun the
        // subscribed baseline. The timeout guards against a carrier that never fires onOpen
        // (see ConnectionConfig.streamOpenTimeoutMs).
        const timeout = new AbortController()
        const [description] = await Promise.all([
          this.api.host.describe({}),
          Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)]),
        ])
        timeout.abort()
        const descriptionResult = description.result
        if (!descriptionResult.ok) {
          throw new Error(`host.describe failed: ${descriptionResult.error.code}: ${descriptionResult.error.message}`)
        }
        if (ac.signal.aborted) throw new Error('generation aborted during readiness handshake')
        this.attempt = 0
        this.emitState('connected')
        // A state sink may synchronously stop this controller. Do not publish
        // a description for a generation that no longer exists afterward.
        if (this.isGenerationActive(ac)) {
          this.callSink(() => { this.sinks.onConnected?.(descriptionResult.value) })
          void this.probeLiveness(ac, () => {
            if (gen === this.generation && !ac.signal.aborted) ac.abort()
          })
        }
      } catch (error) {
        // Transport failure: treat as generation failure, fall through to the shared backoff.
        if (!ac.signal.aborted && isRuntimeTransportError(error)) {
          this.callSink(() => this.sinks.onTransportFailure?.('host_unreachable'))
        }
        if (!ac.signal.aborted) ac.abort()
      }

      await failed
      if (!this.isRunning()) return
      // A rebound can arrive after the old streams ended but before the retry
      // controller is installed below. Do not let that stale generation put
      // the client back to sleep against the old runtime origin.
      if (rebindEpoch !== this.rebindEpoch) continue
      this.emitState('reconnecting')
      if (rebindEpoch !== this.rebindEpoch) continue
      this.attempt += 1
      console.warn(`[web-runtime] connection lost, retry #${this.attempt}`)
      const idle = new AbortController()
      this.retryWake = idle
      await sleep(this.backoffDelay(this.attempt), idle.signal)
      if (this.retryWake === idle) this.retryWake = null
      if (rebindEpoch !== this.rebindEpoch) continue
    }
  }

  /**
   * Detect a half-open carrier: WebSocket close events are not guaranteed when a
   * suspended client, proxy, or Host disappears silently. A successful unary
   * describe proves the HTTP path is still usable; a thrown probe ends the
   * generation and lets the normal reconnect/recovery path handle it.
   */
  private async probeLiveness(controller: AbortController, onFailure: () => void): Promise<void> {
    while (this.isGenerationActive(controller)) {
      await sleep(this.config.livenessIntervalMs, controller.signal)
      if (!this.isGenerationActive(controller)) return

      const probe = new AbortController()
      const timeout = setTimeout(() => probe.abort(), this.config.livenessTimeoutMs)
      const relayAbort = (): void => { probe.abort() }
      controller.signal.addEventListener('abort', relayAbort, { once: true })
      try {
        const response = await this.api.host.describe({}, probe.signal)
        if (!response.result.ok) continue
      } catch {
        if (!controller.signal.aborted) onFailure()
        return
      } finally {
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', relayAbort)
      }
    }
  }

  /** Deduplicated state emission (sink isolation applies). */
  private emitState(state: ConnectionState): void {
    if (this.lastState === state) return
    this.lastState = state
    this.callSink(() => this.sinks.onStateChange?.(state))
  }

  private async pumpStream<F extends { type: string }>(
    stream: AsyncIterable<RpcRequest<F>>,
    sink: ((envelope: RpcRequest<F>) => void) | undefined,
    onEnd: () => void,
  ): Promise<void> {
    try {
      for await (const envelope of stream) {
        if (envelope.payload.type === 'stream/error') break
        if (sink !== undefined) this.callSink(() => { sink(envelope) })
      }
    } catch {
      // Stream loss: converge on onEnd, which triggers the shared reconnect.
    }
    onEnd()
  }

  /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
  private callSink(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      console.error('[web-runtime] connection sink threw:', error)
    }
  }
}

function isRuntimeTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return true
  if (error.message.startsWith("host.describe failed:")) return false
  return error.name === "TypeError"
    || error.name === "TimeoutError"
    || /fetch failed|network|socket|ECONN|timeout/i.test(error.message)
}
