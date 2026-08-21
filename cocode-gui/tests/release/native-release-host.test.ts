import assert from "node:assert/strict"
import test from "node:test"
import { assertNativeReleaseHost } from "../../scripts/release/assert-native-release-host.mjs"

test("accepts a native Linux x64 host", () => {
	assert.doesNotThrow(() =>
		assertNativeReleaseHost({
			targetPlatform: "linux",
			targetArch: "x64",
			platform: "linux",
			arch: "x64",
			machine: "x86_64",
			environment: {},
		}),
	)
})

test("accepts a native Linux arm64 host", () => {
	assert.doesNotThrow(() =>
		assertNativeReleaseHost({
			targetPlatform: "linux",
			targetArch: "arm64",
			platform: "linux",
			arch: "arm64",
			machine: "aarch64",
			environment: {},
		}),
	)
})

test("rejects a Linux process architecture mismatch", () => {
	assert.throws(
		() =>
			assertNativeReleaseHost({
				targetPlatform: "linux",
				targetArch: "arm64",
				platform: "linux",
				arch: "x64",
				machine: "aarch64",
				environment: {},
			}),
		/native arm64.*process is x64/i,
	)
})

test("rejects a Linux uname architecture mismatch", () => {
	assert.throws(
		() =>
			assertNativeReleaseHost({
				targetPlatform: "linux",
				targetArch: "arm64",
				platform: "linux",
				arch: "arm64",
				machine: "x86_64",
				environment: {},
			}),
		/uname -m.*x86_64.*arm64/i,
	)
})

test("rejects cross-compilation environment overrides", () => {
	assert.throws(
		() =>
			assertNativeReleaseHost({
				targetPlatform: "linux",
				targetArch: "x64",
				platform: "linux",
				arch: "x64",
				machine: "x86_64",
				environment: { npm_config_arch: "arm64" },
			}),
		/cross-compilation override.*npm_config_arch/i,
	)
})
