import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TerminalConnection, type TerminalStatus } from "../src/client/terminal-connection.ts"
import { TERMINAL_REFUSED_CODE, TERMINAL_RETRYABLE_CODE } from "../src/terminal-wire.ts"

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readonly OPEN = FakeWebSocket.OPEN
  readonly url: string
  readyState = 0
  binaryType = ""
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string | URL) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  send(): void {}
  close(): void {}

  closeFromHost(code: number, reason: string): void {
    this.onclose?.({ code, reason } as CloseEvent)
  }
}

describe("TerminalConnection recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal("WebSocket", FakeWebSocket)
    vi.stubGlobal("window", { location: { href: "http://localhost/" } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("automatically retries a workspace-not-ready handshake with the latest cwd", async () => {
    const cwdRef: { current: string | undefined } = { current: undefined }
    const statuses: TerminalStatus[] = []
    const connection = new TerminalConnection({
      sessionId: "session-1",
      terminalId: "terminal-1",
      geometry: () => ({ cols: 80, rows: 24 }),
      cwd: () => cwdRef.current,
      onOutput: () => {},
      onStatus: status => { statuses.push(status) },
    })

    connection.connect()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0]?.url).not.toContain("cwd=")

    cwdRef.current = "/tmp/project"
    FakeWebSocket.instances[0]?.closeFromHost(TERMINAL_RETRYABLE_CODE, "session workspace is not ready")
    expect(statuses.at(-1)).toEqual({ kind: "reconnecting" })

    await vi.advanceTimersByTimeAsync(400)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1]?.url).toContain("cwd=%2Ftmp%2Fproject")
    connection.dispose()
  })

  it("keeps permanent refusals settled for explicit user action", async () => {
    const statuses: TerminalStatus[] = []
    const connection = new TerminalConnection({
      sessionId: "session-1",
      terminalId: "terminal-1",
      geometry: () => ({ cols: 80, rows: 24 }),
      cwd: () => "/tmp/project",
      onOutput: () => {},
      onStatus: status => { statuses.push(status) },
    })

    connection.connect()
    FakeWebSocket.instances[0]?.closeFromHost(TERMINAL_REFUSED_CODE, "invalid working directory")
    expect(statuses.at(-1)).toEqual({ kind: "refused", reason: "invalid working directory" })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    connection.dispose()
  })
})
