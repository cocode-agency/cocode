import assert from "node:assert/strict"
import test from "node:test"
import {
	COCODE_ACCOUNT_PACKAGE,
	COCODE_APPEARANCE_PACKAGE,
	COCODE_BRAND_PACKAGE,
	COCODE_DESKTOP_PACKAGE,
	COCODE_INPUT_HISTORY_PACKAGE,
	COCODE_MESSAGE_FEEDBACK_PACKAGE,
	COCODE_MODELS_PACKAGE,
	COCODE_SHORTCUTS_PACKAGE,
	COCODE_WORKBENCH_PACKAGE,
	createDshDesktopPatch,
} from "../../../src/main/contexts/dsh-runtime/infrastructure/dsh-desktop-patch"

test("mounts Cocode plugins only through the Electron overlay", () => {
	const patch = createDshDesktopPatch("file:///app/dsh-noop-hmr.mjs")

	assert.equal(COCODE_WORKBENCH_PACKAGE, "cocode-workbench")
	assert.equal(COCODE_ACCOUNT_PACKAGE, "cocode-account")
	assert.equal(COCODE_SHORTCUTS_PACKAGE, "cocode-shortcuts")
	assert.equal(COCODE_BRAND_PACKAGE, "cocode-brand")
	assert.equal(COCODE_INPUT_HISTORY_PACKAGE, "cocode-input-history")
	assert.equal(COCODE_APPEARANCE_PACKAGE, "cocode-appearance")
	assert.equal(COCODE_DESKTOP_PACKAGE, "cocode-desktop")
	assert.equal(COCODE_MESSAGE_FEEDBACK_PACKAGE, "cocode-message-feedback")
	assert.equal(COCODE_MODELS_PACKAGE, "cocode-models")
	assert.match(patch, /id: ui-message-feedback\n {2}disabled: true/)
	assert.match(patch, /id: ui-settings-models\n {2}disabled: true/)
	assert.match(patch, /id: dsh-desktop-hmr/)
	assert.match(patch, /name: "file:\/\/\/app\/dsh-noop-hmr\.mjs"/)
	assert.match(patch, /id: cocode-workbench/)
	assert.match(patch, /name: "cocode-workbench"/)
	assert.match(patch, /id: cocode-account/)
	assert.match(patch, /name: "cocode-account"/)
	assert.match(patch, /id: cocode-shortcuts/)
	assert.match(patch, /name: "cocode-shortcuts"/)
	assert.match(patch, /id: cocode-brand/)
	assert.match(patch, /name: "cocode-brand"/)
	assert.match(patch, /id: cocode-input-history/)
	assert.match(patch, /name: "cocode-input-history"/)
	assert.match(patch, /id: cocode-appearance/)
	assert.match(patch, /name: "cocode-appearance"/)
	assert.match(patch, /id: cocode-desktop/)
	assert.match(patch, /name: "cocode-desktop"/)
	assert.match(patch, /id: cocode-message-feedback/)
	assert.match(patch, /name: "cocode-message-feedback"/)
	assert.match(patch, /id: cocode-models/)
	assert.match(patch, /name: "cocode-models"/)
	assert.doesNotMatch(patch, /cocode-external-dsh/)
	assert.doesNotMatch(patch, /profiles\/web|cordis\.patch\.yml/)
})
