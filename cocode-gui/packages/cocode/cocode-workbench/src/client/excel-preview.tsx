import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Check, ClipboardPaste, Columns3, Copy, Eraser, Filter,
  FunctionSquare, Grid3X3, Italic, Merge, Minus, Paintbrush, Percent, Plus, Redo2, Rows3, Save, Scissors,
  Search, Sigma, SortAsc, Underline, Undo2, WrapText, ZoomIn, ZoomOut,
} from "lucide-react"
import type { WorkbenchPanelProps } from "./model.ts"
import { State, message, useRemote } from "./panel-state.tsx"
import { workbenchRequest } from "./runtime-api.ts"
import { baseName } from "../paths.ts"
import { t } from "./locales.ts"
import css from "./excel-preview.module.css"

export interface ExcelRead {
  readonly kind: "excel"
  readonly html: string
  readonly warnings: readonly string[]
  readonly writable: boolean
}

interface ExcelSheet {
  readonly index: number
  readonly name: string
}

interface PreparedWorkbook {
  readonly html: string
  readonly sheets: readonly ExcelSheet[]
}

interface ExcelSelection {
  readonly address: string
  readonly sheet: number
  readonly value: string
}

type RibbonTab = "home" | "insert" | "layout" | "formulas" | "data" | "review" | "view"

const EXCEL_TAGS = new Set([
  "A", "B", "BR", "CAPTION", "COL", "COLGROUP", "DIV", "EM", "FONT", "H1", "HR", "I", "IMG", "P", "S", "SPAN",
  "STRIKE", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "U",
])
const EXCEL_STYLE_PROPERTIES = new Set([
  "background", "background-color", "border", "border-bottom", "border-color", "border-left", "border-right", "border-style",
  "border-top", "border-width", "color", "font-family", "font-size", "font-style", "font-weight", "height", "letter-spacing",
  "line-height", "max-width", "min-height", "min-width", "padding", "padding-bottom", "padding-left", "padding-right", "padding-top",
  "text-align", "text-decoration", "vertical-align", "white-space", "width",
])

/** Keep Calc's workbook HTML inert while retaining the presentation Excel exports. */
function sanitizeExcelHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  const root = parsed.body.firstElementChild
  if (root === null) return ""
  const clean = (node: Element): void => {
    for (const child of [...node.children]) clean(child)
    if (!EXCEL_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes)
      return
    }
    const attributes = new Map([...node.attributes].map(attribute => [attribute.name.toLowerCase(), attribute.value]))
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name)

    const copyIf = (name: string, pattern: RegExp): void => {
      const value = attributes.get(name)
      if (value !== undefined && pattern.test(value)) node.setAttribute(name, value)
    }
    copyIf("colspan", /^\d{1,3}$/)
    copyIf("rowspan", /^\d{1,4}$/)
    copyIf("span", /^\d{1,4}$/)
    copyIf("width", /^(?:\d{1,5}(?:\.\d+)?%?|auto)$/)
    copyIf("height", /^(?:\d{1,5}(?:\.\d+)?%?|auto)$/)
    copyIf("align", /^(?:left|center|right|justify|char)$/i)
    copyIf("valign", /^(?:top|middle|bottom|baseline)$/i)
    copyIf("bgcolor", /^(?:#[0-9a-f]{3,8}|[a-z]{1,32})$/i)
    copyIf("cellspacing", /^\d{1,3}$/)
    copyIf("cellpadding", /^\d{1,3}$/)
    copyIf("border", /^\d{1,3}$/)
    copyIf("face", /^[\w .,'-]{1,120}$/)
    copyIf("color", /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,32})$/i)
    copyIf("size", /^(?:[1-7]|[+-][1-7])$/)
    copyIf("sdval", /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)

    if (node.tagName === "IMG") {
      copyIf("src", /^data:image\/(?:png|jpe?g|gif|svg\+xml|webp);base64,[a-z0-9+/=\s]+$/i)
      copyIf("alt", /^[^\0]{0,500}$/)
      copyIf("title", /^[^\0]{0,500}$/)
    }
    const href = attributes.get("href")
    if (node.tagName === "A" && href !== undefined && /^(?:https?:|mailto:|#)/i.test(href)) {
      node.setAttribute("href", href)
      node.setAttribute("rel", "noreferrer")
    }
    const numberFormat = attributes.get("sdnum")
    if (numberFormat !== undefined && numberFormat.length <= 1024 && !numberFormat.includes("\0")) node.setAttribute("sdnum", numberFormat)
    const sheetValue = attributes.get("data-sheets-value")
    if (sheetValue !== undefined && sheetValue.length <= 8192 && !sheetValue.includes("\0")) node.setAttribute("data-sheets-value", sheetValue)
    const formula = attributes.get("data-sheets-formula")
    if (formula !== undefined && formula.length <= 8192 && !formula.includes("\0")) node.setAttribute("data-sheets-formula", formula)

    const style = attributes.get("style")
    if (style !== undefined) {
      const safe = style.split(";").map(declaration => declaration.trim()).filter(Boolean).filter(declaration => {
        const property = declaration.split(":", 1)[0]?.trim().toLowerCase()
        return property !== undefined && EXCEL_STYLE_PROPERTIES.has(property) && !/(?:url\s*\(|expression\s*\(|javascript:|@import)/i.test(declaration)
      }).join("; ")
      if (safe !== "") node.setAttribute("style", safe)
    }
  }
  for (const child of [...root.children]) clean(child)
  return root.innerHTML
}

function parseRoot(html: string): HTMLElement | undefined {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  return parsed.body.firstElementChild as HTMLElement | undefined
}

function normalizeSheetName(value: string, index: number): string {
  const clean = value.replace(/\s+/g, " ").trim().replace(/^Sheet\s+\d+\s*:\s*/i, "")
  return clean === "" ? `Sheet${index + 1}` : clean.slice(0, 31)
}

function sheetNamesFromSource(source: string, count: number): readonly string[] {
  const root = parseRoot(source)
  if (root === undefined) return Array.from({ length: count }, (_, index) => `Sheet${index + 1}`)
  const tables = [...root.querySelectorAll("table")]
  return Array.from({ length: count }, (_, index) => {
    const table = tables[index]
    let sibling = table?.previousElementSibling
    while (sibling !== undefined && sibling !== null) {
      if (sibling.tagName === "A" || sibling.tagName === "H1") {
        const emphasis = sibling.querySelector("em")?.textContent?.trim()
        const text = emphasis ?? sibling.textContent?.trim() ?? ""
        if (text !== "" && !/^overview$/i.test(text)) return normalizeSheetName(text, index)
      }
      sibling = sibling.previousElementSibling
    }
    return `Sheet${index + 1}`
  })
}

function columnLabel(index: number): string {
  let value = index + 1
  let label = ""
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function clearGridMetadata(table: HTMLTableElement): void {
  table.querySelectorAll("[data-cocode-excel-ui]").forEach(node => node.remove())
  table.removeAttribute("data-cocode-excel-sheet")
  table.removeAttribute("data-cocode-excel-sheet-active")
  table.querySelectorAll("[data-cocode-excel-cell]").forEach(cell => {
    for (const name of ["data-cocode-excel-cell", "data-excel-address", "data-excel-column", "data-excel-row", "data-excel-sheet", "data-cocode-selected"]) {
      cell.removeAttribute(name)
    }
  })
}

function decorateTable(table: HTMLTableElement, sheetIndex: number, active: boolean): void {
  clearGridMetadata(table)
  table.setAttribute("data-cocode-excel-sheet", String(sheetIndex))
  table.setAttribute("data-cocode-excel-sheet-active", String(active))
  const originalRows = [...table.rows]
  const columnCount = Math.max(1, ...originalRows.map(row => [...row.cells].reduce((count, cell) => count + Math.max(1, Number(cell.getAttribute("colspan") ?? "1") || 1), 0)))
  const document = table.ownerDocument
  const header = document.createElement("tr")
  header.setAttribute("data-cocode-excel-ui", "column-header-row")
  const corner = document.createElement("th")
  corner.setAttribute("data-cocode-excel-ui", "corner")
  corner.setAttribute("scope", "col")
  header.append(corner)
  for (let index = 0; index < columnCount; index += 1) {
    const cell = document.createElement("th")
    cell.setAttribute("data-cocode-excel-ui", "column-header")
    cell.setAttribute("data-excel-column", String(index))
    cell.setAttribute("scope", "col")
    cell.textContent = columnLabel(index)
    header.append(cell)
  }
  let head = [...table.children].find(child => child.tagName === "THEAD") as HTMLTableSectionElement | undefined
  if (head === undefined) {
    head = document.createElement("thead")
    table.insertBefore(head, table.firstChild)
  }
  head.insertBefore(header, head.firstChild)

  originalRows.forEach((row, rowIndex) => {
    const rowHeader = document.createElement("th")
    rowHeader.setAttribute("data-cocode-excel-ui", "row-header")
    rowHeader.setAttribute("data-excel-row", String(rowIndex))
    rowHeader.setAttribute("scope", "row")
    rowHeader.setAttribute("contenteditable", "false")
    rowHeader.textContent = String(rowIndex + 1)
    row.insertBefore(rowHeader, row.firstChild)
    let columnIndex = 0
    for (const cell of [...row.cells].slice(1)) {
      const span = Math.max(1, Number(cell.getAttribute("colspan") ?? "1") || 1)
      cell.setAttribute("data-cocode-excel-cell", "true")
      cell.setAttribute("data-excel-column", String(columnIndex))
      cell.setAttribute("data-excel-row", String(rowIndex))
      cell.setAttribute("data-excel-sheet", String(sheetIndex))
      cell.setAttribute("data-excel-address", `${columnLabel(columnIndex)}${rowIndex + 1}`)
      columnIndex += span
    }
  })
}

export function prepareWorkbook(source: string): PreparedWorkbook {
  const sanitized = sanitizeExcelHtml(source)
  const root = parseRoot(sanitized)
  if (root === undefined) return { html: "", sheets: [] }
  const tables = [...root.querySelectorAll("table")]
  const names = sheetNamesFromSource(source, tables.length)
  tables.forEach((table, index) => decorateTable(table, index, index === 0))
  return {
    html: root.innerHTML,
    sheets: tables.map((_, index) => ({ index, name: names[index] ?? `Sheet${index + 1}` })),
  }
}

/** Remove the visual grid chrome before sending edited HTML back to Calc. */
export function serializeExcelEditor(editor: HTMLElement): string {
  const clone = editor.cloneNode(true) as HTMLElement
  clone.querySelectorAll("[data-cocode-excel-ui]").forEach(node => node.remove())
  clone.querySelectorAll("[data-cocode-excel-sheet], [data-cocode-excel-sheet-active], [data-cocode-excel-cell], [data-excel-address], [data-excel-column], [data-excel-row], [data-excel-sheet], [data-cocode-selected]").forEach(node => {
    for (const attribute of ["data-cocode-excel-sheet", "data-cocode-excel-sheet-active", "data-cocode-excel-cell", "data-excel-address", "data-excel-column", "data-excel-row", "data-excel-sheet", "data-cocode-selected"]) {
      node.removeAttribute(attribute)
    }
  })
  return clone.innerHTML
}

function RibbonGroup(props: { readonly label: string; readonly children: ReactNode }) {
  return <div className={css.ribbonGroup}>
    <div className={css.ribbonGroupBody}>{props.children}</div>
    <span className={css.ribbonGroupLabel}>{props.label}</span>
  </div>
}

function RibbonButton(props: {
  readonly label: string
  readonly icon?: ReactNode
  readonly onClick?: () => void
  readonly onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void
  readonly active?: boolean
  readonly disabled?: boolean
  readonly compact?: boolean
}) {
  return <button
    type="button"
    className={`${css.ribbonButton} ${props.compact ? css.ribbonButtonCompact : ""}`}
    data-active={props.active || undefined}
    aria-pressed={props.active}
    title={props.label}
    aria-label={props.label}
    disabled={props.disabled}
    onMouseDown={props.onMouseDown}
    onClick={props.onClick}
  >
    {props.icon !== undefined && <span className={css.ribbonIcon}>{props.icon}</span>}
    <span className={css.ribbonButtonLabel}>{props.label}</span>
  </button>
}

function RibbonSelect(props: {
  readonly label: string
  readonly value: string
  readonly options: readonly string[]
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}) {
  return <label className={css.ribbonSelectWrap} title={props.label}>
    <select aria-label={props.label} value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.value)}>
      {props.options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>
}

export function ExcelPreview(props: WorkbenchPanelProps & { readonly path: string }) {
  const sessionId = props.scope.sessionId
  const cwd = props.scope.cwd
  const path = props.path
  const editor = useRef<HTMLDivElement>(null)
  const selectedElement = useRef<HTMLTableCellElement>()
  const [revision, setRevision] = useState(0)
  const remote = useRemote<ExcelRead | undefined>(async signal => {
    if (sessionId === undefined) return undefined
    return workbenchRequest<ExcelRead>("excel.read", { sessionId, path, cwd }, signal)
  }, [sessionId, path, revision, cwd])
  const prepared = useMemo(() => prepareWorkbook(remote.value?.html ?? ""), [remote.value?.html])
  const cleanStored = useMemo(() => {
    const root = parseRoot(prepared.html)
    return root === undefined ? "" : serializeExcelEditor(root)
  }, [prepared.html])
  const [draft, setDraft] = useState<{ readonly path: string; readonly html: string }>()
  const [lastSaved, setLastSaved] = useState<{ readonly path: string; readonly html: string }>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [activeSheet, setActiveSheet] = useState(0)
  const [selection, setSelection] = useState<ExcelSelection>()
  const [nameBox, setNameBox] = useState("A1")
  const [formula, setFormula] = useState("")
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>("home")
  const [gridlines, setGridlines] = useState(true)
  const [zoom, setZoom] = useState(100)
  const editable = remote.value?.writable !== false
  const baseline = lastSaved?.path === path ? lastSaved.html : cleanStored
  const draftHtml = draft?.path === path ? draft.html : undefined
  const dirty = editable && draftHtml !== undefined && draftHtml !== baseline

  const readCellValue = (cell: HTMLTableCellElement): string => cell.getAttribute("data-sheets-formula") ?? (cell.innerText || cell.textContent || "").replace(/\u00a0/g, " ")

  const syncDraft = useCallback((): void => {
    if (editor.current !== null) setDraft({ path, html: serializeExcelEditor(editor.current) })
    const cell = selectedElement.current
    if (cell !== undefined) {
      const value = readCellValue(cell)
      setSelection(previous => previous === undefined ? previous : { ...previous, value })
      setFormula(value)
    }
  }, [path])

  const updateAxes = useCallback((cell: HTMLTableCellElement): void => {
    const root = editor.current
    if (root === null) return
    root.querySelectorAll("[data-cocode-excel-ui][data-cocode-selected-axis]").forEach(node => node.removeAttribute("data-cocode-selected-axis"))
    const row = cell.closest("tr")
    row?.querySelector("[data-cocode-excel-ui='row-header']")?.setAttribute("data-cocode-selected-axis", "true")
    const column = cell.dataset.excelColumn
    if (column !== undefined) root.querySelector(`[data-cocode-excel-ui='column-header'][data-excel-column='${column}']`)?.setAttribute("data-cocode-selected-axis", "true")
  }, [])

  const selectCell = useCallback((cell: HTMLTableCellElement): void => {
    selectedElement.current?.removeAttribute("data-cocode-selected")
    selectedElement.current = cell
    cell.setAttribute("data-cocode-selected", "true")
    const sheet = Number(cell.dataset.excelSheet ?? "0")
    const address = cell.dataset.excelAddress ?? "A1"
    const value = readCellValue(cell)
    setSelection({ address, sheet, value })
    setNameBox(address)
    setFormula(value)
    updateAxes(cell)
  }, [updateAxes])

  useEffect(() => {
    setConfirmRefresh(false)
    setNotice(undefined)
    setDraft(undefined)
    setLastSaved(undefined)
    setActiveSheet(0)
    setSelection(undefined)
    setNameBox("A1")
    setFormula("")
    selectedElement.current = undefined
  }, [path])

  useEffect(() => {
    if (activeSheet >= prepared.sheets.length) setActiveSheet(0)
    const root = editor.current
    if (root === null) return
    const tables = [...root.querySelectorAll<HTMLTableElement>("table[data-cocode-excel-sheet]")]
    tables.forEach((table, index) => table.setAttribute("data-cocode-excel-sheet-active", String(index === activeSheet)))
    const current = selectedElement.current
    if (current !== null && current !== undefined && Number(current.dataset.excelSheet ?? "-1") === activeSheet && root.contains(current)) {
      updateAxes(current)
      return
    }
    const first = tables[activeSheet]?.querySelector<HTMLTableCellElement>("[data-cocode-excel-cell]")
    if (first !== null && first !== undefined) selectCell(first)
  }, [activeSheet, prepared.html, prepared.sheets.length, selectCell, updateAxes])

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

  const preserveSelection = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
  }

  const mutateCell = useCallback((mutator: (cell: HTMLTableCellElement) => void): void => {
    const cell = selectedElement.current
    if (!editable || cell === undefined) return
    mutator(cell)
    selectCell(cell)
    syncDraft()
  }, [editable, selectCell, syncDraft])

  const setCellValue = useCallback((cell: HTMLTableCellElement, value: string): void => {
    const normalized = value.replace(/\r\n?/g, "\n")
    if (normalized.trimStart().startsWith("=")) {
      cell.setAttribute("data-sheets-formula", normalized.trim())
      cell.textContent = normalized
    } else {
      cell.removeAttribute("data-sheets-formula")
      cell.removeAttribute("data-sheets-value")
      cell.removeAttribute("sdval")
      cell.removeAttribute("sdnum")
      cell.textContent = normalized
    }
  }, [])

  const commitFormula = useCallback((): void => {
    const cell = selectedElement.current
    if (cell === undefined || !editable) return
    setCellValue(cell, formula)
    selectCell(cell)
    syncDraft()
  }, [editable, formula, selectCell, setCellValue, syncDraft])

  const handleInput = (event: React.FormEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLTableCellElement>("[data-cocode-excel-cell]") : null
    if (target !== null) {
      target.removeAttribute("data-sheets-formula")
      target.removeAttribute("data-sheets-value")
      target.removeAttribute("sdval")
      target.removeAttribute("sdnum")
      selectCell(target)
    }
    syncDraft()
  }

  const navigateToName = useCallback((value: string): void => {
    const normalized = value.trim().toUpperCase()
    if (!/^[A-Z]{1,3}\d+$/.test(normalized) || editor.current === null) return
    const root = editor.current
    const cells = [...root.querySelectorAll<HTMLTableCellElement>("[data-cocode-excel-cell]")]
    const target = cells.find(cell => cell.dataset.excelAddress?.toUpperCase() === normalized)
    if (target === undefined) return
    const sheet = Number(target.dataset.excelSheet ?? "0")
    if (sheet !== activeSheet) setActiveSheet(sheet)
    window.requestAnimationFrame(() => selectCell(target))
  }, [activeSheet, selectCell])

  const insertRow = useCallback((): void => {
    const cell = selectedElement.current
    const row = cell?.closest<HTMLTableRowElement>("tr")
    if (!editable || cell === undefined || row === null || row === undefined) return
    const table = cell.closest<HTMLTableElement>("table[data-cocode-excel-sheet]")
    if (table === null) return
    const clone = row.cloneNode(true) as HTMLTableRowElement
    for (const child of [...clone.cells]) {
      if (child.hasAttribute("data-cocode-excel-ui")) continue
      child.innerHTML = "<br>"
      child.removeAttribute("data-sheets-formula")
      child.removeAttribute("data-sheets-value")
      child.removeAttribute("sdval")
      child.removeAttribute("sdnum")
    }
    row.parentElement?.insertBefore(clone, row.nextSibling)
    const sheet = Number(table.dataset.cocodeExcelSheet ?? "0")
    decorateTable(table, sheet, true)
    syncDraft()
    const target = table.querySelector<HTMLTableCellElement>(`[data-cocode-excel-cell][data-excel-address='${cell.dataset.excelAddress?.replace(/\d+$/, value => String(Number(value) + 1)) ?? "A1"}']`)
    if (target !== null) selectCell(target)
  }, [editable, selectCell, syncDraft])

  const insertColumn = useCallback((): void => {
    const cell = selectedElement.current
    if (!editable || cell === undefined) return
    const table = cell.closest<HTMLTableElement>("table[data-cocode-excel-sheet]")
    if (table === null) return
    const column = Number(cell.dataset.excelColumn ?? "0")
    for (const row of [...table.rows]) {
      if (row.querySelector("[data-cocode-excel-ui='column-header']") !== null) continue
      const target = [...row.cells].find(candidate => candidate.hasAttribute("data-cocode-excel-cell") && Number(candidate.dataset.excelColumn ?? "-1") === column)
      const newCell = table.ownerDocument.createElement("td")
      newCell.innerHTML = "<br>"
      if (target !== undefined) row.insertBefore(newCell, target.nextSibling)
      else row.append(newCell)
    }
    const sheet = Number(table.dataset.cocodeExcelSheet ?? "0")
    decorateTable(table, sheet, true)
    syncDraft()
    const nextAddress = `${columnLabel(column + 1)}${Number(cell.dataset.excelRow ?? "0") + 1}`
    const target = table.querySelector<HTMLTableCellElement>(`[data-cocode-excel-cell][data-excel-address='${nextAddress}']`)
    if (target !== null) selectCell(target)
  }, [editable, selectCell, syncDraft])

  const copyCell = useCallback(async (cut: boolean): Promise<void> => {
    const cell = selectedElement.current
    if (cell === undefined) return
    const value = readCellValue(cell)
    try {
      if (navigator.clipboard !== undefined) await navigator.clipboard.writeText(value)
      if (cut) mutateCell(target => { target.textContent = ""; target.removeAttribute("data-sheets-formula") })
    } catch (error) {
      setNotice(message(error))
    }
  }, [mutateCell])

  const pasteCell = useCallback(async (): Promise<void> => {
    const cell = selectedElement.current
    if (cell === undefined || !editable || navigator.clipboard === undefined) return
    try {
      setCellValue(cell, await navigator.clipboard.readText())
      selectCell(cell)
      syncDraft()
    } catch (error) {
      setNotice(message(error))
    }
  }, [editable, selectCell, setCellValue, syncDraft])

  const applyStyle = useCallback((property: string, value: string): void => {
    mutateCell(cell => cell.style.setProperty(property, value))
  }, [mutateCell])

  const toggleStyle = useCallback((property: string, on: string, off: string): void => {
    mutateCell(cell => {
      const current = cell.style.getPropertyValue(property)
      cell.style.setProperty(property, current === on ? off : on)
    })
  }, [mutateCell])

  const setNumberFormat = useCallback((format: "general" | "currency" | "percent"): void => {
    mutateCell(cell => {
      if (format === "general") {
        cell.removeAttribute("sdnum")
        cell.style.removeProperty("text-align")
      } else if (format === "percent") {
        cell.setAttribute("sdnum", "2052;0.00%")
        cell.style.setProperty("text-align", "right")
      } else {
        cell.setAttribute("sdnum", "2052;[$$-409]#,##0.00")
        cell.style.setProperty("text-align", "right")
      }
    })
  }, [mutateCell])

  const save = (): void => {
    if (sessionId === undefined || !dirty || saving || editor.current === null) return
    const currentHtml = serializeExcelEditor(editor.current)
    setSaving(true)
    void workbenchRequest("excel.write", { sessionId, path, html: currentHtml }).then(
      () => {
        setLastSaved({ path, html: currentHtml })
        setDraft(undefined)
        setNotice(undefined)
      },
      error => setNotice(message(error)),
    ).finally(() => setSaving(false))
  }

  const renderRibbon = (): ReactNode => {
    if (ribbonTab === "insert") return <>
      <RibbonGroup label={t("preview.excelTables")}>
        <RibbonButton label={t("preview.excelInsertRow")} icon={<Rows3 size={18} />} onMouseDown={preserveSelection} onClick={insertRow} disabled={!editable} />
        <RibbonButton label={t("preview.excelInsertColumn")} icon={<Columns3 size={18} />} onMouseDown={preserveSelection} onClick={insertColumn} disabled={!editable} />
      </RibbonGroup>
      <RibbonGroup label={t("preview.excelIllustrations")}>
        <RibbonButton label={t("preview.excelGridlines")} icon={<Grid3X3 size={18} />} onClick={() => setGridlines(value => !value)} active={gridlines} />
      </RibbonGroup>
    </>
    if (ribbonTab === "layout") return <>
      <RibbonGroup label={t("preview.excelSheetOptions")}>
        <RibbonButton label={t("preview.excelGridlines")} icon={<Grid3X3 size={18} />} onClick={() => setGridlines(value => !value)} active={gridlines} />
        <RibbonButton label={t("preview.excelZoomOut")} icon={<ZoomOut size={18} />} onClick={() => setZoom(value => Math.max(70, value - 10))} />
        <RibbonButton label={t("preview.excelZoomIn")} icon={<ZoomIn size={18} />} onClick={() => setZoom(value => Math.min(160, value + 10))} />
      </RibbonGroup>
    </>
    if (ribbonTab === "formulas") return <>
      <RibbonGroup label={t("preview.excelFunctionLibrary")}>
        <RibbonButton label={t("preview.excelAutoSum")} icon={<Sigma size={18} />} onMouseDown={preserveSelection} onClick={() => {
          const cell = selectedElement.current
          if (cell === undefined || !editable) return
          setCellValue(cell, "=SUM()")
          selectCell(cell)
          syncDraft()
        }} disabled={!editable} />
        <RibbonButton label={t("preview.excelInsertFunction")} icon={<FunctionSquare size={18} />} onMouseDown={preserveSelection} onClick={() => setFormula("=")} disabled={!editable} />
      </RibbonGroup>
    </>
    if (ribbonTab === "data") return <>
      <RibbonGroup label={t("preview.excelSortFilter")}>
        <RibbonButton label={t("preview.excelSortAscending")} icon={<SortAsc size={18} />} onClick={() => setNotice(t("preview.excelSortHint"))} />
        <RibbonButton label={t("preview.excelFilter")} icon={<Filter size={18} />} onClick={() => setNotice(t("preview.excelFilterHint"))} />
      </RibbonGroup>
    </>
    if (ribbonTab === "review") return <RibbonGroup label={t("preview.excelProtection")}>
      <RibbonButton label={editable ? t("preview.excelEditable") : t("preview.readOnly")} icon={editable ? <Check size={18} /> : undefined} disabled />
    </RibbonGroup>
    if (ribbonTab === "view") return <>
      <RibbonGroup label={t("preview.excelWorkbookViews")}>
        <RibbonButton label={t("preview.excelGridlines")} icon={<Grid3X3 size={18} />} onClick={() => setGridlines(value => !value)} active={gridlines} />
      </RibbonGroup>
      <RibbonGroup label={t("preview.excelZoom")}>
        <RibbonButton label={t("preview.excelZoomOut")} icon={<ZoomOut size={18} />} onClick={() => setZoom(value => Math.max(70, value - 10))} />
        <span className={css.zoomReadout}>{zoom}%</span>
        <RibbonButton label={t("preview.excelZoomIn")} icon={<ZoomIn size={18} />} onClick={() => setZoom(value => Math.min(160, value + 10))} />
      </RibbonGroup>
    </>
    return <>
      <RibbonGroup label={t("preview.excelClipboard")}>
        <RibbonButton label={t("preview.excelPaste")} icon={<ClipboardPaste size={18} />} onMouseDown={preserveSelection} onClick={() => void pasteCell()} disabled={!editable} />
        <RibbonButton label={t("preview.excelCut")} icon={<Scissors size={18} />} onMouseDown={preserveSelection} onClick={() => void copyCell(true)} disabled={!editable} />
        <RibbonButton label={t("preview.excelCopy")} icon={<Copy size={18} />} onMouseDown={preserveSelection} onClick={() => void copyCell(false)} />
      </RibbonGroup>
      <RibbonGroup label={t("preview.excelFont")}>
        <RibbonSelect label={t("preview.excelFontFamily")} value={selection?.value === "" ? "Calibri" : "Calibri"} options={["Calibri", "Arial", "Aptos", "Consolas"]} onChange={value => applyStyle("font-family", value)} disabled={!editable} />
        <RibbonSelect label={t("preview.excelFontSize")} value="11" options={["9", "10", "11", "12", "14", "16", "18", "24"]} onChange={value => applyStyle("font-size", `${value}px`)} disabled={!editable} />
        <div className={css.ribbonButtonRow}>
          <RibbonButton label={t("preview.wordBold")} icon={<Bold size={18} />} onMouseDown={preserveSelection} onClick={() => toggleStyle("font-weight", "700", "400")} disabled={!editable} />
          <RibbonButton label={t("preview.wordItalic")} icon={<Italic size={18} />} onMouseDown={preserveSelection} onClick={() => toggleStyle("font-style", "italic", "normal")} disabled={!editable} />
          <RibbonButton label={t("preview.wordUnderline")} icon={<Underline size={18} />} onMouseDown={preserveSelection} onClick={() => toggleStyle("text-decoration", "underline", "none")} disabled={!editable} />
        </div>
        <div className={css.colorControlRow}>
          <label className={css.colorControl} title={t("preview.excelFillColor")}><Paintbrush size={14} /><input type="color" defaultValue="#fff2a8" aria-label={t("preview.excelFillColor")} disabled={!editable} onChange={event => applyStyle("background-color", event.currentTarget.value)} /></label>
          <label className={css.colorControl} title={t("preview.excelFontColor")}><span className={css.fontColorMark}>A</span><input type="color" defaultValue="#000000" aria-label={t("preview.excelFontColor")} disabled={!editable} onChange={event => applyStyle("color", event.currentTarget.value)} /></label>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t("preview.excelAlignment")}>
        <div className={css.ribbonButtonRow}>
          <RibbonButton label={t("preview.wordAlignLeft")} icon={<AlignLeft size={18} />} onMouseDown={preserveSelection} onClick={() => applyStyle("text-align", "left")} disabled={!editable} />
          <RibbonButton label={t("preview.wordAlignCenter")} icon={<AlignCenter size={18} />} onMouseDown={preserveSelection} onClick={() => applyStyle("text-align", "center")} disabled={!editable} />
          <RibbonButton label={t("preview.wordAlignRight")} icon={<AlignRight size={18} />} onMouseDown={preserveSelection} onClick={() => applyStyle("text-align", "right")} disabled={!editable} />
        </div>
        <div className={css.ribbonButtonRow}>
          <RibbonButton label={t("preview.excelWrapText")} icon={<WrapText size={18} />} onMouseDown={preserveSelection} onClick={() => toggleStyle("white-space", "pre-wrap", "nowrap")} disabled={!editable} />
          <RibbonButton label={t("preview.excelMergeCells")} icon={<Merge size={18} />} onClick={() => setNotice(t("preview.excelMergeHint"))} disabled={!editable} />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t("preview.excelNumber")}>
        <RibbonButton label={t("preview.excelGeneral")} icon={<Grid3X3 size={18} />} onClick={() => setNumberFormat("general")} disabled={!editable} compact />
        <div className={css.ribbonButtonRow}>
          <RibbonButton label={t("preview.excelCurrency")} icon={<span className={css.currencyIcon}>$</span>} onClick={() => setNumberFormat("currency")} disabled={!editable} />
          <RibbonButton label={t("preview.excelPercent")} icon={<Percent size={18} />} onClick={() => setNumberFormat("percent")} disabled={!editable} />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t("preview.excelCells")}>
        <RibbonButton label={t("preview.excelInsertRow")} icon={<Rows3 size={18} />} onMouseDown={preserveSelection} onClick={insertRow} disabled={!editable} />
        <RibbonButton label={t("preview.excelInsertColumn")} icon={<Columns3 size={18} />} onMouseDown={preserveSelection} onClick={insertColumn} disabled={!editable} />
      </RibbonGroup>
      <RibbonGroup label={t("preview.excelEditing")}>
        <RibbonButton label={t("preview.excelClearFormatting")} icon={<Eraser size={18} />} onMouseDown={preserveSelection} onClick={() => mutateCell(cell => { cell.removeAttribute("style") })} disabled={!editable} />
      </RibbonGroup>
    </>
  }

  if (remote.loading || remote.error !== undefined) return <State loading={remote.loading} error={remote.error} />

  return <div className={css.excelApp} data-gridlines={gridlines ? "true" : "false"} data-editable={editable ? "true" : "false"}>
    <div className={css.excelTitlebar}>
      <div className={css.excelTitleMain}>
        <span className={css.excelLogo}>X</span>
        <span className={css.excelFileName}>{baseName(path)}</span>
        {!editable && <span className={css.excelReadonlyBadge}>{t("preview.readOnly")}</span>}
      </div>
      <div className={css.excelTitleActions}>
        <span className={css.excelAutosave}>{t("preview.excelAutosave")}</span>
        <RibbonButton label={t("preview.save")} icon={<Save size={16} />} onMouseDown={preserveSelection} onClick={save} disabled={!dirty || saving} compact />
        <RibbonButton label={t("preview.wordUndo")} icon={<Undo2 size={16} />} onMouseDown={preserveSelection} onClick={() => document.execCommand("undo")} compact />
        <RibbonButton label={t("preview.wordRedo")} icon={<Redo2 size={16} />} onMouseDown={preserveSelection} onClick={() => document.execCommand("redo")} compact />
        <div className={css.excelSearch}><Search size={14} /><span>{t("preview.excelSearchCommands")}</span></div>
      </div>
    </div>
    <div className={css.excelRibbonTabs} role="tablist" aria-label={t("preview.excelRibbon")}>
      <button type="button" className={css.excelFileTab} title={t("preview.excelFileTab")}>{t("preview.excelFileTab")}</button>
      {(["home", "insert", "layout", "formulas", "data", "review", "view"] as const).map(tab => <button
        type="button"
        key={tab}
        className={css.excelRibbonTab}
        data-active={ribbonTab === tab || undefined}
        role="tab"
        aria-selected={ribbonTab === tab}
        onClick={() => setRibbonTab(tab)}
      >{t(`preview.excelTab.${tab}` as "preview.excelTab.home")}</button>)}
    </div>
    <div className={css.excelRibbon} role="toolbar" aria-label={t("preview.excelRibbon")}>{renderRibbon()}</div>
    <div className={css.excelFormulaBar}>
      <input className={css.excelNameBox} aria-label={t("preview.excelNameBox")} value={nameBox} onChange={event => setNameBox(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") navigateToName(event.currentTarget.value) }} />
      <span className={css.excelFormulaGlyph}>fx</span>
      <button type="button" className={css.excelFormulaConfirm} title={t("preview.excelAcceptFormula")} aria-label={t("preview.excelAcceptFormula")} onMouseDown={preserveSelection} onClick={commitFormula}><Check size={15} /></button>
      <input className={css.excelFormulaInput} aria-label={t("preview.excelFormulaBar")} value={formula} onChange={event => setFormula(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") commitFormula() }} onBlur={commitFormula} disabled={!editable} />
    </div>
    {confirmRefresh && <div className={css.excelMessage} data-kind="warning">
      <span>{t("preview.confirmRefresh", { name: baseName(path) })}</span>
      <span className={css.excelMessageActions}><button type="button" onClick={() => setConfirmRefresh(false)}>{t("common.cancel")}</button><button type="button" data-danger onClick={refresh}>{t("common.confirm")}</button></span>
    </div>}
    {notice !== undefined && !confirmRefresh && <div className={css.excelMessage} data-kind="error">{notice}</div>}
    <div className={css.excelViewport}>
      <div className={css.excelCanvas}>
        <div
          key={`${path}:${String(revision)}`}
          ref={editor}
          className={css.excelEditor}
          contentEditable={editable}
          suppressContentEditableWarning
          spellCheck={false}
          data-gridlines={gridlines ? "true" : "false"}
          style={{ zoom: `${zoom}%` }}
          dangerouslySetInnerHTML={{ __html: prepared.html }}
          onClick={event => {
            const cell = event.target instanceof Element ? event.target.closest<HTMLTableCellElement>("[data-cocode-excel-cell]") : null
            if (cell !== null) selectCell(cell)
          }}
          onInput={handleInput}
          onKeyDown={event => {
            if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              save()
            }
          }}
        />
      </div>
    </div>
    <div className={css.excelSheetBar}>
      <div className={css.excelSheetNavigation}>
        <button type="button" title={t("preview.excelFirstSheet")} aria-label={t("preview.excelFirstSheet")}><span>‹</span></button>
        <button type="button" title={t("preview.excelPreviousSheet")} aria-label={t("preview.excelPreviousSheet")}><span>‹</span></button>
        <button type="button" title={t("preview.excelNextSheet")} aria-label={t("preview.excelNextSheet")}><span>›</span></button>
        <button type="button" title={t("preview.excelLastSheet")} aria-label={t("preview.excelLastSheet")}><span>›</span></button>
      </div>
      <div className={css.excelSheetTabs} role="tablist" aria-label={t("preview.excelSheets")}>
        {prepared.sheets.map(sheet => <button type="button" key={sheet.index} className={css.excelSheetTab} data-active={activeSheet === sheet.index || undefined} role="tab" aria-selected={activeSheet === sheet.index} onClick={() => setActiveSheet(sheet.index)}>{sheet.name}</button>)}
      </div>
      <button type="button" className={css.excelNewSheet} title={t("preview.excelNewSheet")} aria-label={t("preview.excelNewSheet")}><Plus size={16} /></button>
    </div>
    <div className={css.excelStatusBar}>
      <span>{dirty ? t("preview.excelModified") : t("preview.excelReady")}</span>
      <span className={css.excelStatusSummary}>{selection === undefined ? t("preview.excelSelectCell") : `${selection.address} · ${selection.value.length} ${t("preview.excelCharacters")}`}</span>
      <span className={css.excelStatusSpacer} />
      <span className={css.excelZoomLabel}>{zoom}%</span>
      <input className={css.excelZoomSlider} type="range" min="70" max="160" step="10" value={zoom} aria-label={t("preview.excelZoom")} onChange={event => setZoom(Number(event.currentTarget.value))} />
      <button type="button" className={css.excelZoomButton} title={t("preview.excelZoomOut")} aria-label={t("preview.excelZoomOut")} onClick={() => setZoom(value => Math.max(70, value - 10))}><Minus size={14} /></button>
      <button type="button" className={css.excelZoomButton} title={t("preview.excelZoomIn")} aria-label={t("preview.excelZoomIn")} onClick={() => setZoom(value => Math.min(160, value + 10))}><Plus size={14} /></button>
    </div>
  </div>
}
