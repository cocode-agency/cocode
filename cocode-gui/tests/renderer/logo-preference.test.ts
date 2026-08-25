import assert from "node:assert/strict"
import test from "node:test"
import {
	DEFAULT_LOGO_PREFERENCE,
	isLogoPreference,
	LOGO_PREFERENCES,
} from "../../packages/client/client/ui-theme/src/client/logo-settings.ts"

test("sidebar logo preference defaults to Cocode and accepts both supported brands", () => {
	assert.equal(DEFAULT_LOGO_PREFERENCE, "cocode")
	assert.deepEqual(LOGO_PREFERENCES, ["cocode", "deepseek"])
	assert.equal(isLogoPreference("cocode"), true)
	assert.equal(isLogoPreference("deepseek"), true)
	assert.equal(isLogoPreference("other"), false)
})
