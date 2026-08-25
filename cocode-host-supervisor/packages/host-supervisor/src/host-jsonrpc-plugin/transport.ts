import { StringDecoder } from 'node:string_decoder'
import type { Readable, Writable } from 'node:stream'

type JsonRpcId = string | number
type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>

/** Minimal NDJSON JSON-RPC peer owned by the TUI companion process. */
export class CompanionTransport {
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private handler: RequestHandler | undefined
  private started = false
  private closed = false

  constructor(private readonly input: Readable, private readonly output: Writable) {}

  onRequest(handler: RequestHandler): void {
    this.handler = handler
  }

  start(): void {
    if (this.started || this.closed) return
    this.started = true
    this.input.on('data', this.onData)
    this.input.on('end', this.onEnd)
    this.input.on('error', this.onError)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.input.off('data', this.onData)
    this.input.off('end', this.onEnd)
    this.input.off('error', this.onError)
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed) return
    this.write(
      params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params },
    )
  }

  flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.output.write('', (error) => (error == null ? resolve() : reject(error)))
    })
  }

  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line !== '') void this.handleLine(line)
    }
  }

  private readonly onEnd = (): void => {
    this.buffer += this.decoder.end()
    this.onData('')
    this.close()
  }

  private readonly onError = (): void => {
    this.close()
  }

  private async handleLine(line: string): Promise<void> {
    let frame: unknown
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(frame)) return
    const id = frame.id
    const method = frame.method
    if (!isRpcId(id) || typeof method !== 'string') return
    const handler = this.handler
    if (handler === undefined) {
      this.writeError(id, -32601, `method not found: ${method}`)
      return
    }
    try {
      const result = await handler(method, objectParams(frame.params))
      this.write({ jsonrpc: '2.0', id, result })
    } catch (error) {
      this.writeError(id, -32603, error instanceof Error ? error.message : String(error), error)
    }
  }

  private writeError(id: JsonRpcId, code: number, message: string, cause?: unknown): void {
    const data = rpcErrorData(cause)
    this.write({
      jsonrpc: '2.0',
      id,
      error: data === undefined ? { code, message } : { code, message, data },
    })
  }

  private write(frame: Record<string, unknown>): void {
    if (!this.closed) this.output.write(`${JSON.stringify(frame)}\n`)
  }
}

function rpcErrorData(error: unknown): { code: string; details?: unknown } | undefined {
  if (!isRecord(error) || typeof error.code !== 'string') return undefined
  return {
    code: error.code,
    ...(Object.hasOwn(error, 'details') ? { details: error.details } : {}),
  }
}

function isRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number'
}

function objectParams(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
