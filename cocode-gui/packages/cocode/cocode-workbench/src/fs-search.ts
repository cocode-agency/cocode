import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { promisify } from "node:util"
import { join, relative } from "pathe"
import type { WorkbenchContext } from "./host-types.ts"
import { sessionCwd } from "./file-access.ts"
import { MAX_FILE_SEARCH_QUERY_LENGTH } from "./file-search-ranking.ts"
import type { FileSearchService } from "./file-search-service.ts"
import { toPosix } from "./paths.ts"

const exec = promisify(execFile)
const LEGACY_INDEX_LIMIT = 2000
const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 100
const LEGACY_MAX_DEPTH = 8
const LEGACY_GIT_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next"])
let legacySearchId = 0

interface EntryLimits {
  readonly maxFiles: number
  readonly maxDepth: number
  readonly gitOutputLimitBytes: number
}
const LEGACY_ENTRY_LIMITS: EntryLimits = {
  maxFiles: LEGACY_INDEX_LIMIT,
  maxDepth: LEGACY_MAX_DEPTH,
  gitOutputLimitBytes: LEGACY_GIT_OUTPUT_LIMIT_BYTES,
}

/**
 * Workspace-relative paths for the composer `@` picker. An omitted query keeps
 * the bounded legacy index used by warm clients; a typed query is delegated to
 * the stateful Worker service and returns only its requested Top N.
 * Prefer git's tracked-plus-unignored listing and walk non-repository trees.
 * Directories keep a trailing slash so a pick can name a folder.
 */
export async function searchWorkspace(
  ctx: WorkbenchContext,
  payload: Record<string, unknown>,
  fileSearch: FileSearchService,
  signal?: AbortSignal,
): Promise<{ readonly paths: readonly string[]; readonly truncated?: boolean }> {
  const cwd = sessionCwd(ctx, payload)
  const query = searchQuery(payload)
  if (query === undefined) return { paths: await listEntries(cwd, LEGACY_ENTRY_LIMITS) }
  const result = await fileSearch.search({
    cwd,
    query,
    limit: searchLimit(payload),
    searchId: searchId(payload),
    revision: searchRevision(payload),
  }, signal)
  return { paths: result.paths, ...(result.truncated ? { truncated: true } : {}) }
}

async function listEntries(cwd: string, limits: EntryLimits): Promise<string[]> {
  try {
    const result = await exec("git", ["-C", cwd, "ls-files", "-co", "--exclude-standard", "-z"], {
      encoding: "buffer",
      maxBuffer: limits.gitOutputLimitBytes,
    })
    const files = result.stdout.toString("utf8").split("\0").filter(Boolean).map(toPosix)
    const entries = addParentDirectories(files)
    return entries.slice(0, limits.maxFiles)
  } catch {
    return walkWorkspace(cwd, limits)
  }
}

async function walkWorkspace(cwd: string, limits: EntryLimits): Promise<string[]> {
  const result: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (
      result.length >= limits.maxFiles ||
      depth > limits.maxDepth
    ) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (result.length >= limits.maxFiles) return
      const relativePath = toPosix(relative(cwd, join(directory, entry.name)))
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        result.push(`${relativePath}/`)
        await visit(join(directory, entry.name), depth + 1)
        continue
      }
      if (entry.isFile()) result.push(relativePath)
    }
  }
  await visit(cwd, 0)
  return result.sort()
}

function searchQuery(payload: Record<string, unknown>): string | undefined {
  const value = payload.query
  if (typeof value !== "string") return undefined
  const query = value.trim().slice(0, MAX_FILE_SEARCH_QUERY_LENGTH)
  return query === "" ? undefined : query
}

function searchId(payload: Record<string, unknown>): string {
  const value = payload.searchId
  if (typeof value === "string" && value.trim() !== "") return value.slice(0, 256)
  legacySearchId += 1
  return `legacy-${String(legacySearchId)}`
}

function searchRevision(payload: Record<string, unknown>): number {
  const value = payload.revision
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function searchLimit(payload: Record<string, unknown>): number {
  const value = payload.limit
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return DEFAULT_SEARCH_LIMIT
  return Math.min(value, MAX_SEARCH_LIMIT)
}

function addParentDirectories(files: readonly string[]): string[] {
  const entries = new Set(files)
  for (const file of files) {
    const parts = file.split("/")
    for (let index = 1; index < parts.length; index += 1) {
      entries.add(`${parts.slice(0, index).join("/")}/`)
    }
  }
  return [...entries].sort()
}
