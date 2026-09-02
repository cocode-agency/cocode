/**
 * 源代码管理面板。布局与交互对齐 VS Code 的 Source Control 视图：分支选择器与
 * 同步状态在顶栏，提交框居中，变更按「合并冲突 / 已暂存 / 更改」三段折叠，行内
 * 悬停出操作、右键出完整菜单。
 *
 * 所有 git 语义都在 `git-store` 与后端，这里只负责呈现与派发。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Menu, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives"
import type { WorkbenchPanelProps } from "./model.ts"
import { sectionsOf, statusLetter, statusTone, gitRequest, type GitCommit, type GitRow, type GitSection } from "./git-client.ts"
import { useGitStore } from "./git-store.ts"
import { branchMenuEntries, checkoutTarget, commitMenuEntries, moreMenuEntries, rowMenuEntries, sectionLabel, type GitCommand } from "./git-menus.ts"
import { BranchIcon, DiscardIcon, MoreIcon, OpenFileIcon, RefreshIcon, SectionChevron, SparkleIcon, SpinnerIcon, StageIcon, StashApplyIcon, StashDropIcon, StashPopIcon, SyncIcon, UnstageIcon } from "./git-icons.tsx"
import { GitIcon } from "./icons.tsx"
import { State } from "./panel-state.tsx"
import { localeRevision, subscribeLocale, t } from "./locales.ts"
import css from "./git.module.css"

/** 提交框最大高度，超出后内部滚动而不是把列表挤没。 */
const COMMIT_MAX_HEIGHT = 160

type SectionId = GitSection["id"] | "stash" | "history"

interface Notice {
  readonly text: string
  readonly tone: "info" | "error"
}

interface Confirm {
  readonly text: string
  readonly run: () => Promise<unknown>
}

interface Prompt {
  readonly label: string
  readonly value: string
  /** Stash 说明一类的可选输入允许留空，分支名这类必填的留空即取消。 */
  readonly allowEmpty?: boolean
  readonly submit: (value: string) => Promise<unknown>
}

function commitShortcutLabel(): string {
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent)
  return mac ? "⌘Enter" : "Ctrl+Enter"
}

/** 让提交框随内容长高，到上限后交给自身滚动。 */
function fitHeight(element: HTMLTextAreaElement | null): void {
  if (element === null) return
  element.style.height = "auto"
  element.style.height = `${String(Math.min(element.scrollHeight, COMMIT_MAX_HEIGHT))}px`
}

function IconAction(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  /** 图标之外还要放计数一类的内容时放开固定宽度。 */
  wide?: boolean
  children: ReactNode
}) {
  return <Tooltip label={props.label} side="bottom" delayMs={400}>
    <button
      type="button"
      className={css.iconButton}
      aria-label={props.label}
      disabled={props.disabled}
      aria-busy={props.busy === true || undefined}
      data-busy={props.busy === true || undefined}
      data-wide={props.wide === true || undefined}
      onClick={event => { event.stopPropagation(); props.onClick() }}
    >{props.children}</button>
  </Tooltip>
}

export function GitPanel(props: WorkbenchPanelProps) {
  const sessionId = props.scope.sessionId
  // 面板挂在 slot 注入通道之外，语言切换靠订阅 locale 修订号驱动重渲染。
  useSyncExternalStore(subscribeLocale, localeRevision, localeRevision)

  const { state, reload, run, loadBranches } = useGitStore(sessionId, props.visible)
  const repo = state.status?.isRepo === true ? state.status : undefined

  const [draft, setDraft] = useState("")
  const [notice, setNotice] = useState<Notice>()
  const [confirm, setConfirm] = useState<Confirm>()
  const [prompt, setPrompt] = useState<Prompt>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionId>>(() => new Set())
  const [selected, setSelected] = useState<string>()
  const [history, setHistory] = useState<readonly GitCommit[]>()
  const [branchOpen, setBranchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [commitMenuOpen, setCommitMenuOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ readonly row: GitRow; readonly x: number; readonly y: number }>()
  const [generating, setGenerating] = useState(false)
  const commitRef = useRef<HTMLTextAreaElement>(null)

  const sections = useMemo(() => sectionsOf(repo?.files ?? []), [repo?.files])
  const shortcut = useMemo(commitShortcutLabel, [])

  useEffect(() => { fitHeight(commitRef.current) }, [draft])
  // 切换会话等于换一个仓库，草稿与临时态都不该跟着走。
  useEffect(() => {
    setDraft("")
    setNotice(undefined)
    setConfirm(undefined)
    setPrompt(undefined)
    setHistory(undefined)
    setSelected(undefined)
  }, [sessionId])

  const report = useCallback((error: string | undefined) => {
    setNotice(error === undefined ? undefined : { text: error, tone: "error" })
  }, [])

  const toggleSection = (id: SectionId): void => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const absolutePathOf = (row: GitRow): string | undefined =>
    repo === undefined ? undefined : `${repo.root}/${row.path}`

  const openFile = (row: GitRow): void => {
    const path = absolutePathOf(row)
    if (path === undefined) return
    props.open("preview", { title: row.name, dock: "right", target: { path } })
  }

  /** 打开差异视图；分组决定比较的是索引还是工作区。 */
  const openChanges = (row: GitRow): void => {
    const path = absolutePathOf(row)
    if (path === undefined) return
    // 标题带上比较的一侧，同一文件的暂存差异与工作区差异因此是两个可分辨的页签。
    props.open("preview", {
      title: `${row.name} · ${row.group === "index" ? t("git.diffStaged") : t("git.diffWorktree")}`,
      dock: "right",
      target: { path, data: { kind: "diff", repoPath: row.path, group: row.group } },
    })
  }

  /** 单行撤销与 VS Code 一致：直接还原，不弹确认框。 */
  const discardRow = (row: GitRow): void => {
    void run("git.discard", { paths: [row.path], group: row.group }).then(report)
  }

  const askDiscardAll = (): void => {
    const count = repo?.files.filter(file => file.group !== "index").length ?? 0
    setConfirm({
      text: t("git.confirmDiscardAll", { count }),
      run: () => run("git.discardAll").then(report),
    })
  }

  const commit = async (variant: "commit" | "commitPush" | "commitSync" | "commitAmend" | "commitSignoff"): Promise<void> => {
    const text = draft.trim()
    // 只有修补提交允许留空——它会沿用上一条提交信息。
    if (text === "" && variant !== "commitAmend") {
      setNotice({ text: t("git.commitEmpty"), tone: "error" })
      return
    }
    // 什么都没暂存时连同已跟踪文件一起提交，省去“先全部暂存再提交”这一步；
    // 未跟踪文件不在 --all 的范围内，仍需显式暂存，与 git 本身的语义一致。
    const staged = repo?.files.some(file => file.group === "index") === true
    const error = await run("git.commit", {
      ...(text === "" ? {} : { message: text }),
      ...(staged ? {} : { all: true }),
      ...(variant === "commitAmend" ? { amend: true } : {}),
      ...(variant === "commitSignoff" ? { signoff: true } : {}),
    })
    if (error !== undefined) {
      report(error)
      return
    }
    setDraft("")
    setNotice(undefined)
    if (variant === "commitPush") report(await run("git.push"))
    if (variant === "commitSync") report(await run("git.sync"))
  }

  /** 让模型读当前差异并写好提交消息，直接落进草稿框，用户仍可改后再提交。 */
  const generateMessage = async (): Promise<void> => {
    if (sessionId === undefined || generating) return
    setGenerating(true)
    try {
      const result = await gitRequest<{ message: string }>("git.generateMessage", { sessionId })
      setDraft(result.message)
      setNotice(undefined)
      commitRef.current?.focus()
    } catch (error) {
      report(error instanceof Error ? error.message : String(error))
    } finally {
      setGenerating(false)
    }
  }

  const showHistory = async (): Promise<void> => {
    if (sessionId === undefined) return
    try {
      const result = await gitRequest<{ commits: readonly GitCommit[] }>("git.log", { sessionId })
      setHistory(result.commits)
      setCollapsed(current => {
        const next = new Set(current)
        next.delete("history")
        return next
      })
    } catch (error) {
      report(error instanceof Error ? error.message : String(error))
    }
  }

  const dispatch = async (command: GitCommand, row?: GitRow): Promise<void> => {
    switch (command) {
      case "refresh": await reload(); return
      case "init": report(await run("git.init")); return
      case "openFile": if (row !== undefined) openFile(row); return
      case "openChanges": if (row !== undefined) openChanges(row); return
      case "stage": if (row !== undefined) report(await run("git.stage", { paths: [row.path] })); return
      case "unstage": if (row !== undefined) report(await run("git.unstage", { paths: [row.path] })); return
      case "discard": if (row !== undefined) discardRow(row); return
      case "ignore": if (row !== undefined) report(await run("git.ignore", { paths: [row.path] })); return
      case "copyPath": {
        const path = row === undefined ? undefined : absolutePathOf(row)
        if (path !== undefined) await navigator.clipboard.writeText(path)
        return
      }
      case "reveal": {
        const path = row === undefined ? undefined : absolutePathOf(row)
        if (path === undefined || sessionId === undefined) return
        try { await gitRequest("fs.reveal", { sessionId, path }) } catch (error) { report(error instanceof Error ? error.message : String(error)) }
        return
      }
      case "stageAll": report(await run("git.stageAll")); return
      case "unstageAll": report(await run("git.unstageAll")); return
      case "discardAll": askDiscardAll(); return
      case "push": report(await run("git.push")); return
      case "pushForce": report(await run("git.push", { force: true })); return
      case "pull": report(await run("git.pull")); return
      case "pullRebase": report(await run("git.pull", { rebase: true })); return
      case "fetch": report(await run("git.fetch", { all: true })); return
      case "sync": report(await run("git.sync")); return
      case "branchCreate":
        setPrompt({
          label: t("git.promptBranchName"),
          value: "",
          submit: value => run("git.checkout", { branch: value, create: true }).then(report),
        })
        return
      case "branchDelete":
        setPrompt({
          label: t("git.promptBranchName"),
          value: "",
          submit: value => run("git.branchDelete", { branch: value }).then(report),
        })
        return
      case "stashPush": case "stashPushUntracked": {
        const untracked = command === "stashPushUntracked"
        setPrompt({
          label: t("git.promptStashMessage"),
          value: "",
          allowEmpty: true,
          submit: value => run("git.stashPush", {
            ...(value === "" ? {} : { message: value }),
            ...(untracked ? { includeUntracked: true } : {}),
          }).then(report),
        })
        return
      }
      case "stashPop": report(await run("git.stashPop", { index: 0 })); return
      case "stashApply": report(await run("git.stashApply", { index: 0 })); return
      case "stashDrop":
        setConfirm({ text: t("git.confirmStashDrop"), run: () => run("git.stashDrop", { index: 0 }).then(report) })
        return
      case "history": await showHistory(); return
      case "abortMerge": report(await run("git.mergeAbort")); return
      case "commit": case "commitPush": case "commitSync": case "commitAmend": case "commitSignoff":
        await commit(command)
        return
    }
  }

  const renderRow = (row: GitRow): ReactNode => {
    const staged = row.group === "index"
    return <div
      key={row.id}
      className={css.row}
      role="button"
      tabIndex={0}
      data-tone={statusTone(row)}
      data-selected={selected === row.id || undefined}
      title={row.path}
      onClick={() => { setSelected(row.id); openChanges(row) }}
      onKeyDown={event => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        setSelected(row.id)
        openChanges(row)
      }}
      onContextMenu={event => {
        event.preventDefault()
        setSelected(row.id)
        setRowMenu({ row, x: event.clientX, y: event.clientY })
      }}
    >
      <span className={css.rowIcon} data-ext={row.ext === "" ? undefined : row.ext}><OpenFileIcon size={14} /></span>
      <span className={css.rowLabel}>
        <span className={css.rowName}>{row.name}</span>
        {row.directory !== "" && <span className={css.rowDirectory}>{row.directory}</span>}
      </span>
      <span className={css.rowActions}>
        <IconAction label={t("git.openFile")} onClick={() => openFile(row)}><OpenFileIcon size={14} /></IconAction>
        <IconAction label={t("git.discard")} onClick={() => discardRow(row)}><DiscardIcon size={14} /></IconAction>
        {staged
          ? <IconAction label={t("git.unstage")} onClick={() => void dispatch("unstage", row)}><UnstageIcon size={14} /></IconAction>
          : <IconAction label={t("git.stage")} onClick={() => void dispatch("stage", row)}><StageIcon size={14} /></IconAction>}
      </span>
      <span className={css.rowStatus}>{statusLetter(row)}</span>
    </div>
  }

  const renderSection = (id: SectionId, label: string, count: number, actions: ReactNode, children: ReactNode): ReactNode => {
    if (count === 0) return null
    const open = !collapsed.has(id)
    return <section className={css.section} key={id}>
      <button type="button" className={css.sectionHeader} aria-expanded={open} onClick={() => toggleSection(id)}>
        <span className={css.sectionChevron} data-open={open || undefined}><SectionChevron size={12} /></span>
        <span className={css.sectionTitle}>{label}</span>
        <span className={css.sectionActions}>{actions}</span>
        <span className={css.count}>{count}</span>
      </button>
      {open && children}
    </section>
  }

  const sectionActions = (section: GitSection): ReactNode => {
    if (section.id === "index") {
      return <IconAction label={t("git.unstageAll")} onClick={() => void dispatch("unstageAll")}><UnstageIcon size={14} /></IconAction>
    }
    return <>
      <IconAction label={t("git.discardAll")} onClick={() => void dispatch("discardAll")}><DiscardIcon size={14} /></IconAction>
      <IconAction label={t("git.stageAll")} onClick={() => void dispatch("stageAll")}><StageIcon size={14} /></IconAction>
    </>
  }

  if (sessionId === undefined) {
    return <State empty={t("git.noSession")} hint={t("git.noSessionHint")} icon={<GitIcon size={18} />} />
  }
  if (state.loading && state.status === undefined) return <State loading />
  // 读状态失败与「不是仓库」是两回事：前者只能重试，后者才该给初始化。
  if (state.error !== undefined) {
    return <State error={state.error} action={{ label: t("common.retry"), onClick: () => void dispatch("refresh") }} />
  }
  if (repo === undefined) {
    return <State
      empty={t("git.notRepo")}
      hint={t("git.notRepoHint")}
      icon={<GitIcon size={18} />}
      action={{ label: t("git.init"), onClick: () => void dispatch("init") }}
    />
  }

  const totalChanges = repo.files.length
  const hasDiffableChanges = repo.files.some(file => file.group !== "untracked")
  // 有改动可提交，或处于修补/未完成操作中（此时可以提交一次空改动收尾）。
  const canCommit = totalChanges > 0 || repo.operation !== undefined
  const tracking = repo.ahead > 0 || repo.behind > 0
  // 同步按钮自带计数，提示里再把两个方向各自说清楚。
  const syncLabel = [
    t("git.sync"),
    ...(repo.behind > 0 ? [t("git.behind", { count: repo.behind })] : []),
    ...(repo.ahead > 0 ? [t("git.ahead", { count: repo.ahead })] : []),
  ].join(" · ")

  return <div className={css.panel}>
    <div className={css.toolbar}>
      <Menu
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        items={branchMenuEntries(repo, state.branches, state.remoteBranches)}
        selectedId={`checkout:${repo.branch}`}
        onSelect={id => {
          setBranchOpen(false)
          const branch = checkoutTarget(id)
          if (branch !== undefined) { void run("git.checkout", { branch }).then(report); return }
          void dispatch(id as GitCommand)
        }}
        align="start"
        portal
        compact
        className={css.menuAnchor}
        anchor={<button
          type="button"
          className={css.branch}
          data-detached={repo.detached || undefined}
          aria-haspopup="menu"
          aria-expanded={branchOpen}
          title={repo.detached ? t("git.detached") : repo.branch}
          onClick={() => { setBranchOpen(open => !open); void loadBranches() }}
        >
          <BranchIcon size={14} />
          {/* 尾随星号与 VS Code 一致：分支上还有未提交的改动。 */}
          <span className={css.branchName}>{repo.branch}{totalChanges > 0 ? "*" : ""}</span>
        </button>}
      />
      {repo.operation !== undefined && <span className={css.operation}>{t(`git.operation.${repo.operation}`)}</span>}
      <span className={css.spacer} />
      {repo.hasRemote && <IconAction label={syncLabel} busy={state.busy} wide={tracking} onClick={() => void dispatch("sync")}>
        <SyncIcon size={15} />
        {tracking && <span className={css.syncCount}>
          {repo.behind > 0 && <span>{repo.behind}↓</span>}
          {repo.ahead > 0 && <span>{repo.ahead}↑</span>}
        </span>}
      </IconAction>}
      <IconAction label={t("git.refresh")} onClick={() => void dispatch("refresh")}><RefreshIcon size={15} /></IconAction>
      <Menu
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={moreMenuEntries(repo, state.stashes)}
        onSelect={id => { setMoreOpen(false); void dispatch(id as GitCommand) }}
        align="end"
        portal
        compact
        className={css.menuAnchor}
        anchor={<button type="button" className={css.iconButton} aria-label={t("git.more")} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(open => !open)}>
          <MoreIcon size={15} />
        </button>}
      />
    </div>

    <div className={css.commit}>
      <div className={css.commitField}>
        <textarea
          ref={commitRef}
          className={css.commitInput}
          value={draft}
          rows={2}
          spellCheck={false}
          aria-label={t("git.commit")}
          placeholder={t("git.commitPlaceholder", { key: shortcut, branch: repo.branch })}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
            event.preventDefault()
            void commit("commit")
          }}
        />
        <div className={css.commitGenerate}>
          <IconAction
            label={generating ? t("git.generatingMessage") : t("git.generateMessage")}
            busy={generating}
            disabled={generating || !hasDiffableChanges}
            onClick={() => void generateMessage()}
          >
            {generating ? <SpinnerIcon size={14} /> : <SparkleIcon size={14} />}
          </IconAction>
        </div>
      </div>
      <div className={css.commitBar}>
        <button type="button" className={css.commitButton} disabled={state.busy || !canCommit} onClick={() => void commit("commit")}>
          {t("git.commit")}
        </button>
        <Menu
          open={commitMenuOpen}
          onClose={() => setCommitMenuOpen(false)}
          items={commitMenuEntries(repo)}
          onSelect={id => { setCommitMenuOpen(false); void dispatch(id as GitCommand) }}
          align="end"
          side="top"
          portal
          compact
          className={css.menuAnchor}
          anchor={<button type="button" className={css.commitMore} disabled={state.busy} aria-label={t("git.more")} aria-haspopup="menu" aria-expanded={commitMenuOpen} onClick={() => setCommitMenuOpen(open => !open)}>
            <SectionChevron size={12} />
          </button>}
        />
      </div>
    </div>

    {confirm !== undefined && <div className={css.notice} data-tone="error">
      <span className={css.noticeText}>{confirm.text}</span>
      <span className={css.noticeActions}>
        <button type="button" className={css.noticeButton} onClick={() => setConfirm(undefined)}>{t("common.cancel")}</button>
        <button type="button" className={css.noticeButton} data-danger onClick={() => { const task = confirm.run; setConfirm(undefined); void task() }}>{t("common.confirm")}</button>
      </span>
    </div>}

    {prompt !== undefined && <form
      className={css.prompt}
      onSubmit={event => {
        event.preventDefault()
        const value = prompt.value.trim()
        setPrompt(undefined)
        if (value !== "" || prompt.allowEmpty === true) void prompt.submit(value)
      }}
    >
      <input
        autoFocus
        className={css.promptInput}
        value={prompt.value}
        placeholder={prompt.label}
        aria-label={prompt.label}
        onChange={event => setPrompt({ ...prompt, value: event.target.value })}
        onKeyDown={event => { if (event.key === "Escape") setPrompt(undefined) }}
      />
      <button type="submit" className={css.noticeButton}>{t("common.confirm")}</button>
    </form>}

    {notice !== undefined && confirm === undefined && <div className={css.notice} data-tone={notice.tone}>
      <span className={css.noticeText}>{notice.text}</span>
      <span className={css.noticeActions}>
        <button type="button" className={css.noticeButton} onClick={() => setNotice(undefined)}>{t("common.close")}</button>
      </span>
    </div>}

    <div className={css.body}>
      {totalChanges === 0 && history === undefined && state.stashes.length === 0 &&
        <State empty={t("git.empty")} hint={t("git.emptyHint")} icon={<GitIcon size={18} />} />}
      {sections.map(section => renderSection(
        section.id,
        sectionLabel(section.id),
        section.rows.length,
        sectionActions(section),
        section.rows.map(renderRow),
      ))}
      {renderSection("stash", t("git.stash"), state.stashes.length, null, state.stashes.map(stash =>
        <div className={css.stashRow} key={stash.index}>
          <span className={css.rowIcon} />
          <span className={css.stashLabel} title={stash.label}>{stash.label}</span>
          <span className={css.rowActions}>
            <IconAction label={t("git.stashApply")} onClick={() => void run("git.stashApply", { index: stash.index }).then(report)}><StashApplyIcon size={14} /></IconAction>
            <IconAction label={t("git.stashPop")} onClick={() => void run("git.stashPop", { index: stash.index }).then(report)}><StashPopIcon size={14} /></IconAction>
            <IconAction label={t("git.stashDrop")} onClick={() => setConfirm({ text: t("git.confirmStashDrop"), run: () => run("git.stashDrop", { index: stash.index }).then(report) })}><StashDropIcon size={14} /></IconAction>
          </span>
        </div>,
      ))}
      {history !== undefined && renderSection("history", t("git.history"), history.length, null, history.map(entry =>
        <div className={css.commitRow} key={entry.hash} title={`${entry.shortHash} · ${entry.author}`}>
          <span className={css.commitSubject}>{entry.subject}</span>
          <span className={css.commitMeta}>{entry.date}</span>
        </div>,
      ))}
      {history !== undefined && history.length === 0 && <State empty={t("git.historyEmpty")} />}
    </div>

    <Menu
      open={rowMenu !== undefined}
      onClose={() => setRowMenu(undefined)}
      items={rowMenu === undefined ? [] : rowMenuEntries(rowMenu.row)}
      onSelect={id => {
        const row = rowMenu?.row
        setRowMenu(undefined)
        if (row !== undefined) void dispatch(id as GitCommand, row)
      }}
      portal
      compact
      getAnchorRect={() => rowMenu === undefined ? null : new DOMRect(rowMenu.x, rowMenu.y, 0, 0)}
      anchor={null}
    />
  </div>
}
