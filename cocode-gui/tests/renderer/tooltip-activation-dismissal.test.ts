import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "pathe"
import test from "node:test"

const source = readFileSync(
	resolve(process.cwd(), "packages/client/client/ui-primitives/src/Tooltip.tsx"),
	"utf8",
)

test("tooltip chains the anchor hover and focus handlers", () => {
	assert.match(
		source,
		/onMouseEnter:\s*\(e\) => \{ children\.props\.onMouseEnter\?\.\(e\); triggers\.current\.hover = true; showAfterHoverDelay\(\) \}/,
	)
	assert.match(
		source,
		/onFocus:\s*\(e\) => \{ children\.props\.onFocus\?\.\(e\); triggers\.current\.focus = true; cancelShow\(\); show\(\) \}/,
	)
	assert.match(source, /onMouseLeave:[\s\S]*?setPos\(null\)/)
	assert.match(source, /role="tooltip"/)
})
