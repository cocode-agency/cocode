import assert from "node:assert/strict"
import test from "node:test"
import {
	createDevHostEnvironment,
	resolveDevSupervisorEntry,
} from "../../scripts/lib/dev-runtime-entry.mjs"

test("dev Host Supervisor resolves from the staged runtime root", () => {
	assert.equal(
		resolveDevSupervisorEntry("/tmp/cocode-dsh-runtime"),
		"/tmp/cocode-dsh-runtime/packages/host-supervisor/lib/bin.js",
	)
})

test("dev Host Supervisor uses an isolated dev runtime channel", () => {
	assert.deepEqual(
		createDevHostEnvironment(
			{ COCODE_RUNTIME_CHANNEL: "stable", CUSTOM_FLAG: "keep" },
			"/tmp/cocode-dsh-runtime/packages/host-supervisor/lib/bin.js",
		),
		{
			COCODE_RUNTIME_CHANNEL: "dev",
			COCODE_SUPERVISOR_SERVICE_ENTRY:
				"/tmp/cocode-dsh-runtime/packages/host-supervisor/lib/bin.js",
			CUSTOM_FLAG: "keep",
		},
	)
})
