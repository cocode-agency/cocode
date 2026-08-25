import { relativeTo } from "../paths.ts"
import { MAX_FILE_SEARCH_QUERY_LENGTH, rankFilePaths } from "../file-search-ranking.ts"
import { workbenchCwd, workbenchRequest } from "./runtime-api.ts"

const MAX_FILES = 2000
const MAX_DEPTH = 8
const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next"])

interface TreeListing {
  readonly path?: string
  readonly entries?: readonly {
    readonly name: string
    readonly path: string
    readonly isDir: boolean
  }[]
}

interface MentionSearchOptions {
  readonly query?: string
  readonly limit?: number
  readonly signal?: AbortSignal
  readonly searchId?: string
  readonly revision?: number
}

/** Session-scoped workspace index for the composer `@` picker. */
export async function listMentionPaths(
  sessionId: string,
  cwd = workbenchCwd(),
  options: MentionSearchOptions = {},
): Promise<readonly string[]> {
  const query = options.query?.trim().slice(0, MAX_FILE_SEARCH_QUERY_LENGTH)
  const limit = options.limit ?? 20
  const payload = {
    sessionId,
    ...(cwd === undefined ? {} : { cwd }),
    ...(query === undefined || query === "" ? {} : { query, limit }),
    ...(options.searchId === undefined ? {} : { searchId: options.searchId }),
    ...(options.revision === undefined ? {} : { revision: options.revision }),
  }
  try {
    const result = await workbenchRequest<{ paths?: readonly string[] }>("fs.search", payload, options.signal)
    const paths = result.paths ?? []
    // A legacy Host ignores query/limit and returns its local index. Ranking
    // again keeps that protocol compatible while a new Host has already
    // searched its complete index and sends only the best matches.
    if (query !== undefined && query !== "") return rankFilePaths(paths, query, limit)
    if (paths.length > 0) return paths
  } catch {
    if (options.signal?.aborted === true) return []
    // Older hosts have no fs.search; the bounded tree walk below still works.
  }
  const paths = await walkTree(payload, options.signal)
  return query === undefined || query === "" ? paths : rankFilePaths(paths, query, limit)
}

async function walkTree(
  payload: { sessionId: string; cwd?: string },
  signal?: AbortSignal,
): Promise<string[]> {
  const result: string[] = []
  const visit = async (dir: string | undefined, depth: number): Promise<void> => {
    if (signal?.aborted === true || result.length >= MAX_FILES || depth > MAX_DEPTH) return
    let listing: TreeListing
    try {
      listing = await workbenchRequest<TreeListing>("fs.tree", {
        ...payload,
        ...(dir === undefined ? {} : { path: dir }),
      }, signal)
    } catch {
      return
    }
    const root = payload.cwd ?? listing.path
    for (const entry of listing.entries ?? []) {
      if (result.length >= MAX_FILES) return
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      const relative = root === undefined ? entry.path : relativeTo(root, entry.path)
      if (relative === "" || relative === ".") continue
      if (entry.isDir) {
        result.push(relative.endsWith("/") ? relative : `${relative}/`)
        await visit(entry.path, depth + 1)
        continue
      }
      result.push(relative)
    }
  }
  await visit(undefined, 0)
  return result
}
