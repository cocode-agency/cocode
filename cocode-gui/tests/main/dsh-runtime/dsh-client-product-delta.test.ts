import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"
import { fileURLToPath } from "node:url"

const clientRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../packages/client",
)

const productFiles = [
	"client/ui-sidebar/src/client/CocodeLogo.tsx",
	"client/ui-sidebar/src/client/logo-store.ts",
	"client/ui-conversation/src/client/skeleton/hero-logo-store.ts",
	"client/ui-theme/src/client/logo-settings.ts",
	"client/ui-theme/src/client/AppearanceSection.tsx",
	"client/ui-theme/src/client/AppearanceSection.module.css",
	"client/ui-settings-models/src/client/account-gate.ts",
	"client/ui-message-feedback/src/client/account.ts",
]

for (const relative of productFiles) {
	test(`product code stays out of the DSH client snapshot: ${relative}`, () => {
		assert.equal(existsSync(path.join(clientRoot, relative)), false)
	})
}
