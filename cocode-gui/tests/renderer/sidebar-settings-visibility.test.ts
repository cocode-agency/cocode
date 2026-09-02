import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "pathe"
import test from "node:test"

const settingsRoot = readFileSync(
	resolve(process.cwd(), "packages/cocode/cocode-desktop/src/client/SettingsRoot.tsx"),
	"utf8",
)

test("Settings is no longer rendered as an independent footer trigger", () => {
	assert.match(settingsRoot, /cocode:open-settings/)
	assert.doesNotMatch(settingsRoot, /data-dsh-settings-trigger/)
	assert.doesNotMatch(settingsRoot, /css\.trigger/)
})
