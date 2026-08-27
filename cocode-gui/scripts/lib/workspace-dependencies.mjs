import { execFileSync } from "node:child_process"
import {
	chmodSync,
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
} from "node:fs"
import * as path from "pathe"
import { shellCommandOptions } from "./child-process-options.mjs"
import { assertNativeBinaryArchitecture } from "./native-binary-inspection.mjs"

/**
 * @typedef {(command: string, args: string[], options?: import("node:child_process").ExecFileSyncOptions) => unknown} RunCommand
 */

/**
 * Install a sibling workspace's dependencies when its required artifacts are
 * missing. Installation runs through Corepack at the pinned pnpm version so
 * the result matches the workspace's committed lockfile.
 * @param root - workspace directory containing package.json and pnpm-lock.yaml.
 * @param label - human-readable workspace name used in progress output.
 * @param requiredPaths - files whose presence marks the install as complete.
 */
export function ensureWorkspaceDependencies({ root, label, requiredPaths }) {
	if (requiredPaths.every((requiredPath) => existsSync(requiredPath))) return false

	console.log(`[workspace-deps] installing ${label} dependencies`)
	execFileSync(
		process.platform === "win32" ? "corepack.cmd" : "corepack",
		["pnpm@10.34.5", "install", "--frozen-lockfile"],
		shellCommandOptions({ cwd: root, stdio: "inherit" }),
	)
	return true
}

export function discoverNodePtyPackages(root) {
	const packages = []
	const seen = new Set()
	visitNodeModules(path.join(root, "node_modules"))
	return packages.sort((left, right) => left.packageRoot.localeCompare(right.packageRoot))

	function visitNodeModules(modulesRoot) {
		if (!existsSync(modulesRoot)) return
		for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
			const packageRoot = path.join(modulesRoot, entry.name)
			if (entry.name.startsWith("@")) {
				visitNodeModules(packageRoot)
				continue
			}
			visitPackage(packageRoot)
		}
	}

	function visitPackage(packageRoot) {
		let manifest
		try {
			manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"))
		} catch {
			manifest = undefined
		}
		if (manifest?.name === "node-pty") {
			const resolvedRoot = realpathSync(packageRoot)
			if (!seen.has(resolvedRoot)) {
				seen.add(resolvedRoot)
				packages.push({
					packageRoot: resolvedRoot,
					version: String(manifest.version ?? "unknown"),
					manifest,
				})
			}
		}
		visitNodeModules(path.join(packageRoot, "node_modules"))
	}
}

export function resolveNodePtyNativeDirectory(
	packageRoot,
	{ platform = process.platform, arch = process.arch } = {},
) {
	const directories = [
		path.join(packageRoot, "build", "Release"),
		path.join(packageRoot, "build", "Debug"),
		path.join(packageRoot, "prebuilds", `${platform}-${arch}`),
	]
	return directories.find(
		(directory) =>
			existsSync(path.join(directory, "pty.node")) ||
			existsSync(path.join(directory, "conpty.node")),
	)
}

/**
 * @param {{
 *   root: string,
 *   platform?: NodeJS.Platform,
 *   arch?: NodeJS.Architecture,
 *   force?: boolean,
 *   run?: RunCommand,
 *   compileSpawnHelper?: (packageRoot: string, nativeDirectory: string) => unknown,
 * }} [options]
 */
export function prepareNodePtyNatives({
	root,
	platform = process.platform,
	arch = process.arch,
	force = false,
	run = execFileSync,
	compileSpawnHelper = (packageRoot, nativeDirectory) =>
		compileUnixNodePtySpawnHelper(packageRoot, nativeDirectory, { run }),
} = {}) {
	if (!["win32", "darwin", "linux"].includes(platform)) return []
	const packages = discoverNodePtyPackages(root)
	if (packages.length === 0) return []
	for (const { packageRoot, version } of packages) {
		if (platform === "win32")
			ensureWindowsNodePtyNatives({ root, packageRoot, version, platform, arch, force, run })
		if (platform === "linux")
			ensureLinuxNodePtyNatives({
				root,
				packageRoot,
				platform,
				arch,
				force,
				run,
				skipHelperRebuild: true,
			})
		if (platform === "darwin")
			ensureDarwinNodePtyNatives({
				root,
				packageRoot,
				platform,
				arch,
				force,
				run,
				skipHelperRebuild: true,
			})
	}

	for (const { packageRoot } of packages) {
		const nativeDirectory = resolveNodePtyNativeDirectory(packageRoot, { platform, arch })
		if (!nativeDirectory) {
			throw new Error(`node-pty pty.node is missing for ${platform}/${arch}: ${packageRoot}`)
		}
		if (platform !== "win32") {
			const helper = path.join(nativeDirectory, "spawn-helper")
			if (!existsSync(helper)) compileSpawnHelper(packageRoot, nativeDirectory)
			if (!existsSync(helper)) {
				throw new Error(
					`node-pty spawn-helper is missing for ${platform}/${arch}: ${helper}`,
				)
			}
			chmodSync(helper, 0o755)
		}
	}

	return packages
}

export function restoreNodePtyHelpers({
	root,
	platform = process.platform,
	arch = process.arch,
} = {}) {
	// Windows node-pty has no Unix spawn-helper executable to restore.
	if (platform === "win32") return []
	const restored = []
	for (const { packageRoot } of discoverNodePtyPackages(root)) {
		const nativeDirectory = resolveNodePtyNativeDirectory(packageRoot, { platform, arch })
		if (!nativeDirectory) continue
		const helper = path.join(nativeDirectory, "spawn-helper")
		if (!existsSync(helper))
			throw new Error(`node-pty spawn-helper is missing for ${platform}/${arch}: ${helper}`)
		chmodSync(helper, 0o755)
		assertNativeBinaryArchitecture(path.join(nativeDirectory, "pty.node"), { platform, arch })
		assertNativeBinaryArchitecture(helper, { platform, arch })
		restored.push(helper)
	}
	return restored
}

export function verifyNodePtyNativesRecursively({
	root,
	platform = process.platform,
	arch = process.arch,
} = {}) {
	const results = []
	for (const { packageRoot, version } of discoverNodePtyPackages(root)) {
		const nativeDirectory = resolveNodePtyNativeDirectory(packageRoot, { platform, arch })
		if (!nativeDirectory)
			throw new Error(`node-pty pty.node is missing for ${platform}/${arch}: ${packageRoot}`)
		const pty = path.join(nativeDirectory, "pty.node")
		if (platform !== "win32") {
			const helper = path.join(nativeDirectory, "spawn-helper")
			if (!existsSync(helper))
				throw new Error(
					`node-pty spawn-helper is missing for ${platform}/${arch}: ${helper}`,
				)
			if ((statSync(helper).mode & 0o111) === 0)
				throw new Error(`node-pty spawn-helper is not executable: ${helper}`)
			assertNativeBinaryArchitecture(pty, { platform, arch })
			assertNativeBinaryArchitecture(helper, { platform, arch })
			results.push({ packageRoot, version, nativeDirectory, files: [pty, helper] })
			continue
		}
		const beta = version.includes("1.2.0-beta")
		const primary = beta ? "conpty.node" : "pty.node"
		const required = beta
			? [
					"conpty_console_list.node",
					path.join("conpty", "conpty.dll"),
					path.join("conpty", "OpenConsole.exe"),
			  ]
			: [
					"conpty.node",
					"winpty-agent.exe",
					path.join("conpty", "conpty.dll"),
					path.join("conpty", "OpenConsole.exe"),
			  ]
		const files = [
			path.join(nativeDirectory, primary),
			...required.map((relative) => path.join(nativeDirectory, relative)),
		]
		for (const file of files)
			if (!existsSync(file))
				throw new Error(`node-pty ${version} asset is missing for win32/${arch}: ${file}`)
		for (const file of files) assertNativeBinaryArchitecture(file, { platform, arch })
		results.push({ packageRoot, version, nativeDirectory, files })
	}
	return results
}

/**
 * node-pty can load its Windows native modules from build/Release,
 * build/Debug, or prebuilds/win32-<arch>. The ConPTY companion binaries live
 * beside whichever conpty.node is selected. A sibling workspace can retain a
 * valid JS install while those architecture-specific files are missing, so
 * repair the native files explicitly before the runtime is staged.
 */
function resolveNodePtyWorkspaceRoot(packageRoot, fallbackRoot) {
	let current = packageRoot
	while (true) {
		if (existsSync(path.join(current, "pnpm-lock.yaml"))) return current
		const parent = path.dirname(current)
		if (parent === current) return fallbackRoot
		current = parent
	}
}

const NODE_PTY_REBUILD_LOCK_STALE_MS = 30 * 60 * 1000
const NODE_PTY_REBUILD_LOCK_TIMEOUT_MS = 35 * 60 * 1000

/**
function withWindowsNodePtyRebuildLock(workspaceRoot, arch, task) {
	const lockDirectory = path.join(workspaceRoot, ".cache", "cocode")
	const lockPath = path.join(lockDirectory, `node-pty-win32-${arch}.lock`)
	mkdirSync(lockDirectory, { recursive: true })
	const startedAt = Date.now()
	while (true) {
		try {
			mkdirSync(lockPath)
			break
		} catch (error) {
			if (error?.code !== "EEXIST") throw error
			if (isStaleNodePtyRebuildLock(lockPath)) {
				rmSync(lockPath, { recursive: true, force: true })
				continue
			}
			if (Date.now() - startedAt >= NODE_PTY_REBUILD_LOCK_TIMEOUT_MS)
				throw new Error(`Timed out waiting for the Windows node-pty rebuild lock: ${lockPath}`)
			sleepSync(250)
		}
	}
	try {
		return task()
	} finally {
		rmSync(lockPath, { recursive: true, force: true })
	}
}
 * @param {{
 *   root: string,
 *   packageRoot?: string,
 *   version?: string,
 *   platform?: NodeJS.Platform,
 *   arch?: NodeJS.Architecture,
 *   force?: boolean,
 *   run?: RunCommand,
 * }} [options]
 */
export function ensureWindowsNodePtyNatives({
	root,
	packageRoot = path.join(root, "node_modules", "node-pty"),
	version,
	platform = process.platform,
	arch = process.arch,
	force = false,
	run = execFileSync,
} = {}) {
	if (platform !== "win32") return false
	const packageVersion = version ?? readNodePtyVersion(packageRoot)
	if (!force && resolveWindowsNodePtyMissing(packageRoot, arch, packageVersion).length === 0)
		return false

	console.log(`[workspace-deps] rebuilding node-pty natives for win32/${arch}`)
	const workspaceRoot = resolveNodePtyWorkspaceRoot(packageRoot, root)
	run(
		process.platform === "win32" ? "corepack.cmd" : "corepack",
		["pnpm@10.34.5", "rebuild", "node-pty"],
		{
			...shellCommandOptions({ cwd: workspaceRoot, stdio: "inherit" }),
			env: { ...process.env, npm_config_arch: arch, DSH_NODE_PTY_PACKAGE_ROOT: packageRoot },
		},
	)

	// pnpm rebuild can rebuild the native addon without replaying node-pty's
	// postinstall hook. That hook copies the ConPTY companion binaries beside
	// conpty.node, so run it explicitly when the package provides it.
	const postInstall = path.join(packageRoot, "scripts", "post-install.js")
	if (existsSync(postInstall)) {
		run(process.execPath, [postInstall], {
			...shellCommandOptions({ cwd: packageRoot, stdio: "inherit" }),
			env: { ...process.env, npm_config_arch: arch, DSH_NODE_PTY_PACKAGE_ROOT: packageRoot },
		})
	}

	const missing = resolveWindowsNodePtyMissing(packageRoot, arch, packageVersion)
	if (missing.length > 0) {
		throw new Error(
			[
				`node-pty Windows native files are missing after rebuild for win32/${arch}.`,
				"Run the pinned pnpm rebuild in the host-supervisor workspace and ensure node-pty build scripts are allowed:",
				`  corepack pnpm@10.34.5 --dir ${workspaceRoot} rebuild node-pty`,
				...missing.map((file) => `  missing: ${file}`),
			].join("\n"),
		)
	}
	return true
}

/**
 * @param {{
 *   root: string,
 *   packageRoot?: string,
 *   platform?: NodeJS.Platform,
 *   arch?: NodeJS.Architecture,
 *   force?: boolean,
 *   skipHelperRebuild?: boolean,
 *   run?: RunCommand,
 * }} [options]
 */
export function ensureLinuxNodePtyNatives({
	root,
	packageRoot = path.join(root, "node_modules", "node-pty"),
	platform = process.platform,
	arch = process.arch,
	force = false,
	skipHelperRebuild = false,
	run = execFileSync,
} = {}) {
	if (platform !== "linux") return false
	const nativeDirectory = resolveNodePtyNativeDirectory(packageRoot, { platform: "linux", arch })
	if (!force && nativeDirectory && skipHelperRebuild) return false
	if (!force && !resolveLinuxNodePtyMissing(packageRoot, arch).length) return false

	console.log(`[workspace-deps] rebuilding node-pty natives for linux/${arch}`)
	run(
		process.platform === "win32" ? "corepack.cmd" : "corepack",
		["pnpm@10.34.5", "rebuild", "node-pty"],
		{
			...shellCommandOptions({ cwd: root, stdio: "inherit" }),
			env: { ...process.env, npm_config_arch: arch, DSH_NODE_PTY_PACKAGE_ROOT: packageRoot },
		},
	)
	const rebuiltNativeDirectory = resolveNodePtyNativeDirectory(packageRoot, {
		platform: "linux",
		arch,
	})
	if (rebuiltNativeDirectory)
		compileUnixNodePtySpawnHelper(packageRoot, rebuiltNativeDirectory, { run })

	const missing = resolveLinuxNodePtyMissing(packageRoot, arch)
	if (missing.length > 0) {
		throw new Error(
			[
				`node-pty Linux native files are missing after rebuild for linux/${arch}.`,
				"Run the pinned pnpm rebuild in the host-supervisor workspace with build scripts enabled:",
				`  corepack pnpm@10.34.5 --dir ${root} rebuild node-pty`,
				...missing.map((file) => `  missing: ${file}`),
			].join("\n"),
		)
	}
	return true
}

/**
 * macOS node-pty can retain a native build from a previous arm64/x64 install
 * even when the target prebuild for the current architecture is present. The
 * loader checks build/Release before prebuilds, so always remove that output
 * before rebuilding the target package during a native release.
 */
/**
 * @param {{
 *   root: string,
 *   packageRoot?: string,
 *   platform?: NodeJS.Platform,
 *   arch?: NodeJS.Architecture,
 *   force?: boolean,
 *   skipHelperRebuild?: boolean,
 *   run?: RunCommand,
 * }} [options]
 */
export function ensureDarwinNodePtyNatives({
	root,
	packageRoot = path.join(root, "node_modules", "node-pty"),
	platform = process.platform,
	arch = process.arch,
	force = false,
	skipHelperRebuild = false,
	run = execFileSync,
} = {}) {
	if (platform !== "darwin") return false
	const buildRoot = path.join(packageRoot, "build")
	const nativeDirectory = resolveNodePtyNativeDirectory(packageRoot, { platform: "darwin", arch })
	if (!force && nativeDirectory && skipHelperRebuild) return false
	if (!force && nativeDirectory && resolveDarwinNodePtyMissing(packageRoot, arch).length === 0)
		return false
	if (!force && !existsSync(buildRoot) && !nativeDirectory) return false

	rmSync(buildRoot, { recursive: true, force: true })
	console.log(`[workspace-deps] rebuilding node-pty natives for darwin/${arch}`)
	run(
		process.platform === "win32" ? "corepack.cmd" : "corepack",
		["pnpm@10.34.5", "rebuild", "node-pty"],
		{
			...shellCommandOptions({ cwd: root, stdio: "inherit" }),
			env: {
				...process.env,
				npm_config_arch: arch,
				npm_config_platform: "darwin",
				DSH_NODE_PTY_PACKAGE_ROOT: packageRoot,
			},
		},
	)

	const missing = resolveDarwinNodePtyMissing(packageRoot, arch)
	if (missing.length > 0) {
		throw new Error(
			[
				`node-pty macOS native files are missing after rebuild for darwin/${arch}.`,
				"Run the pinned pnpm rebuild in the GUI workspace and ensure node-pty build scripts are allowed:",
				`  corepack pnpm@10.34.5 --dir ${root} rebuild node-pty`,
				...missing.map((file) => `  missing: ${file}`),
			].join("\n"),
		)
	}
	return true
}

export function verifyDarwinNodePtyArchitecture({
	root,
	platform = process.platform,
	arch = process.arch,
	architectures = (file) =>
		execFileSync("lipo", ["-archs", file], { encoding: "utf8" }).trim().split(/\s+/),
} = {}) {
	if (platform !== "darwin") return false
	const packageRoot = path.join(root, "node_modules", "node-pty")
	const nativeDirectory = resolveDarwinNodePtyDirectory(packageRoot, arch)
	if (!nativeDirectory) {
		throw new Error(
			`node-pty native files are missing for darwin/${arch} under ${packageRoot}.`,
		)
	}
	const expectedArchitecture = arch === "x64" ? "x86_64" : arch
	for (const name of ["pty.node", "spawn-helper"]) {
		const file = path.join(nativeDirectory, name)
		if (!existsSync(file))
			throw new Error(`node-pty ${name} is missing for darwin/${arch}: ${file}`)
		if (!architectures(file).includes(expectedArchitecture)) {
			throw new Error(`node-pty ${name} architecture mismatch for darwin/${arch}: ${file}`)
		}
	}
	return true
}

/**
 * @param {string} packageRoot
 * @param {string} nativeDirectory
 * @param {{ run: RunCommand }} options
 */
function compileUnixNodePtySpawnHelper(packageRoot, nativeDirectory, { run }) {
	const source = path.join(packageRoot, "src", "unix", "spawn-helper.cc")
	const output = path.join(nativeDirectory, "spawn-helper")
	if (!existsSync(source) || existsSync(output)) return

	console.log(`[workspace-deps] compiling node-pty spawn-helper in ${nativeDirectory}`)
	run(process.env.CXX || "c++", ["-O2", "-std=c++17", source, "-o", output], {
		...shellCommandOptions({ cwd: packageRoot, stdio: "inherit" }),
	})
	chmodSync(output, 0o755)
}

export function pruneIncompatibleNativePackages(
	root,
	{ platform = process.platform, arch = process.arch } = {},
) {
	const incompatible = findIncompatibleNativePackages(root, { platform, arch })
	for (const packageRoot of incompatible) rmSync(packageRoot, { recursive: true, force: true })
	let changed = incompatible.length > 0
	changed =
		pruneNativePrebuildFiles(path.join(root, "node_modules"), { platform, arch }) || changed
	changed =
		pruneIncompatibleNativeFiles(path.join(root, "node_modules"), { platform, arch }) || changed
	changed = pruneNativePrebuildDirectories(root, { platform, arch }) || changed
	return changed
}

export function findIncompatibleNativePackages(
	root,
	{ platform = process.platform, arch = process.arch } = {},
) {
	const incompatible = []
	collectIncompatiblePackages(path.join(root, "node_modules"), { platform, arch }, incompatible)
	return incompatible
}

function collectIncompatiblePackages(root, target, incompatible) {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) return
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const packageRoot = path.join(root, entry.name)
		if (entry.name.startsWith("@")) {
			collectIncompatiblePackages(packageRoot, target, incompatible)
			continue
		}
		const manifestPath = path.join(packageRoot, "package.json")
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
			if (isIncompatibleNativePackage(manifest, entry.name, target)) {
				incompatible.push(packageRoot)
				continue
			}
		}
		collectIncompatiblePackages(path.join(packageRoot, "node_modules"), target, incompatible)
	}
}

function isIncompatibleNativePackage(manifest, directoryName, { platform, arch }) {
	const packageName = typeof manifest.name === "string" ? manifest.name : directoryName
	const platformMarker = nativePlatformMarker(packageName)
	if (platformMarker && platformMarker.platform !== platform) return true
	if (platformMarker && platformMarker.arch && platformMarker.arch !== arch) return true
	return !matchesConstraint(manifest.os, platform) || !matchesConstraint(manifest.cpu, arch)
}

export function isPackageCompatible(
	manifest,
	{ platform = process.platform, arch = process.arch } = {},
) {
	return !isIncompatibleNativePackage(manifest, manifest?.name ?? "", { platform, arch })
}

function nativePlatformMarker(name) {
	const match = /(?:^|[-_])(darwin|win32|linuxmusl|linux)-(x64|arm64|ia32)(?:[-_.]|$)/i.exec(name)
	if (!match) return undefined
	return { platform: match[1].toLowerCase(), arch: match[2].toLowerCase() }
}

function matchesConstraint(constraint, value) {
	if (constraint === undefined) return true
	const values = Array.isArray(constraint) ? constraint : [constraint]
	const normalized = values.map((entry) => String(entry).toLowerCase())
	if (normalized.includes(`!${value}`)) return false
	const positive = normalized.filter((entry) => !entry.startsWith("!"))
	return positive.length === 0 || positive.includes(value)
}

function pruneNativePrebuildFiles(root, target) {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) return false
	let changed = false
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const directory = path.join(root, entry.name)
		if (entry.name === "prebuilds") {
			changed = prunePrebuildDirectory(directory, target) || changed
			continue
		}
		changed = pruneNativePrebuildFiles(directory, target) || changed
	}
	return changed
}

function prunePrebuildDirectory(root, { platform, arch }) {
	const expected = `${platform}-${arch}`
	let changed = false
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const marker = nativePlatformMarker(entry.name)
		if (marker && `${marker.platform}-${marker.arch}` !== expected) {
			rmSync(path.join(root, entry.name), { recursive: true, force: true })
			changed = true
			continue
		}
		if (entry.isDirectory())
			changed =
				pruneNativePrebuildFiles(path.join(root, entry.name), { platform, arch }) || changed
	}
	return changed
}

function pruneIncompatibleNativeFiles(root, target) {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) return false
	let changed = false
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const file = path.join(root, entry.name)
		if (entry.isDirectory()) {
			changed = pruneIncompatibleNativeFiles(file, target) || changed
			continue
		}
		if (!/\.(?:node|dll|dylib|so|exe)$/i.test(entry.name)) continue
		const marker = nativeFileMarker(entry.name)
		if (!marker || isNativeFileCompatible(marker, target)) continue
		rmSync(file, { force: true })
		changed = true
	}
	return changed
}

function nativeFileMarker(name) {
	const match =
		/(?:^|[._-])(darwin|win32|linuxmusl|linux|freebsd)-(universal|x64|arm64|ia32|arm|ppc64|riscv64|s390x|loong64|wasm32)(?:[._-]|$)/i.exec(
			name,
		)
	if (!match) return undefined
	return { platform: match[1].toLowerCase(), arch: match[2].toLowerCase() }
}

function isNativeFileCompatible(marker, { platform, arch }) {
	if (marker.platform !== platform) return false
	return marker.arch === "universal" || marker.arch === arch
}

export function pruneNativePrebuildDirectories(
	root,
	{ platform = process.platform, arch = process.arch } = {},
) {
	if (platform !== "win32" && platform !== "darwin" && platform !== "linux") return false
	const packageRoots = new Set([
		path.join(root, "node_modules", "node-pty"),
		...discoverNodePtyPackages(root).map(({ packageRoot }) => packageRoot),
	])
	let changed = false
	for (const packageRoot of packageRoots) {
		if (!existsSync(packageRoot)) continue
		changed =
			pruneTargetDirectories(path.join(packageRoot, "prebuilds"), `${platform}-${arch}`) ||
			changed
		if (platform === "darwin")
			changed = pruneNodePtyAbiDirectories(path.join(packageRoot, "bin"), arch) || changed
		changed =
			(platform === "win32"
				? pruneTargetDirectories(
						path.join(packageRoot, "third_party", "conpty"),
						`win10-${arch}`,
				  )
				: removeDirectory(path.join(packageRoot, "third_party", "conpty"))) || changed
	}
	return changed
}

function pruneNodePtyAbiDirectories(root, arch) {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) return false
	let changed = false
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const match = /^darwin-(x64|arm64)-\d+$/i.exec(entry.name)
		if (!match || match[1].toLowerCase() === arch) continue
		rmSync(path.join(root, entry.name), { recursive: true, force: true })
		changed = true
	}
	return changed
}

function removeDirectory(directory) {
	if (!existsSync(directory)) return false
	rmSync(directory, { recursive: true, force: true })
	return true
}

function pruneTargetDirectories(root, expected) {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) return false
	let changed = false
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || (expected && entry.name === expected)) continue
		rmSync(path.join(root, entry.name), { recursive: true, force: true })
		changed = true
	}
	return changed
}

function resolveWindowsNodePtyMissing(
	packageRoot,
	arch,
	version = readNodePtyVersion(packageRoot),
) {
	const searchDirectories = [
		path.join(packageRoot, "build", "Release"),
		path.join(packageRoot, "build", "Debug"),
		path.join(packageRoot, "prebuilds", `win32-${arch}`),
	]
	const resolveDirectory = (name) =>
		searchDirectories.find((directory) => existsSync(path.join(directory, name)))
	const missing = []
	const beta = String(version).includes("1.2.0-beta")
	const primary = beta ? "conpty.node" : "pty.node"
	const ptyDirectory = resolveDirectory(primary)
	if (!ptyDirectory) {
		missing.push(`${primary} (searched: ${searchDirectories.join(", ")})`)
	} else {
		const companion = beta ? "conpty_console_list.node" : "winpty-agent.exe"
		if (!existsSync(path.join(ptyDirectory, companion)))
			missing.push(path.join(ptyDirectory, companion))
	}
	const conptyDirectory = resolveDirectory("conpty.node")
	if (!conptyDirectory) {
		missing.push(`conpty.node (searched: ${searchDirectories.join(", ")})`)
	} else {
		for (const companion of ["conpty.dll", "OpenConsole.exe"]) {
			const file = path.join(conptyDirectory, "conpty", companion)
			if (!existsSync(file)) missing.push(file)
		}
	}
	return missing
}

function readNodePtyVersion(packageRoot) {
	try {
		return JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version
	} catch {
		return "unknown"
	}
}

function resolveLinuxNodePtyMissing(packageRoot, arch) {
	const searchDirectories = [
		path.join(packageRoot, "build", "Release"),
		path.join(packageRoot, "build", "Debug"),
		path.join(packageRoot, "prebuilds", `linux-${arch}`),
	]
	const resolveDirectory = (name) =>
		searchDirectories.find((directory) => existsSync(path.join(directory, name)))
	const missing = []
	const ptyDirectory = resolveDirectory("pty.node")
	if (!ptyDirectory) {
		missing.push(`pty.node (searched: ${searchDirectories.join(", ")})`)
	} else if (!existsSync(path.join(ptyDirectory, "spawn-helper"))) {
		missing.push(path.join(ptyDirectory, "spawn-helper"))
	}
	return missing
}

function resolveDarwinNodePtyMissing(packageRoot, arch) {
	const searchDirectories = [
		path.join(packageRoot, "build", "Release"),
		path.join(packageRoot, "build", "Debug"),
		path.join(packageRoot, "prebuilds", `darwin-${arch}`),
	]
	const resolveDirectory = (name) =>
		searchDirectories.find((directory) => existsSync(path.join(directory, name)))
	const missing = []
	const ptyDirectory = resolveDirectory("pty.node")
	if (!ptyDirectory) missing.push(`pty.node (searched: ${searchDirectories.join(", ")})`)
	const spawnHelperDirectory = resolveDirectory("spawn-helper")
	if (!spawnHelperDirectory)
		missing.push(`spawn-helper (searched: ${searchDirectories.join(", ")})`)
	return missing
}

function resolveDarwinNodePtyDirectory(packageRoot, arch) {
	const searchDirectories = [
		path.join(packageRoot, "build", "Release"),
		path.join(packageRoot, "build", "Debug"),
		path.join(packageRoot, "prebuilds", `darwin-${arch}`),
	]
	return searchDirectories.find(
		(directory) =>
			existsSync(path.join(directory, "pty.node")) &&
			existsSync(path.join(directory, "spawn-helper")),
	)
}
