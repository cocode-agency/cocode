import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "pathe"
import test from "node:test"

const css = readFileSync(
	resolve(process.cwd(), "packages/client/client/ui-sidebar/src/client/SidebarRoot.module.css"),
	"utf8",
)
const settingsRoot = readFileSync(
	resolve(
		process.cwd(),
		"packages/client/client/ui-settings-general/src/client/SettingsRoot.tsx",
	),
	"utf8",
)

test("Settings is no longer rendered as an independent footer trigger", () => {
	assert.match(css, /\.settingsArea/)
	assert.doesNotMatch(settingsRoot, /data-dsh-settings-trigger/)
})
