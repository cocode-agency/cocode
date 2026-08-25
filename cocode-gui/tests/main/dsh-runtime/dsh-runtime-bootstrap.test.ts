import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
	extractDshBootManifest,
	extractDshThemePreference,
} from "../../../src/shared/dsh-runtime/bootstrap-html"
import {
	assertRequiredCocodeWebEndpoints,
	assertRequiredCocodeWebEntries,
} from "../../../src/main/contexts/dsh-runtime/infrastructure/dsh-runtime-health"

describe("extractDshBootManifest", () => {
	it("parses the host-injected manifest with nested entry data", () => {
		const manifest = extractDshBootManifest(
			`<script>window.__DSH_BOOT__ = ${JSON.stringify({
				rev: "local",
				entries: [
					{
						id: "@deepseek-ai/dsh-client-runtime",
						url: "/plugins/runtime/client.js",
						rev: "abc",
						inject: ["connection"],
						immediately: true,
					},
				],
			})}</script>`,
		)

		assert.deepEqual(manifest.entries[0], {
			id: "@deepseek-ai/dsh-client-runtime",
			url: "/plugins/runtime/client.js",
			rev: "abc",
			inject: ["connection"],
			immediately: true,
		})
	})

	it("parses the globalThis bracket form emitted by the DSH webserver", () => {
		const manifest = extractDshBootManifest(
			`<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({
				rev: "globalThis",
				entries: [],
			})}</script>`,
		)

		assert.deepEqual(manifest, { rev: "globalThis", entries: [] })
	})

	it("rejects a page without the boot script", () => {
		assert.throws(
			() => extractDshBootManifest("<html><body>missing</body></html>"),
			/ did not contain window\.__DSH_BOOT__\./,
		)
	})

	it("rejects malformed JSON before it reaches the manifest schema", () => {
		assert.throws(
			() => extractDshBootManifest("<script>window.__DSH_BOOT__ = {broken}</script>"),
			/boot manifest is not valid JSON/,
		)
	})
})

describe("extractDshThemePreference", () => {
	it("reads the host preference marker used for the no-flash local boot", () => {
		assert.equal(
			extractDshThemePreference(
				'<head><meta name="dsh-theme-preference" content="dark"></head>',
			),
			"dark",
		)
	})

	it("accepts the marker attributes in either order", () => {
		assert.equal(
			extractDshThemePreference(
				'<head><meta content="light" data-source="host" name="dsh-theme-preference"></head>',
			),
			"light",
		)
	})

	it("falls back to system for older sidecar pages", () => {
		assert.equal(extractDshThemePreference("<html></html>"), "system")
	})
})

describe("Cocode Web runtime health", () => {
	const boot = {
		rev: "test",
		entries: [
			{ id: "cocode-workbench", url: "/plugins/cocode-workbench/client.js", rev: "a" },
			{ id: "cocode-account", url: "/plugins/cocode-account/client.js", rev: "b" },
			{ id: "cocode-shortcuts", url: "/plugins/cocode-shortcuts/client.js", rev: "c" },
		],
	} as const

	it("requires all Desktop-owned Cocode entries", () => {
		assertRequiredCocodeWebEntries(boot)
		assert.throws(
			() => assertRequiredCocodeWebEntries({ ...boot, entries: boot.entries.slice(0, 2) }),
			/missing boot entry: cocode-shortcuts/,
		)
	})

	it("checks every advertised plugin endpoint", async () => {
		const requested: string[] = []
		await assertRequiredCocodeWebEndpoints("http://127.0.0.1:3080", boot, async (input) => {
			requested.push(String(input))
			return new Response("ok", { status: 200 })
		})
		assert.deepEqual(requested.sort(), [
			"http://127.0.0.1:3080/plugins/cocode-account/client.js",
			"http://127.0.0.1:3080/plugins/cocode-shortcuts/client.js",
			"http://127.0.0.1:3080/plugins/cocode-workbench/client.js",
		])
	})

	it("reports a broken client route", async () => {
		await assert.rejects(
			() =>
				assertRequiredCocodeWebEndpoints("http://127.0.0.1:3080", boot, async (input) => {
					const id = String(input).includes("cocode-account") ? 404 : 200
					return new Response("", { status: id })
				}),
			/Cocode Web client entry cocode-account is not reachable: GET \/plugins\/cocode-account\/client\.js returned HTTP 404/,
		)
	})
})
