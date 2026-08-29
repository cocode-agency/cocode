import assert from "node:assert/strict"
import test from "node:test"
import {
	DEFAULT_MESSAGE_FONT_SIZE,
	isMessageFontSize,
	MESSAGE_FONT_SIZES,
} from "../../packages/cocode/cocode-appearance/src/client/font-size.ts"

test("message-list font size defaults to 14 and accepts every displayed option", () => {
	assert.equal(DEFAULT_MESSAGE_FONT_SIZE, "14")
	assert.deepEqual(MESSAGE_FONT_SIZES, ["14", "16", "18", "20"])
	assert.equal(isMessageFontSize("14"), true)
	assert.equal(isMessageFontSize("12"), false)
})
