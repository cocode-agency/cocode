import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import assert from "node:assert/strict"
import {
	discoverDshClientPackages,
	hasUnregisteredClientExternal,
	isClientBundleStale,
	createClientBuildConfig,
	resolveClientBuildTsconfig,
	resolveRuntimeClientBundlePath,
} from "../../scripts/watch-dsh-client.mjs"

test("uses the reference-free browser tsconfig for mirrored client bundles", () => {
	assert.equal(
		resolveClientBuildTsconfig(path.resolve("packages/client/client/ui-agent-preset")),
		path.resolve("tsconfig.base.client.json"),
	)
	assert.equal(
		resolveClientBuildTsconfig(path.resolve("packages/cocode/cocode-workbench")),
		path.resolve("packages/cocode/cocode-workbench/tsconfig.json"),
	)
})

test("discovers only web client packages with a source client entry", () => {
	const root = path.join(os.tmpdir(), `dsh-client-discovery-${String(process.pid)}`)
	rmSync(root, { recursive: true, force: true })
	try {
		const valid = path.join(root, "valid")
		mkdirSync(path.join(valid, "src", "client"), { recursive: true })
		writeFileSync(
			path.join(valid, "package.json"),
			JSON.stringify({
				name: "@example/dsh-client-valid",
				dsh: { client: { platform: "web" } },
			}),
		)
		writeFileSync(path.join(valid, "tsdown.config.ts"), "export default {}")
		writeFileSync(path.join(valid, "src", "client", "index.ts"), "export {}")

		const ignored = path.join(root, "ignored")
		mkdirSync(path.join(ignored, "src", "client"), { recursive: true })
		writeFileSync(
			path.join(ignored, "package.json"),
			JSON.stringify({
				name: "@example/dsh-client-ignored",
				dsh: { client: { platform: "node" } },
			}),
		)
		writeFileSync(path.join(ignored, "tsdown.config.ts"), "export default {}")
		writeFileSync(path.join(ignored, "src", "client", "index.ts"), "export {}")

		assert.deepEqual(
			discoverDshClientPackages(root).map((item) => item.id),
			["@example/dsh-client-valid"],
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("discovers web client packages nested below category directories", () => {
	const root = path.join(os.tmpdir(), `dsh-client-nested-discovery-${String(process.pid)}`)
	rmSync(root, { recursive: true, force: true })
	try {
		const nested = path.join(root, "client", "ui-sidebar")
		mkdirSync(path.join(nested, "src", "client"), { recursive: true })
		writeFileSync(
			path.join(nested, "package.json"),
			JSON.stringify({
				name: "@example/dsh-client-ui-sidebar",
				dsh: { client: { platform: "web" } },
			}),
		)
		writeFileSync(path.join(nested, "tsdown.config.ts"), "export default {}")
		writeFileSync(path.join(nested, "src", "client", "index.ts"), "export {}")

		assert.deepEqual(
			discoverDshClientPackages(root).map((item) => item.id),
			["@example/dsh-client-ui-sidebar"],
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("continues scanning below a non-client package manifest", () => {
	const root = path.join(os.tmpdir(), `dsh-client-manifest-parent-${String(process.pid)}`)
	rmSync(root, { recursive: true, force: true })
	try {
		const parent = path.join(root, "category")
		const nested = path.join(parent, "ui-sidebar")
		mkdirSync(path.join(nested, "src", "client"), { recursive: true })
		writeFileSync(path.join(parent, "package.json"), JSON.stringify({ name: "@example/category" }))
		writeFileSync(
			path.join(nested, "package.json"),
			JSON.stringify({ name: "@example/dsh-client-ui-sidebar", dsh: { client: { platform: "web" } } }),
		)
		writeFileSync(path.join(nested, "tsdown.config.ts"), "export default {}")
		writeFileSync(path.join(nested, "src", "client", "index.ts"), "export {}")

		assert.deepEqual(
			discoverDshClientPackages(root).map((item) => item.id),
			["@example/dsh-client-ui-sidebar"],
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("discovers the migrated client tree from the workspace package root", () => {
	const ids = discoverDshClientPackages(path.resolve("packages/client")).map((item) => item.id)
	assert.equal(ids.length >= 37, true)
	assert.equal(ids.includes("@deepseek-ai/dsh-client-ui-sidebar"), true)
	assert.equal(ids.includes("@deepseek-ai/dsh-client-ui-conversation"), true)
})

test("detects a source bundle that is newer than its emitted client bundle", () => {
	const root = path.join(os.tmpdir(), `dsh-client-stale-${String(process.pid)}`)
	rmSync(root, { recursive: true, force: true })
	try {
		const sourceRoot = path.join(root, "src")
		const bundlePath = path.join(root, "lib", "client.js")
		mkdirSync(sourceRoot, { recursive: true })
		mkdirSync(path.dirname(bundlePath), { recursive: true })
		writeFileSync(path.join(sourceRoot, "index.ts"), "export {}")
		writeFileSync(bundlePath, "old")
		const now = Date.now() / 1000
		utimesSync(bundlePath, now, now)
		utimesSync(path.join(sourceRoot, "index.ts"), now + 2, now + 2)

		assert.equal(isClientBundleStale({ bundlePath, sourceRoot }), true)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("resolves the staged runtime path from a scoped package id", () => {
	assert.equal(
		resolveRuntimeClientBundlePath("/tmp/dsh-runtime", "@example/dsh-client-valid"),
		path.join(
			"/tmp/dsh-runtime",
			"node_modules",
			"@example",
			"dsh-client-valid",
			"lib",
			"client.js",
		),
	)
	assert.equal(
		resolveRuntimeClientBundlePath("/tmp/dsh-runtime", "cocode-workbench"),
		path.join("/tmp/dsh-runtime", "node_modules", "cocode-workbench", "lib", "client.js"),
	)
	assert.throws(() => resolveRuntimeClientBundlePath("/tmp/dsh-runtime", "bad/package/name"))
	assert.throws(() => resolveRuntimeClientBundlePath("/tmp/dsh-runtime", "../escape"))
})

test("marks bundles with non-table CommonJS externals for rebuild", () => {
	const root = path.join(os.tmpdir(), `dsh-client-external-drift-${String(process.pid)}`)
	rmSync(root, { recursive: true, force: true })
	try {
		mkdirSync(root, { recursive: true })
		const bundlePath = path.join(root, "client.js")
		writeFileSync(
			bundlePath,
			'const ok = require("react"); const stale = require("@deepseek-ai/schemastery");',
		)
		assert.equal(hasUnregisteredClientExternal(bundlePath), true)
		writeFileSync(bundlePath, 'const ok = require("react");')
		assert.equal(hasUnregisteredClientExternal(bundlePath), false)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("forces ordinary client dependencies into the browser bundle", async () => {
	const config = await createClientBuildConfig({
		id: "@deepseek-ai/dsh-client-ui-trajectory",
		root: path.resolve("packages/client/client/ui-trajectory"),
		configPath: path.resolve("packages/client/client/ui-trajectory/tsdown.config.ts"),
		tsconfigPath: path.resolve("tsconfig.base.client.json"),
	})

	const neverBundle = config.deps?.neverBundle as ((specifier: string) => boolean)
	assert.equal(typeof neverBundle, "function")
	for (const specifier of [
		"react",
		"react/jsx-runtime",
		"react-dom",
		"react-dom/client",
		"@deepseek-ai/cordis",
		"@deepseek-ai/dsh-client-ui-slots",
		"@deepseek-ai/dsh-client-ui-primitives",
		"@deepseek-ai/dsh-client-runtime/client",
	]) assert.equal(neverBundle(specifier), true, specifier)
	assert.equal(neverBundle("@deepseek-ai/dsh-client-schema-form"), false)
	assert.equal(config.deps?.alwaysBundle?.("@tanstack/react-virtual"), true)
	assert.equal(config.deps?.alwaysBundle?.("diff"), true)
	assert.equal(config.deps?.alwaysBundle?.("react"), false)

	const resolver = (config.plugins as Array<{ name?: string; resolveId?: Function }>).find(
		(plugin) => plugin.name === "dsh-client-dependency-fallback",
	)
	assert.equal(typeof resolver?.resolveId, "function")
	const importer = path.resolve(
		"packages/client/client/ui-trajectory/src/client/TrajectoryTable.tsx",
	)
	assert.match(String(resolver?.resolveId?.("@tanstack/react-virtual", importer)), /react-virtual/)
	assert.match(String(resolver?.resolveId?.("diff", importer)), /diff/)
	assert.equal(resolver?.resolveId?.("@xterm/xterm/css/xterm.css", importer), null)
})
