import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import { baseName, relativeTo } from "../paths.ts"
import { MAX_FILE_SEARCH_QUERY_LENGTH, rankFilePaths } from "../file-search-ranking.ts"
import { listMentionPaths } from "./file-index.ts"
import { bindWorkbenchCwd, workbenchCwd } from "./runtime-api.ts"

const SOURCE_NAME = "file"
const SOURCE_ORDER = -10
const CACHE_TTL_MS = 8_000
const CANDIDATE_LIMIT = 20
const MAX_SEARCH_SESSIONS = 256
const PLAIN_PATH = /^[\w./:@+~-]+$/u

interface PathIndex {
  readonly paths: readonly string[]
  readonly fetchedAt: number
}

interface SearchSession {
  readonly searchId: string
  revision: number
}

interface FileCandidate {
  readonly name: string
  readonly description?: string
  readonly path?: string
}

interface InputTriggers {
  registerSource(source: {
    readonly trigger: "@"
    readonly name: string
    readonly order: number
    candidates(
      session: { readonly sessionId: string },
      req: { readonly query: string; readonly signal: AbortSignal },
    ): Promise<readonly FileCandidate[]>
    warm(session: { readonly sessionId: string }): void
    lexicon(session: { readonly sessionId: string }): readonly string[] | undefined
    subscribeLexicon(session: { readonly sessionId: string }, listener: () => void): () => void
    onPick(pick: { readonly candidate: FileCandidate }): { readonly text: string }
  }): () => void
}

/**
 * `@` file source: keep a small warm lexicon for rendering and ask the Host to
 * rank typed queries against the complete workspace index. A failed or missing
 * `fs.search` falls back to the legacy client-side tree walk.
 */
export function registerFileMention(ctx: ClientContext): void {
  const inputTriggers = readInputTriggers(ctx)
  if (inputTriggers === undefined) return
  const cache = new Map<string, PathIndex>()
  const inflight = new Map<string, Promise<readonly string[]>>()
  const lexiconListeners = new Map<string, Set<() => void>>()
  const searchSessions = new Map<string, SearchSession>()
  const searchNamespace = globalThis.crypto?.randomUUID?.() ?? `${String(Date.now())}-${Math.random().toString(36).slice(2)}`

  const notifyLexicon = (sessionId: string): void => {
    for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) {
      try {
        listener()
      } catch (error) {
        console.error("[cocode-workbench] lexicon listener failed:", error)
      }
    }
  }

  const load = async (sessionId: string): Promise<readonly string[]> => {
    const hit = cache.get(sessionId)
    if (hit !== undefined && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.paths
    const pending = inflight.get(sessionId)
    if (pending !== undefined) return pending
    const request = listMentionPaths(sessionId, sessionCwd(ctx, sessionId)).then((paths) => {
      if (paths.length > 0) {
        cache.set(sessionId, { paths, fetchedAt: Date.now() })
        notifyLexicon(sessionId)
      }
      return paths
    }).finally(() => {
      inflight.delete(sessionId)
    })
    inflight.set(sessionId, request)
    return request
  }

  ctx.effect(() => {
    const unregister = inputTriggers.registerSource({
      trigger: "@",
      name: SOURCE_NAME,
      order: SOURCE_ORDER,
      async candidates(session, { query, signal }) {
        const normalized = normalizeQuery(query)
        const cwd = sessionCwd(ctx, session.sessionId)
        let search = searchSessions.get(session.sessionId)
        if (search === undefined) {
          while (searchSessions.size >= MAX_SEARCH_SESSIONS) {
            const oldest = searchSessions.keys().next().value as string | undefined
            if (oldest === undefined) break
            searchSessions.delete(oldest)
          }
          search = { searchId: `${searchNamespace}:${session.sessionId}`, revision: 0 }
          searchSessions.set(session.sessionId, search)
        }
        const paths = normalized === ""
          ? await load(session.sessionId)
          : await listMentionPaths(session.sessionId, cwd, {
            query: normalized,
            limit: CANDIDATE_LIMIT,
            signal,
            searchId: search.searchId,
            revision: ++search.revision,
          })
        if (signal.aborted) return []
        return rankFilePaths(paths, normalized, CANDIDATE_LIMIT)
          .map((path) => toCandidate(path, workspaceLabel(cwd)))
      },
      warm(session) {
        load(session.sessionId).catch(() => {})
      },
      lexicon(session) {
        return cache.get(session.sessionId)?.paths
      },
      subscribeLexicon(session, listener) {
        const key = session.sessionId
        const listeners = lexiconListeners.get(key) ?? new Set<() => void>()
        listeners.add(listener)
        lexiconListeners.set(key, listeners)
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) lexiconListeners.delete(key)
        }
      },
      onPick({ candidate }) {
        return { text: fileMentionText(insertPath(candidate)) }
      },
    })
    return () => {
      unregister()
      cache.clear()
      inflight.clear()
      lexiconListeners.clear()
      searchSessions.clear()
    }
  }, "cocode-workbench: @ file source")
  ctx.on("connection/reset", () => {
    const keys = new Set([...cache.keys(), ...lexiconListeners.keys()])
    cache.clear()
    inflight.clear()
    for (const key of keys) notifyLexicon(key)
  })
}

function sessionCwd(ctx: ClientContext, sessionId: string): string | undefined {
  const sessions = ctx.get("sessions") as {
    list?: { getSnapshot?: () => { byId?: Record<string, { cwd?: string }> } }
  } | undefined
  const listed = sessions?.list?.getSnapshot?.().byId?.[sessionId]?.cwd
  if (listed !== undefined && listed.trim() !== "") {
    bindWorkbenchCwd(listed)
    return listed
  }
  return workbenchCwd()
}

function readInputTriggers(ctx: ClientContext): InputTriggers | undefined {
  const named = (ctx as ClientContext & { inputTriggers?: InputTriggers }).inputTriggers
  if (named !== undefined) return named
  return ctx.get("inputTriggers") as InputTriggers | undefined
}

function toCandidate(path: string, rootLabel: string): FileCandidate {
  const folder = path.endsWith("/")
  const trimmed = folder ? path.slice(0, -1) : path
  const label = folder ? `${baseName(trimmed)}/` : baseName(trimmed)
  const slash = trimmed.lastIndexOf("/")
  return {
    name: label,
    description: slash < 0 ? rootLabel : trimmed.slice(0, slash),
    path,
  }
}

function insertPath(candidate: FileCandidate): string {
  return candidate.path ?? candidate.name
}

function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined) return "."
  const name = baseName(cwd.replace(/[/\\]+$/, ""))
  return name === "" ? "." : name
}

/** Exact plain-text projection used by both the `@` picker and file-tree insertion. */
export function fileMentionText(path: string): string {
  const mention = PLAIN_PATH.test(path)
    ? `@${path}`
    : `@"${path.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`
  return `${mention} `
}

/** Match the `@` picker's directory spelling when insertion starts from the file tree. */
export function treeMentionPath(root: string, path: string, isDir: boolean): string {
  const relative = path === root ? "." : relativeTo(root, path)
  return isDir && relative !== "." && !relative.endsWith("/") ? `${relative}/` : relative
}

function normalizeQuery(query: string): string {
  const trimmed = query.trim()
  const unquoted = trimmed.startsWith("\"") ? trimmed.slice(1).replaceAll("\\\"", "\"") : trimmed
  return unquoted.slice(0, MAX_FILE_SEARCH_QUERY_LENGTH)
}
