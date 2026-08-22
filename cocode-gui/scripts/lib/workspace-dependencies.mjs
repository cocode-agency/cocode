import { execFileSync } from "node:child_process"
import {
	chmodSync,
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs"
import * as path from "pathe"
import { shellCommandOptions } from "./child-process-options.mjs"

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

/**
 * node-pty can load its Windows native modules from build/Release,
 * build/Debug, or prebuilds/win32-<arch>. The ConPTY companion binaries live
 * beside whichever conpty.node is selected. A sibling workspace can retain a
 * valid JS install while those architecture-specific files are missing, so
 * repair the native files explicitly before the runtime is staged.
 */
export function ensureWindowsNodePtyNatives({
	root,
	platform = process.platform,
	arch = process.arch,
	force = false,
	run = execFileSync,
} = {}) {
	if (platform !== "win32") return false
	const packageRoot = path.join(root, "node_modules", "node-pty")
	if (!force && resolveWindowsNodePtyMissing(packageRoot, arch).length === 0) return false

	console.log(`[workspace-deps] rebuilding node-pty natives for win32/${arch}`)
	run(
		process.platform === "win32" ? "corepack.cmd" : "corepack",
		["pnpm@10.34.5", "rebuild", "node-pty"],
		{
			...shellCommandOptions({ cwd: root, stdio: "inherit" }),
			env: { ...process.env, npm_config_arch: arch },
		},
	)

	const missing = resolveWindowsNodePtyMissing(packageRoot, arch)
	if (missing.length > 0) {
		throw new Error(
			[
				`node-pty Windows native files are missing after rebuild for win32/${arch}.`,
				"Run the pinned pnpm rebuild in the host-supervisor workspace and ensure node-pty build scripts are allowed:",
				`  corepack pnpm@10.34.5 --dir ${root} rebuild node-pty`,
				...missing.map((file) => `  missing: ${file}`),
			].join("\n"),
		)
	}
	return true
}

export function ensureLinuxNodePtyNatives({
	root,
	platform = process.platform,
	arch = process.arch,
	force = false,
	run = execFileSync,
} = {}) {
	if (platform !== "linux") return false
	const packageRoot = path.join(root, "node_modules", "node-pty")
	if (!force && resolveLinuxNodePtyMissing(packageRoot, arch).length === 0) return false

	console.log(`[workspace-deps] rebuilding node-pty natives for linux/${arch}`)
	run(
		process.platform === "win32" ? "corepack.cmd" : "corepack",
		["pnpm@10.34.5", "rebuild", "node-pty"],
		{
			...shellCommandOptions({ cwd: root, stdio: "inherit" }),
			env: { ...process.env, npm_config_arch: arch },
		},
	)
	compileLinuxNodePtySpawnHelper(packageRoot, { run })

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

function compileLinuxNodePtySpawnHelper(packageRoot, { run }) {
	const source = path.join(packageRoot, "src", "unix", "spawn-helper.cc")
	const output = path.join(packageRoot, "build", "Release", "spawn-helper")
	if (!existsSync(source) || existsSync(output)) return

	console.log("[workspace-deps] compiling node-pty spawn-helper for linux")
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
	const packageRoot = path.join(root, "node_modules", "node-pty")
	if (!existsSync(packageRoot)) return false
	let changed = pruneTargetDirectories(path.join(packageRoot, "prebuilds"), `${platform}-${arch}`)
	changed =
		(platform === "win32"
			? pruneTargetDirectories(
					path.join(packageRoot, "third_party", "conpty"),
					`win10-${arch}`,
			  )
			: removeDirectory(path.join(packageRoot, "third_party", "conpty"))) || changed
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

function resolveWindowsNodePtyMissing(packageRoot, arch) {
	const searchDirectories = [
		path.join(packageRoot, "build", "Release"),
		path.join(packageRoot, "build", "Debug"),
		path.join(packageRoot, "prebuilds", `win32-${arch}`),
	]
	const resolveDirectory = (name) =>
		searchDirectories.find((directory) => existsSync(path.join(directory, name)))
	const missing = []
	const ptyDirectory = resolveDirectory("pty.node")
	if (!ptyDirectory) {
		missing.push(`pty.node (searched: ${searchDirectories.join(", ")})`)
	} else if (!existsSync(path.join(ptyDirectory, "winpty-agent.exe"))) {
		missing.push(path.join(ptyDirectory, "winpty-agent.exe"))
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
