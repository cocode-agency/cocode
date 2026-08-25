import net from 'node:net'
import { once } from 'node:events'

export type RpcRequest = { id: number; method: string; params?: Record<string, unknown> }
export type RpcResponse = { id: number; result?: unknown; error?: { code: number; message: string; data?: { code?: string } } }

export type LineFrameOutput = NodeJS.WritableStream & {
  destroyed?: boolean
  writable?: boolean
}

export function writeLineFrame(output: LineFrameOutput, frame: unknown): boolean {
  if (output.destroyed === true || output.writable === false) return false
  try {
    output.write(`${JSON.stringify(frame)}\n`)
    return true
  } catch {
    return false
  }
}

export function openLineConnection(endpoint: string): Promise<LinePeer> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    const peer = new LinePeer(socket, socket)
    const onError = (error: Error) => { socket.destroy(); reject(error) }
    socket.once('error', onError)
    socket.once('connect', () => {
      socket.off('error', onError)
      resolve(peer)
    })
  })
}

export class LinePeer {
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly notifications = new Set<(method: string, params: Record<string, unknown>) => void>()
  private readonly closeHandlers = new Set<(error: Error) => void>()
  private closed = false
  private closeNotified = false

  constructor(private readonly input: NodeJS.ReadableStream, private readonly output: NodeJS.WritableStream) {
    input.on('data', (chunk: Buffer | string) => this.onData(chunk.toString()))
    input.once('close', () => this.fail(new Error('IPC connection closed')))
    input.once('error', (error) => this.fail(error instanceof Error ? error : new Error(String(error))))
  }

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('IPC connection is closed'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value as T) }, reject: (error) => { clearTimeout(timer); reject(error) } })
      this.output.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  onNotification(handler: (method: string, params: Record<string, unknown>) => void): () => void {
    this.notifications.add(handler)
    return () => this.notifications.delete(handler)
  }

  onClose(handler: (error: Error) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const destroy = this.input as NodeJS.ReadableStream & { destroy?: () => void }
    destroy.destroy?.()
    this.fail(new Error('IPC connection closed'))
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const index = this.buffer.indexOf('\n')
      if (index < 0) return
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let frame: RpcResponse & { method?: string; params?: Record<string, unknown> }
      try { frame = JSON.parse(line) } catch { continue }
      if (typeof frame.id === 'number') {
        const pending = this.pending.get(frame.id)
        if (!pending) continue
        this.pending.delete(frame.id)
        if (frame.error) {
          const error = new Error(frame.error.message)
          const code = frame.error.data?.code
          if (typeof code === 'string') Object.defineProperty(error, 'code', { value: code, enumerable: true })
          pending.reject(error)
        }
        else pending.resolve(frame.result)
      } else if (typeof frame.method === 'string') {
        for (const handler of this.notifications) handler(frame.method, frame.params ?? {})
      }
    }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    if (this.closeNotified) return
    this.closeNotified = true
    for (const handler of this.closeHandlers) handler(error)
  }
}

export async function listenLineServer(server: net.Server, endpoint: string): Promise<void> {
  if (process.platform !== 'win32') {
    const fs = await import('node:fs/promises')
    await fs.rm(endpoint, { force: true }).catch(() => undefined)
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  })
}
