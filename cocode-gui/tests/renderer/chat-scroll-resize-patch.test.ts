import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const patch = readFileSync("patches/@deepseek-ai__dsh-client-ui-chat@0.1.2-alpha.5.patch", "utf8")

test("reconciles the jump-to-latest state after chat content reflows", () => {
	assert.match(patch, /if \(el\.scrollHeight - el\.scrollTop - el\.clientHeight <= 25\)/)
	assert.match(patch, /atBottomRef\.current = true/)
	assert.match(patch, /setAtBottom\(true\)/)
	assert.match(patch, /chatScroll\.save\(null\)/)
})
