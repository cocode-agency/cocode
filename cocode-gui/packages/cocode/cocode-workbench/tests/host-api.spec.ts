import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "pathe"
import { describe, expect, it } from "vitest"
import htmlToDocx from "html-to-docx"
import { createWorkbenchApi } from "../src/host-api.ts"
import type { SandboxMode, WorkbenchContext } from "../src/host-types.ts"

/**
 * Host context of a session rooted at `cwd`. Without a mounted `sandboxPolicy`
 * the workbench assumes the narrowest mode, so the workspace is the only
 * writable root; `mode` mounts a stub policy to exercise the wider modes.
 */
function context(cwd: string, mode?: SandboxMode): WorkbenchContext {
  return {
    sessions: { get: () => ({ header: { cwd } }) },
    webServer: { register: () => () => {}, registerUpgrade: () => () => {} },
    get: (name: string) => name === "sandboxPolicy" && mode !== undefined ? { resolve: () => ({ mode }) } : undefined,
    inject: () => {},
    effect: () => {},
  } as WorkbenchContext
}

/** Same host surface, but the named session is not live in the store yet. */
function detached(): WorkbenchContext {
  return {
    sessions: { get: () => undefined },
    webServer: { register: () => () => {}, registerUpgrade: () => () => {} },
    get: () => undefined,
    inject: () => {},
    effect: () => {},
  }
}

async function invoke(route: ReturnType<typeof createWorkbenchApi>, method: string, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload))
  let status = 0
  let response = ""
  await route.handler({ method: "POST", url: `/cocode/workbench/api/${method}`, async *[Symbol.asyncIterator]() { yield body } }, {
    writeHead: value => { status = value },
    end: value => { response += String(value ?? "") },
  })
  return { status, value: JSON.parse(response) as { ok: boolean; value?: unknown; error?: { message: string } } }
}

describe("Cocode Workbench host API", () => {
  it("lists and reads files inside the session workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    await writeFile(join(cwd, "note.txt"), "hello")
    const route = createWorkbenchApi(context(cwd))
    const tree = await invoke(route, "fs.tree", { sessionId: "s1" })
    expect(tree.value?.value).toMatchObject({ path: cwd })
    const read = await invoke(route, "fs.read", { sessionId: "s1", path: "note.txt" })
    expect(read.value?.value).toMatchObject({ kind: "text", content: "hello" })
  })

  it("reads outside the workspace but marks it unwritable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    const outside = await mkdtemp(join(tmpdir(), "cocode-elsewhere-"))
    await writeFile(join(outside, "note.txt"), "hello")
    const route = createWorkbenchApi(context(cwd))
    const result = await invoke(route, "fs.read", { sessionId: "s1", path: join(outside, "note.txt") })
    expect(result.status).toBe(200)
    expect(result.value?.value).toMatchObject({ kind: "text", content: "hello", writable: false })
  })

  it("denies a write outside the writable roots of the current mode", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    const outside = await mkdtemp(join(tmpdir(), "cocode-elsewhere-"))
    const route = createWorkbenchApi(context(cwd))
    const result = await invoke(route, "fs.write", { sessionId: "s1", path: join(outside, "note.txt"), content: "x" })
    expect(result.status).toBe(400)
    expect(result.value.error?.message).toMatch(/file access denied under read-only mode/)
  })

  it("keeps the workspace writable even under read-only", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    const route = createWorkbenchApi(context(cwd, "read-only"))
    const result = await invoke(route, "fs.write", { sessionId: "s1", path: "note.txt", content: "x" })
    expect(result.value?.value).toMatchObject({ written: true })
  })

  it("lifts the write fence under danger-full-access", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    const outside = await mkdtemp(join(tmpdir(), "cocode-elsewhere-"))
    const route = createWorkbenchApi(context(cwd, "danger-full-access"))
    const result = await invoke(route, "fs.write", { sessionId: "s1", path: join(outside, "note.txt"), content: "x" })
    expect(result.value?.value).toMatchObject({ written: true })
  })

  it("writes text through the explicit editor action", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    const path = join(cwd, "note.txt")
    await writeFile(path, "old")
    const route = createWorkbenchApi(context(cwd))
    const result = await invoke(route, "fs.write", { sessionId: "s1", path: "note.txt", content: "new" })
    expect(result.value?.value).toMatchObject({ written: true })
    await expect(readFile(path, "utf8")).resolves.toBe("new")
  })

  it("previews and edits a Word document without a remote service", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-word-"))
    const path = join(cwd, "report.docx")
    const fixture = await htmlToDocx("<h1>Weekly report</h1><table><tr><th>Team</th><th>Status</th></tr><tr><td>GUI</td><td>Ready</td></tr></table>")
    await writeFile(path, Buffer.isBuffer(fixture) ? fixture : Buffer.from(await fixture.arrayBuffer()))
    const route = createWorkbenchApi(context(cwd))

    const preview = await invoke(route, "word.read", { sessionId: "s1", path: "report.docx" })
    expect(preview.status).toBe(200)
    expect(preview.value?.value).toMatchObject({ kind: "word", writable: true })
    expect((preview.value?.value as { html?: string }).html).toContain("Weekly report")

    const save = await invoke(route, "word.write", { sessionId: "s1", path: "report.docx", html: "<h1>Edited report</h1><p><strong>Saved</strong> in Cocode.</p>" })
    expect(save.status).toBe(200)
    expect(save.value?.value).toMatchObject({ written: true })

    const reread = await invoke(route, "word.read", { sessionId: "s1", path: "report.docx" })
    expect((reread.value?.value as { html?: string }).html).toMatch(/Edited\s+report/)
    expect((reread.value?.value as { html?: string }).html).toContain("Saved")
  }, 15_000)

  it("round-trips rich Word formatting instead of flattening it to plain text", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-rich-word-"))
    const path = join(cwd, "rich.docx")
    const fixture = await htmlToDocx(
      `<h1>Rich title</h1>
       <p style="text-align:center;color:#c62828;font-size:18pt"><strong><em><u>Styled text</u></em></strong> <sub>2</sub><sup>+</sup></p>
       <blockquote>Quoted paragraph</blockquote>
       <ol style="list-style-type:upper-roman"><li>First</li><li>Second</li></ol>
       <table><thead><tr><th>Header</th></tr></thead><tbody><tr><td style="background-color:#eee;border:1px solid #000">Cell</td></tr></tbody></table>
       <div class="page-break" style="page-break-after:always"></div><pre>code sample</pre>`,
      null,
      { pageSize: { width: 11906, height: 16838 }, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, font: "Arial", fontSize: 21, lang: "zh-CN" },
    )
    await writeFile(path, Buffer.isBuffer(fixture) ? fixture : Buffer.from(await fixture.arrayBuffer()))
    const route = createWorkbenchApi(context(cwd))

    const preview = await invoke(route, "word.read", { sessionId: "s1", path: "rich.docx" })
    const html = (preview.value?.value as { html?: string }).html ?? ""
    expect(html).toContain("Rich title")
    expect(html).toContain("<ol")
    expect(html).toContain("<table")
    expect(html).toContain('width="602"')
    expect(html).toContain("border: 1px solid #000000")
    expect(html).toContain("line-height: 100%")
    expect(html).toContain("<sub>")
    expect(html).toContain("<sup>")

    const save = await invoke(route, "word.write", {
      sessionId: "s1",
      path: "rich.docx",
      html: `<h2>Edited rich title</h2><p style="color:#c62828;text-align:right"><strong><u>Saved style</u></strong></p><ul><li>Bullet</li></ul><div class="page-break" style="page-break-after:always"></div><pre>Saved code</pre>`,
    })
    expect(save.status).toBe(200)

    const reread = await invoke(route, "word.read", { sessionId: "s1", path: "rich.docx" })
    const edited = (reread.value?.value as { html?: string }).html ?? ""
    expect(edited).toMatch(/Edited\s+rich\s+title/)
    expect(edited).toMatch(/Saved\s+style/)
    expect(edited).toContain("<ul>")
    expect(edited).toMatch(/Saved\s+code/)
  }, 15_000)

  it("uses the caller-supplied cwd when the session is not live", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    await writeFile(join(cwd, "note.txt"), "hello")
    const route = createWorkbenchApi(detached())
    const result = await invoke(route, "fs.read", { sessionId: "s1", cwd, path: "note.txt" })
    expect(result.status).toBe(200)
    expect(result.value?.value).toMatchObject({ kind: "text", content: "hello" })
  })

  it("indexes workspace files and folders for @ mentions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-search-"))
    await mkdir(join(cwd, "src"))
    await mkdir(join(cwd, "node_modules"))
    await writeFile(join(cwd, "src", "main.ts"), "export {}\n")
    await writeFile(join(cwd, "node_modules", "ignored.js"), "ignored\n")
    const route = createWorkbenchApi(context(cwd))
    const result = await invoke(route, "fs.search", { sessionId: "s1" })
    const paths = (result.value?.value as { paths?: string[] }).paths ?? []
    expect(paths).toContain("src/")
    expect(paths).toContain("src/main.ts")
    expect(paths).not.toContain("node_modules/ignored.js")
  })

  it("does not fence a named session against process.cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cocode-workbench-"))
    await writeFile(join(cwd, "note.txt"), "hello")
    const route = createWorkbenchApi(detached())
    const result = await invoke(route, "fs.read", { sessionId: "s1", path: join(cwd, "note.txt") })
    expect(result.status).toBe(400)
    expect(result.value.error?.message).toMatch(/not ready/)
  })
})
