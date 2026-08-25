/**
 * The root entry's layout store: panel geometry as a width in px plus an open
 * flag per panel, persisted so the shell reopens the way the user left it
 * (the key is versioned — a state-shape change must not rehydrate an old
 * snapshot). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampMin, clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
  WORKBENCH_BOTTOM_DEFAULT, WORKBENCH_BOTTOM_MAX, WORKBENCH_BOTTOM_MIN,
  WORKBENCH_DEFAULT, WORKBENCH_MIN,
} from './columns.ts'

/**
 * Layout store state: each panel is a pair — a width preference in px that
 * always holds a valid open width, and an open flag. Closing flips the flag
 * only, so the dragged width survives a collapse/expand round trip. Plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
type LayoutState = {
  sidebar: number
  sidebarOpen: boolean
  details: number
  detailsOpen: boolean
  workbenchRight: number
  workbenchRightOpen: boolean
  workbenchBottom: number
  workbenchBottomOpen: boolean
  narrow: boolean
  narrowExpanded: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  setWorkbenchRight: (draft: LayoutState, px: number) => void
  setWorkbenchBottom: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  openWorkbenchRight: (draft: LayoutState) => void
  closeWorkbenchRight: (draft: LayoutState) => void
  openWorkbenchBottom: (draft: LayoutState) => void
  closeWorkbenchBottom: (draft: LayoutState) => void
  toggleWorkbenchRight: (draft: LayoutState) => void
  toggleWorkbenchBottom: (draft: LayoutState) => void
}

/**
 * Create the layout panel store handle. Width and openness are separate: drag
 * writes clamp into the panel's contract range and open/close transitions only
 * flip the panel's flag, so every panel reopens at the width the user last
 * dragged it to (the contract default is merely the pre-drag seed). Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the open flag.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      sidebarOpen: true,
      details: DETAILS_DEFAULT,
      detailsOpen: false,
      workbenchRight: WORKBENCH_DEFAULT,
      workbenchRightOpen: false,
      workbenchBottom: WORKBENCH_BOTTOM_DEFAULT,
      workbenchBottomOpen: false,
      narrow: false,
      narrowExpanded: false,
    }),
    // The narrow pair rides along: AppFrame's first setNarrow reconciles a
    // rehydrated breakpoint that no longer matches the viewport.
    persist: 'dsh.layout.panels.v1',
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      setWorkbenchRight: (d, px: number) => { d.workbenchRight = clampMin(px, WORKBENCH_MIN) },
      setWorkbenchBottom: (d, px: number) => {
        d.workbenchBottom = clampWidth(px, WORKBENCH_BOTTOM_MIN, WORKBENCH_BOTTOM_MAX)
      },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebarOpen = !d.sidebarOpen
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { d.detailsOpen = true },
      closeDetails: (d) => { d.detailsOpen = false },
      openWorkbenchRight: (d) => { d.workbenchRightOpen = true },
      closeWorkbenchRight: (d) => { d.workbenchRightOpen = false },
      openWorkbenchBottom: (d) => { d.workbenchBottomOpen = true },
      closeWorkbenchBottom: (d) => { d.workbenchBottomOpen = false },
      toggleWorkbenchRight: (d) => { d.workbenchRightOpen = !d.workbenchRightOpen },
      toggleWorkbenchBottom: (d) => { d.workbenchBottomOpen = !d.workbenchBottomOpen },
    },
  })
  return handle
}
