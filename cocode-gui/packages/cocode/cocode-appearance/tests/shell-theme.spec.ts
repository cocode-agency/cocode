// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { applyShellTheme } from "../src/client/shell-theme.ts"

afterEach(() => {
	document.documentElement.className = ""
	document.documentElement.removeAttribute("data-theme")
	document.documentElement.style.removeProperty("color-scheme")
})

describe("Cocode shell theme projection", () => {
	it("keeps the light shell state readable", () => {
		applyShellTheme({ active: { colorScheme: "light" } })

		expect(document.documentElement.dataset.theme).toBe("light")
		expect(document.documentElement.classList.contains("dark")).toBe(false)
		expect(document.documentElement.style.colorScheme).toBe("light")
	})

	it("switches the native shell hooks for dark mode", () => {
		applyShellTheme({ active: { colorScheme: "dark" } })

		expect(document.documentElement.dataset.theme).toBe("dark")
		expect(document.documentElement.classList.contains("dark")).toBe(true)
		expect(document.documentElement.style.colorScheme).toBe("dark")
	})
})
