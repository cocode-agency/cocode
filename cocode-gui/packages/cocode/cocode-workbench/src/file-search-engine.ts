import { spawn } from "node:child_process"
import { readdir, realpath, stat } from "node:fs/promises"
import { dirname, join, relative } from "pathe"
import { rankFilePathsCooperatively } from "./file-search-ranking.ts"
import type { FileSearchRequest, FileSearchResult } from "./file-search-protocol.ts"
import { toPosix } from "./paths.ts"

const INDEX_CACHE_TTL_MS = 30_000
const MAX_INDEX_BYTES = 128 * 1024 * 1024
const MAX_INDEX_ENTRIES = 500_000
const MAX_INDEX_PATH_BYTES = 96 * 1024 * 1024
const MAX_GIT_DIAGNOSTIC_BYTES = 64 * 1024
const MAX_SINGLE_PATH_BYTES = 64 * 1024
const MAX_PENDING_WORKSPACES = 2
const MAX_SEARCH_SESSIONS = 256
const INDEX_BUILD_TIMEOUT_MS = 30_000
const MAX_WALK_DEPTH = 64
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next"])

export interface WorkspaceIndex {
  readonly paths: readonly string[]
  readonly estimatedBytes: number
  readonly truncated: boolean
}

interface CachedIndex {
  readonly promise: Promise<WorkspaceIndex>
  completedAt?: number
  estimatedBytes?: number
}

/** Successful indexes are byte-bounded; pending workspaces have a separate cap. */
export class WorkspaceIndexCache {
  private readonly entries = new Map<string, CachedIndex>()

  constructor(
    private readonly ttlMs = INDEX_CACHE_TTL_MS,
    private readonly maxBytes = MAX_INDEX_BYTES,
    private readonly maxPending = MAX_PENDING_WORKSPACES,
    private readonly now: () => number = Date.now,
  ) {}

  get(cwd: string, load: () => Promise<WorkspaceIndex>): Promise<WorkspaceIndex> {
    const cached = this.entries.get(cwd)
    if (cached !== undefined) {
      if (cached.completedAt === undefined || this.now() - cached.completedAt < this.ttlMs) {
        this.touch(cwd, cached)
        return cached.promise
      }
      this.entries.delete(cwd)
    }

    const pendingCount = [...this.entries.values()].filter(entry => entry.completedAt === undefined).length
    if (pendingCount >= this.maxPending) return Promise.reject(new Error("file search is busy indexing other workspaces"))

    let entry: CachedIndex
    const promise = Promise.resolve()
      .then(load)
      .then(
        index => {
          if (this.entries.get(cwd) === entry) {
            entry.completedAt = this.now()
            entry.estimatedBytes = index.estimatedBytes
            this.touch(cwd, entry)
            this.trimSettledEntries()
          }
          return index
        },
        (error: unknown) => {
          if (this.entries.get(cwd) === entry) this.entries.delete(cwd)
          throw error
        },
      )
    entry = { promise }
    this.entries.set(cwd, entry)
    return promise
  }

  clear(): void {
    this.entries.clear()
  }

  delete(cwd: string): void {
    this.entries.delete(cwd)
  }

  private touch(cwd: string, entry: CachedIndex): void {
    this.entries.delete(cwd)
    this.entries.set(cwd, entry)
  }

  private trimSettledEntries(): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + (entry.estimatedBytes ?? 0), 0)
    for (const [cwd, entry] of this.entries) {
      if (bytes <= this.maxBytes) break
      if (entry.completedAt === undefined) continue
      this.entries.delete(cwd)
      bytes -= entry.estimatedBytes ?? 0
    }
  }
}

/** Stateful search engine used inside the long-lived Workbench Worker. */
export class FileSearchEngine {
  private readonly cache: WorkspaceIndexCache
  private readonly latestRevisions = new Map<string, number>()

  constructor(
    cache = new WorkspaceIndexCache(),
    private readonly loadIndex: (cwd: string) => Promise<WorkspaceIndex> = buildWorkspaceIndex,
    private readonly yieldControl: () => Promise<void> = () => new Promise(resolve => setImmediate(resolve)),
  ) {
    this.cache = cache
  }

  async search(request: FileSearchRequest, canceled: () => boolean = () => false): Promise<FileSearchResult | undefined> {
    if (!this.markLatest(request.searchId, request.revision)) return undefined
    const cwd = await canonicalPath(request.cwd)
    const cacheKey = process.platform === "win32" ? cwd.toLowerCase() : cwd
    const index = await this.cache.get(cacheKey, () => this.loadIndex(cwd))
    const stale = (): boolean => canceled() || this.latestRevisions.get(request.searchId) !== request.revision
    if (stale()) return undefined
    const paths = await rankFilePathsCooperatively(index.paths, request.query, request.limit, {
      canceled: stale,
      yieldControl: this.yieldControl,
    })
    if (paths === undefined) return undefined
    return { paths, truncated: index.truncated }
  }

  dispose(): void {
    this.latestRevisions.clear()
    this.cache.clear()
  }

  async invalidate(cwd: string): Promise<void> {
    const canonical = await canonicalPath(cwd)
    this.cache.delete(process.platform === "win32" ? canonical.toLowerCase() : canonical)
  }

  private markLatest(searchId: string, revision: number): boolean {
    const current = this.latestRevisions.get(searchId)
    if (current !== undefined && current >= revision) return false
    this.latestRevisions.delete(searchId)
    this.latestRevisions.set(searchId, revision)
    while (this.latestRevisions.size > MAX_SEARCH_SESSIONS) {
      const oldest = this.latestRevisions.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.latestRevisions.delete(oldest)
    }
    return true
  }
}

async function canonicalPath(cwd: string): Promise<string> {
  try {
    return await realpath(cwd)
  } catch {
    return cwd
  }
}

async function buildWorkspaceIndex(cwd: string): Promise<WorkspaceIndex> {
  const deadline = Date.now() + INDEX_BUILD_TIMEOUT_MS
  let git: WorkspaceIndex | undefined
  try {
    git = await listGitEntries(cwd, deadline)
  } catch (error) {
    if (!isMissingExecutable(error)) throw error
  }
  if (git !== undefined) return git
  return walkWorkspace(cwd, deadline)
}

async function listGitEntries(cwd: string, deadline: number): Promise<WorkspaceIndex | undefined> {
  const child = spawn("git", ["-C", cwd, "ls-files", "-co", "--exclude-standard", "-z"], {
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  const collector = new EntryCollector()
  const stderr: Buffer[] = []
  let stderrBytes = 0
  let carry = Buffer.alloc(0)
  let budgetReached = false
  let timedOut = false
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, Math.max(1, deadline - Date.now()))
  timeout.unref()
  try {
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = MAX_GIT_DIAGNOSTIC_BYTES - stderrBytes
      if (remaining <= 0) return
      const limited = chunk.subarray(0, remaining)
      stderr.push(limited)
      stderrBytes += limited.length
    })
    for await (const value of child.stdout) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])
      let start = 0
      for (let index = bytes.indexOf(0); index >= 0; index = bytes.indexOf(0, start)) {
        if (!collector.addFile(toPosix(bytes.subarray(start, index).toString("utf8")))) {
          budgetReached = true
          child.kill()
          break
        }
        start = index + 1
      }
      carry = bytes.subarray(start)
      if (carry.length > MAX_SINGLE_PATH_BYTES) throw new Error("git returned an invalid file path")
      if (budgetReached) break
    }
    const exitCode = await exit
    if (budgetReached) return collector.finish(true)
    if (timedOut) throw new Error("file search index timed out")
    if (exitCode === 0) return collector.finish(false)
    const message = Buffer.concat(stderr).toString("utf8")
    if (/not a git repository/i.test(message) && !await hasGitMarker(cwd)) return undefined
    throw new Error(message.trim() || `git ls-files exited with code ${String(exitCode)}`)
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exit.catch(() => {})
  }
}

async function hasGitMarker(cwd: string): Promise<boolean> {
  let directory = cwd
  for (;;) {
    try {
      await stat(join(directory, ".git"))
      return true
    } catch { /* continue toward the filesystem root */ }
    const parent = dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
}

function isMissingExecutable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

async function walkWorkspace(cwd: string, deadline: number): Promise<WorkspaceIndex> {
  const collector = new EntryCollector()
  const queue: { readonly directory: string; readonly depth: number }[] = [{ directory: cwd, depth: 0 }]
  let truncated = false
  let cursor = 0
  while (cursor < queue.length) {
    if (Date.now() >= deadline) throw new Error("file search index timed out")
    const current = queue[cursor]
    cursor += 1
    if (current === undefined) break
    let entries
    try {
      entries = await readdir(current.directory, { withFileTypes: true })
    } catch (error) {
      if (current.directory === cwd) throw error
      truncated = true
      continue
    }
    for (const entry of entries) {
      const relativePath = toPosix(relative(cwd, join(current.directory, entry.name)))
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        if (!collector.addDirectory(relativePath)) return collector.finish(true)
        if (current.depth < MAX_WALK_DEPTH) queue.push({ directory: join(current.directory, entry.name), depth: current.depth + 1 })
        else truncated = true
      } else if (entry.isFile() && !collector.addFile(relativePath)) {
        return collector.finish(true)
      }
    }
  }
  return collector.finish(truncated)
}

class EntryCollector {
  private readonly entries = new Set<string>()
  private estimatedBytes = 0
  private pathBytes = 0

  addFile(path: string): boolean {
    if (path === "") return true
    if (!this.add(path)) return false
    let slash = path.indexOf("/")
    while (slash >= 0) {
      if (!this.add(`${path.slice(0, slash)}/`)) return false
      slash = path.indexOf("/", slash + 1)
    }
    return true
  }

  addDirectory(path: string): boolean {
    return this.add(path.endsWith("/") ? path : `${path}/`)
  }

  finish(truncated: boolean): WorkspaceIndex {
    return { paths: [...this.entries].sort(), estimatedBytes: this.estimatedBytes, truncated }
  }

  private add(path: string): boolean {
    if (this.entries.has(path)) return true
    const pathBytes = Buffer.byteLength(path, "utf8")
    if (this.entries.size >= MAX_INDEX_ENTRIES || this.pathBytes + pathBytes > MAX_INDEX_PATH_BYTES) return false
    this.entries.add(path)
    this.pathBytes += pathBytes
    this.estimatedBytes += path.length * 2 + 32
    return true
  }
}
