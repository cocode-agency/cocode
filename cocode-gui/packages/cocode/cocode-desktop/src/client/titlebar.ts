/** Resolve the stable layout seam used by the desktop titlebar mount. */
export function findSidebarColumn(overlay: Element): Element | null {
	const frame = overlay.parentElement
	if (frame === null) return null

	// The DSH renderer marks slot owners with `data-slot`. The layout package
	// does not expose a public class for its columns, so resolve the owner
	// wrapper and then step out to the actual sidebar grid column. Keep the old
	// marker as a compatibility path for builds that still expose it.
	const marked = frame.querySelector("[data-dsh-sidebar-column]")
	if (marked !== null) return marked
	const sidebarSlot = frame.querySelector('[data-slot="sidebar"]')
	return sidebarSlot?.parentElement ?? null
}
