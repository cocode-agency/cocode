/**
 * Terminal WebSocket seat. One socket owns one pseudo terminal for as long as
 * the panel lives: it replays the transcript on attach, streams live output,
 * forwards keystrokes and geometry, and hands the shell back to the registry
 * grace period when the socket drops.
 *
 * Handshake query:
 * - `sessionId` — conversation the terminal belongs to (its cwd and quota).
 * - `terminal`  — the workbench panel instance id; the reconnect identity.
 * - `cols`/`rows` — geometry of the first spawn.
 * - `restart` — kill the shell behind the key and spawn a fresh one.
 */
import { WebSocketServer, type WebSocket } from "ws"
import type { WorkbenchContext } from "./host-types.ts"
import { resolveSessionCwd, SessionWorkspaceNotReadyError } from "./session-cwd.ts"
import { clampGeometry, TerminalRegistry, terminalKey, type TerminalGeometry, type TerminalProcess } from "./terminal-registry.ts"
import { isTrustedUpgrade } from "./upgrade-trust.ts"
import {
  parseTerminalMessage,
  TERMINAL_REFUSED_CODE,
  TERMINAL_RETRYABLE_CODE,
  TERMINAL_SOCKET_PATH,
  TERMINAL_SUPERSEDED_CODE,
  type TerminalClientMessage,
  type TerminalHostMessage,
} from "./terminal-wire.ts"

/** Concurrent shells one conversation may hold. */
const TERMINALS_PER_SESSION = 8

/** How long a shell outlives a dropped socket, awaiting the reconnect. */
const RECONNECT_GRACE_MS = 30_000

function geometryOf(url: URL): TerminalGeometry {
  return clampGeometry({ cols: Number(url.searchParams.get("cols")), rows: Number(url.searchParams.get("rows")) })
}

function sendControl(socket: WebSocket, message: TerminalHostMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

function sendOutput(socket: WebSocket, text: string): void {
  if (socket.readyState === socket.OPEN) socket.send(Buffer.from(text, "utf8"), { binary: true })
}

/**
 * Bind one socket to one terminal until either end goes away.
 * @returns nothing; every failure path closes the socket with a reason.
 */
function attach(
  registry: TerminalRegistry,
  attachments: Map<string, WebSocket>,
  socket: WebSocket,
  entry: TerminalProcess,
  restored: boolean,
): void {
  const previous = attachments.get(entry.key)
  if (previous !== undefined && previous !== socket) {
    sendControl(previous, { type: "superseded" })
    previous.close(TERMINAL_SUPERSEDED_CODE, "superseded")
  }
  attachments.set(entry.key, socket)

  sendControl(socket, { type: "attached", cwd: entry.cwd, shell: entry.shell, restored })
  // node-pty emits asynchronously, so the snapshot and the subscription taken
  // in the same tick can neither duplicate nor drop a chunk.
  const replay = entry.transcript.join("")
  if (replay !== "") sendOutput(socket, replay)
  const dataSub = entry.pty.onData(chunk => { sendOutput(socket, chunk) })
  const exitSub = entry.pty.onExit(({ exitCode }) => { sendControl(socket, { type: "exit", code: exitCode }) })
  if (entry.exited) sendControl(socket, { type: "exit", code: entry.exitCode ?? 0 })

  socket.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
    if (isBinary) {
      if (!entry.exited) entry.pty.write(buffer.toString("utf8"))
      return
    }
    const control = parseTerminalMessage<TerminalClientMessage>(buffer.toString("utf8"))
    if (control?.type !== "resize" || entry.exited) return
    const size = clampGeometry(control)
    entry.pty.resize(size.cols, size.rows)
  })

  socket.on("close", () => {
    dataSub.dispose()
    exitSub.dispose()
    if (attachments.get(entry.key) === socket) attachments.delete(entry.key)
    // The panel is gone (closed tab, refresh, session switch) but the work in
    // the shell may not be: keep it for the grace period, which the reconnect
    // cancels and a new terminal may reclaim when the session is at its cap.
    registry.release(entry.key)
  })
}

export function applyTerminalHost(ctx: WorkbenchContext): void {
  const registry = new TerminalRegistry({ limitPerSession: TERMINALS_PER_SESSION, graceMs: RECONNECT_GRACE_MS })
  const attachments = new Map<string, WebSocket>()
  const server = new WebSocketServer({ noServer: true })

  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: TERMINAL_SOCKET_PATH,
    handler: (request, socket, head) => {
      if (!isTrustedUpgrade(request)) {
        socket.destroy()
        return
      }
      server.handleUpgrade(request, socket, head, connection => {
        const url = new URL(request.url ?? TERMINAL_SOCKET_PATH, "http://workbench.local")
        const sessionId = url.searchParams.get("sessionId")
        const terminalId = url.searchParams.get("terminal")
        if (sessionId === null || sessionId === "" || terminalId === null || terminalId === "") {
          connection.close(TERMINAL_REFUSED_CODE, "sessionId and terminal are required")
          return
        }
        try {
          const key = terminalKey(sessionId, terminalId)
          if (url.searchParams.get("restart") !== null) registry.close(key)
          const existing = registry.get(key)
          const cwd = resolveSessionCwd(ctx, sessionId, url.searchParams.get("cwd") ?? undefined)
          const entry = registry.open(sessionId, terminalId, cwd, geometryOf(url))
          attach(registry, attachments, connection, entry, existing === entry)
        } catch (error) {
          connection.close(
            error instanceof SessionWorkspaceNotReadyError ? TERMINAL_RETRYABLE_CODE : TERMINAL_REFUSED_CODE,
            error instanceof Error ? error.message : String(error),
          )
        }
      })
    },
  }), "cocode-workbench: terminal socket")

  ctx.effect(() => () => {
    for (const connection of attachments.values()) connection.close(1001, "host shutdown")
    attachments.clear()
    registry.disposeAll()
    server.close()
  }, "cocode-workbench: terminal registry")
}
