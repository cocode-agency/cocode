import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import * as path from "pathe"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { COCODE_WEB_CLIENT_PACKAGES } from "../../../src/shared/dsh-runtime/dsh-client-bundle-path"

const guiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

test("the repository has no DSH source snapshot", () => {
	assert.equal(existsSync(path.join(guiRoot, "packages", "client")), false)
})

test("Cocode product changes are represented by plugin packages", () => {
	for (const plugin of COCODE_WEB_CLIENT_PACKAGES) {
		const packageRoot = path.join(guiRoot, "packages", "cocode", plugin)
		assert.equal(
			existsSync(path.join(packageRoot, "src")),
			true,
			`${plugin} must remain an in-tree Cocode plugin`,
		)
		const manifest = JSON.parse(
			readFileSync(path.join(packageRoot, "package.json"), "utf8"),
		) as {
			dsh?: { client?: { platform?: string } }
		}
		assert.equal(
			manifest.dsh?.client?.platform,
			"web",
			`${plugin} must declare the DSH Web client plugin ABI`,
		)
	}
	assert.equal(
		existsSync(path.join(guiRoot, "packages", "cocode", "cocode-dsml", "src")),
		true,
		"cocode-dsml must remain the Host-only Cocode plugin",
	)
	assert.equal(
		JSON.parse(
			readFileSync(
				path.join(guiRoot, "packages", "cocode", "cocode-dsml", "package.json"),
				"utf8",
			),
		).dsh?.client,
		undefined,
		"cocode-dsml must not be advertised as a browser client",
	)
})

test("every direct Cocode package directory has a build manifest", () => {
	const packageRoot = path.join(guiRoot, "packages", "cocode")
	for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const manifestPath = path.join(packageRoot, entry.name, "package.json")
		assert.equal(existsSync(manifestPath), true, `${entry.name} must have package.json`)
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			private?: boolean
			cocode?: { runtimeDependencies?: unknown }
		}
		assert.equal(manifest.private, true, `${entry.name} must be a private Cocode plugin`)
		assert.ok(
			manifest.cocode !== undefined,
			`${entry.name} must declare Cocode staging metadata`,
		)
	}
})
