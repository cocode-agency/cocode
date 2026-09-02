// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
	applyMessageFontSize,
	clearMessageFontSize,
	DSH_CONTENT_FONT_SIZE_VARIABLE,
	MESSAGE_FONT_SIZE_ATTRIBUTE,
	MESSAGE_FONT_SIZE_VARIABLE,
} from "../src/client/font-size.ts"

afterEach(() => {
	document.body.style.removeProperty(MESSAGE_FONT_SIZE_VARIABLE)
	document.body.removeAttribute(MESSAGE_FONT_SIZE_ATTRIBUTE)
	document.body.style.removeProperty(DSH_CONTENT_FONT_SIZE_VARIABLE)
})

describe("Cocode message font-size projection", () => {
	it("writes the DSH content axis consumed by the conversation and composer", () => {
		applyMessageFontSize("20")

		expect(document.body.style.getPropertyValue(MESSAGE_FONT_SIZE_VARIABLE)).toBe("20px")
		expect(document.body.hasAttribute(MESSAGE_FONT_SIZE_ATTRIBUTE)).toBe(true)
		expect(document.body.style.getPropertyValue(DSH_CONTENT_FONT_SIZE_VARIABLE)).toBe("")
	})

	it("clears the shared axis when the appearance plugin is disposed", () => {
		applyMessageFontSize("16")
		clearMessageFontSize()

		expect(document.body.style.getPropertyValue(MESSAGE_FONT_SIZE_VARIABLE)).toBe("")
		expect(document.body.hasAttribute(MESSAGE_FONT_SIZE_ATTRIBUTE)).toBe(false)
	})
})
