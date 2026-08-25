import { parentPort } from "node:worker_threads"
import { FileSearchEngine } from "./file-search-engine.ts"
import type { FileSearchWorkerRequest, FileSearchWorkerResponse } from "./file-search-protocol.ts"

const port = parentPort
if (port === null) throw new Error("file-search-worker must run in a Worker")

const engine = new FileSearchEngine()
const canceled = new Set<number>()
const active = new Set<number>()
let controlBarrier = Promise.resolve()

port.on("message", (message: FileSearchWorkerRequest) => {
  if (message.type === "cancel") {
    // Search is posted before cancel on the same MessagePort. Ignore a late
    // cancel after completion instead of retaining its request id forever.
    if (active.has(message.requestId)) canceled.add(message.requestId)
    return
  }
  if (message.type === "invalidate") {
    controlBarrier = controlBarrier.then(() => engine.invalidate(message.cwd))
    return
  }
  active.add(message.requestId)
  void controlBarrier.then(() => engine.search(message.value, () => canceled.has(message.requestId))).then(
    value => {
      const response: FileSearchWorkerResponse = value === undefined
        ? { type: "canceled", requestId: message.requestId }
        : { type: "result", requestId: message.requestId, value }
      port.postMessage(response)
    },
    (error: unknown) => {
      const response: FileSearchWorkerResponse = {
        type: "error",
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error),
      }
      port.postMessage(response)
    },
  ).finally(() => {
    active.delete(message.requestId)
    canceled.delete(message.requestId)
  })
})

port.once("close", () => engine.dispose())
