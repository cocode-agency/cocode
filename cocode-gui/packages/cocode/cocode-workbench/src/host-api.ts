import { execFile } from "node:child_process"
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative } from "pathe"
import { promisify } from "node:util"
import type { WorkbenchContext, WorkbenchRequest, WorkbenchResponse, WorkbenchRoute } from "./host-types.ts"
import { hasSeparator } from "./paths.ts"
import { applyBrowserHost } from "./browser/host.ts"
import { absolutePath, assertWritable, canWrite, readablePath, sessionCwd, writablePath } from "./file-access.ts"
import { gitDispatch } from "./git-api.ts"
import { searchWorkspace } from "./fs-search.ts"
import { WorkerFileSearchService, type FileSearchService } from "./file-search-service.ts"
import { readWordDocument, writeWordDocument } from "./word-document.ts"
import { readExcelDocument, writeExcelDocument } from "./excel-document.ts"

const exec = promisify(execFile)
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 1000
const WORKTREE_MUTATIONS = new Set([
  "git.init",
  "git.discard",
  "git.discardAll",
  "git.pull",
  "git.sync",
  "git.checkout",
  "git.stashPush",
  "git.stashPop",
  "git.stashApply",
  "git.ignore",
  "git.mergeAbort",
  "git.revert",
  "git.cherryPick",
])

function reply(response: WorkbenchResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(body))
}

function mimeFor(path: string): string {
  const ext = path.toLowerCase().split(".").at(-1)
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", pdf: "application/pdf", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", json: "application/json; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream"
}

async function bodyOf(request: WorkbenchRequest): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk)
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  if (total === 0) return {}
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : {}
  } catch { return {} }
}

function textField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

/**
 * Resolve the `to` field of a move/copy: a bare name renames next to the
 * source, anything with a separator is resolved against the workspace root.
 */
function destinationPath(ctx: WorkbenchContext, cwd: string, source: string, payload: Record<string, unknown>): string {
  const to = textField(payload, "to")
  if (to === undefined || to.includes("\0")) throw new Error("a target name is required")
  const absolute = hasSeparator(to)
    ? absolutePath(cwd, to)
    : join(dirname(source), to)
  return assertWritable(ctx, payload, absolute)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch { return false }
}

/** True when `target` sits inside `source`, which would make a copy/move recurse forever. */
function contains(source: string, target: string): boolean {
  const rel = relative(source, target)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

/** First free `name copy`, `name copy 2`, … next to a taken target. */
async function uniquePath(target: string): Promise<string> {
  if (!await exists(target)) return target
  const directory = dirname(target)
  const name = basename(target)
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ""
  for (let index = 1; index < 1000; index += 1) {
    const candidate = join(directory, `${stem} copy${index === 1 ? "" : ` ${String(index)}`}${extension}`)
    if (!await exists(candidate)) return candidate
  }
  throw new Error("no available name in this directory")
}

async function tree(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const directory = readablePath(ctx, payload, "path")
  const entries = await readdir(directory, { withFileTypes: true })
  const limited = entries.slice(0, MAX_DIRECTORY_ENTRIES)
  return {
    path: directory,
    truncated: entries.length > limited.length,
    entries: await Promise.all(limited.map(async entry => {
      const path = join(directory, entry.name)
      const isDir = entry.isDirectory()
      let size: number | undefined
      let mtime: number | undefined
      let childCount: number | undefined
      try {
        const info = await stat(path)
        mtime = info.mtimeMs
        if (!isDir) size = info.size
      } catch { /* disappearing file */ }
      if (isDir) {
        try { childCount = (await readdir(path)).length } catch { /* disappearing directory */ }
      }
      return {
        name: entry.name,
        path,
        isDir,
        ...(size === undefined ? {} : { size }),
        ...(mtime === undefined ? {} : { mtime }),
        ...(childCount === undefined ? {} : { childCount }),
      }
    })),
  }
}

async function fileRead(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = readablePath(ctx, payload, "path")
  const bytes = await readFile(path)
  const limited = bytes.byteLength > MAX_FILE_BYTES ? bytes.subarray(0, MAX_FILE_BYTES) : bytes
  const binary = limited.subarray(0, Math.min(limited.length, 4096)).includes(0)
  // `writable` lets the editor open read-only up front instead of accepting
  // edits the current sandbox mode will reject at save time.
  const writable = canWrite(ctx, payload, path)
  const truncated = bytes.byteLength > limited.byteLength
  if (binary) return { kind: "binary", bytes: limited.byteLength, truncated, writable }
  return { kind: "text", content: new TextDecoder().decode(limited), truncated, writable }
}

async function fileWrite(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = writablePath(ctx, payload, "path")
  const content = payload.content
  if (typeof content !== "string") throw new Error("fs.write requires text content")
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error("file is too large")
  await writeFile(path, content, "utf8")
  return { written: true, bytes: Buffer.byteLength(content, "utf8") }
}

async function wordRead(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = readablePath(ctx, payload, "path")
  return readWordDocument(path, canWrite(ctx, payload, path))
}

async function wordWrite(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = writablePath(ctx, payload, "path")
  const html = payload.html
  if (typeof html !== "string") throw new Error("word.write requires HTML content")
  return writeWordDocument(path, html)
}

async function excelRead(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = readablePath(ctx, payload, "path")
  return readExcelDocument(path, canWrite(ctx, payload, path))
}

async function excelWrite(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = writablePath(ctx, payload, "path")
  const html = payload.html
  if (typeof html !== "string") throw new Error("excel.write requires HTML content")
  return writeExcelDocument(path, html)
}

async function fileMkdir(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = writablePath(ctx, payload, "path")
  await mkdir(path)
  return { created: true }
}

/** Rename in place or move across directories; never overwrites an existing entry. */
async function fileRename(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const cwd = sessionCwd(ctx, payload)
  const source = writablePath(ctx, payload, "path")
  if (source === cwd) throw new Error("cannot rename the workspace root")
  const target = destinationPath(ctx, cwd, source, payload)
  if (target === source) return { path: source }
  if (contains(source, target)) throw new Error("cannot move a folder into itself")
  if (await exists(target)) throw new Error(`${basename(target)} already exists`)
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
  return { path: target }
}

/** Copy a file or directory tree, sidestepping a name clash instead of failing. */
async function fileCopy(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const cwd = sessionCwd(ctx, payload)
  // The source is only read; solely the destination must clear the write fence.
  const source = readablePath(ctx, payload, "from")
  const requested = destinationPath(ctx, cwd, source, payload)
  // Deduplicate first: pasting next to the source resolves onto the source
  // itself, so only a genuinely nested target is a recursive copy.
  const target = await uniquePath(requested)
  if (contains(source, target)) throw new Error("cannot copy a folder into itself")
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true, errorOnExist: true, force: false })
  return { path: target }
}

async function fileDelete(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const cwd = sessionCwd(ctx, payload)
  const path = writablePath(ctx, payload, "path")
  if (path === cwd) throw new Error("cannot delete the workspace root")
  await rm(path, { recursive: true, force: true })
  return { deleted: true }
}

/**
 * Show the entry in the host file manager. Revealing observes rather than
 * mutates, so it follows the read rule. Arguments go through execFile, so the
 * path is never interpreted by a shell.
 */
async function fileReveal(ctx: WorkbenchContext, payload: Record<string, unknown>) {
  const path = readablePath(ctx, payload, "path")
  if (!await exists(path)) throw new Error("this entry no longer exists")
  try {
    if (process.platform === "darwin") await exec("open", ["-R", path])
    // explorer.exe reports a non-zero code even on success, so its failure is ignorable.
    else if (process.platform === "win32") await exec("explorer.exe", [`/select,${path}`])
    else await exec("xdg-open", [dirname(path)])
  } catch (error) {
    if (process.platform !== "win32") throw error
  }
  return { revealed: true }
}

async function dispatch(
  ctx: WorkbenchContext,
  method: string,
  payload: Record<string, unknown>,
  fileSearch: FileSearchService,
  signal?: AbortSignal,
): Promise<unknown> {
  // Source control owns a large surface of its own; it lives in git-api.ts and
  // claims the whole `git.` namespace here.
  if (method.startsWith("git.")) {
    const value = await gitDispatch(ctx, method, payload)
    if (WORKTREE_MUTATIONS.has(method)) fileSearch.invalidate(sessionCwd(ctx, payload))
    return value
  }
  switch (method) {
    case "session.cwd": return { cwd: sessionCwd(ctx, payload) }
    case "fs.tree": return tree(ctx, payload)
    case "fs.search": return searchWorkspace(ctx, payload, fileSearch, signal)
    case "fs.read": return fileRead(ctx, payload)
    case "fs.write": return mutateWorkspace(ctx, payload, fileSearch, () => fileWrite(ctx, payload))
    case "word.read": return wordRead(ctx, payload)
    case "word.write": return mutateWorkspace(ctx, payload, fileSearch, () => wordWrite(ctx, payload))
    case "excel.read": return excelRead(ctx, payload)
    case "excel.write": return mutateWorkspace(ctx, payload, fileSearch, () => excelWrite(ctx, payload))
    case "fs.mkdir": return mutateWorkspace(ctx, payload, fileSearch, () => fileMkdir(ctx, payload))
    case "fs.rename": return mutateWorkspace(ctx, payload, fileSearch, () => fileRename(ctx, payload))
    case "fs.copy": return mutateWorkspace(ctx, payload, fileSearch, () => fileCopy(ctx, payload))
    case "fs.delete": return mutateWorkspace(ctx, payload, fileSearch, () => fileDelete(ctx, payload))
    case "fs.reveal": return fileReveal(ctx, payload)
    case "jobs.list": return { jobs: [] }
    default: throw Object.assign(new Error(`unknown workbench method: ${method}`), { status: 404 })
  }
}

export function createWorkbenchApi(
  ctx: WorkbenchContext,
  fileSearch: FileSearchService,
): WorkbenchRoute {
  return {
    // One prefix seat covers both faces of the API: the JSON methods under
    // /api and the media route under /file.
    kind: "prefix",
    path: "/cocode/workbench",
    handler: async (request, response) => {
      const match = request.url?.match(/^\/cocode\/workbench\/api\/([^/?]+)/)
      if (request.method === "GET" && request.url?.startsWith("/cocode/workbench/file")) {
        try {
          const url = new URL(request.url, "http://workbench.local")
          const sessionId = url.searchParams.get("sessionId") ?? undefined
          const path = url.searchParams.get("path")
          const cwd = url.searchParams.get("cwd") ?? undefined
          if (path === null) throw new Error("path is required")
          const absolute = readablePath(ctx, { sessionId, path, cwd }, "path")
          const bytes = await readFile(absolute)
          response.writeHead(200, { "content-type": mimeFor(absolute), "cache-control": "no-store", "content-length": String(bytes.byteLength) })
          response.end(bytes)
        } catch (error) {
          reply(response, 404, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
        }
        return
      }
      if (request.method !== "POST" || match === undefined || match === null) {
        reply(response, 404, { ok: false, error: { message: "not found" } })
        return
      }
      const requestLifetime = requestAbortSignal(request, response)
      try {
        const method = match[1]
        if (method === undefined) throw new Error("missing workbench method")
        const value = await dispatch(ctx, decodeURIComponent(method), await bodyOf(request), fileSearch, requestLifetime.signal)
        if (requestLifetime.signal.aborted || response.destroyed === true) return
        reply(response, 200, { ok: true, value })
      } catch (error) {
        if (requestLifetime.signal.aborted || response.destroyed === true) return
        const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 400
        reply(response, status, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
      } finally {
        requestLifetime.dispose()
      }
    },
  }
}

export function applyWorkbenchHost(ctx: WorkbenchContext): void {
  const fileSearch = new WorkerFileSearchService()
  const route = createWorkbenchApi(ctx, fileSearch)
  ctx.effect(() => {
    const unregister = ctx.webServer.register(route)
    return () => {
      unregister()
      fileSearch.dispose()
    }
  }, "cocode-workbench: api")
  applyBrowserHost(ctx)
}

async function mutateWorkspace<T>(
  ctx: WorkbenchContext,
  payload: Record<string, unknown>,
  fileSearch: FileSearchService,
  mutation: () => Promise<T>,
): Promise<T> {
  const value = await mutation()
  fileSearch.invalidate(sessionCwd(ctx, payload))
  return value
}

function requestAbortSignal(request: WorkbenchRequest, response: WorkbenchResponse): {
  readonly signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const abortRequest = (): void => controller.abort()
  const closeResponse = (): void => {
    if (response.writableEnded !== true) controller.abort()
  }
  if (request.aborted === true || response.destroyed === true) controller.abort()
  request.on?.("aborted", abortRequest)
  response.on?.("close", closeResponse)
  return {
    signal: controller.signal,
    dispose: () => {
      request.off?.("aborted", abortRequest)
      response.off?.("close", closeResponse)
    },
  }
}
