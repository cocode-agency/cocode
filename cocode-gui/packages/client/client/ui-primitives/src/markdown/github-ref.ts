/** Parsed GitHub issue, pull request, or discussion reference. */
export type GitHubRefKind = 'issue' | 'pull' | 'discussion'

export interface GitHubRef {
  kind: GitHubRefKind
  owner: string
  repo: string
  number: number
}

const GITHUB_REF_PATH =
  /^\/([^/]+)\/([^/]+)\/(pull|issues|discussions)\/(\d+)(?:\/|$)/

/**
 * Recognize github.com issue, pull request, and discussion URLs.
 * @param url - Absolute HTTP(S) destination after sanitization.
 */
export function parseGitHubRef(url: string): GitHubRef | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
      return undefined
    }
    const match = GITHUB_REF_PATH.exec(parsed.pathname)
    if (match === null) return undefined
    const owner = match[1]
    const repo = match[2]
    const segment = match[3]
    const number = Number(match[4])
    if (owner === undefined || repo === undefined || segment === undefined || !Number.isFinite(number)) {
      return undefined
    }
    const kind: GitHubRefKind = segment === 'pull'
      ? 'pull'
      : segment === 'issues'
        ? 'issue'
        : 'discussion'
    return { kind, owner, repo, number }
  } catch {
    return undefined
  }
}

/** Scan plain text for absolute GitHub issue / PR / discussion URLs. */
export const GITHUB_REF_URL_RE = /https?:\/\/(?:www\.)?github\.com\/[^\s<>)\]]+/g
