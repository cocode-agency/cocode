/** Resolve the stable layout seam used by the desktop titlebar mount. */
export function findSidebarColumn(overlay: Element): Element | null {
	return overlay.parentElement?.querySelector("[data-dsh-sidebar-column]") ?? null
}
