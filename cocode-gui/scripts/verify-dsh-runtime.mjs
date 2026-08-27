import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import * as path from "pathe"
import { fileURLToPath } from "node:url"
import { resolveRuntimeDependencyClosure } from "../../cocode-host-supervisor/packages/host-supervisor/lib/runtime-closure.mjs"
import { hashDirectory, hashJson } from "./runtime-build-helpers.mjs"
import {
	findIncompatibleNativePackages,
	isPackageCompatible,
	verifyNodePtyNativesRecursively,
} from "./lib/workspace-dependencies.mjs"
import { collectRuntimeNativeInventory } from "./lib/native-binary-inspection.mjs"
import { resolveNativeRuntimeMatrix } from "./lib/native-runtime-matrix.mjs"

export function verifyRuntime(
	runtimeRoot,
	{ expectedInputFingerprint = undefined, platform = process.platform, arch = process.arch } = {},
) {
	const root = path.resolve(runtimeRoot)
	const manifestPath = path.join(root, "runtime-manifest.json")
	if (!existsSync(manifestPath)) throw new Error(`Runtime manifest is missing: ${manifestPath}`)
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
	if (manifest.schemaVersion !== 2)
		throw new Error(`Unsupported runtime manifest schema: ${manifest.schemaVersion}`)
	if (manifest.platform !== platform || manifest.arch !== arch)
		throw new Error(
			`Runtime platform mismatch: expected ${platform}/${arch}, got ${manifest.platform}/${manifest.arch}.`,
		)
	if (expectedInputFingerprint && manifest.inputFingerprint !== expectedInputFingerprint)
		throw new Error("Staged runtime inputs are stale.")
	const withoutManifest = hashDirectory(root, {
		ignore: (relative) => relative === "runtime-manifest.json",
	})
	if (withoutManifest !== manifest.runtimeContentHash)
		throw new Error("Runtime content hash does not match runtime-manifest.json.")
	const unsigned = { ...manifest }
	delete unsigned.fingerprint
	if (hashJson(unsigned) !== manifest.fingerprint)
		throw new Error("Runtime manifest fingerprint is invalid.")
	assertFile(path.join(root, manifest.supervisor.entry), "Supervisor entry")
	const supervisorPackage = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
	if (supervisorPackage.name !== "@cocode-agency/host-supervisor")
		throw new Error("Staged supervisor package name is invalid.")
	if (String(supervisorPackage.version) !== String(manifest.supervisor.version))
		throw new Error("Supervisor version mismatch.")
	if (
		hashDirectory(path.join(root, "packages", "host-supervisor")) !==
		manifest.supervisor.contentHash
	)
		throw new Error("Supervisor content hash mismatch.")
	for (const plugin of manifest.plugins) {
		const pluginRoot = path.join(root, "runtime", "plugins", ...String(plugin.name).split("/"))
		const pluginPackage = JSON.parse(
			readFileSync(path.join(pluginRoot, "package.json"), "utf8"),
		)
		if (
			pluginPackage.name !== plugin.name ||
			String(pluginPackage.version) !== String(plugin.version)
		)
			throw new Error(`Plugin manifest mismatch: ${plugin.name}`)
		assertFile(path.join(pluginRoot, "lib", "index.js"), `${plugin.name} server entry`)
		if (pluginPackage.dsh?.client?.platform === "web")
			assertFile(path.join(pluginRoot, "lib", "client.js"), `${plugin.name} client entry`)
		if (hashDirectory(pluginRoot) !== plugin.contentHash)
			throw new Error(`Plugin content hash mismatch: ${plugin.name}`)
	}
	const dshRoot = path.join(root, "node_modules", "@deepseek-ai", "dsh")
	const dshPackage = JSON.parse(readFileSync(path.join(dshRoot, "package.json"), "utf8"))
	if (
		dshPackage.name !== "@deepseek-ai/dsh" ||
		String(dshPackage.version) !== String(manifest.dsh.version)
	)
		throw new Error("DSH manifest mismatch.")
	assertFile(path.join(root, manifest.dsh.entry), "DSH entry")
	if (hashDirectory(dshRoot) !== manifest.dsh.contentHash)
		throw new Error("DSH content hash mismatch.")
	if (hashDirectory(path.join(root, "node_modules")) !== manifest.dependencyClosureHash)
		throw new Error("Dependency closure hash mismatch.")
	verifyDependencyRecords(root, manifest.dependencyRecords)
	if (manifest.dependencyRecordsHash !== hashJson(manifest.dependencyRecords))
		throw new Error("Runtime dependency record hash does not match runtime-manifest.json.")
	const recomputedDependencyRecords = recomputeRuntimeDependencyRecords(root)
	if (
		JSON.stringify(sortDependencyRecords(recomputedDependencyRecords)) !==
		JSON.stringify(sortDependencyRecords(manifest.dependencyRecords))
	)
		throw new Error("Runtime dependency closure does not match runtime-manifest.json.")
	verifyNoSymlinks(root)
	const incompatibleNativePackages = findIncompatibleNativePackages(root, { platform, arch })
	if (incompatibleNativePackages.length > 0)
		throw new Error(
			`Staged runtime contains incompatible native packages for ${platform}/${arch}: ${incompatibleNativePackages.join(
				", ",
			)}`,
		)
	verifyRequiredWindowsNativePackages(root, { platform, arch })
	verifyNativeRuntimeMatrix(root, { platform, arch })
	verifyNodePtyNatives(root, platform, arch)
	const nativeInventory = collectRuntimeNativeInventory(root, { platform, arch })
	if (JSON.stringify(nativeInventory) !== JSON.stringify(manifest.nativeInventory))
		throw new Error("Runtime native inventory does not match runtime-manifest.json.")
	return manifest
}

export function verifyRequiredWindowsNativePackages(
	root,
	{ platform = process.platform, arch = process.arch } = {},
) {
	if (platform !== "win32") return
	const requirements = [
		{
			base: "koffi",
			target: `@koromix/koffi-${platform}-${arch}`,
			extensions: [".node"],
		},
		{
			base: "node-addon-require-builtin",
			target: `node-addon-require-builtin-${platform}-${arch}-msvc`,
			extensions: [".node"],
		},
		{
			base: "@vscode/ripgrep",
			target: `@vscode/ripgrep-${platform}-${arch}`,
			relativeFiles: ["bin/rg.exe"],
		},
	]
	for (const requirement of requirements) {
		if (findPackageRoots(root, requirement.base).length === 0) continue
		const targetRoots = findPackageRoots(root, requirement.target)
		if (targetRoots.length === 0)
			throw new Error(
				`Required Windows native package is missing for ${platform}/${arch}: ${requirement.target}`,
			)
		for (const targetRoot of targetRoots) {
			const manifest = JSON.parse(readFileSync(path.join(targetRoot, "package.json"), "utf8"))
			if (!isPackageCompatible(manifest, { platform, arch }))
				throw new Error(
					`Required Windows native package is incompatible with ${platform}/${arch}: ${requirement.target}`,
				)
			for (const relativeFile of requirement.relativeFiles ?? []) {
				const file = path.join(targetRoot, relativeFile)
				assertFile(file, `${requirement.target}/${relativeFile}`)
				assertPeArchitecture(file, arch)
			}
			if (requirement.extensions) {
				const nativeFiles = listPaths(targetRoot).filter((relative) =>
					requirement.extensions.some((extension) =>
						relative.toLowerCase().endsWith(extension),
					),
				)
				if (nativeFiles.length === 0)
					throw new Error(
						`Required Windows native package has no native binary for ${platform}/${arch}: ${requirement.target}`,
					)
				for (const relativeFile of nativeFiles)
					assertPeArchitecture(path.join(targetRoot, relativeFile), arch)
			}
		}
	}
}

/**
 * Verify platform package selections described by the native runtime matrix.
 *
 * Platform packages are conditional dependencies. A missing target is only a
 * failure when its portable/base package is present in the staged runtime;
 * this keeps minimal fixtures and runtimes that do not use a capability
 * valid, while still failing closed when a capability's target was pruned.
 */
export function verifyNativeRuntimeMatrix(
	root,
	{ platform = process.platform, arch = process.arch } = {},
) {
	const entries = resolveNativeRuntimeMatrix({ platform, arch })
	for (const entry of entries) {
		if (entry.scope !== "dsh-runtime") continue
		if (entry.packageName === "node-pty") {
			if (findPackageRoots(root, entry.packageName).length === 0)
				throw new Error(
					`Required native runtime package is missing for ${platform}/${arch}: ${entry.packageName}`,
				)
			continue
		}
		const trigger = matrixTriggerPackage(entry)
		if (trigger && findPackageRoots(root, trigger).length === 0) continue
		if (entry.packageName === "sharp" || entry.packageName === "koffi") continue
		if (entry.packageName === "node-addon-require-builtin") continue
		if (entry.packageName === "@vscode/ripgrep") continue
		if (entry.packageName === "@deepseek-ai/node-addon-landlock-run") continue
		const targetRoots = findPackageRoots(root, entry.packageName)
		if (targetRoots.length === 0)
			throw new Error(
				`Required native runtime package is missing for ${platform}/${arch}: ${entry.packageName}`,
			)
		for (const targetRoot of targetRoots) {
			const manifestPath = path.join(targetRoot, "package.json")
			const packageManifest = JSON.parse(readFileSync(manifestPath, "utf8"))
			if (!isPackageCompatible(packageManifest, { platform, arch }))
				throw new Error(
					`Required native runtime package is incompatible with ${platform}/${arch}: ${entry.packageName}`,
				)
			const expectedFiles = matrixExpectedFiles(entry, targetRoot)
			for (const relativeFile of expectedFiles) {
				const file = path.join(targetRoot, relativeFile)
				assertFile(file, `${entry.packageName}/${relativeFile}`)
			}
		}
	}
}

function matrixTriggerPackage(entry) {
	if (entry.packageName.startsWith("@img/sharp-")) return "sharp"
	if (entry.packageName.startsWith("@koromix/koffi-")) return "koffi"
	if (entry.packageName.startsWith("node-addon-require-builtin-"))
		return "node-addon-require-builtin"
	if (entry.packageName.startsWith("@vscode/ripgrep-")) return "@vscode/ripgrep"
	if (entry.packageName.startsWith("@deepseek-ai/node-addon-landlock-run-linux-"))
		return "@deepseek-ai/node-addon-landlock-run"
	return undefined
}

function matrixExpectedFiles(entry, packageRoot) {
	if (entry.role === "ripgrep-native")
		return [path.join("bin", entry.platform === "win32" ? "rg.exe" : "rg")]
	if (entry.role === "landlock-native") return [path.join("bin", "landlock-run")]
	if (entry.role === "sharp-libvips") {
		const nativeFiles = listPaths(packageRoot).filter(
			(relative) =>
				/libvips/i.test(path.basename(relative)) &&
				/\.(?:so|dylib|dll)(?:\.\d+)*$/i.test(relative),
		)
		if (nativeFiles.length === 0)
			throw new Error(`Native runtime package has no libvips binary: ${entry.packageName}`)
		return nativeFiles
	}
	if (
		entry.role === "sharp-addon" ||
		entry.role === "koffi-native" ||
		entry.role === "node-addon-require-builtin-native"
	) {
		const nativeFiles = listPaths(packageRoot).filter((relative) => /\.node$/i.test(relative))
		if (nativeFiles.length === 0)
			throw new Error(`Native runtime package has no .node binary: ${entry.packageName}`)
		return nativeFiles
	}
	return []
}

function verifyNoSymlinks(root) {
	for (const relative of listPaths(root))
		if (lstatSync(path.join(root, relative)).isSymbolicLink())
			throw new Error(`Staged runtime contains a symlink: ${relative}`)
}

function verifyNodePtyNatives(root, platform, arch) {
	return verifyNodePtyNativesRecursively({ root, platform, arch })
}

/**
 * @typedef {{
 *   destination: string,
 *   name: string,
 *   version: string,
 *   requestedName: string,
 *   lineage: string[],
 * }} RuntimeDependencyRecord
 */

/**
 * @param {string} root
 * @returns {RuntimeDependencyRecord[]}
 */
export function recomputeRuntimeDependencyRecords(root) {
	const supervisorRoot = realpathSync(path.resolve(root))
	const pluginRoot = path.join(supervisorRoot, "runtime", "plugins")
	const roots = [
		{ root: supervisorRoot, destinationSegments: [], copy: false },
		...readDirectoryEntries(pluginRoot)
			.filter((directory) => existsSync(path.join(directory, "package.json")))
			.map((directory) => {
				const manifest = JSON.parse(
					readFileSync(path.join(directory, "package.json"), "utf8"),
				)
				return {
					root: directory,
					destinationSegments: String(manifest.name).split("/"),
					copy: true,
				}
			}),
	]
	const records = resolveRuntimeDependencyClosure({
		roots,
		fallbackRoot: supervisorRoot,
		allowedRoot: supervisorRoot,
	})
	for (const record of records) {
		if (!isPathWithin(supervisorRoot, record.root))
			throw new Error(
				`Runtime dependency resolution escaped staged root: ${record.name}@${record.version} at ${record.root}`,
			)
	}
	return records
		.filter((record) => record.copy)
		.map((record) => ({
			destination: path.join("node_modules", ...record.destinationSegments),
			name: record.name,
			version: record.version,
			requestedName: record.requestedName,
			lineage: record.lineage,
		}))
		.sort(compareDependencyRecords)
}

export function verifyDependencyRecords(root, records) {
	if (!Array.isArray(records) || records.length === 0)
		throw new Error("Runtime dependency records are missing.")
	const seen = new Set()
	for (const record of records) {
		if (
			!record ||
			typeof record.destination !== "string" ||
			path.isAbsolute(record.destination) ||
			record.destination.split(/[\\/]+/).includes("..")
		)
			throw new Error("Runtime dependency record has an invalid destination.")
		if (seen.has(record.destination))
			throw new Error(`Runtime dependency destination is duplicated: ${record.destination}`)
		seen.add(record.destination)
		const manifestPath = path.join(root, record.destination, "package.json")
		assertFile(manifestPath, `Runtime dependency ${record.name ?? "unknown"}`)
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		if (manifest.name !== record.name || String(manifest.version) !== String(record.version))
			throw new Error(`Runtime dependency record mismatch: ${record.destination}`)
		if (!Array.isArray(record.lineage) || record.lineage.length === 0)
			throw new Error(`Runtime dependency lineage is missing: ${record.destination}`)
	}
}

function sortDependencyRecords(records) {
	return [...records].sort(compareDependencyRecords)
}

function compareDependencyRecords(left, right) {
	return `${left.destination}\0${left.name}\0${left.version}`.localeCompare(
		`${right.destination}\0${right.name}\0${right.version}`,
	)
}

function isPathWithin(root, candidate) {
	const relative = path.relative(path.resolve(root), path.resolve(candidate))
	return (
		relative === "" ||
		(!relative.startsWith("../") && relative !== ".." && !path.isAbsolute(relative))
	)
}

function readDirectoryEntries(directory) {
	if (!existsSync(directory)) return []
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(directory, entry.name))
}

function listPaths(root, prefix = "") {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const relative = path.join(prefix, entry.name)
		const absolute = path.join(root, entry.name)
		return entry.isDirectory() ? listPaths(absolute, relative) : [relative]
	})
}

function findPackageRoots(root, name, current = path.join(root, "node_modules"), result = []) {
	if (!existsSync(current) || !statSync(current).isDirectory()) return result
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue
		const packageRoot = path.join(current, entry.name)
		if (entry.name.startsWith("@")) {
			findPackageRoots(root, name, packageRoot, result)
			continue
		}
		const manifestPath = path.join(packageRoot, "package.json")
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
			if (manifest.name === name) result.push(packageRoot)
		}
		findPackageRoots(root, name, path.join(packageRoot, "node_modules"), result)
	}
	return result
}

function assertFile(file, label) {
	if (!existsSync(file) || !statSync(file).isFile())
		throw new Error(`${label} is missing: ${file}`)
}

function assertPeArchitecture(file, arch) {
	const bytes = readFileSync(file)
	if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d)
		throw new Error(`Native runtime file is not a Windows PE image: ${file}`)
	const peOffset = bytes.readUInt32LE(0x3c)
	if (peOffset + 6 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0")
		throw new Error(`Native runtime file has no PE header: ${file}`)
	const machine = bytes.readUInt16LE(peOffset + 4)
	const expected = arch === "arm64" ? 0xaa64 : 0x8664
	if (machine !== expected)
		throw new Error(`Native runtime file architecture mismatch for ${arch}: ${file}`)
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))) {
	const index = process.argv.indexOf("--runtime-root")
	if (index < 0)
		throw new Error("Usage: node scripts/verify-dsh-runtime.mjs --runtime-root <directory>")
	verifyRuntime(process.argv[index + 1])
}
