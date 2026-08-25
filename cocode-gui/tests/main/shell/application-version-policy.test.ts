import assert from "node:assert/strict"
import test from "node:test"
import { isStrictlyNewerApplicationVersion } from "../../../src/main/shell/updater/application-version-policy"

test("accepts only strictly newer stable and prerelease versions", () => {
	assert.equal(isStrictlyNewerApplicationVersion("1.0.1", "1.0.0"), true)
	assert.equal(isStrictlyNewerApplicationVersion("1.0.0", "1.0.0"), false)
	assert.equal(isStrictlyNewerApplicationVersion("0.9.9", "1.0.0"), false)
	assert.equal(isStrictlyNewerApplicationVersion("1.0.0", "1.0.0-rc.1"), true)
	assert.equal(isStrictlyNewerApplicationVersion("1.0.0-rc.2", "1.0.0-rc.1"), true)
	assert.equal(isStrictlyNewerApplicationVersion("1.0.0-alpha", "1.0.0-1"), true)
	assert.equal(isStrictlyNewerApplicationVersion("1.0.0-1", "1.0.0-alpha"), false)
})

test("rejects invalid versions instead of treating them as upgrades", () => {
	assert.equal(isStrictlyNewerApplicationVersion("1.0", "1.0.0"), false)
	assert.equal(isStrictlyNewerApplicationVersion("1.0.0-01.1", "1.0.0-1"), false)
	assert.equal(isStrictlyNewerApplicationVersion(undefined, "1.0.0"), false)
})
