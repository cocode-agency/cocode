import assert from "node:assert/strict"
import test from "node:test"

import {
	getNativePackageOwnership,
	resolveNativeRuntimeMatrix,
} from "../../scripts/lib/native-runtime-matrix.mjs"

test("resolves the complete darwin arm64 native package matrix", () => {
	const entries = resolveNativeRuntimeMatrix({ platform: "darwin", arch: "arm64" })
	const names = entries.map((entry) => entry.packageName)

	assert.deepEqual(names, [
		"better-sqlite3",
		"node-pty",
		"sharp",
		"@img/sharp-darwin-arm64",
		"@img/sharp-libvips-darwin-arm64",
		"koffi",
		"@koromix/koffi-darwin-arm64",
		"node-addon-require-builtin",
		"node-addon-require-builtin-darwin-arm64",
		"@vscode/ripgrep",
		"@vscode/ripgrep-darwin-arm64",
	])
	assert.equal(entries.find((entry) => entry.packageName === "better-sqlite3")?.scope, "gui-main")
	assert.deepEqual(
		entries.find((entry) => entry.packageName === "@img/sharp-darwin-arm64")?.owners,
		["DSH attachment"],
	)
})

test("adds Linux Landlock and glibc ABI while omitting it on macOS", () => {
	const linux = resolveNativeRuntimeMatrix({ platform: "linux", arch: "x64" })
	const linuxNames = linux.map((entry) => entry.packageName)
	assert.equal(linuxNames.includes("@deepseek-ai/node-addon-landlock-run-linux-x64"), true)
	assert.equal(linuxNames.includes("node-addon-require-builtin-linux-x64-gnu"), true)
	assert.equal(linuxNames.includes("node-addon-require-builtin-linux-x64-msvc"), false)

	const mac = resolveNativeRuntimeMatrix({ platform: "darwin", arch: "x64" })
	assert.equal(
		mac.some((entry) =>
			entry.packageName.startsWith("@deepseek-ai/node-addon-landlock-run-linux-"),
		),
		false,
	)
})

test("uses the Windows sharp target package without inventing a libvips package", () => {
	const windows = resolveNativeRuntimeMatrix({ platform: "win32", arch: "x64" })
	const names = windows.map((entry) => entry.packageName)

	assert.equal(names.includes("@img/sharp-win32-x64"), true)
	assert.equal(names.includes("@img/sharp-libvips-win32-x64"), false)
})

test("keeps root and nested node-pty ownership distinct", () => {
	assert.deepEqual(
		getNativePackageOwnership({
			packageName: "node-pty",
			packagePath: "node_modules/node-pty",
		}),
		["Cocode Workbench", "Host Supervisor"],
	)
	assert.deepEqual(
		getNativePackageOwnership({
			packageName: "node-pty",
			packagePath: "node_modules/@deepseek-ai/dsh-subprocess-local/node_modules/node-pty",
		}),
		["DSH subprocess"],
	)
})
