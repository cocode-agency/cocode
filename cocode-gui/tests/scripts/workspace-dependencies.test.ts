import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "pathe"
import test from "node:test"
import { esbuildPlatformPackagePath } from "../../scripts/build-tui.mjs"
import {
	findIncompatibleNativePackages,
	isPackageCompatible,
	pruneIncompatibleNativePackages,
	pruneNativePrebuildDirectories,
	ensureLinuxNodePtyNatives,
	ensureWindowsNodePtyNatives,
	ensureWorkspaceDependencies,
} from "../../scripts/lib/workspace-dependencies.mjs"

test("resolves the esbuild package for the active platform and architecture", () => {
	assert.equal(
		esbuildPlatformPackagePath("/workspace/cocode-tui", "darwin", "x64"),
		path.join(
			"/workspace/cocode-tui",
			"node_modules",
			"@esbuild",
			"darwin-x64",
			"package.json",
		),
	)
})

test("reports when a workspace already has its required dependencies", () => {
	const root = mkdtempSync(path.join(tmpdir(), "cocode-workspace-dependencies-test-"))
	const requiredPath = path.join(root, "node_modules", "esbuild", "package.json")
	mkdirSync(path.dirname(requiredPath), { recursive: true })
	writeFileSync(requiredPath, "{}\n")

	assert.equal(
		ensureWorkspaceDependencies({
			root,
			label: "test workspace",
			requiredPaths: [requiredPath],
		}),
		false,
	)
})

test("repairs missing Windows node-pty native files with the target architecture", () => {
	const root = mkdtempSync(path.join(tmpdir(), "cocode-node-pty-native-test-"))
	const release = path.join(root, "node_modules", "node-pty", "prebuilds", "win32-x64")
	const required = [
		path.join(release, "conpty", "conpty.dll"),
		path.join(release, "conpty", "OpenConsole.exe"),
		path.join(release, "conpty.node"),
		path.join(release, "pty.node"),
		path.join(release, "winpty-agent.exe"),
	]
	const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = []
	try {
		assert.equal(
			ensureWindowsNodePtyNatives({
				root,
				platform: "win32",
				arch: "x64",
				run(command, args, options) {
					calls.push({ command, args, env: options?.env })
					for (const file of required) {
						mkdirSync(path.dirname(file), { recursive: true })
						writeFileSync(file, "native")
					}
				},
			}),
			true,
		)
		assert.equal(calls.length, 1)
		assert.deepEqual(calls[0]?.args, ["pnpm@10.34.5", "rebuild", "node-pty"])
		assert.equal(calls[0]?.env?.npm_config_arch, "x64")
		assert.deepEqual(
			ensureWindowsNodePtyNatives({ root, platform: "win32", arch: "x64" }),
			false,
		)
		assert.equal(
			ensureWindowsNodePtyNatives({
				root,
				platform: "win32",
				arch: "arm64",
				force: true,
				run(command, args, options) {
					calls.push({ command, args, env: options?.env })
					const arm64 = path.join(
						root,
						"node_modules",
						"node-pty",
						"prebuilds",
						"win32-arm64",
					)
					for (const relative of [
						"pty.node",
						"winpty-agent.exe",
						"conpty.node",
						path.join("conpty", "conpty.dll"),
						path.join("conpty", "OpenConsole.exe"),
					]) {
						const file = path.join(arm64, relative)
						mkdirSync(path.dirname(file), { recursive: true })
						writeFileSync(file, "native")
					}
				},
			}),
			true,
		)
		assert.equal(calls.at(-1)?.env?.npm_config_arch, "arm64")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("repairs missing Linux node-pty native files with the target architecture", () => {
	const root = mkdtempSync(path.join(tmpdir(), "cocode-linux-node-pty-native-test-"))
	const release = path.join(root, "node_modules", "node-pty", "prebuilds", "linux-arm64")
	const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = []
	try {
		assert.equal(
			ensureLinuxNodePtyNatives({
				root,
				platform: "linux",
				arch: "arm64",
				run(command, args, options) {
					calls.push({ command, args, env: options?.env })
					for (const file of [
						path.join(release, "pty.node"),
						path.join(release, "spawn-helper"),
					]) {
						mkdirSync(path.dirname(file), { recursive: true })
						writeFileSync(file, "native")
					}
				},
			}),
			true,
		)
		assert.equal(calls.length, 1)
		assert.deepEqual(calls[0]?.args, ["pnpm@10.34.5", "rebuild", "node-pty"])
		assert.equal(calls[0]?.env?.npm_config_arch, "arm64")
		assert.equal(existsSync(path.join(release, "spawn-helper")), true)
		assert.equal(ensureLinuxNodePtyNatives({ root, platform: "linux", arch: "arm64" }), false)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("prunes node-pty native prebuild directories to the staged target", () => {
	const root = mkdtempSync(path.join(tmpdir(), "cocode-node-pty-prune-test-"))
	try {
		for (const directory of ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"]) {
			const file = path.join(
				root,
				"node_modules",
				"node-pty",
				"prebuilds",
				directory,
				"pty.node",
			)
			mkdirSync(path.dirname(file), { recursive: true })
			writeFileSync(file, "native")
		}

		pruneNativePrebuildDirectories(root, { platform: "win32", arch: "x64" })

		assert.equal(
			existsSync(
				path.join(root, "node_modules", "node-pty", "prebuilds", "win32-x64", "pty.node"),
			),
			true,
		)
		for (const directory of ["darwin-arm64", "darwin-x64", "win32-arm64"])
			assert.equal(
				existsSync(path.join(root, "node_modules", "node-pty", "prebuilds", directory)),
				false,
				directory,
			)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("prunes incompatible optional native packages and node-pty conpty assets", () => {
	const root = mkdtempSync(path.join(tmpdir(), "cocode-native-package-prune-test-"))
	try {
		const darwinPackage = path.join(root, "node_modules", "@img", "sharp-darwin-arm64")
		const windowsPackage = path.join(root, "node_modules", "@img", "sharp-win32-x64")
		const sqlitePrebuilds = path.join(root, "node_modules", "better-sqlite3", "prebuilds")
		const embeddedNativePackage = path.join(root, "node_modules", "embedded-native")
		mkdirSync(darwinPackage, { recursive: true })
		mkdirSync(windowsPackage, { recursive: true })
		mkdirSync(sqlitePrebuilds, { recursive: true })
		mkdirSync(embeddedNativePackage, { recursive: true })
		writeFileSync(
			path.join(darwinPackage, "package.json"),
			JSON.stringify({ name: "@img/sharp-darwin-arm64", os: ["darwin"], cpu: ["arm64"] }),
		)
		writeFileSync(
			path.join(windowsPackage, "package.json"),
			JSON.stringify({ name: "@img/sharp-win32-x64", os: ["win32"], cpu: ["x64"] }),
		)
		for (const name of ["darwin-arm64.node", "linux-x64.node", "win32-x64.node"])
			writeFileSync(path.join(sqlitePrebuilds, name), "native")
		for (const name of ["index.darwin-arm64.node", "index.win32-x64-msvc.node"])
			writeFileSync(path.join(embeddedNativePackage, name), "native")
		for (const directory of ["win10-arm64", "win10-x64"])
			mkdirSync(
				path.join(root, "node_modules", "node-pty", "third_party", "conpty", directory),
				{ recursive: true },
			)

		pruneIncompatibleNativePackages(root, { platform: "win32", arch: "x64" })
		assert.deepEqual(
			findIncompatibleNativePackages(root, { platform: "win32", arch: "x64" }),
			[],
		)
		assert.equal(
			isPackageCompatible(
				{ name: "@img/sharp-win32-x64", os: ["win32"], cpu: ["x64"] },
				{
					platform: "win32",
					arch: "x64",
				},
			),
			true,
		)

		assert.equal(existsSync(darwinPackage), false)
		assert.equal(existsSync(windowsPackage), true)
		assert.equal(existsSync(path.join(sqlitePrebuilds, "win32-x64.node")), true)
		assert.equal(existsSync(path.join(sqlitePrebuilds, "darwin-arm64.node")), false)
		assert.equal(existsSync(path.join(sqlitePrebuilds, "linux-x64.node")), false)
		assert.equal(existsSync(path.join(embeddedNativePackage, "index.darwin-arm64.node")), false)
		assert.equal(
			existsSync(path.join(embeddedNativePackage, "index.win32-x64-msvc.node")),
			true,
		)
		assert.equal(
			existsSync(
				path.join(root, "node_modules", "node-pty", "third_party", "conpty", "win10-x64"),
			),
			true,
		)
		assert.equal(
			existsSync(
				path.join(root, "node_modules", "node-pty", "third_party", "conpty", "win10-arm64"),
			),
			false,
		)

		mkdirSync(
			path.join(root, "node_modules", "node-pty", "third_party", "conpty", "win10-arm64"),
			{ recursive: true },
		)
		pruneIncompatibleNativePackages(root, { platform: "darwin", arch: "arm64" })
		assert.equal(
			existsSync(path.join(root, "node_modules", "node-pty", "third_party", "conpty")),
			false,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
