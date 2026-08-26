import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import { pathToFileURL } from "node:url"
import test from "node:test"

test("GUI can consume the Host Supervisor runtime closure contract", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-gui-runtime-closure-"))
	try {
		const runtimeClosure = (await import(
			pathToFileURL(
				path.resolve(
					process.cwd(),
					"../cocode-host-supervisor/packages/host-supervisor/lib/runtime-closure.mjs",
				),
			).href
		)) as { resolveRuntimeDependencyClosure: unknown }
		assert.equal(typeof runtimeClosure.resolveRuntimeDependencyClosure, "function")
		assert.equal(existsSync(root), true)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
