import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
	DSH_CLIENT_HMR_ID,
	DSH_DEV_ONLY_ENTRY_IDS,
	selectDshBootBatches,
	selectDshBootEntries,
} from "../../src/renderer/app/bootstrap/dsh-boot-entries"

const entries = [
	{ id: DSH_CLIENT_HMR_ID, url: "/plugins/hmr/client.js", rev: "hmr" },
	{
		id: "@deepseek-ai/dsh-client-ui-trajectory",
		url: "/plugins/trajectory/client.js",
		rev: "trajectory",
	},
	{
		id: "@deepseek-ai/dsh-session-log-export",
		url: "/plugins/session-log/client.js",
		rev: "session-log",
	},
	{ id: "@deepseek-ai/dsh-client-modules", url: "/plugins/modules/client.js", rev: "modules" },
] as const

describe("selectDshBootEntries", () => {
	it("keeps all diagnostic entries during development", () => {
		assert.deepEqual(selectDshBootEntries(entries, false), entries)
	})

	it("removes every dev-only entry from packaged boot", () => {
		assert.deepEqual(selectDshBootEntries(entries, true), [entries[3]])
		assert.deepEqual(
			[...DSH_DEV_ONLY_ENTRY_IDS].sort(),
			[
				DSH_CLIENT_HMR_ID,
				"@deepseek-ai/dsh-session-log-export",
				"@deepseek-ai/dsh-client-ui-trajectory",
			].sort(),
		)
	})
})

describe("selectDshBootBatches", () => {
	const batches = [
		{
			phase: "application",
			url: "/plugins/application.js",
			rev: "application",
			entries: [
				DSH_CLIENT_HMR_ID,
				"@deepseek-ai/dsh-client-ui-trajectory",
				"@deepseek-ai/dsh-session-log-export",
				"@deepseek-ai/dsh-client-modules",
			],
		},
	] as const

	it("removes entries omitted from packaged boot while retaining the batch", () => {
		assert.deepEqual(selectDshBootBatches(batches, [entries[1]]), [
			{
				...batches[0],
				entries: ["@deepseek-ai/dsh-client-ui-trajectory"],
			},
		])
	})

	it("drops batches that no longer contain selected entries", () => {
		assert.deepEqual(selectDshBootBatches(batches, []), [])
	})
})
