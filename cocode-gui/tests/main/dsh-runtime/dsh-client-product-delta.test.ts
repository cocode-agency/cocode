import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"
import { fileURLToPath } from "node:url"

const clientRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../packages/client",
)

const productBrandFiles = [
	"client/ui-sidebar/src/client/CocodeLogo.tsx",
	"client/ui-sidebar/src/client/logo-store.ts",
	"client/ui-conversation/src/client/skeleton/hero-logo-store.ts",
	"client/ui-theme/src/client/logo-settings.ts",
]

for (const relative of productBrandFiles) {
	test(`product brand code stays out of the DSH client snapshot: ${relative}`, () => {
		assert.equal(existsSync(path.join(clientRoot, relative)), false)
	})
}
