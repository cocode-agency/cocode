import { describe, expect, it } from "vitest"
import { findSidebarColumn } from "../src/client/titlebar.ts"

describe("desktop titlebar layout seam", () => {
	it("finds the sidebar by its stable marker instead of child order", () => {
		const frame = document.createElement("div")
		const sidebar = document.createElement("div")
		sidebar.dataset.dshSidebarColumn = ""
		const center = document.createElement("div")
		const overlay = document.createElement("div")
		overlay.dataset.shellOverlay = ""
		frame.append(center, overlay, sidebar)

		expect(findSidebarColumn(overlay)).toBe(sidebar)
	})

	it("returns null before the layout frame is mounted", () => {
		expect(findSidebarColumn(document.createElement("div"))).toBeNull()
	})
})
