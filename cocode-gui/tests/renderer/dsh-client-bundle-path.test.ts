import assert from "node:assert/strict"
// This test asserts native path resolution for the Electron-side bundle layout.
import test from "node:test"
import { parseDshClientBundleRequest } from "../../vite.renderer.config"
import { resolveLocalDshClientBundleUrl } from "../../src/renderer/app/bootstrap/local-dsh-client-bundles"

test("resolves every browser roster alias to a local Electron bundle", () => {
	const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window
	;(globalThis as typeof globalThis & { window: { location: { href: string } } }).window = {
		location: { href: "file:///Cocode/app.html" },
	}
	try {
		assert.equal(
			resolveLocalDshClientBundleUrl("@deepseek-ai/dsh-client-ui-reference"),
			"file:///Cocode/dsh-client/ui-reference/client.js",
		)
		assert.equal(
			resolveLocalDshClientBundleUrl("@deepseek-ai/dsh-client-ui-permission-presets"),
			"file:///Cocode/dsh-client/ui-permission-presets/client.js",
		)
	} finally {
		if (previousWindow === undefined)
			delete (globalThis as typeof globalThis & { window?: unknown }).window
		else (globalThis as typeof globalThis & { window: unknown }).window = previousWindow
	}
})

test("parses nested Cocode client bundle paths", () => {
	assert.deepEqual(parseDshClientBundleRequest("/dsh-client/cocode/cocode-workbench/client.js"), {
		directory: "cocode/cocode-workbench",
		sourceMap: false,
	})
	assert.deepEqual(parseDshClientBundleRequest("/dsh-client/cocode/cocode-account/client.js"), {
		directory: "cocode/cocode-account",
		sourceMap: false,
	})
})

test("preserves source-map requests for nested client bundles", () => {
	assert.deepEqual(
		parseDshClientBundleRequest("/dsh-client/cocode/cocode-workbench/client.js.map"),
		{
			directory: "cocode/cocode-workbench",
			sourceMap: true,
		},
	)
})
