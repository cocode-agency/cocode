import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { IconChevronDownOutline14, Menu, type MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives"
import type { SessionListState } from "@deepseek-ai/dsh-client-runtime/client"
import { BranchIcon } from "./git-icons.tsx"
import { SearchIcon } from "./icons.tsx"
import { branchMenuEntries, checkoutTarget } from "./git-menus.ts"
import { fetchStatus, gitRequest, type GitBranch, type GitRepo, type GitStatus } from "./git-client.ts"
import { localeRevision, subscribeLocale, t } from "./locales.ts"
import css from "./git-hero-action.module.css"

interface GitHeroActionProps {
  readonly useSessions: (select: (state: SessionListState) => string | undefined) => string | undefined
}

interface HeroGitState {
  readonly loading: boolean
  readonly repo?: GitRepo
  readonly branches: readonly GitBranch[]
  readonly remoteBranches: readonly string[]
  readonly error?: string
}

const POLL_MS = 3000

function isRepo(status: GitStatus | undefined): status is GitRepo {
  return status?.isRepo === true
}

function projectName(repo: GitRepo): string {
  const root = repo.root.replace(/\/+$/, "")
  return root.slice(root.lastIndexOf("/") + 1) || "项目"
}

function useHeroGit(sessionId: string | undefined): HeroGitState & {
  readonly reloadBranches: () => Promise<void>
  readonly reloadStatus: () => Promise<void>
} {
  const [state, setState] = useState<HeroGitState>({ loading: true, branches: [], remoteBranches: [] })

  const reloadStatus = useCallback(async () => {
    if (sessionId === undefined) {
      setState({ loading: false, branches: [], remoteBranches: [] })
      return
    }
    try {
      const status = await fetchStatus(sessionId)
      setState(current => ({ ...current, loading: false, error: undefined, repo: isRepo(status) ? status : undefined }))
    } catch (error) {
      setState(current => ({ ...current, loading: false, repo: undefined, error: error instanceof Error ? error.message : String(error) }))
    }
  }, [sessionId])

  const reloadBranches = useCallback(async () => {
    if (sessionId === undefined) return
    try {
      const result = await gitRequest<{ local: readonly GitBranch[]; remote: readonly string[] }>("git.branches", { sessionId })
      setState(current => ({ ...current, branches: result.local, remoteBranches: result.remote, error: undefined }))
    } catch (error) {
      setState(current => ({ ...current, error: error instanceof Error ? error.message : String(error) }))
    }
  }, [sessionId])

  useEffect(() => {
    let disposed = false
    let timer: number | undefined
    setState({ loading: true, branches: [], remoteBranches: [] })
    const tick = async (): Promise<void> => {
      await reloadStatus()
      if (!disposed) timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [reloadStatus])

  return { ...state, reloadBranches, reloadStatus }
}

/** Project-scoped Git selector using the shared 62686e0 Menu primitive. */
export function GitHeroAction(props: GitHeroActionProps) {
  useSyncExternalStore(subscribeLocale, localeRevision, localeRevision)
  const sessionId = props.useSessions(state => state.current)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { repo, branches, remoteBranches, loading, reloadBranches, reloadStatus } = useHeroGit(sessionId)

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const checkout = async (branch: string): Promise<void> => {
    if (sessionId === undefined || busy) return
    setBusy(true)
    try {
      await gitRequest("git.checkout", { sessionId, branch })
      await reloadStatus()
      await reloadBranches()
      setOpen(false)
      setQuery("")
    } finally {
      setBusy(false)
    }
  }

  const createBranch = (): void => {
    const name = window.prompt(t("git.promptBranchName"))?.trim()
    if (name !== undefined && name !== "") {
      setBusy(true)
      void gitRequest("git.checkout", { sessionId, branch: name, create: true })
        .then(async () => { await reloadStatus(); await reloadBranches(); setOpen(false) })
        .finally(() => setBusy(false))
    }
  }

  const items = useMemo<readonly MenuEntry[]>(() => {
    if (repo === undefined) return []
    const needle = query.trim().toLocaleLowerCase()
    const searchEntry = {
      type: "label",
      id: "hero-branch-search",
      text: <label className={css.search}>
        <SearchIcon size={14} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={t("git.branchPickerSearch", { project: projectName(repo) })}
          aria-label={t("git.branchPickerSearch", { project: projectName(repo) })}
          onChange={event => setQuery(event.target.value)}
        />
      </label>,
    } as unknown as MenuEntry
    const entries = branchMenuEntries(repo, branches, remoteBranches)
    const filtered = entries.filter(entry => {
      if (needle === "" || !("label" in entry)) return true
      if (entry.id === "branchCreate" || entry.id === "branchDelete") return true
      return String(entry.label).toLocaleLowerCase().includes(needle)
    })
    const hasBranch = filtered.some(entry => entry.id.startsWith("checkout:"))
    return [
      searchEntry,
      ...(hasBranch || needle === "" ? filtered : [{ type: "label", id: "hero-branch-empty", text: t("git.branchPickerNoMatch") } satisfies MenuEntry]),
    ]
  }, [branches, query, remoteBranches, repo])

  if (sessionId === undefined || (!loading && repo === undefined)) return null

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={css.trigger}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={repo === undefined ? t("git.branchPicker") : t("git.branchPickerCurrent", { branch: repo.branch })}
      disabled={repo === undefined || busy}
      onClick={() => { setOpen(current => !current); if (!open) void reloadBranches() }}
    >
      <BranchIcon size={14} />
      <span className={css.triggerLabel}>{repo?.branch ?? t("git.branchPicker")}</span>
      <IconChevronDownOutline14 className={css.triggerChevron} size={14} />
    </button>
    <Menu
      open={open}
      onClose={() => { setOpen(false); setQuery("") }}
      items={items}
      selectedId={repo === undefined ? undefined : `checkout:${repo.branch}`}
      onSelect={id => {
        const branch = checkoutTarget(id)
        if (branch !== undefined) { void checkout(branch); return }
        if (id === "branchCreate") createBranch()
        if (id === "branchDelete") {
          const name = window.prompt(t("git.promptBranchName"), repo?.branch)?.trim()
          if (name !== undefined && name !== "") {
            setBusy(true)
            void gitRequest("git.branchDelete", { sessionId, branch: name })
              .then(async () => { await reloadStatus(); await reloadBranches(); setOpen(false) })
              .finally(() => setBusy(false))
          }
        }
      }}
      align="start"
      side="top"
      portal
      compact
      getAnchorRect={() => triggerRef.current?.getBoundingClientRect() ?? null}
      anchor={null}
    />
  </>
}
