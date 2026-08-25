/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  clampWidth, computeColumns, SIDEBAR_AUTO_COLLAPSE,
  WORKBENCH_BOTTOM_MAX, WORKBENCH_BOTTOM_MIN,
} from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

type RuntimeRecoveryState = 'idle' | 'recovering' | 'ready' | 'failed'
type RuntimeRecoveryDetail = {
  state: RuntimeRecoveryState
  attempt: number
  maxAttempts: number
  error?: { code: string; message: string }
}

type LayoutLocale = { subscribe(listener: () => void): () => void; getSnapshot(): { active: string }; bind(namespace: string): (key: string, params?: Record<string, unknown>) => string }

const EMPTY_LOCALE = { active: 'zh' }
const EMPTY_SUBSCRIBE = (): (() => void) => () => {}
const EMPTY_GET_SNAPSHOT = (): { active: string } => EMPTY_LOCALE

function RuntimeRecoveryBanner({ locale, centerStart, centerWidth }: {
  locale?: LayoutLocale
  centerStart: number
  centerWidth: number
}) {
  const [detail, setDetail] = useState<RuntimeRecoveryDetail | null>(null)
  // LocaleRuntime exposes methods that read its private state through `this`.
  // Passing those methods directly to React loses the receiver and crashes the
  // whole root slot during startup. Bind once per locale instance instead.
  const localeStore = useMemo(() => {
    if (locale === undefined) {
      return {
        subscribe: EMPTY_SUBSCRIBE,
        getSnapshot: EMPTY_GET_SNAPSHOT,
      }
    }
    return {
      subscribe: locale.subscribe.bind(locale),
      getSnapshot: locale.getSnapshot.bind(locale),
    }
  }, [locale])
  const localeSnapshot = useSyncExternalStore(
    localeStore.subscribe,
    localeStore.getSnapshot,
    localeStore.getSnapshot,
  )

  useEffect(() => {
    const root = document.documentElement
    const onState = (event: Event): void => {
      const next = (event as CustomEvent<RuntimeRecoveryDetail>).detail
      setDetail(next)
    }
    window.addEventListener('cocode:dsh-runtime-recovery-state', onState)
    const initial = root.dataset.dshRuntimeState as RuntimeRecoveryState | undefined
    if (initial !== undefined && initial !== 'idle' && initial !== 'ready') {
      setDetail({ state: initial, attempt: 0, maxAttempts: 3 })
    }
    return () => window.removeEventListener('cocode:dsh-runtime-recovery-state', onState)
  }, [])

  if (detail === null || detail.state === 'idle' || detail.state === 'ready') return null
  const failed = detail.state === 'failed'
  const retry = (): void => {
    const desktop = (window as Window & {
      desktopApi?: { dsh?: { requestRecovery(request: { reason: 'host_unreachable'; endpointGeneration: number }): Promise<unknown> } }
    }).desktopApi?.dsh
    if (desktop === undefined) return
    void desktop.requestRecovery({
      reason: 'host_unreachable',
      endpointGeneration: (window as Window & { __DSH_DESKTOP_ENDPOINT_GENERATION__?: number }).__DSH_DESKTOP_ENDPOINT_GENERATION__ ?? 0,
    })
  }
  const diagnostics = (): void => {
    const api = (window as Window & {
      desktopApi?: { diagnostics?: { openLogFolder(): Promise<unknown> } }
    }).desktopApi?.diagnostics
    if (api !== undefined) void api.openLogFolder()
  }
  const english = localeSnapshot.active === 'en'
  return (
    <div
      className={css.recoveryBanner}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      style={{
        left: centerStart + centerWidth / 2,
        maxWidth: Math.max(0, centerWidth - 32),
      }}
    >
      <span>
        {failed
          ? english
            ? `Local runtime recovery failed (${String(detail.attempt)}/${String(detail.maxAttempts)})`
            : `本地运行时恢复失败（${String(detail.attempt)}/${String(detail.maxAttempts)}）`
          : english ? 'Recovering the local runtime; new actions are temporarily disabled…' : '正在恢复本地运行时，暂时禁止发送新操作…'}
        {failed && detail.error?.message !== undefined ? `：${detail.error.message}` : ''}
      </span>
      {failed && <button type="button" onClick={retry}>{english ? 'Retry recovery' : '重试恢复'}</button>}
      {failed && <button type="button" onClick={diagnostics}>{english ? 'Open diagnostics' : '打开诊断'}</button>}
    </div>
  )
}

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'workbench.right' | 'workbench.bottom' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & { locale?: LayoutLocale }

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

function WorkbenchSlot(props: { dock: 'right' | 'bottom'; children?: ReactNode }) {
  return <div className={props.dock === 'right' ? css.workbenchRight : css.workbenchBottom}>{props.children}</div>
}

/**
 * One drag handle for both workbench axes: pointer capture, rAF-throttled
 * deltas against the drag-start origin. The strip is invisible chrome; hovering
 * it lights the seam it straddles (AppFrame.module.css).
 */
function DragHandle(props: {
  axis: 'x' | 'y'
  position: number
  spanStart?: number
  spanEnd?: number
  onStart: () => void
  onDrag: (delta: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }
  const axis = props.axis

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const point = axis === 'x' ? e.clientX : e.clientY
    origin.current = point
    latest.current = point
    callbacks.current.onStart()
    setDragging(true)
  }, [axis])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = axis === 'x' ? e.clientX : e.clientY
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [axis])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={axis === 'x' ? css.handle : css.rowHandle}
      style={axis === 'x'
        ? { left: props.position }
        : { bottom: props.position - 4, left: props.spanStart, right: props.spanEnd }}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  locale,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the stored width
  // preference and the center absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : !panels.sidebarOpen
  // The store keeps width and openness apart, so the solver's 0 = closed
  // sentinel is produced here per frame and the stored width stays intact.
  const cols = computeColumns(
    viewport,
    sidebarCollapsed ? 0 : panels.sidebar,
    detailsSession === undefined || !panels.detailsOpen ? 0 : panels.details,
    panels.workbenchRightOpen ? panels.workbenchRight : 0,
  )
  const bottom = panels.workbenchBottomOpen
    ? clampWidth(panels.workbenchBottom, WORKBENCH_BOTTOM_MIN, WORKBENCH_BOTTOM_MAX)
    : 0
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const workbenchBase = useRef(0)
  const bottomBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onWorkbenchStart = useCallback(() => { workbenchBase.current = colsRef.current.workbench; setDragging(true) }, [])
  const onBottomStart = useCallback(() => { bottomBase.current = bottom; setDragging(true) }, [bottom])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const onWorkbenchDrag = useCallback((dx: number) => {
    actions.setWorkbenchRight(workbenchBase.current - dx)
  }, [actions])
  const onBottomDrag = useCallback((dy: number) => {
    actions.setWorkbenchBottom(bottomBase.current - dy)
  }, [actions])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px ${cols.workbench}px`,
        gridTemplateRows: `minmax(0, 1fr) ${bottom}px`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-workbench-right-collapsed={cols.workbench === 0 || undefined}
      data-workbench-bottom-collapsed={bottom === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      <RuntimeRecoveryBanner locale={locale} centerStart={cols.sidebar} centerWidth={cols.center} />
      <div className={css.sidebarCol}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). */}
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <WorkbenchSlot dock="right">{renderSlot('workbench.right', { dock: 'right', visible: cols.workbench > 0 })}</WorkbenchSlot>
        <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
        <WorkbenchSlot dock="bottom">{renderSlot('workbench.bottom', { dock: 'bottom', visible: bottom > 0 })}</WorkbenchSlot>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!sidebarCollapsed && <DragHandle axis="x" position={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {cols.details > 0 && <DragHandle axis="x" position={cols.sidebar + cols.center} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
      {cols.workbench > 0 && <DragHandle axis="x" position={cols.sidebar + cols.center + cols.details} onStart={onWorkbenchStart} onDrag={onWorkbenchDrag} onEnd={onDragEnd} />}
      {bottom > 0 && <DragHandle axis="y" position={bottom} spanStart={cols.sidebar} spanEnd={cols.workbench} onStart={onBottomStart} onDrag={onBottomDrag} onEnd={onDragEnd} />}
    </div>
  )
}
