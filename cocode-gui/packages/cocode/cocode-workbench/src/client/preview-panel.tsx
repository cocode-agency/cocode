import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { CodeBlock, MarkdownText } from "@deepseek-ai/dsh-client-ui-primitives"
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Highlighter, Italic, List, ListIndentDecrease,
  ListIndentIncrease, ListOrdered, Palette, Redo2, RemoveFormatting, Save, SeparatorHorizontal, Strikethrough,
  Subscript, Superscript, Table2, Underline, Undo2,
} from "lucide-react"
import type { WorkbenchPanelProps } from "./model.ts"
import { ExternalIcon, PreviewIcon } from "./icons.tsx"
import type { DesktopApi } from "../../../../../src/contracts/ipc/desktop.contract.ts"
import { State, message, useRemote } from "./panel-state.tsx"
import { CodeEditor } from "./code-editor.tsx"
import { fileUrl, workbenchRequest } from "./runtime-api.ts"
import { resolveMarkdownImages } from "./markdown-assets.ts"
import { baseName, relativeTo } from "../paths.ts"
import { GitDiffView } from "./git-diff.tsx"
import type { GitGroup } from "./git-client.ts"
import { t } from "./locales.ts"
import { ExcelPreview } from "./excel-preview.tsx"
import css from "./preview.module.css"

/** Source is the editable face; preview is always read-only. */
type ViewMode = "source" | "preview"

/** Matches preview.module.css crossfade duration. */
const MODE_CROSSFADE_MS = 200

/** Crossfade between source and preview; only one face stays mounted at rest. */
function ModeCrossfade(props: { readonly mode: ViewMode; readonly path: string; readonly source: ReactNode; readonly preview: ReactNode }) {
  const reducedMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  ).current
  const prevMode = useRef(props.mode)
  const [resident, setResident] = useState<readonly ViewMode[]>(() => [props.mode])

  useEffect(() => {
    prevMode.current = props.mode
    setResident([props.mode])
  }, [props.path])

  useEffect(() => {
    if (reducedMotion || props.mode === prevMode.current) return
    prevMode.current = props.mode
    setResident(prev => prev.includes(props.mode) ? prev : [...prev, props.mode])
    const timer = window.setTimeout(() => setResident([props.mode]), MODE_CROSSFADE_MS)
    return () => window.clearTimeout(timer)
  }, [props.mode, reducedMotion])

  if (reducedMotion) {
    return <div className={css.body}>{props.mode === "source" ? props.source : props.preview}</div>
  }

  return <div className={css.body}>
    {resident.includes("source") && <div className={css.face} data-visible={props.mode === "source" || undefined}>{props.source}</div>}
    {resident.includes("preview") && <div className={css.face} data-visible={props.mode === "preview" || undefined}>{props.preview}</div>}
  </div>
}

/** How the preview face draws a file; `undefined` means it has no preview. */
type PreviewKind = "markdown" | "html" | "image" | "pdf" | "word" | "code"

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"])
const HTML_EXTENSIONS = new Set(["html", "htm"])
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"])
const WORD_EXTENSIONS = new Set(["doc", "docx"])
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx"])

interface FileRead {
  readonly kind: string
  readonly content?: string
  readonly truncated?: boolean
  /** False when the session's sandbox mode forbids writing this path. */
  readonly writable?: boolean
}

function previewKind(extension: string | undefined, fileKind: string | undefined): PreviewKind | undefined {
  if (extension !== undefined && WORD_EXTENSIONS.has(extension)) return "word"
  if (extension !== undefined && IMAGE_EXTENSIONS.has(extension)) return "image"
  if (fileKind === "binary") return extension === "pdf" ? "pdf" : undefined
  if (extension !== undefined && MARKDOWN_EXTENSIONS.has(extension)) return "markdown"
  if (extension !== undefined && HTML_EXTENSIONS.has(extension)) return "html"
  return "code"
}

/** Documents and graphics open rendered; source-first formats open as source. */
function preferredMode(kind: PreviewKind | undefined, hasSource: boolean): ViewMode {
  if (!hasSource) return "preview"
  return kind === undefined || kind === "code" ? "source" : "preview"
}

interface WordRead {
  readonly kind: "word"
  readonly html: string
  readonly warnings: readonly string[]
  readonly writable: boolean
}

const WORD_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CENTER", "CITE", "CODE", "COL", "COLGROUP", "DD", "DEL", "DIV", "DL", "DT", "EM", "FONT",
  "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "INPUT", "KBD", "LI", "MARK", "OL", "P",
  "PRE", "Q", "S", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT",
  "TH", "THEAD", "TR", "U", "UL", "WBR",
])
const WORD_STYLE_PROPERTIES = new Set([
  "background", "background-color", "border", "border-bottom", "border-color", "border-left", "border-right", "border-style",
  "border-top", "border-width", "color", "font-family", "font-size", "font-style", "font-variant", "font-weight",
  "letter-spacing", "line-height", "margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "padding",
  "padding-bottom", "padding-left", "padding-right", "padding-top", "page-break-after", "page-break-before",
  "page-break-inside", "text-align", "text-decoration", "text-indent", "text-transform", "vertical-align", "white-space",
  "width", "height", "max-width", "list-style-type", "direction",
])

/** Keep Word content inert before placing it in the app DOM. */
function sanitizeWordHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  const root = parsed.body.firstElementChild
  if (root === null) return ""
  const clean = (node: Element): void => {
    for (const child of [...node.children]) clean(child)
    if (!WORD_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes)
      return
    }
    const href = node.tagName === "A" ? node.getAttribute("href") : null
    const src = node.tagName === "IMG" ? node.getAttribute("src") : null
    const alt = node.tagName === "IMG" ? node.getAttribute("alt") : null
    const face = node.tagName === "FONT" ? node.getAttribute("face") : null
    const color = node.tagName === "FONT" ? node.getAttribute("color") : null
    const className = node.getAttribute("class")
    const title = node.getAttribute("title")
    const align = node.getAttribute("align")
    const valign = node.getAttribute("valign")
    const bgColor = node.getAttribute("bgcolor")
    const width = node.getAttribute("width")
    const height = node.getAttribute("height")
    const listType = node.tagName === "OL" ? node.getAttribute("type") : null
    const listStart = node.tagName === "OL" ? node.getAttribute("start") : null
    const colSpan = /^(?:TD|TH)$/.test(node.tagName) ? node.getAttribute("colspan") : null
    const rowSpan = /^(?:TD|TH)$/.test(node.tagName) ? node.getAttribute("rowspan") : null
    const style = node.getAttribute("style")
    const declarations = style === null ? [] : style.split(";").map(declaration => declaration.trim()).filter(Boolean)
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name)
    if (href !== null && /^(?:https?:|mailto:|#)/i.test(href)) {
      node.setAttribute("href", href)
      node.setAttribute("rel", "noreferrer")
    }
    if (src !== null && /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(src)) node.setAttribute("src", src)
    if (alt !== null) node.setAttribute("alt", alt)
    if (className !== null) {
      const safeClasses = className.split(/\s+/).filter(value => value === "page-break" || value === "caption")
      if (safeClasses.length > 0) node.setAttribute("class", safeClasses.join(" "))
    }
    if (title === "header" || title === "footer") node.setAttribute("title", title)
    if (colSpan !== null && /^\d{1,2}$/.test(colSpan)) node.setAttribute("colspan", colSpan)
    if (rowSpan !== null && /^\d{1,2}$/.test(rowSpan)) node.setAttribute("rowspan", rowSpan)
    if (listType !== null && /^[1aAiI]$/.test(listType)) node.setAttribute("type", listType)
    if (listStart !== null && /^\d{1,4}$/.test(listStart)) node.setAttribute("start", listStart)
    if (align !== null && /^(?:left|center|right|justify)$/i.test(align)) node.setAttribute("align", align.toLowerCase())
    if (valign !== null && /^(?:top|middle|bottom|baseline)$/i.test(valign)) node.setAttribute("valign", valign.toLowerCase())
    if (bgColor !== null && /^(?:#[0-9a-f]{3,8}|[a-z]{1,32})$/i.test(bgColor)) node.setAttribute("bgcolor", bgColor)
    if (width !== null && /^(?:\d{1,4}(?:\.\d+)?%?|auto)$/.test(width)) node.setAttribute("width", width)
    if (height !== null && /^(?:\d{1,4}(?:\.\d+)?%?|auto)$/.test(height)) node.setAttribute("height", height)
    if (align !== null && /^(?:left|center|right|justify)$/i.test(align)) declarations.push(`text-align: ${align}`)
    if (valign !== null && /^(?:top|middle|bottom|baseline)$/i.test(valign)) declarations.push(`vertical-align: ${valign}`)
    if (bgColor !== null && /^(?:#[0-9a-f]{3,8}|[a-z]{1,32})$/i.test(bgColor)) declarations.push(`background-color: ${bgColor}`)
    if (width !== null && /^(?:\d{1,4}(?:\.\d+)?%?|auto)$/.test(width)) declarations.push(`width: ${width}`)
    if (height !== null && /^(?:\d{1,4}(?:\.\d+)?%?|auto)$/.test(height)) declarations.push(`height: ${height}`)
    if (face !== null && /^[\w .,'-]{1,120}$/.test(face)) declarations.push(`font-family: ${face}`)
    if (color !== null && /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,32})$/i.test(color)) declarations.push(`color: ${color}`)
    if (declarations.length > 0) {
      const safe = declarations.filter(declaration => {
        const property = declaration.split(":", 1)[0]?.trim().toLowerCase()
        return property !== undefined && WORD_STYLE_PROPERTIES.has(property) && !/(?:url\s*\(|expression\s*\(|javascript:|@import)/i.test(declaration)
      }).join("; ")
      if (safe !== "") node.setAttribute("style", safe)
    }
  }
  for (const child of [...root.children]) clean(child)
  return root.innerHTML
}

/** Show a file under the current workspace, falling back to its bare name. */
function workspaceRelativePath(root: string | undefined, path: string): string {
  if (root === undefined || root === "") return baseName(path)
  const relative = relativeTo(root, path)
  return relative === "" ? baseName(path) : relative
}

/** Cache-bust binary previews when the user explicitly reloads from disk. */
function previewFileUrl(sessionId: string | undefined, path: string, revision: number): string {
  const url = new URL(fileUrl(sessionId, path))
  if (revision > 0) url.searchParams.set("_", String(revision))
  return url.href
}

/** 源代码管理面板打开一行时带来的差异请求，其余目标一律按文件预览处理。 */
interface DiffTarget {
  readonly repoPath: string
  readonly group: GitGroup
}

function diffTarget(data: unknown): DiffTarget | undefined {
  if (data === null || typeof data !== "object") return undefined
  const value = data as Partial<DiffTarget> & { kind?: unknown }
  if (value.kind !== "diff" || typeof value.repoPath !== "string" || typeof value.group !== "string") return undefined
  return { repoPath: value.repoPath, group: value.group }
}

/**
 * 预览面板的入口。差异与文件是两套完全不同的读取与呈现，在这里就分开，
 * 免得文件预览为一个 diff 目标白读一次内容。
 */
export function PreviewPanel(props: WorkbenchPanelProps) {
  const diff = diffTarget(props.instance.target?.data)
  if (diff !== undefined) {
    return <GitDiffView sessionId={props.scope.sessionId} cwd={props.scope.cwd} repoPath={diff.repoPath} group={diff.group} />
  }
  return <FilePreview {...props} />
}

function FilePreview(props: WorkbenchPanelProps) {
  const path = props.instance.target?.path
  const extension = path?.split(".").at(-1)?.toLowerCase()
  if (path !== undefined && extension !== undefined && EXCEL_EXTENSIONS.has(extension)) return <ExcelPreview {...props} path={path} />
  if (path !== undefined && extension !== undefined && WORD_EXTENSIONS.has(extension)) return <WordPreview {...props} path={path} />
  return <RegularFilePreview {...props} />
}

function RegularFilePreview(props: WorkbenchPanelProps) {
  const sessionId = props.scope.sessionId
  const cwd = props.scope.cwd
  const path = props.instance.target?.path
  const extension = path?.split(".").at(-1)?.toLowerCase()
  // Bumped after a write so the saved file is re-read and the editor baseline
  // matches what is actually on disk.
  const [revision, setRevision] = useState(0)
  const remote = useRemote<FileRead | undefined>(async signal => {
    if (sessionId === undefined || path === undefined) return undefined
    return workbenchRequest<FileRead>("fs.read", { sessionId, path, cwd }, signal)
  }, [sessionId, path, revision, cwd])
  // Draft and mode are keyed by path, so opening another file in this panel
  // drops both instead of leaking one file's edits or choice into the next.
  const [draft, setDraft] = useState<{ readonly path: string; readonly text: string }>()
  const [choice, setChoice] = useState<{ readonly path: string; readonly mode: ViewMode }>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [openingExternal, setOpeningExternal] = useState(false)
  const [confirmRefresh, setConfirmRefresh] = useState(false)

  useEffect(() => {
    setConfirmRefresh(false)
  }, [path])

  const file = remote.value
  const stored = file?.content ?? ""
  const text = draft !== undefined && draft.path === path ? draft.text : stored
  const kind = previewKind(extension, file?.kind)
  const markdown = useMemo(
    () => kind === "markdown" && path !== undefined ? resolveMarkdownImages(text, path, sessionId) : text,
    [kind, text, path, sessionId],
  )
  // 保持引用稳定，MarkdownText 才能复用它的渲染缓存；语言切换时才换一份。
  const copyLabel = t("common.copy")
  const copiedLabel = t("common.copied")
  const codeLabels = useMemo(() => ({ copyLabel, copiedLabel }), [copyLabel, copiedLabel])
  const markdownLabels = useMemo(
    () => ({ code: codeLabels, footnotes: t("common.footnotes") }),
    [codeLabels, t],
  )

  const hasSource = file?.kind === "text"
  // A truncated read holds only the first megabytes; writing it back would
  // destroy the tail, so such a file stays readable but never editable. A file
  // the sandbox mode puts out of write reach opens read-only for the same
  // reason: better than accepting edits the save would reject.
  const editable = hasSource && file?.truncated !== true && file.writable !== false
  const dirty = editable && text !== stored
  const mode = choice !== undefined && choice.path === path ? choice.mode : preferredMode(kind, hasSource)

  const refresh = useCallback((): void => {
    if (remote.loading) return
    setDraft(undefined)
    setNotice(undefined)
    setConfirmRefresh(false)
    setRevision(value => value + 1)
  }, [remote.loading])

  const requestRefresh = useCallback((): void => {
    if (remote.loading) return
    if (dirty) {
      setConfirmRefresh(true)
      return
    }
    refresh()
  }, [dirty, refresh, remote.loading])

  const refreshToken = props.instance.refreshToken
  const lastRefreshToken = useRef(refreshToken)
  useEffect(() => {
    if (refreshToken === undefined || refreshToken === lastRefreshToken.current) return
    lastRefreshToken.current = refreshToken
    requestRefresh()
  }, [refreshToken, requestRefresh])

  if (path === undefined) return <State empty={t("preview.pickFile")} icon={<PreviewIcon size={18} />} />
  if (remote.loading || remote.error !== undefined) return <State loading={remote.loading} error={remote.error} />

  const save = (): void => {
    if (sessionId === undefined || !dirty || saving) return
    setSaving(true)
    void workbenchRequest("fs.write", { sessionId, path, content: text }).then(
      () => { setDraft(undefined); setNotice(undefined); setRevision(value => value + 1) },
      error => setNotice(message(error)),
    ).finally(() => setSaving(false))
  }

  const openWithDefaultApp = (): void => {
    const api = getDesktopApi()?.localFiles
    if (api === undefined || openingExternal) return
    setOpeningExternal(true)
    setNotice(undefined)
    void api.open({ path }).catch(error => setNotice(message(error))).finally(() => setOpeningExternal(false))
  }

  const sourceView = <CodeEditor
    key={path}
    value={text}
    lang={extension}
    readOnly={!editable}
    onChange={value => setDraft({ path, text: value })}
    onSave={save}
  />

  const previewView = ((): ReactNode => {
    switch (kind) {
      case "markdown":
        return <div className={css.scroll}>
          <article className={css.document}><MarkdownText text={markdown} labels={markdownLabels} /></article>
        </div>
      case "html":
        return <iframe className={css.frame} sandbox="allow-forms allow-scripts" srcDoc={text} title={props.instance.title} />
      case "pdf":
        return <iframe className={css.frame} src={previewFileUrl(sessionId, path, revision)} title={props.instance.title} />
      case "image":
        return <div className={css.canvas}><img className={css.image} src={previewFileUrl(sessionId, path, revision)} alt={props.instance.title} /></div>
      case "code":
        return <div className={css.scroll}><CodeBlock code={text} lang={extension} className={css.code} copyLabel={copyLabel} copiedLabel={copiedLabel} /></div>
      default:
        return <div className={css.unsupported}>
          <PreviewIcon size={28} />
          <p className={css.unsupportedText}>{t("preview.unsupported")}</p>
          {getDesktopApi()?.localFiles === undefined
            ? <p className={css.unavailable}>{t("preview.openUnavailable")}</p>
            : <button
              type="button"
              className={css.externalOpen}
              disabled={openingExternal}
              onClick={openWithDefaultApp}
            ><ExternalIcon size={15} />{t(openingExternal ? "preview.opening" : "preview.openDefault")}</button>}
        </div>
    }
  })()

  return <div className={css.panel}>
    <div className={css.toolbar}>
      {file?.truncated === true
        ? <span className={css.flag}>{t("preview.truncated")}</span>
        : hasSource && !editable && <span className={css.flag}>{t("preview.readOnly")}</span>}
      <span className={css.spacer} />
      {hasSource && kind !== undefined && <div className={css.modes} data-mode={mode} role="group" aria-label={t("preview.viewMode")}>
        <div className={css.modeThumb} aria-hidden="true" />
        <button type="button" className={css.mode} data-active={mode === "source" || undefined} onClick={() => setChoice({ path, mode: "source" })}>{t("preview.source")}</button>
        <button type="button" className={css.mode} data-active={mode === "preview" || undefined} onClick={() => setChoice({ path, mode: "preview" })}>{t("preview.preview")}</button>
      </div>}
      {dirty && <button type="button" className={css.save} disabled={saving} onClick={save}>{t(saving ? "preview.saving" : "preview.save")}</button>}
    </div>
    {confirmRefresh && <div className={css.confirm}>
      <span className={css.confirmText}>{t("preview.confirmRefresh", { name: workspaceRelativePath(cwd, path) })}</span>
      <span className={css.confirmActions}>
        <button type="button" className={css.confirmButton} onClick={() => setConfirmRefresh(false)}>{t("common.cancel")}</button>
        <button type="button" className={css.confirmButton} data-danger onClick={refresh}>{t("common.confirm")}</button>
      </span>
    </div>}
    {notice !== undefined && !confirmRefresh && <div className={css.notice}>{notice}</div>}
    <ModeCrossfade mode={mode} path={path} source={sourceView} preview={previewView} />
  </div>
}

function WordPreview(props: WorkbenchPanelProps & { readonly path: string }) {
  const sessionId = props.scope.sessionId
  const cwd = props.scope.cwd
  const path = props.path
  const editor = useRef<HTMLDivElement>(null)
  const [revision, setRevision] = useState(0)
  const remote = useRemote<WordRead | undefined>(async signal => {
    if (sessionId === undefined) return undefined
    return workbenchRequest<WordRead>("word.read", { sessionId, path, cwd }, signal)
  }, [sessionId, path, revision, cwd])
  const [draft, setDraft] = useState<{ readonly path: string; readonly html: string }>()
  const [lastSaved, setLastSaved] = useState<{ readonly path: string; readonly html: string }>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [activeFormats, setActiveFormats] = useState<Readonly<Record<string, boolean>>>({})
  const selection = useRef<Range>()

  useEffect(() => {
    setConfirmRefresh(false)
    setNotice(undefined)
    setLastSaved(undefined)
  }, [path])

  const stored = useMemo(() => sanitizeWordHtml(remote.value?.html ?? ""), [remote.value?.html])
  const baseline = lastSaved?.path === path ? lastSaved.html : stored
  const html = draft?.path === path ? draft.html : baseline
  const editable = remote.value?.writable !== false
  const dirty = editable && html !== baseline

  const rememberSelection = useCallback(() => {
    const current = window.getSelection()
    if (current === null || current.rangeCount === 0 || editor.current === null) return
    const range = current.getRangeAt(0)
    if (editor.current.contains(range.commonAncestorContainer)) selection.current = range.cloneRange()
  }, [])

  const restoreSelection = useCallback(() => {
    const current = window.getSelection()
    const target = editor.current
    if (current === null || target === null) return
    target.focus()
    const range = selection.current
    if (range === undefined) {
      const end = document.createRange()
      end.selectNodeContents(target)
      end.collapse(false)
      current.removeAllRanges()
      current.addRange(end)
      selection.current = end.cloneRange()
      return
    }
    current.removeAllRanges()
    current.addRange(range)
  }, [])

  const refreshFormatState = useCallback(() => {
    if (editor.current === null || document.activeElement !== editor.current) return
    const commands = ["bold", "italic", "underline", "strikeThrough", "superscript", "subscript", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"]
    const next: Record<string, boolean> = {}
    for (const command of commands) {
      try { next[command] = document.queryCommandState(command) } catch { next[command] = false }
    }
    setActiveFormats(next)
  }, [])

  useEffect(() => {
    if (!editable) return
    const handleSelectionChange = (): void => {
      rememberSelection()
      refreshFormatState()
    }
    document.addEventListener("selectionchange", handleSelectionChange)
    return () => document.removeEventListener("selectionchange", handleSelectionChange)
  }, [editable, rememberSelection, refreshFormatState])

  const syncDraft = useCallback(() => {
    if (editor.current !== null) setDraft({ path, html: editor.current.innerHTML })
    refreshFormatState()
  }, [path, refreshFormatState])

  const runFormat = (command: string, value?: string): void => {
    if (!editable) return
    restoreSelection()
    document.execCommand(command, false, value)
    syncDraft()
  }

  const insertHtml = (value: string): void => {
    const target = editor.current
    if (target === null) return
    restoreSelection()
    const current = window.getSelection()
    if (current === null || current.rangeCount === 0) return
    const range = current.getRangeAt(0)
    const fragment = range.createContextualFragment(value)
    range.deleteContents()
    range.insertNode(fragment)
    range.collapse(false)
    current.removeAllRanges()
    current.addRange(range)
    selection.current = range.cloneRange()
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertHTML" }))
    syncDraft()
  }

  const insertPageBreak = (): void => {
    if (!editable) return
    restoreSelection()
    if (!document.execCommand("insertHTML", false, '<div class="page-break" style="page-break-after: always;"></div>')) {
      insertHtml('<div class="page-break" style="page-break-after: always;"></div>')
    } else syncDraft()
  }

  const insertTable = (): void => {
    if (!editable) return
    restoreSelection()
    if (!document.execCommand("insertHTML", false, '<table><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>')) {
      insertHtml('<table><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>')
    } else syncDraft()
  }

  const preserveButtonSelection = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    rememberSelection()
  }

  const refresh = useCallback((): void => {
    if (remote.loading) return
    setDraft(undefined)
    setLastSaved(undefined)
    setNotice(undefined)
    setConfirmRefresh(false)
    setRevision(value => value + 1)
  }, [remote.loading])

  const requestRefresh = useCallback((): void => {
    if (remote.loading) return
    if (dirty) {
      setConfirmRefresh(true)
      return
    }
    refresh()
  }, [dirty, refresh, remote.loading])

  const refreshToken = props.instance.refreshToken
  const lastRefreshToken = useRef(refreshToken)
  useEffect(() => {
    if (refreshToken === undefined || refreshToken === lastRefreshToken.current) return
    lastRefreshToken.current = refreshToken
    requestRefresh()
  }, [refreshToken, requestRefresh])

  const save = (): void => {
    if (sessionId === undefined || !dirty || saving) return
    const currentHtml = editor.current?.innerHTML ?? html
    setSaving(true)
    void workbenchRequest("word.write", { sessionId, path, html: currentHtml }).then(
      () => {
        // Keep the current DOM visible after the write. A second immediate
        // read can still be served by a stale conversion response and would
        // otherwise make a successful save look like a rollback.
        setLastSaved({ path, html: currentHtml })
        setDraft(undefined)
        setNotice(undefined)
      },
      error => setNotice(message(error)),
    ).finally(() => setSaving(false))
  }

  if (remote.loading || remote.error !== undefined) return <State loading={remote.loading} error={remote.error} />

  return <div className={css.panel}>
    {!editable && <div className={css.toolbar}><span className={css.flag}>{t("preview.readOnly")}</span></div>}
    {editable && <div className={css.wordToolbarShell}>
      <button type="button" className={`${css.wordTool} ${css.wordSave}`} disabled={!dirty || saving} title={t(saving ? "preview.saving" : "preview.save")} aria-label={t(saving ? "preview.saving" : "preview.save")} onClick={save}><Save size={16} strokeWidth={1.8} /></button>
      <span className={css.wordDivider} />
      <div className={css.wordToolbar} role="toolbar" aria-label={t("preview.wordTools")}>
      <span className={css.wordFormatSelectWrap}>
        <ChevronDown className={css.wordFormatChevron} size={16} strokeWidth={1.8} aria-hidden="true" />
        <select className={css.wordFormatSelect} title={t("preview.wordMoreFormatting")} aria-label={t("preview.wordMoreFormatting")} defaultValue="" onChange={event => {
        const [command, value] = event.currentTarget.value.split(":", 2)
        if (command !== undefined && value !== undefined) runFormat(command, value)
        event.currentTarget.value = ""
        }}>
        <option value="" disabled>{t("preview.wordMoreFormatting")}</option>
        <optgroup label={t("preview.wordStyle")}>
          <option value="formatBlock:p">{t("preview.wordBody")}</option>
          <option value="formatBlock:h1">{t("preview.wordHeading1")}</option>
          <option value="formatBlock:h2">{t("preview.wordHeading2")}</option>
          <option value="formatBlock:h3">{t("preview.wordHeading3")}</option>
          <option value="formatBlock:h4">H4</option>
          <option value="formatBlock:blockquote">{t("preview.wordQuote")}</option>
        </optgroup>
        <optgroup label={t("preview.wordFont")}>
          <option value="fontName:Arial">Arial</option>
          <option value="fontName:Calibri">Calibri</option>
          <option value="fontName:Georgia">Georgia</option>
          <option value="fontName:Menlo">Menlo</option>
          <option value="fontName:宋体">宋体</option>
          <option value="fontName:黑体">黑体</option>
        </optgroup>
        <optgroup label={t("preview.wordSize")}>
          <option value="fontSize:1">10px</option>
          <option value="fontSize:2">13px</option>
          <option value="fontSize:3">16px</option>
          <option value="fontSize:4">18px</option>
          <option value="fontSize:5">24px</option>
          <option value="fontSize:6">32px</option>
          <option value="fontSize:7">48px</option>
        </optgroup>
        </select>
      </span>
      <span className={css.wordDivider} />
      <button type="button" className={css.wordTool} title={t("preview.wordUndo")} aria-label={t("preview.wordUndo")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("undo")}><Undo2 size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} title={t("preview.wordRedo")} aria-label={t("preview.wordRedo")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("redo")}><Redo2 size={16} strokeWidth={1.8} /></button>
      <span className={css.wordDivider} />
      <button type="button" className={css.wordTool} data-active={activeFormats.bold || undefined} aria-pressed={activeFormats.bold} title={t("preview.wordBold")} aria-label={t("preview.wordBold")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("bold")}><Bold size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.italic || undefined} aria-pressed={activeFormats.italic} title={t("preview.wordItalic")} aria-label={t("preview.wordItalic")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("italic")}><Italic size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.underline || undefined} aria-pressed={activeFormats.underline} title={t("preview.wordUnderline")} aria-label={t("preview.wordUnderline")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("underline")}><Underline size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.strikeThrough || undefined} aria-pressed={activeFormats.strikeThrough} title={t("preview.wordStrike")} aria-label={t("preview.wordStrike")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("strikeThrough")}><Strikethrough size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.superscript || undefined} aria-pressed={activeFormats.superscript} title={t("preview.wordSuperscript")} aria-label={t("preview.wordSuperscript")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("superscript")}><Superscript size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.subscript || undefined} aria-pressed={activeFormats.subscript} title={t("preview.wordSubscript")} aria-label={t("preview.wordSubscript")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("subscript")}><Subscript size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} title={t("preview.wordTextColor")} aria-label={t("preview.wordTextColor")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("foreColor", "#c62828")}><Palette size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} title={t("preview.wordHighlight")} aria-label={t("preview.wordHighlight")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("hiliteColor", "#fff2a8")}><Highlighter size={16} strokeWidth={1.8} /></button>
      <span className={css.wordDivider} />
      <button type="button" className={css.wordTool} data-active={activeFormats.insertUnorderedList || undefined} aria-pressed={activeFormats.insertUnorderedList} title={t("preview.wordBullets")} aria-label={t("preview.wordBullets")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("insertUnorderedList")}><List size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.insertOrderedList || undefined} aria-pressed={activeFormats.insertOrderedList} title={t("preview.wordNumbering")} aria-label={t("preview.wordNumbering")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("insertOrderedList")}><ListOrdered size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} title={t("preview.wordIndent")} aria-label={t("preview.wordIndent")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("indent")}><ListIndentIncrease size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} title={t("preview.wordOutdent")} aria-label={t("preview.wordOutdent")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("outdent")}><ListIndentDecrease size={16} strokeWidth={1.8} /></button>
      <span className={css.wordDivider} />
      <button type="button" className={css.wordTool} data-active={activeFormats.justifyLeft || undefined} aria-pressed={activeFormats.justifyLeft} title={t("preview.wordAlignLeft")} aria-label={t("preview.wordAlignLeft")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("justifyLeft")}><AlignLeft size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.justifyCenter || undefined} aria-pressed={activeFormats.justifyCenter} title={t("preview.wordAlignCenter")} aria-label={t("preview.wordAlignCenter")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("justifyCenter")}><AlignCenter size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.justifyRight || undefined} aria-pressed={activeFormats.justifyRight} title={t("preview.wordAlignRight")} aria-label={t("preview.wordAlignRight")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("justifyRight")}><AlignRight size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} data-active={activeFormats.justifyFull || undefined} aria-pressed={activeFormats.justifyFull} title={t("preview.wordAlignJustify")} aria-label={t("preview.wordAlignJustify")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("justifyFull")}><AlignJustify size={16} strokeWidth={1.8} /></button>
      <span className={css.wordDivider} />
      <button type="button" className={css.wordTool} title={t("preview.wordTable")} aria-label={t("preview.wordTable")} onMouseDown={preserveButtonSelection} onClick={insertTable}><Table2 size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} title={t("preview.wordPageBreak")} aria-label={t("preview.wordPageBreak")} onMouseDown={preserveButtonSelection} onClick={insertPageBreak}><SeparatorHorizontal size={16} strokeWidth={1.8} /></button>
      <button type="button" className={css.wordTool} title={t("preview.wordClear")} aria-label={t("preview.wordClear")} onMouseDown={preserveButtonSelection} onClick={() => runFormat("removeFormat")}><RemoveFormatting size={16} strokeWidth={1.8} /></button>
      </div>
    </div>}
    {confirmRefresh && <div className={css.confirm}>
      <span className={css.confirmText}>{t("preview.confirmRefresh", { name: workspaceRelativePath(cwd, path) })}</span>
      <span className={css.confirmActions}>
        <button type="button" className={css.confirmButton} onClick={() => setConfirmRefresh(false)}>{t("common.cancel")}</button>
        <button type="button" className={css.confirmButton} data-danger onClick={refresh}>{t("common.confirm")}</button>
      </span>
    </div>}
    {notice !== undefined && !confirmRefresh && <div className={css.notice}>{notice}</div>}
    <div className={css.wordScroll}>
      <div
        key={`${path}:${String(revision)}`}
        ref={editor}
        className={css.wordPage}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck
        // Keep the contentEditable DOM uncontrolled while the user edits it.
        // Replacing innerHTML on every React render destroys the live selection
        // and can make a save observe state from the previous input event.
        dangerouslySetInnerHTML={{ __html: stored }}
        onFocus={refreshFormatState}
        onInput={syncDraft}
        onKeyUp={refreshFormatState}
        onKeyDown={event => {
          if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          save()
        }}
      />
    </div>
  </div>
}

function getDesktopApi(): DesktopApi | undefined {
  return (window as Window & { readonly desktopApi?: DesktopApi }).desktopApi
}
