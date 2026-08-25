import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode, type RefObject } from "react"
import { Menu, Tooltip, type MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives"
import type { WorkbenchController } from "./controller.ts"
import type { WorkbenchDock, WorkbenchPanelDescriptor, WorkbenchPanelInstance, WorkbenchPanelProps, WorkbenchSplitNode } from "./model.ts"
import { bindWorkbenchCwd } from "./runtime-api.ts"
import { fileMentionText } from "./file-mention.ts"
import { localeRevision, subscribeLocale, t } from "./locales.ts"
import css from "./workbench.module.css"
import { CloseIcon, FileGlyph, fileTypeIcon, PanelBottomIcon, PanelRightIcon, PlusIcon } from "./icons.tsx"
import { baseName, relativeTo } from "../paths.ts"

interface SessionListSlice {
  readonly byId: Readonly<Record<string, { readonly cwd?: string } | undefined>>
}

interface DockSurfaceProps {
  readonly controller: WorkbenchController
  readonly dock: WorkbenchDock
  readonly visible: boolean
  readonly sessionId?: string
  readonly sessions?: WorkbenchPanelProps["sessions"]
  readonly addFileToChat?: (sessionId: string, path: string) => boolean
  readonly useSessions?: (select: (state: SessionListSlice) => string | undefined) => string | undefined
}

// 单个 tab 低于这个宽度就进入紧凑模式：标签所剩空间已经不足以读全，
// 此时收起非活动 tab 的关闭按钮并用竖线分隔，避免 tab 糊成一片。
const DENSE_TAB_WIDTH = 132

/** 按 tab 栏可用宽度和 tab 数量判断是否需要紧凑排布。 */
function useDenseTabs(count: number): readonly [RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [dense, setDense] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = (): void => { setDense(count > 1 && element.clientWidth / count < DENSE_TAB_WIDTH) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [count])
  return [ref, dense]
}

function panelTitle(descriptor: WorkbenchPanelDescriptor): string {
  return typeof descriptor.title === "function" ? descriptor.title() : descriptor.title
}

/** Preview tabs identify the open file; other tabs identify their panel. */
function tabTitle(descriptor: WorkbenchPanelDescriptor | undefined, instance: WorkbenchPanelInstance): string {
  if (descriptor?.id === "preview" && instance.target?.path !== undefined) return baseName(instance.target.path)
  return descriptor === undefined ? instance.title : panelTitle(descriptor)
}

function isFilePreview(instance: WorkbenchPanelInstance | undefined): boolean {
  if (instance?.type !== "preview" || instance.target?.path === undefined) return false
  const data = instance.target.data
  return data === undefined || data === null || typeof data !== "object" || (data as { readonly kind?: unknown }).kind !== "diff"
}

function panelIcon(descriptor: WorkbenchPanelDescriptor | undefined): ReactNode {
  if (descriptor === undefined) return <FileGlyph size={15} />
  return typeof descriptor.icon === "function" ? descriptor.icon() : descriptor.icon ?? <FileGlyph size={15} />
}

/** File preview tabs use the file's format icon; every other tab uses its panel icon. */
function tabIcon(descriptor: WorkbenchPanelDescriptor | undefined, instance: WorkbenchPanelInstance): ReactNode {
  if (descriptor?.id === "preview") {
    const path = instance.target?.path
    if (path !== undefined) return fileTypeIcon(path)
  }
  return panelIcon(descriptor)
}

function addablePanels(catalog: readonly WorkbenchPanelDescriptor[]): readonly WorkbenchPanelDescriptor[] {
  return catalog.filter(candidate => candidate.addable !== false)
}

function panelMenuItems(snapshot: ReturnType<WorkbenchController["snapshot"]>) {
  return addablePanels(snapshot.catalog).map(candidate => ({
    id: candidate.id,
    label: <span className={css.menuItem}><span className={css.chooserIcon}>{panelIcon(candidate)}</span><span>{panelTitle(candidate)}</span></span>,
  }))
}

/**
 * 空 pane 是邀请，不是缺失：这里按设计系统的 conversation-welcome 语言排布
 * （标题 + 一句说明 + 芯片网格），而不是面板内部那种虚线空态卡片——后者表示
 * “本该有内容却没有”，会和“请挑一个面板”混为一谈。
 */
function EmptyDock(props: {
  catalog: readonly WorkbenchPanelDescriptor[]
  onOpen: (id: string) => void
}) {
  return <div className={css.emptyDock}>
    <div className={css.emptyBlock}>
      <div className={css.emptyCopy}>
        <p className={css.emptyTitle}>{t("dock.emptyTitle")}</p>
        <p className={css.emptyHint}>{t("dock.emptyHint")}</p>
      </div>
      <div className={css.emptyCards}>
        {props.catalog.map(candidate => <button key={candidate.id} type="button" className={css.emptyCard} onClick={() => props.onOpen(candidate.id)}>
          <span className={css.emptyCardIcon}>{panelIcon(candidate)}</span>
          <span className={css.emptyCardLabel}>{panelTitle(candidate)}</span>
        </button>)}
      </div>
    </div>
  </div>
}

function Tab(props: {
  instance: WorkbenchPanelInstance
  title: string
  icon?: ReactNode
  dragText?: string
  active: boolean
  activate: () => void
  close: () => void
  drop: (draggedId: string, beforeId?: string) => void
  contextMenu: (x: number, y: number) => void
}) {
  return <div
    className={css.tab}
    data-active={props.active || undefined}
    role="presentation"
    draggable
    onDragStart={event => {
      event.dataTransfer.effectAllowed = props.dragText === undefined ? "move" : "copyMove"
      event.dataTransfer.setData("application/x-cocode-workbench-tab", props.instance.id)
      if (props.dragText !== undefined) {
        event.dataTransfer.setData("application/x-cocode-file-mention", props.dragText)
        event.dataTransfer.setData("text/plain", props.dragText)
      }
      document.body.dataset.cocodeWorkbenchDragging = ""
    }}
    onDragEnd={() => { delete document.body.dataset.cocodeWorkbenchDragging }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation() }}
    onDrop={event => {
      event.preventDefault()
      event.stopPropagation()
      const id = event.dataTransfer.getData("application/x-cocode-workbench-tab")
      if (id) props.drop(id, props.instance.id)
      delete document.body.dataset.cocodeWorkbenchDragging
    }}
    onAuxClick={event => {
      if (event.button === 1) {
        event.preventDefault()
        props.close()
      }
    }}
    onContextMenu={event => {
      event.preventDefault()
      props.contextMenu(event.clientX, event.clientY)
    }}
  >
    <button type="button" className={css.tabMain} role="tab" aria-selected={props.active} onClick={props.activate}>
      {props.icon === undefined ? null : <span className={css.tabIcon}>{props.icon}</span>}
      <span className={css.tabLabel}>{props.title}</span>
    </button>
    <button type="button" className={css.tabClose} aria-label="Close panel" title="Close panel" onClick={props.close}><CloseIcon size={14} /></button>
  </div>
}

function PaneDropSurface(props: {
  paneId: string
  onDrop: (paneId: string, edge: "left" | "right" | "up" | "down" | "center", draggedId: string) => void
}) {
  const drop = (edge: "left" | "right" | "up" | "down" | "center") => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const draggedId = event.dataTransfer.getData("application/x-cocode-workbench-tab")
    if (draggedId) props.onDrop(props.paneId, edge, draggedId)
  }
  return <div className={css.dropZones} aria-hidden="true">
    <div className={`${css.dropZone} ${css.dropLeft}`} onDragOver={event => event.preventDefault()} onDrop={drop("left")} />
    <div className={`${css.dropZone} ${css.dropRight}`} onDragOver={event => event.preventDefault()} onDrop={drop("right")} />
    <div className={`${css.dropZone} ${css.dropUp}`} onDragOver={event => event.preventDefault()} onDrop={drop("up")} />
    <div className={`${css.dropZone} ${css.dropDown}`} onDragOver={event => event.preventDefault()} onDrop={drop("down")} />
    <div className={`${css.dropZone} ${css.dropCenter}`} onDragOver={event => event.preventDefault()} onDrop={drop("center")} />
  </div>
}

function Pane(props: {
  node: WorkbenchSplitNode
  dock: WorkbenchDock
  instances: readonly WorkbenchPanelInstance[]
  activeId: string | undefined
  snapshot: ReturnType<WorkbenchController["snapshot"]>
  controller: WorkbenchController
  visible: boolean
  sessionId?: string
  cwd?: string
  sessions?: WorkbenchPanelProps["sessions"]
  addFileToChat?: WorkbenchPanelProps["addFileToChat"]
  toggleDock?: (dock: WorkbenchDock) => void
  root: boolean
}) {
  // 加号菜单属于单个 pane：同一个 dock 分屏后，各 pane 的菜单必须各开各的。
  const [chooserOpen, setChooserOpen] = useState(false)
  // Tab context menu, one per pane. The point lives in state (not a ref) so the
  // anchor callback keeps a stable identity per menu placement: Menu re-reads it
  // only when it changes, and a per-render identity would loop against its own
  // positioning state.
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number }>()
  const closeTabMenu = useCallback(() => { setTabMenu(undefined) }, [])
  const tabMenuAnchor = useCallback(() => tabMenu === undefined ? null : new DOMRect(tabMenu.x, tabMenu.y, 0, 0), [tabMenu])
  const paneInstances = props.instances.filter(instance => (instance.paneId ?? instance.id) === props.node.id)
  const [tabsRef, dense] = useDenseTabs(paneInstances.length)
  if (props.node.kind === "split") {
    const node = props.node
    const directionClass = node.direction === "horizontal" ? css.splitHorizontal : css.splitVertical
    return <div className={`${css.split} ${directionClass}`} style={{ gridTemplateColumns: node.direction === "horizontal" ? node.sizes.map(size => `${size}fr`).join(" ") : undefined, gridTemplateRows: node.direction === "vertical" ? node.sizes.map(size => `${size}fr`).join(" ") : undefined }}>
      {node.children.map((child, index) => <div className={css.splitChild} key={child.id}>
        <Pane {...props} node={child} root={false} />
        {index < node.children.length - 1 && <SplitDivider node={node} index={index} controller={props.controller} />}
      </div>)}
    </div>
  }
  const activeId = paneInstances.find(instance => instance.id === props.activeId)?.id ?? paneInstances[0]?.id
  /** 新面板落在发起请求的这个 pane，而不是 dock 当前的活动 pane。 */
  const openHere = (type: string): void => { props.controller.open(type, { dock: props.dock, paneId: props.node.id }) }
  const drop = (paneId: string, edge: "left" | "right" | "up" | "down" | "center", draggedId: string): void => {
    if (edge === "center") {
      props.controller.moveToPane(draggedId, paneId, activeId)
      return
    }
    const direction = edge === "left" || edge === "right" ? "horizontal" : "vertical"
    const after = edge === "right" || edge === "down"
    const newPane = props.controller.splitPane(paneId, direction, after)
    if (newPane !== undefined) props.controller.moveToPane(draggedId, newPane)
  }
  const menuIndex = paneInstances.findIndex(instance => instance.id === tabMenu?.id)
  const menuInstance = paneInstances.find(instance => instance.id === tabMenu?.id)
  const canRefresh = isFilePreview(menuInstance)
  const tabMenuItems: readonly MenuEntry[] = [
    ...(canRefresh ? [{ id: "refresh", label: t("preview.refresh") } satisfies MenuEntry] : []),
    { id: "close", label: t("tabMenu.close") },
    { id: "closeOthers", label: t("tabMenu.closeOthers"), disabled: paneInstances.length <= 1 },
    { id: "closeRight", label: t("tabMenu.closeRight"), disabled: menuIndex < 0 || menuIndex >= paneInstances.length - 1 },
    { id: "closeAll", label: t("tabMenu.closeAll") },
    { type: "separator", id: "sep-split" },
    { id: "splitRight", label: t("tabMenu.splitRight"), disabled: paneInstances.length <= 1 },
    { id: "splitDown", label: t("tabMenu.splitDown"), disabled: paneInstances.length <= 1 },
    { type: "separator", id: "sep-move" },
    { id: "move", label: t(props.dock === "right" ? "tabMenu.moveBottom" : "tabMenu.moveRight") },
  ]
  const runTabMenu = (action: string): void => {
    const id = tabMenu?.id
    const paneId = props.node.id
    closeTabMenu()
    if (id === undefined) return
    const ids = paneInstances.map(instance => instance.id)
    const split = (direction: "horizontal" | "vertical"): void => {
      const newPane = props.controller.splitPane(paneId, direction, true)
      if (newPane !== undefined) props.controller.moveToPane(id, newPane)
    }
    const actions: Record<string, () => void> = {
      refresh: () => props.controller.refresh(id),
      close: () => props.controller.close(id),
      closeOthers: () => props.controller.closeMany(ids.filter(candidate => candidate !== id)),
      closeRight: () => props.controller.closeMany(ids.slice(menuIndex + 1)),
      closeAll: () => props.controller.closeMany(ids),
      splitRight: () => split("horizontal"),
      splitDown: () => split("vertical"),
      move: () => props.controller.move(id, props.dock === "right" ? "bottom" : "right"),
    }
    actions[action]?.()
  }
  return <div className={css.pane} data-pane-id={props.node.id} onMouseDown={() => props.controller.focusPane(props.node.id)}>
    <div className={css.paneTabbar}>
      <div ref={tabsRef} className={css.tabs} data-dense={dense || undefined} role="tablist" aria-label={`${props.dock} pane`} onWheel={event => {
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
        const element = event.currentTarget
        if (element.scrollWidth <= element.clientWidth) return
        event.preventDefault()
        element.scrollLeft += event.deltaX + event.deltaY
      }}>
        {paneInstances.map(instance => {
          const descriptor = props.snapshot.catalog.find(item => item.id === instance.type)
          const title = tabTitle(descriptor, instance)
          const dragText = descriptor?.id === "preview" && instance.target?.path !== undefined && props.cwd !== undefined
            ? fileMentionText(relativeTo(props.cwd, instance.target.path))
            : undefined
          return <Tab key={instance.id} instance={instance} title={title} icon={tabIcon(descriptor, instance)} dragText={dragText} active={instance.id === activeId} activate={() => props.controller.activate(instance.id)} close={() => props.controller.close(instance.id)} drop={(draggedId, beforeId) => props.controller.moveToPane(draggedId, props.node.id, beforeId)} contextMenu={(x, y) => {
            props.controller.activate(instance.id)
            setTabMenu({ id: instance.id, x, y })
          }} />
        })}
      </div>
      <div className={css.actions}>
        <Menu
          open={chooserOpen}
          onClose={() => setChooserOpen(false)}
          items={panelMenuItems(props.snapshot)}
          onSelect={type => { openHere(type); setChooserOpen(false) }}
          align="end"
          portal
          anchor={<button type="button" className={css.iconButton} aria-label="Add panel" title="New panel" aria-haspopup="menu" aria-expanded={chooserOpen} onClick={() => setChooserOpen(!chooserOpen)}><PlusIcon size={16} /></button>}
        />
        {props.root && props.dock === "right" && <>
          <Tooltip label="Toggle bottom panel" side="bottom" delayMs={500}><button type="button" className={css.iconButton} aria-label="Toggle bottom panel" onClick={() => props.toggleDock?.("bottom")}><PanelBottomIcon size={16} /></button></Tooltip>
          <Tooltip label="Toggle right panel" side="bottom" delayMs={500}><button type="button" className={css.iconButton} aria-label="Toggle right panel" onClick={() => props.toggleDock?.("right")}><PanelRightIcon size={16} /></button></Tooltip>
        </>}
      </div>
      <Menu open={tabMenu !== undefined} onClose={closeTabMenu} items={tabMenuItems} onSelect={runTabMenu} getAnchorRect={tabMenuAnchor} portal compact anchor={null} />
    </div>
    <div className={css.paneBody} role="tabpanel">
      {paneInstances.length === 0
        ? <EmptyDock catalog={addablePanels(props.snapshot.catalog)} onOpen={openHere} />
        : paneInstances.map(instance => {
          const descriptor = props.snapshot.catalog.find(item => item.id === instance.type)
          const isActive = instance.id === activeId
          return <div key={instance.id} className={css.panelView} data-active={isActive || undefined}>
            {descriptor === undefined
              ? <div className={css.empty}><span>This panel is unavailable.</span><button type="button" onClick={() => props.controller.close(instance.id)}>Close</button></div>
              : descriptor.render({ instance, scope: { sessionId: props.sessionId, cwd: props.cwd }, visible: props.visible && isActive, sessions: props.sessions, addFileToChat: props.addFileToChat, open: (type, options) => props.controller.open(type, options), close: instanceId => props.controller.close(instanceId) })}
          </div>
        })}
    </div>
    <PaneDropSurface paneId={props.node.id} onDrop={drop} />
  </div>
}

function SplitDivider(props: { node: Extract<WorkbenchSplitNode, { kind: "split" }>; index: number; controller: WorkbenchController }) {
  const start = useRef<number | undefined>()
  const orientation = props.node.direction === "horizontal" ? "vertical" : "horizontal"
  return <div className={`${css.divider} ${orientation === "vertical" ? css.dividerVertical : css.dividerHorizontal}`} role="separator" aria-orientation={orientation} onPointerDown={event => {
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = props.node.direction === "horizontal" ? event.clientX : event.clientY
  }} onPointerMove={event => {
    if (start.current === undefined) return
    const current = props.node.direction === "horizontal" ? event.clientX : event.clientY
    const delta = (current - start.current) / 320
    start.current = current
    props.controller.resizeSplit(props.node.id, props.index, delta)
  }} onPointerUp={() => { start.current = undefined }} />
}

export function DockSurface({ controller, dock, visible, sessionId, sessions, useSessions, addFileToChat }: DockSurfaceProps) {
  useSyncExternalStore(subscribeLocale, localeRevision, localeRevision)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const cwd = useSessions?.(state => sessionId === undefined ? undefined : state.byId[sessionId]?.cwd)
  // Bound during render so the first child fetch (useEffect) already carries
  // the listed workspace — waiting for an effect would miss that first request.
  bindWorkbenchCwd(cwd)
  const instances = snapshot.session.instances.filter(instance => instance.dock === dock)
  const activeId = snapshot.session.active[dock] ?? instances[0]?.id
  useEffect(() => { controller.setSession(sessionId) }, [controller, sessionId])
  useEffect(() => { controller.setDockOpen(dock, visible) }, [controller, dock, visible])
  useEffect(() => {
    if (dock !== "right") return
    if (visible) document.body.dataset.cocodeWorkbenchRight = ""
    else delete document.body.dataset.cocodeWorkbenchRight
    return () => { delete document.body.dataset.cocodeWorkbenchRight }
  }, [dock, visible])
  return <section className={css.dock} data-cocode-workbench={dock} data-visible={visible || undefined}>
    <div className={css.body} role="tabpanel">
      <Pane
        node={snapshot.session.layouts?.[dock] ?? { kind: "pane", id: `root:${dock}:${snapshot.sessionId ?? "$welcome"}` }}
        dock={dock}
        instances={instances}
        activeId={snapshot.session.active[dock] ?? activeId}
        snapshot={snapshot}
        controller={controller}
        visible={visible}
        sessionId={sessionId}
        cwd={cwd}
        sessions={sessions}
        addFileToChat={sessionId === undefined || addFileToChat === undefined
          ? undefined
          : path => addFileToChat(sessionId, path)}
        toggleDock={target => controller.toggleDock(target)}
        root
      />
    </div>
  </section>
}
