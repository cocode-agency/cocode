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
			libc: "glibc",
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
			libc: "glibc",
			environment: {},
		}),
	)
})

test("accepts a native Windows x64 host without requiring Unix uname", () => {
	assert.doesNotThrow(() =>
		assertNativeReleaseHost({
			targetPlatform: "win32",
			targetArch: "x64",
			platform: "win32",
			arch: "x64",
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
				libc: "glibc",
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
				libc: "glibc",
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
				libc: "glibc",
				environment: { npm_config_arch: "arm64" },
			}),
		/cross-compilation override.*npm_config_arch/i,
	)
})

test("rejects musl hosts while the Linux matrix targets glibc packages", () => {
	assert.throws(
		() =>
			assertNativeReleaseHost({
				targetPlatform: "linux",
				targetArch: "x64",
				platform: "linux",
				arch: "x64",
				machine: "x86_64",
				libc: "musl",
				environment: {},
			}),
		/glibc/i,
	)
})
