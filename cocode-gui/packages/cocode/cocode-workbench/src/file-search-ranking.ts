interface RankedPath {
  readonly path: string
  readonly index: number
  readonly score: number
}

export interface CooperativeRankingOptions {
  readonly chunkSize?: number
  readonly canceled?: () => boolean
  readonly yieldControl: () => Promise<void>
}

/** Bound user-controlled work while preserving any realistic file-search query. */
export const MAX_FILE_SEARCH_QUERY_LENGTH = 256

/** Rank paths identically on Host and client while retaining only the requested Top N. */
export function rankFilePaths(paths: readonly string[], query: string, limit: number): string[] {
  const needle = normalizeSearchQuery(query)
  if (limit <= 0) return []
  const best: RankedPath[] = []
  for (let index = 0; index < paths.length; index += 1) {
    rankPath(best, paths[index], index, needle, limit)
  }
  return best.map(entry => entry.path)
}

/**
 * Rank in bounded chunks so a Worker can receive a newer query or a cancel
 * message while a very large index is being searched. `undefined` means the
 * caller no longer wants this revision.
 */
export async function rankFilePathsCooperatively(
  paths: readonly string[],
  query: string,
  limit: number,
  options: CooperativeRankingOptions,
): Promise<string[] | undefined> {
  if (limit <= 0) return []
  const needle = normalizeSearchQuery(query)
  const best: RankedPath[] = []
  const chunkSize = Math.max(1, options.chunkSize ?? 4_096)
  for (let index = 0; index < paths.length; index += 1) {
    if (options.canceled?.() === true) return undefined
    rankPath(best, paths[index], index, needle, limit)
    if ((index + 1) % chunkSize === 0) await options.yieldControl()
  }
  if (options.canceled?.() === true) return undefined
  return best.map(entry => entry.path)
}

function rankPath(
  best: RankedPath[],
  path: string | undefined,
  index: number,
  needle: string,
  limit: number,
): void {
  if (path === undefined) return
  const score = filePathScore(path, needle)
  if (score === undefined) return
  const candidate = { path, index, score }
  if (best.length === limit && compareRankedPaths(candidate, best[best.length - 1] as RankedPath) >= 0) return
  let low = 0
  let high = best.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (compareRankedPaths(candidate, best[middle] as RankedPath) < 0) high = middle
    else low = middle + 1
  }
  best.splice(low, 0, candidate)
  if (best.length > limit) best.pop()
}

function compareRankedPaths(left: RankedPath, right: RankedPath): number {
  return right.score - left.score || left.index - right.index
}

function normalizeSearchQuery(query: string): string {
  return query
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .toLowerCase()
}

function filePathScore(path: string, query: string): number | undefined {
  if (query === "") return 0
  const lower = path.toLowerCase()
  const comparable = lower.endsWith("/") ? lower.slice(0, -1) : lower
  const base = comparable.slice(Math.max(0, comparable.lastIndexOf("/") + 1))
  if (comparable === query) return 1_000
  if (base.startsWith(query)) return 800 - base.length / 100
  if (comparable.startsWith(query)) return 700 - comparable.length / 100
  const index = comparable.indexOf(query)
  if (index >= 0) return 500 - index - comparable.length / 100
  let cursor = 0
  for (const character of query) {
    cursor = comparable.indexOf(character, cursor)
    if (cursor < 0) return undefined
    cursor += 1
  }
  return 100 - comparable.length / 100
}
