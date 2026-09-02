import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import test from "node:test"
import * as path from "pathe"
import {
	DSH_CLIENT_OWNERSHIP,
	assertDshClientPackageOwnership,
	classifyDshClientPackage,
} from "../../scripts/lib/dsh-client-ownership.mjs"
import { resolveLocalDshClientBundleUrl } from "../../src/renderer/app/bootstrap/local-dsh-client-bundles"
import rendererViteConfig, { findDshClientBundles } from "../../vite.renderer.config"

test("declares the renderer and bundle ownership contract", () => {
	assert.deepEqual(DSH_CLIENT_OWNERSHIP, {
		webBoot: "@deepseek-ai/dsh-client-web",
		reactRenderer: "@deepseek-ai/dsh-client-ui-renderer",
		webBundle: "@deepseek-ai/dsh-web-app",
		legacy: ["@deepseek-ai/dsh-client-web-react"],
	})
	assert.equal(classifyDshClientPackage("@deepseek-ai/dsh-client-web"), "web-boot")
	assert.equal(classifyDshClientPackage("@deepseek-ai/dsh-client-ui-renderer"), "react-renderer")
	assert.equal(classifyDshClientPackage("@deepseek-ai/dsh-web-app"), "web-app")
	assert.equal(classifyDshClientPackage("@deepseek-ai/dsh-client-web-react"), "legacy")
	assert.throws(
		() => assertDshClientPackageOwnership("@deepseek-ai/dsh-client-web-react"),
		/legacy DSH client package/i,
	)
})

test("keeps the local Web boot alias and rejects the removed legacy package", () => {
	const viteSource = readFileSync(path.resolve("vite.renderer.config.ts"), "utf8")
	const rendererSource = readFileSync(
		path.resolve("src/renderer/app/bootstrap/start-renderer.ts"),
		"utf8",
	)
	assert.equal(viteSource.includes("node_modules/@deepseek-ai"), true)
	assert.equal(viteSource.includes("packages/client"), false)
	assert.equal(rendererSource.includes("@deepseek-ai/dsh-client-web"), true)
	assert.throws(
		() => resolveLocalDshClientBundleUrl("@deepseek-ai/dsh-client-web-react"),
		/legacy DSH client package/i,
	)
	assert.equal(findDshClientBundles().bundles.has("web-react"), false)
	const aliases = (rendererViteConfig.resolve?.alias ?? []) as Array<{
		find: unknown
		replacement?: string
	}>
	const webAlias = aliases.find(
		(alias) => String(alias.find) === "/^@deepseek-ai\\/dsh-client-web$/",
	)
	assert.equal(webAlias, undefined)
	assert.equal(
		aliases.some((alias) => String(alias.find).includes("dsh-client-web-react")),
		false,
	)
})

test("rejects a legacy package at Vite bundle discovery", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "dsh-client-vite-legacy-"))
	try {
		const packageRoot = path.join(root, "legacy")
		mkdirSync(path.join(packageRoot, "src", "client"), { recursive: true })
		mkdirSync(path.join(packageRoot, "lib"), { recursive: true })
		writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({
				name: "@deepseek-ai/dsh-client-web-react",
				dsh: { client: { platform: "web" } },
			}),
		)
		writeFileSync(path.join(packageRoot, "lib", "client.js"), "export {}")

		assert.throws(
			() => findDshClientBundles([{ root, prefix: "" }]),
			/legacy DSH client package/i,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("continues Vite bundle discovery below a non-client package manifest", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "dsh-client-vite-nested-"))
	try {
		const category = path.join(root, "category")
		const packageRoot = path.join(category, "ui-sidebar")
		mkdirSync(path.join(packageRoot, "lib"), { recursive: true })
		writeFileSync(path.join(category, "package.json"), JSON.stringify({ name: "category" }))
		writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({
				name: "@deepseek-ai/dsh-client-ui-sidebar",
				dsh: { client: { platform: "web" } },
			}),
		)
		writeFileSync(path.join(packageRoot, "lib", "client.js"), "export {}")

		const result = findDshClientBundles([{ root, prefix: "" }])
		assert.equal(result.bundles.has("ui-sidebar"), true)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
