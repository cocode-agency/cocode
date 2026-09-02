// @vitest-environment node
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const css = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "../src/client/SidebarRoot.module.css"),
	"utf8",
)

describe("desktop sidebar layout", () => {
	it("fills the sidebar column so footer actions stay at the window bottom", () => {
		expect(css).toMatch(/\.root\s*\{[^}]*height:\s*100%;/s)
		expect(css).toMatch(/\.regionArea\s*\{[^}]*flex:\s*1;/s)
		expect(css).toMatch(/\.footArea\s*\{[^}]*flex:\s*none;/s)
	})

	it("joins the collapsed rail divider below the full-width header hairline", () => {
		expect(css).toMatch(/\[data-sidebar-collapsed\][^{]*\{[^}]*border-right:\s*none;/s)
		expect(css).toMatch(
			/\[data-sidebar-collapsed\][^{]*::before\s*\{[^}]*top:\s*calc\(var\(--dsh-shell-header-height, 46px\) - 1px\);[^}]*height:\s*1px;/s,
		)
		expect(css).toMatch(
			/\[data-sidebar-collapsed\][^{]*::after\s*\{[^}]*top:\s*var\(--dsh-shell-header-height, 46px\);[^}]*bottom:\s*0;[^}]*width:\s*1px;/s,
		)
	})
})
