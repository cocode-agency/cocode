// Logic tests for the cocode-input-history client half (recall-mode state
// machine): empty draft + ArrowUp enters recall; unedited drafts walk
// back/forward; any manual edit hands the arrows back to the app.
import { afterEach, describe, expect, it, vi } from "vitest"
import { apply } from "../src/client/index.ts"

type Listener = (event: FakeEvent) => void

class FakeElement {
  closestTarget: string | null = null
  closest(selector: string): FakeElement | null {
    return this.closestTarget === selector ? this : null
  }
}

class FakeEvent {
  readonly key: string
  isComposing: boolean
  readonly target: unknown
  prevented = false
  stopped = false

  constructor(key: string, target: unknown, composing = false) {
    this.key = key
    this.target = target
    this.isComposing = composing
  }

  preventDefault(): void {
    this.prevented = true
  }

  stopPropagation(): void {
    this.stopped = true
  }
}

interface NodeLike {
  kind?: string
  content?: readonly { type?: string; text?: string }[]
}

interface Harness {
  readonly draft: string
  readonly calls: string[]
  up(): FakeEvent
  down(): FakeEvent
  upOutside(): FakeEvent
  key(key: string, target: unknown, composing?: boolean): FakeEvent
  /** Simulate a hand edit / pre-filled draft (bypasses recall setDraft). */
  forceDraft(text: string): void
}

function makeHarness(nodes: readonly NodeLike[]): Harness {
  const listeners = new Map<string, Listener>()
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, fn)
    },
    removeEventListener: (type: string) => {
      listeners.delete(type)
    },
  })
  vi.stubGlobal("HTMLElement", FakeElement)

  let draft = ""
  const calls: string[] = []
  const input = {
    state: { getSnapshot: () => ({ draft }) },
    setDraft: (text: string) => {
      draft = text
      calls.push(text)
    },
  }
  // Session-scope ctx: must expose the conversation face (the client reads
  // actx.get("conversation"), matching the real scope-addressed service).
  const conversation = { input: { for: (c: unknown) => (c === actx ? input : undefined) } }
  const actx = { get: (k: string) => (k === "conversation" ? conversation : undefined) }
  const sessions = {
    list: { getSnapshot: () => ({ current: "s1" }) },
    scope: (id: string) => (id === "s1" ? actx : undefined),
    binding: (id: string) =>
      id === "s1"
        ? { session: { getSnapshot: () => ({ nodes }) } }
        : undefined,
  }
  const ctx = {
    get: (k: string) =>
      k === "sessions" ? sessions : k === "conversation" ? conversation : undefined,
    effect: () => () => {},
  }
  apply(ctx as never)

  const composer = () => {
    const el = new FakeElement()
    el.closestTarget = "textarea[data-phase]"
    return el
  }
  return {
    get draft() {
      return draft
    },
    get calls() {
      return calls
    },
    up: () => {
      const event = new FakeEvent("ArrowUp", composer())
      listeners.get("keydown")?.(event)
      return event
    },
    down: () => {
      const event = new FakeEvent("ArrowDown", composer())
      listeners.get("keydown")?.(event)
      return event
    },
    upOutside: () => {
      const event = new FakeEvent("ArrowUp", new FakeElement())
      listeners.get("keydown")?.(event)
      return event
    },
    key: (key, target, composing = false) => {
      const event = new FakeEvent(key, target, composing)
      listeners.get("keydown")?.(event)
      return event
    },
    forceDraft: (text) => {
      draft = text
    },
  }
}

const HISTORY: readonly NodeLike[] = [
  { kind: "user", content: [{ type: "text", text: "first" }] },
  { kind: "assistant", content: [{ type: "text", text: "reply" }] },
  { kind: "user", content: [{ type: "text", text: "second" }] },
  { kind: "steering", content: [{ type: "text", text: "steer" }] },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("cocode-input-history client", () => {
  it("empty + Up recalls the newest message and intercepts the key", () => {
    const h = makeHarness(HISTORY)
    const ev = h.up()
    expect(h.draft).toBe("steer")
    expect(ev.prevented && ev.stopped).toBe(true)
  })

  it("unedited Up walks back through history", () => {
    const h = makeHarness(HISTORY)
    h.up()
    expect(h.draft).toBe("steer")
    h.up()
    expect(h.draft).toBe("second")
    h.up()
    expect(h.draft).toBe("first")
  })

  it("Up at the oldest entry stays put and is intercepted", () => {
    const h = makeHarness(HISTORY)
    h.up()
    h.up()
    h.up()
    const ev = h.up()
    expect(h.draft).toBe("first")
    expect(ev.prevented).toBe(true)
  })

  it("Down walks forward and past the newest clears to empty", () => {
    const h = makeHarness(HISTORY)
    h.up() // steer (newest)
    h.up() // second
    h.up() // first (oldest)
    expect(h.draft).toBe("first")
    h.down()
    expect(h.draft).toBe("second")
    h.down()
    expect(h.draft).toBe("steer")
    const ev = h.down() // past the newest -> clears
    expect(h.draft).toBe("")
    expect(ev.prevented).toBe(true)
  })

  it("deduplicates identical history entries while keeping the newest occurrence", () => {
    const h = makeHarness([
      { kind: "user", content: [{ type: "text", text: "same" }] },
      { kind: "user", content: [{ type: "text", text: "middle" }] },
      { kind: "steering", content: [{ type: "text", text: "same" }] },
      { kind: "user", content: [{ type: "text", text: "same" }] },
    ])

    h.up()
    expect(h.draft).toBe("same")
    h.up()
    expect(h.draft).toBe("middle")
    h.up()
    expect(h.draft).toBe("middle")
    h.down()
    expect(h.draft).toBe("same")
  })

  it("empty draft re-enters recall mode from the newest entry", () => {
    const h = makeHarness(HISTORY)
    h.up()
    h.down()
    h.down()
    expect(h.draft).toBe("")
    h.up()
    expect(h.draft).toBe("steer")
  })

  it("a non-empty draft is handed to the app (no recall, not intercepted)", () => {
    const h = makeHarness(HISTORY)
    const before = h.calls.length
    h.forceDraft("正在输入的内容")
    const ev = h.up()
    expect(h.calls.length).toBe(before)
    expect(h.draft).toBe("正在输入的内容")
    expect(ev.prevented).toBe(false)
  })

  it("a coincidental match is not treated as recall", () => {
    const h = makeHarness(HISTORY)
    h.forceDraft("steer")
    const before = h.calls.length
    const ev = h.up()
    expect(h.calls.length).toBe(before)
    expect(ev.prevented).toBe(false)
  })

  it("recall then hand-edit exits recall mode", () => {
    const h = makeHarness(HISTORY)
    h.up() // draft = "steer"
    h.forceDraft("steer!")
    const before = h.calls.length
    const ev = h.up()
    expect(h.calls.length).toBe(before)
    expect(h.draft).toBe("steer!")
    expect(ev.prevented).toBe(false)
  })

  it("Down outside recall mode is handed to the app", () => {
    const h = makeHarness(HISTORY)
    h.forceDraft("x")
    const ev = h.down()
    expect(h.draft).toBe("x")
    expect(ev.prevented).toBe(false)
  })

  it("ignores events outside the composer textarea", () => {
    const h = makeHarness(HISTORY)
    h.calls.length = 0
    h.upOutside()
    expect(h.calls).toHaveLength(0)
  })

  it("ignores IME composition events", () => {
    const h = makeHarness(HISTORY)
    h.calls.length = 0
    const el = new FakeElement()
    el.closestTarget = "textarea[data-phase]"
    h.key("ArrowUp", el, true)
    expect(h.calls).toHaveLength(0)
  })

  it("does nothing when there is no history", () => {
    const h = makeHarness([{ kind: "assistant", content: [] }])
    h.calls.length = 0
    h.up()
    expect(h.calls).toHaveLength(0)
  })
})
