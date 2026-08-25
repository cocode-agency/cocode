import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import { Button, Menu, Modal, writeClipboard } from "@deepseek-ai/dsh-client-ui-primitives"
import type { WorkbenchPanelProps } from "./model.ts"
import { workbenchRequest } from "./runtime-api.ts"
import { baseName, isAbsolutePath, isValidName, joinPath, parentOf, relativeTo } from "../paths.ts"
import {
  copyEntry, createEntry, deleteEntry,
  moveEntry, renameEntry, revealEntry, type TreeEntry,
} from "./files-actions.ts"
import { fileMenuEntries, isFileCommand, type FileCommand } from "./files-menu.ts"
import {
  activeFileShortcutTarget, FILE_ADD_TO_CHAT_COMMAND, FILE_CANCEL_COMMAND,
  FILE_COLLAPSE_COMMAND, FILE_CONTEXT_MENU_COMMAND, FILE_COPY_COMMAND,
  FILE_CUT_COMMAND, FILE_DELETE_COMMAND, FILE_EXPAND_COMMAND, FILE_OPEN_COMMAND,
  FILE_PASTE_COMMAND, FILE_RENAME_COMMAND, FILE_SELECT_NEXT_COMMAND,
  FILE_SELECT_PREVIOUS_COMMAND, fileShortcutBindingsSnapshot, fileShortcutLabel,
  removeActiveFileShortcutTarget, setActiveFileShortcutTarget, subscribeFileShortcutBindings,
} from "./file-shortcuts.ts"
import { fileMentionText, treeMentionPath } from "./file-mention.ts"
import { ChevronIcon, FileGlyph, FolderGlyph, SearchIcon } from "./icons.tsx"
import { localeRevision, subscribeLocale, t } from "./locales.ts"
import css from "./panels.module.css"

/** `git.status` 返回的一条变更记录；同一路径的暂存态与工作区态是两条。 */
interface GitEntry {
  readonly path: string
  readonly group: "merge" | "index" | "worktree" | "untracked"
  readonly status: string
}

/** Inline row used for both "new entry" and "rename", so only one can be live. */
interface TreeDraft {
  readonly mode: "file" | "folder" | "rename"
  /** Directory the draft belongs to; reloaded once the draft commits. */
  readonly dir: string
  /** Renamed entry (absent while creating). */
  readonly path?: string
  readonly isDir?: boolean
  readonly name: string
}

interface ContextTarget {
  readonly entry: TreeEntry
  readonly x: number
  readonly y: number
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sortEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  })
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot <= 0 || dot === name.length - 1) return ""
  return name.slice(dot + 1).toLowerCase()
}

/** 一个路径可能同时落在多组里，冲突最该被看见，其次是尚未暂存的改动。 */
const BADGE_RANK: Readonly<Record<GitEntry["group"], number>> = { merge: 3, worktree: 2, untracked: 1, index: 0 }

/** 变更记录按仓库根展开成绝对路径，同路径只保留优先级最高的那个徽标。 */
function gitMap(root: string, entries: readonly GitEntry[]): Readonly<Record<string, string>> {
  const best: Record<string, { readonly rank: number; readonly badge: string }> = {}
  for (const entry of entries) {
    const path = isAbsolutePath(entry.path) ? entry.path : joinPath(root, entry.path)
    const badge = entry.group === "untracked" ? "U" : entry.status.toUpperCase()
    const rank = BADGE_RANK[entry.group]
    const current = best[path]
    if (current === undefined || rank > current.rank) best[path] = { rank, badge }
  }
  return Object.fromEntries(Object.entries(best).map(([path, value]) => [path, value.badge]))
}

export function FilesPanel(props: WorkbenchPanelProps) {
  useSyncExternalStore(subscribeLocale, localeRevision, localeRevision)
  const sessionId = props.scope.sessionId
  const cwdHint = props.scope.cwd
  const [cwd, setCwd] = useState("")
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [children, setChildren] = useState<Readonly<Record<string, readonly TreeEntry[]>>>({})
  const [pending, setPending] = useState<Readonly<Record<string, boolean>>>({})
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [git, setGit] = useState<Readonly<Record<string, string>>>({})
  const [draft, setDraft] = useState<TreeDraft>()
  const [clipboard, setClipboard] = useState<{ readonly path: string; readonly cut: boolean }>()
  const [removal, setRemoval] = useState<TreeEntry>()
  const [menu, setMenu] = useState<ContextTarget>()
  const [newOpen, setNewOpen] = useState(false)
  const [treeFocused, setTreeFocused] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)
  const shortcutBindings = useSyncExternalStore(
    subscribeFileShortcutBindings,
    fileShortcutBindingsSnapshot,
    fileShortcutBindingsSnapshot,
  )

  const loadDir = async (dir: string, signal?: AbortSignal) => {
    if (sessionId === undefined) return
    setPending(current => ({ ...current, [dir]: true }))
    try {
      const listing = await workbenchRequest<{ entries?: TreeEntry[] }>("fs.tree", { sessionId, path: dir, cwd: cwdHint }, signal)
      setChildren(current => ({ ...current, [dir]: sortEntries(listing.entries ?? []) }))
      setError(undefined)
    } catch (cause) {
      if (signal?.aborted) return
      setError(message(cause))
    } finally {
      setPending(current => ({ ...current, [dir]: false }))
    }
  }

  // 状态里的路径相对仓库根，而会话 cwd 可能是仓库的子目录，因此按返回的 root 展开。
  const loadGit = async (fallbackRoot: string, signal?: AbortSignal) => {
    if (sessionId === undefined) return
    try {
      const status = await workbenchRequest<{ root?: string; files?: GitEntry[] }>("git.status", { sessionId, cwd: cwdHint }, signal)
      setGit(gitMap(status.root ?? fallbackRoot, status.files ?? []))
    } catch {
      setGit({})
    }
  }

  useEffect(() => {
    if (sessionId === undefined || !props.visible) return
    const controller = new AbortController()
    void workbenchRequest<{ cwd: string }>("session.cwd", { sessionId, cwd: cwdHint }, controller.signal).then(async value => {
      setCwd(value.cwd)
      setExpanded(current => new Set(current).add(value.cwd))
      await loadDir(value.cwd, controller.signal)
      await loadGit(value.cwd, controller.signal)
    }, cause => {
      if (!controller.signal.aborted) setError(message(cause))
    })
    return () => controller.abort()
  }, [sessionId, cwdHint, props.visible])

  /** Reload the directories an operation touched, then the git badges. */
  const refresh = async (...dirs: readonly string[]) => {
    for (const dir of new Set(dirs)) await loadDir(dir)
    await loadGit(cwd)
  }

  const toggleDir = (path: string) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (children[path] === undefined) void loadDir(path)
  }

  /** Make a directory visible so a draft row or a pasted entry is not hidden. */
  const expandDir = (path: string) => {
    if (path === cwd) return
    setExpanded(current => current.has(path) ? current : new Set(current).add(path))
    if (children[path] === undefined) void loadDir(path)
  }

  const openEntry = (entry: TreeEntry, dock: "right" | "bottom" = "right") => {
    setSelected(entry.path)
    if (entry.isDir) {
      toggleDir(entry.path)
      return
    }
    props.open("preview", { title: entry.name, target: { path: entry.path }, dock })
  }

  const startCreate = (dir: string, mode: "file" | "folder") => {
    expandDir(dir)
    setDraft({ mode, dir, name: "" })
  }

  const submitDraft = async () => {
    if (sessionId === undefined || draft === undefined) return
    const name = draft.name.trim()
    if (!isValidName(name)) {
      setDraft(undefined)
      return
    }
    try {
      if (draft.mode === "rename") {
        if (draft.path === undefined || name === baseName(draft.path)) {
          setDraft(undefined)
          return
        }
        const path = await renameEntry(sessionId, draft.path, name)
        setDraft(undefined)
        setSelected(path)
        await refresh(draft.dir)
        return
      }
      const path = await createEntry(sessionId, draft.dir, name, draft.mode)
      setDraft(undefined)
      await refresh(draft.dir)
      if (draft.mode === "folder") expandDir(path)
      else openEntry({ name, path, isDir: false })
    } catch (cause) {
      setDraft(undefined)
      setError(message(cause))
    }
  }

  const paste = async (dir: string) => {
    if (sessionId === undefined || clipboard === undefined) return
    const source = parentOf(clipboard.path)
    try {
      const path = clipboard.cut
        ? await moveEntry(sessionId, clipboard.path, dir)
        : await copyEntry(sessionId, clipboard.path, dir)
      if (clipboard.cut) setClipboard(undefined)
      expandDir(dir)
      setSelected(path)
      await refresh(dir, source)
    } catch (cause) {
      setError(message(cause))
    }
  }

  const remove = async (entry: TreeEntry) => {
    setRemoval(undefined)
    if (sessionId === undefined) return
    try {
      await deleteEntry(sessionId, entry.path)
      if (selected === entry.path) setSelected(undefined)
      if (clipboard?.path === entry.path) setClipboard(undefined)
      await refresh(parentOf(entry.path))
    } catch (cause) {
      setError(message(cause))
    }
  }

  const runCommand = (command: FileCommand, entry: TreeEntry) => {
    const dir = entry.isDir ? entry.path : parentOf(entry.path)
    switch (command) {
      case "open": openEntry(entry); return
      case "addToChat": props.addFileToChat?.(treeMentionPath(cwd, entry.path, entry.isDir)); return
      case "newFile": startCreate(dir, "file"); return
      case "newFolder": startCreate(dir, "folder"); return
      case "refresh": void refresh(dir); return
      case "copy": setClipboard({ path: entry.path, cut: false }); return
      case "cut": setClipboard({ path: entry.path, cut: true }); return
      case "paste": void paste(dir); return
      case "rename": setDraft({ mode: "rename", dir: parentOf(entry.path), path: entry.path, isDir: entry.isDir, name: entry.name }); return
      case "delete": setRemoval(entry); return
      case "copyPath": void writeClipboard(entry.path); return
      case "copyRelativePath": void writeClipboard(relativeTo(cwd, entry.path)); return
      case "reveal":
        if (sessionId !== undefined) void revealEntry(sessionId, entry.path).catch((cause: unknown) => setError(message(cause)))
    }
  }

  const visibleEntries = (): TreeEntry[] => {
    const result: TreeEntry[] = []
    const visit = (dir: string) => {
      for (const entry of children[dir] ?? []) {
        result.push(entry)
        if (entry.isDir && expanded.has(entry.path)) visit(entry.path)
      }
    }
    visit(cwd)
    return result
  }

  const selectedEntry = (): TreeEntry | undefined => {
    if (selected === undefined) return undefined
    const visit = (dir: string): TreeEntry | undefined => {
      for (const entry of children[dir] ?? []) {
        if (entry.path === selected) return entry
        if (entry.isDir && expanded.has(entry.path)) {
          const found = visit(entry.path)
          if (found !== undefined) return found
        }
      }
      return undefined
    }
    return visit(cwd)
  }

  const runShortcut = (commandId: string): boolean => {
    const entry = selectedEntry()
    if (commandId === FILE_CANCEL_COMMAND) {
      if (menu !== undefined) { setMenu(undefined); return true }
      if (draft !== undefined) { setDraft(undefined); return true }
      if (removal !== undefined) { setRemoval(undefined); return true }
      return false
    }
    if (entry === undefined) return false
    switch (commandId) {
      case FILE_OPEN_COMMAND: runCommand("open", entry); return true
      case FILE_ADD_TO_CHAT_COMMAND:
        return props.addFileToChat?.(treeMentionPath(cwd, entry.path, entry.isDir)) ?? false
      case FILE_RENAME_COMMAND:
        runCommand("rename", entry); return true
      case FILE_DELETE_COMMAND:
        runCommand("delete", entry); return true
      case FILE_COPY_COMMAND:
        runCommand("copy", entry); return true
      case FILE_CUT_COMMAND:
        runCommand("cut", entry); return true
      case FILE_PASTE_COMMAND:
        runCommand("paste", entry); return true
      case FILE_SELECT_PREVIOUS_COMMAND:
      case FILE_SELECT_NEXT_COMMAND: {
        const entries = visibleEntries()
        const index = entries.findIndex(candidate => candidate.path === entry.path)
        if (index < 0 || entries.length === 0) return false
        const next = commandId === FILE_SELECT_NEXT_COMMAND
          ? entries[Math.min(index + 1, entries.length - 1)]
          : entries[Math.max(index - 1, 0)]
        if (next === undefined || next.path === entry.path) return false
        setSelected(next.path)
        return true
      }
      case FILE_EXPAND_COMMAND:
        if (!entry.isDir) return false
        if (!expanded.has(entry.path)) { toggleDir(entry.path); return true }
        return false
      case FILE_COLLAPSE_COMMAND:
        if (entry.isDir && expanded.has(entry.path)) { toggleDir(entry.path); return true }
        setSelected(parentOf(entry.path))
        return true
      case FILE_CONTEXT_MENU_COMMAND:
        setMenu({ entry, x: treeRef.current?.getBoundingClientRect().left ?? 0, y: treeRef.current?.getBoundingClientRect().top ?? 0 })
        return true
      default: return false
    }
  }

  useEffect(() => {
    const target = {
      isActive: () => treeFocused && treeRef.current?.contains(document.activeElement) === true,
      run: runShortcut,
    }
    setActiveFileShortcutTarget(target)
    return () => {
      removeActiveFileShortcutTarget(target)
    }
  })

  const openMenu = (event: ReactMouseEvent, entry: TreeEntry) => {
    event.preventDefault()
    event.stopPropagation()
    setTreeFocused(true)
    treeRef.current?.focus()
    setSelected(entry.path)
    setMenu({ entry, x: event.clientX, y: event.clientY })
  }

  // The menu is anchored at the pointer instead of an element, so it reports a
  // zero-sized rect there and lets Menu's own clamping keep it on screen.
  const anchorRect = useCallback(
    () => menu === undefined ? null : new DOMRect(menu.x, menu.y, 0, 0),
    [menu],
  )

  const query = filter.trim().toLowerCase()
  const roots = children[cwd] ?? []

  const draftRow = (depth: number, isDir: boolean): ReactNode => <form
    key="draft"
    className={css.treeCreate}
    style={{ paddingLeft: 26 + depth * 12 }}
    onSubmit={event => { event.preventDefault(); void submitDraft() }}
  >
    <span className={css.treeIcon} data-dir={isDir || undefined}>{isDir ? <FolderGlyph size={14} /> : <FileGlyph size={14} />}</span>
    <input
      autoFocus
      aria-label={draft?.mode === "rename" ? t("files.name") : isDir ? t("files.folderName") : t("files.name")}
      value={draft?.name ?? ""}
      placeholder={isDir ? t("files.folderName") : t("files.name")}
      onChange={event => setDraft(current => current === undefined ? current : { ...current, name: event.target.value })}
      onKeyDown={event => { if (event.key === "Escape") setDraft(undefined) }}
      onBlur={() => { void submitDraft() }}
    />
  </form>

  const renderBranch = (dir: string, depth: number): ReactNode[] => {
    const entries = children[dir] ?? []
    const nodes: ReactNode[] = []
    if (draft !== undefined && draft.mode !== "rename" && draft.dir === dir) nodes.push(draftRow(depth, draft.mode === "folder"))
    for (const entry of entries) {
      const open = expanded.has(entry.path)
      const nested = entry.isDir && open ? renderBranch(entry.path, depth + 1) : []
      const nameHit = query === "" || entry.name.toLowerCase().includes(query)
      if (query !== "" && !nameHit && nested.length === 0) continue
      if (draft?.mode === "rename" && draft.path === entry.path) {
        nodes.push(draftRow(depth, entry.isDir))
        nodes.push(...nested)
        continue
      }
      const badge = git[entry.path]
      nodes.push(
        <div
          key={entry.path}
          className={css.treeRow}
          draggable={!entry.isDir}
          data-selected={selected === entry.path || undefined}
          data-cut={(clipboard?.cut === true && clipboard.path === entry.path) || undefined}
          style={{ paddingLeft: 8 + depth * 12 }}
          role="treeitem"
          aria-expanded={entry.isDir ? open : undefined}
          aria-selected={selected === entry.path}
          onClick={() => { setTreeFocused(true); treeRef.current?.focus(); openEntry(entry) }}
          onDragStart={event => {
            if (entry.isDir) {
              event.preventDefault()
              return
            }
            event.dataTransfer.effectAllowed = "copy"
            const mention = fileMentionText(treeMentionPath(cwd, entry.path, false))
            event.dataTransfer.setData("application/x-cocode-file-mention", mention)
            event.dataTransfer.setData("text/plain", mention)
          }}
          onContextMenu={event => openMenu(event, entry)}
        >
          {entry.isDir
            ? <span className={css.treeChevron} data-open={open || undefined} onClick={event => { event.stopPropagation(); toggleDir(entry.path) }}><ChevronIcon size={12} /></span>
            : <span className={css.treeChevron} />}
          <span className={css.treeIcon} data-dir={entry.isDir || undefined} data-ext={entry.isDir ? undefined : extensionOf(entry.name)}>
            {entry.isDir ? <FolderGlyph size={14} /> : <FileGlyph size={14} />}
          </span>
          <span className={css.treeName}>{entry.name}</span>
          {badge === undefined ? null : <span className={css.treeGit} data-status={badge}>{badge}</span>}
        </div>,
      )
      nodes.push(...nested)
    }
    return nodes
  }

  const root: TreeEntry = { name: baseName(cwd), path: cwd, isDir: true }

  return <div className={css.files}>
    <div className={css.treeSearch}>
      <SearchIcon size={14} />
      <input
        aria-label={t("files.filterLabel")}
        value={filter}
        placeholder={t("files.filter")}
        onChange={event => setFilter(event.target.value)}
      />
      <Menu
        open={newOpen}
        onClose={() => setNewOpen(false)}
        align="end"
        portal
        compact
        items={[
          { id: "file", label: t("files.newFile") },
          { id: "folder", label: t("files.newFolder") },
        ]}
        onSelect={id => {
          setNewOpen(false)
          startCreate(selected !== undefined && expanded.has(selected) ? selected : cwd, id === "folder" ? "folder" : "file")
        }}
        anchor={<button type="button" className={css.treeNew} aria-label={t("files.new")} aria-haspopup="menu" aria-expanded={newOpen} onClick={() => setNewOpen(open => !open)}>+</button>}
      />
    </div>
    {error !== undefined && <div className={css.treeError}>{error}</div>}
    <div
      ref={treeRef}
      tabIndex={0}
      className={css.tree}
      role="tree"
      aria-label={t("files.workspaceLabel")}
      onFocus={() => setTreeFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTreeFocused(false) }}
      onContextMenu={event => { if (cwd !== "") openMenu(event, root) }}
    >
      {pending[cwd] && roots.length === 0
        ? <div className={css.treeEmpty}>{t("files.loading")}</div>
        : roots.length === 0 && draft === undefined
          ? <div className={css.treeEmpty}>{t("files.empty")}</div>
          : renderBranch(cwd, 0)}
    </div>
    <Menu
      open={menu !== undefined}
      onClose={() => setMenu(undefined)}
      portal
      compact
      getAnchorRect={anchorRect}
      items={menu === undefined ? [] : fileMenuEntries(
        { isDir: menu.entry.isDir, isRoot: menu.entry.path === cwd, canPaste: clipboard !== undefined },
        commandId => fileShortcutLabel(commandId, shortcutBindings),
      )}
      onSelect={id => {
        const target = menu?.entry
        setMenu(undefined)
        if (target !== undefined && isFileCommand(id)) runCommand(id, target)
      }}
      anchor={null}
    />
    <Modal
      open={removal !== undefined}
      onClose={() => setRemoval(undefined)}
      title={removal?.isDir === true ? t("files.deleteFolder") : t("files.delete")}
      description={removal === undefined ? "" : t("files.deleteDescription", { name: removal.name, contents: removal.isDir ? t("files.contentsRemoved") : "" })}
      footer={<>
        <Button variant="outline" onClick={() => setRemoval(undefined)}>{t("files.cancel")}</Button>
        <Button variant="primary" className={css.treeDangerAction} onClick={() => { if (removal !== undefined) void remove(removal) }}>{t("files.delete")}</Button>
      </>}
    />
  </div>
}
