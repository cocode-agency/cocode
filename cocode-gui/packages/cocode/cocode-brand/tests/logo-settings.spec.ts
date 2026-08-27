import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	DEFAULT_LOGO_PREFERENCE,
	getLogoPreference,
	isLogoPreference,
	LOGO_STORAGE_KEY,
	readStoredLogoPreference,
	setLogoPreference,
	syncLogoDataset,
} from "../src/client/logo-settings.ts"

const memory = new Map<string, string>()

beforeEach(() => {
	memory.clear()
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => { memory.set(key, value) },
			clear: () => { memory.clear() },
		},
	})
	document.documentElement.removeAttribute("data-cocode-logo")
	setLogoPreference(DEFAULT_LOGO_PREFERENCE)
})

afterEach(() => {
	setLogoPreference(DEFAULT_LOGO_PREFERENCE)
	document.documentElement.removeAttribute("data-cocode-logo")
})

describe("logo preference", () => {
	it("accepts only the two product choices", () => {
		expect(isLogoPreference("cocode")).toBe(true)
		expect(isLogoPreference("deepseek")).toBe(true)
		expect(isLogoPreference("whale")).toBe(false)
	})

	it("defaults to Cocode and persists the live choice", () => {
		expect(readStoredLogoPreference()).toBe("cocode")
		setLogoPreference("deepseek")
		expect(getLogoPreference()).toBe("deepseek")
		expect(localStorage.getItem(LOGO_STORAGE_KEY)).toBe("deepseek")
		expect(document.documentElement.dataset.cocodeLogo).toBe("deepseek")
	})

	it("syncs the html dataset from the current preference", () => {
		syncLogoDataset()
		expect(document.documentElement.dataset.cocodeLogo).toBe("cocode")
	})
})
