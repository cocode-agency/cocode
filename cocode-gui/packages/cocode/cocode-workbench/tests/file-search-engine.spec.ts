import { describe, expect, it, vi } from "vitest"
import { FileSearchEngine, WorkspaceIndexCache, type WorkspaceIndex } from "../src/file-search-engine.ts"

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function index(paths: readonly string[]): WorkspaceIndex {
  return { paths, estimatedBytes: paths.length * 64, truncated: false }
}

function request(revision: number, query: string) {
  return {
    cwd: process.cwd(),
    query,
    limit: 20,
    searchId: "picker-1",
    revision,
  }
}

describe("FileSearchEngine", () => {
  it("coalesces a cold index and ranks only the latest revision", async () => {
    const pending = deferred<WorkspaceIndex>()
    const load = vi.fn(() => pending.promise)
    const engine = new FileSearchEngine(new WorkspaceIndexCache(), load, async () => {})

    const stale = engine.search(request(1, "old"))
    const latest = engine.search(request(2, "needle"))
    pending.resolve(index(["old.ts", "src/needle.ts"]))

    await expect(stale).resolves.toBeUndefined()
    await expect(latest).resolves.toEqual({ paths: ["src/needle.ts"], truncated: false })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("interrupts an in-progress ranking after a newer revision arrives", async () => {
    const paths = Array.from({ length: 8_500 }, (_, value) => `src/file-${String(value)}.ts`)
    paths.push("src/latest-needle.ts")
    const enteredYield = deferred<void>()
    const resume = deferred<void>()
    let yields = 0
    const engine = new FileSearchEngine(
      new WorkspaceIndexCache(),
      async () => index(paths),
      async () => {
        yields += 1
        if (yields === 1) {
          enteredYield.resolve()
          await resume.promise
        }
      },
    )

    const stale = engine.search(request(1, "file"))
    await enteredYield.promise
    const latest = engine.search(request(2, "latest-needle"))
    resume.resolve()

    await expect(stale).resolves.toBeUndefined()
    await expect(latest).resolves.toEqual({ paths: ["src/latest-needle.ts"], truncated: false })
  })

  it("rejects an older revision that arrives after the latest request", async () => {
    const load = vi.fn().mockResolvedValue(index(["src/latest.ts", "src/old.ts"]))
    const engine = new FileSearchEngine(new WorkspaceIndexCache(), load, async () => {})

    await expect(engine.search(request(5, "latest"))).resolves.toEqual({
      paths: ["src/latest.ts"],
      truncated: false,
    })
    await expect(engine.search(request(4, "old"))).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
