import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "pathe"
import {
	verifyNativeRuntimeMatrix,
	verifyRequiredWindowsNativePackages,
} from "../verify-dsh-runtime.mjs"
import {
	assertNativeBinaryArchitecture,
	collectRuntimeNativeInventory,
} from "../lib/native-binary-inspection.mjs"
import { verifyNodePtyNativesRecursively } from "../lib/workspace-dependencies.mjs"

export function verifyPackagedStartupAssets(
	packageRoot,
	{ platform, arch, nodeExecutableName = platform === "win32" ? "cocode-node.exe" : "cocode-node" } = {},
) {
	const root = path.resolve(packageRoot)
	assertFile(path.join(root, "resources", nodeExecutableName), `packaged ${nodeExecutableName}`)
	assertFile(
		path.join(root, "resources", "startup-failure.html"),
		"packaged startup failure diagnostic page",
	)

	const runtimeRoot = path.join(root, "resources", "dsh-runtime")
	assertDirectory(runtimeRoot, "packaged DSH runtime")
	const manifestPath = path.join(runtimeRoot, "runtime-manifest.json")
	assertFile(manifestPath, "packaged runtime manifest")
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
	if (manifest.platform !== platform || manifest.arch !== arch) {
		throw new Error(
			`Packaged runtime architecture mismatch: expected ${platform}/${arch}, got ${manifest.platform}/${manifest.arch}.`,
		)
	}
	assertFile(
		path.join(runtimeRoot, "packages", "host-supervisor", "lib", "bin.js"),
		"packaged Host Supervisor entry",
	)
	assertFile(path.join(runtimeRoot, "package.json"), "packaged Supervisor manifest")
	const dshEntry = manifest.dsh?.entry
	if (typeof dshEntry !== "string" || dshEntry.length === 0)
		throw new Error("Packaged DSH runtime manifest is missing its Web entry.")
	assertFile(path.join(runtimeRoot, dshEntry), "packaged DSH Web entry")
	assertPackageEntry(runtimeRoot, "@deepseek-ai/dsh-host-webserver", "packaged DSH Web server")
	assertPackageEntry(
		runtimeRoot,
		"@deepseek-ai/dsh-host-frontend-static",
		"packaged DSH Web frontend",
	)

	const appRoot = resolvePackagedAppRoot(root)
	const betterSqliteRoot = path.join(appRoot, "node_modules", "better-sqlite3")
	assertDirectory(betterSqliteRoot, "packaged better-sqlite3")
	const betterSqliteNative = findTargetNativeAddon(betterSqliteRoot, platform, arch)
	if (!betterSqliteNative) throw new Error("Packaged better-sqlite3 native module is missing.")
	assertNativeBinaryArchitecture(betterSqliteNative, { platform, arch })

	const ptyRoot = path.join(runtimeRoot, "node_modules", "node-pty")
	assertDirectory(ptyRoot, "packaged node-pty")
	const ptyDirectory = findTargetNodePtyDirectory(ptyRoot, platform, arch)
	const ptyNative = path.join(ptyDirectory, "pty.node")
	assertFile(ptyNative, "packaged node-pty pty.node")
	assertNativeBinaryArchitecture(ptyNative, { platform, arch })
	if (platform === "win32") {
		const ptyManifest = JSON.parse(readFileSync(path.join(ptyRoot, "package.json"), "utf8"))
		const beta = String(ptyManifest.version).includes("1.2.0-beta")
		const conptyNative = path.join(ptyDirectory, "conpty.node")
		const conptyConsoleList = path.join(ptyDirectory, "conpty_console_list.node")
		const winptyAgent = path.join(ptyDirectory, "winpty-agent.exe")
		const conptyLibrary = path.join(ptyDirectory, "conpty", "conpty.dll")
		const openConsole = path.join(ptyDirectory, "conpty", "OpenConsole.exe")
		assertFile(conptyNative, "packaged node-pty conpty.node")
		assertFile(conptyLibrary, "packaged node-pty conpty.dll")
		assertFile(openConsole, "packaged node-pty OpenConsole.exe")
		if (beta) assertFile(conptyConsoleList, "packaged node-pty conpty_console_list.node")
		else assertFile(winptyAgent, "packaged node-pty winpty agent")
		for (const nativeFile of [
			ptyNative,
			...(beta ? [conptyConsoleList] : [winptyAgent]),
			conptyNative,
			conptyLibrary,
			openConsole,
		])
			assertNativeBinaryArchitecture(nativeFile, { platform, arch })
	}

	assertNativeBinaryArchitecture(path.join(root, "resources", nodeExecutableName), { platform, arch })
	verifyRequiredWindowsNativePackages(runtimeRoot, { platform, arch })
	verifyNativeRuntimeMatrix(runtimeRoot, { platform, arch })
	const nodePtyInventory = verifyNodePtyNativesRecursively({ root: runtimeRoot, platform, arch })
	const nativeInventory = collectRuntimeNativeInventory(runtimeRoot, { platform, arch })
	return {
		appRoot,
		runtimeRoot,
		betterSqliteNative,
		nodePtyInventory,
		nativeInventory,
		nativeMatrix: true,
	}
}

function resolvePackagedAppRoot(root) {
	const candidates = [
		root,
		path.join(root, "resources", "app"),
		path.join(root, "resources", "app.asar.unpacked"),
	]
	const resolved = candidates.find((candidate) =>
		existsSync(path.join(candidate, "node_modules", "better-sqlite3")),
	)
	if (!resolved) throw new Error("Packaged application node_modules are missing.")
	return resolved
}

function assertDirectory(directory, label) {
	if (!existsSync(directory) || !statSync(directory).isDirectory())
		throw new Error(`${label} is missing: ${directory}`)
}

function assertFile(file, label) {
	if (!existsSync(file) || !statSync(file).isFile())
		throw new Error(`${label} is missing: ${file}`)
}

function assertPackageEntry(root, packageName, label) {
	const packageRoot = path.join(root, "node_modules", ...packageName.split("/"))
	const packageManifestPath = path.join(packageRoot, "package.json")
	assertFile(packageManifestPath, `${label} manifest`)
	const packageManifest = JSON.parse(readFileSync(packageManifestPath, "utf8"))
	const entry = typeof packageManifest.main === "string" ? packageManifest.main : "lib/index.js"
	assertFile(path.join(packageRoot, entry), `${label} entry`)
}

function findTargetNodePtyDirectory(root, platform, arch) {
	const candidates = [
		path.join(root, "build", "Release"),
		path.join(root, "build", "Debug"),
		path.join(root, "prebuilds", `${platform}-${arch}`),
	]
	const directory = candidates.find((candidate) => existsSync(path.join(candidate, "pty.node")))
	if (!directory) throw new Error(`Packaged node-pty pty.node is missing for ${platform}/${arch}.`)
	return directory
}

function findFirstByName(root, name) {
	if (!existsSync(root) || !statSync(root).isDirectory()) return undefined
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const file = path.join(root, entry.name)
		if (entry.isFile() && entry.name === name) return file
		if (entry.isDirectory()) {
			const found = findFirstByName(file, name)
			if (found) return found
		}
	}
	return undefined
}

function findFirstByExtension(root, extension) {
	if (!existsSync(root) || !statSync(root).isDirectory()) return undefined
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const file = path.join(root, entry.name)
		if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) return file
		if (entry.isDirectory()) {
			const found = findFirstByExtension(file, extension)
			if (found) return found
		}
	}
	return undefined
}

function findTargetNativeAddon(root, platform, arch) {
	const targetName = `${platform}-${arch}.node`
	const target = findFirstByName(root, targetName)
	if (target) return target
	return findFirstByExtension(root, ".node")
}
