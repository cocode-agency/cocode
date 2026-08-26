import assert from "node:assert/strict"
import test from "node:test"
import {
	parseSyncShortcutsRequest,
	parseTriggeredShortcutCommandId,
} from "../../../src/contracts/schemas/shortcuts.schema"

test("rejects malformed global shortcut payloads", () => {
	assert.throws(() =>
		parseSyncShortcutsRequest({
			bindings: [{ commandId: "not valid", accelerator: "CommandOrControl+N" }],
		}),
	)
	assert.throws(() =>
		parseSyncShortcutsRequest({
			bindings: new Array(65).fill({
				commandId: "cocode.newSession",
				accelerator: "CommandOrControl+N",
			}),
		}),
	)
	assert.throws(() => parseTriggeredShortcutCommandId("../execute"))
})
