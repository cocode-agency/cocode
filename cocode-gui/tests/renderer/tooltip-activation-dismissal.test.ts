import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "pathe"
import test from "node:test"

const source = readFileSync(
	resolve(process.cwd(), "packages/client/ui-primitives/src/Tooltip.tsx"),
	"utf8",
)

test("tooltip dismisses after its anchor is activated", () => {
	assert.match(source, /onClick\?: MouseEventHandler/)
	assert.match(
		source,
		/onClick:\s*\(e: MouseEvent<HTMLElement>\) => \{[\s\S]*?children\.props\.onClick\?\.\(e\)[\s\S]*?dismissAfterActivation\(\)/,
	)
	assert.match(
		source,
		/const dismissAfterActivation = \(\) => \{\s*cancelShow\(\)\s*triggers\.current\.hover = false\s*setPos\(null\)\s*\}/,
	)
})
