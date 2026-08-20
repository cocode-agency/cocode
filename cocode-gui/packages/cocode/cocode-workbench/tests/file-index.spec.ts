import { afterEach, describe, expect, it, vi } from "vitest"
import { listMentionPaths } from "../src/client/file-index.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("file mention Host search", () => {
  it("sends query and limit to the Host and forwards cancellation", async () => {
    let requestBody: Record<string, unknown> | undefined
    let requestSignal: AbortSignal | null | undefined
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestSignal = init?.signal
      return new Response(JSON.stringify({
        ok: true,
        value: { paths: ["src/needle-target.ts"] },
      }), { status: 200, headers: { "content-type": "application/json" } })
    })
    const controller = new AbortController()

    await expect(listMentionPaths("session-1", "/work/repo", {
      query: "needle",
      limit: 20,
      signal: controller.signal,
      searchId: "picker-1",
      revision: 3,
    })).resolves.toEqual(["src/needle-target.ts"])
    expect(requestBody).toEqual({
      sessionId: "session-1",
      cwd: "/work/repo",
      query: "needle",
      limit: 20,
      searchId: "picker-1",
      revision: 3,
    })
    expect(requestSignal).toBe(controller.signal)
  })

  it("reranks a legacy Host response that ignores query fields", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      ok: true,
      value: {
        paths: [
          "docs/needle-guide.md",
          "needle.ts",
          "src/needle.ts",
          "README.md",
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }))

    await expect(listMentionPaths("session-1", "/work/repo", {
      query: "needle",
      limit: 2,
    })).resolves.toEqual(["needle.ts", "src/needle.ts"])
  })
})
