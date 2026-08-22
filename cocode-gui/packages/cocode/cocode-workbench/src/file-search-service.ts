import { Worker } from "node:worker_threads"
import type { FileSearchRequest, FileSearchResult, FileSearchWorkerRequest, FileSearchWorkerResponse } from "./file-search-protocol.ts"

const MAX_PENDING_SEARCHES = 32
const MAX_WORKER_OLD_GENERATION_MB = 256
const MAX_SEARCH_DURATION_MS = 35_000

export interface FileSearchService {
  search(request: FileSearchRequest, signal?: AbortSignal): Promise<FileSearchResult>
  invalidate(cwd: string): void
  dispose(): void
}

interface PendingSearch {
  readonly resolve: (value: FileSearchResult) => void
  readonly reject: (error: Error) => void
  readonly removeAbortListener: () => void
  readonly clearDeadline: () => void
}

/** Own one restartable Worker so indexes and full-path ranking stay off the Host event loop. */
export class WorkerFileSearchService implements FileSearchService {
  private worker: Worker | undefined
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingSearch>()
  private disposed = false

  search(request: FileSearchRequest, signal?: AbortSignal): Promise<FileSearchResult> {
    if (this.disposed) return Promise.reject(new Error("file search service is disposed"))
    if (signal?.aborted === true) return Promise.reject(abortError())
    if (this.pending.size >= MAX_PENDING_SEARCHES) return Promise.reject(new Error("too many pending file searches"))
    const requestId = this.nextRequestId++
    const worker = this.ensureWorker()
    return new Promise<FileSearchResult>((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(requestId)
        if (pending === undefined) return
        this.pending.delete(requestId)
        pending.removeAbortListener()
        pending.clearDeadline()
        const message: FileSearchWorkerRequest = { type: "cancel", requestId }
        try { worker.postMessage(message) } catch { /* the failed Worker is already canceling this request */ }
        reject(abortError())
      }
      if (signal !== undefined) signal.addEventListener("abort", abort, { once: true })
      const deadline = setTimeout(() => this.stopUnresponsiveWorker(worker), MAX_SEARCH_DURATION_MS)
      deadline.unref()
      this.pending.set(requestId, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener("abort", abort),
        clearDeadline: () => clearTimeout(deadline),
      })
      const message: FileSearchWorkerRequest = { type: "search", requestId, value: request }
      try {
        worker.postMessage(message)
      } catch (error) {
        this.pending.delete(requestId)
        signal?.removeEventListener("abort", abort)
        clearTimeout(deadline)
        if (this.worker === worker) {
          this.worker = undefined
          void worker.terminate()
        }
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose(): void {
    this.disposed = true
    const worker = this.worker
    this.worker = undefined
    if (worker !== undefined) void worker.terminate()
    this.rejectPending(new Error("file search service stopped"))
  }

  invalidate(cwd: string): void {
    if (this.disposed || this.worker === undefined) return
    const worker = this.worker
    const message: FileSearchWorkerRequest = { type: "invalidate", cwd }
    try {
      worker.postMessage(message)
    } catch {
      if (this.worker === worker) this.worker = undefined
      void worker.terminate()
    }
  }

  private ensureWorker(): Worker {
    if (this.worker !== undefined) return this.worker
    const worker = new Worker(new URL("./file-search-worker.js", import.meta.url), {
      // The Host may itself be launched with CLI-only flags (for example
      // --input-type in diagnostics). They are not valid for a file Worker.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: MAX_WORKER_OLD_GENERATION_MB },
    })
    worker.on("message", (message: FileSearchWorkerResponse) => this.handleMessage(message))
    worker.on("error", error => {
      if (this.worker === worker) this.worker = undefined
      this.rejectPending(error)
    })
    worker.on("exit", code => {
      if (this.worker !== worker) return
      this.worker = undefined
      if (!this.disposed) this.rejectPending(new Error(`file search worker exited with code ${String(code)}`))
    })
    this.worker = worker
    return worker
  }

  private handleMessage(message: FileSearchWorkerResponse): void {
    const pending = this.pending.get(message.requestId)
    if (pending === undefined) return
    this.pending.delete(message.requestId)
    pending.removeAbortListener()
    pending.clearDeadline()
    if (message.type === "result") pending.resolve(message.value)
    else if (message.type === "canceled") pending.resolve({ paths: [], truncated: false })
    else pending.reject(new Error(message.message))
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId)
      pending.removeAbortListener()
      pending.clearDeadline()
      pending.reject(error)
    }
  }

  private stopUnresponsiveWorker(worker: Worker): void {
    if (this.worker !== worker) return
    this.worker = undefined
    void worker.terminate()
    this.rejectPending(new Error("file search worker timed out"))
  }
}

function abortError(): Error {
  return Object.assign(new Error("file search canceled"), { name: "AbortError" })
}
