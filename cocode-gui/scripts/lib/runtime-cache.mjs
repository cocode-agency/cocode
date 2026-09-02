/**
 * Staging for the shared DSH Host runtime.
 *
 * Staging is expensive, so the default is a fingerprinted OS cache directory
 * that survives restarts. `DSH_RUNTIME_ROOT` pins an explicit location and
 * `DSH_DISABLE_RUNTIME_CACHE=1` forces a throwaway directory per run.
 */
import { spawnSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import * as path from "pathe"

const CACHE_MARKER = ".cocode-runtime-cache.json"
const FINGERPRINT_VERSION = 3
const RUNTIME_ENTRY = path.join("packages", "host-supervisor", "lib", "bin.js")

export function resolveRuntimeRoot(temporaryPrefix) {
	const configured = process.env.DSH_RUNTIME_ROOT
	const useCache = !configured && process.env.DSH_DISABLE_RUNTIME_CACHE !== "1"
	const isTemporary = !configured && !useCache
	const root =
		configured ??
		(useCache ? defaultCacheRoot() : mkdtempSync(path.join(os.tmpdir(), temporaryPrefix)))
	return { root, useCache, isTemporary }
}

export function prepareRuntime(runtime) {
	if (runtime.useCache) ensureRuntimeStaged(runtime.root)
	else if (runtime.isTemporary) stageRuntime(runtime.root)
}

export function cleanupRuntime(runtime) {
	if (runtime.isTemporary) rmSync(runtime.root, { recursive: true, force: true })
}

function defaultCacheRoot() {
	if (process.env.DSH_RUNTIME_CACHE_ROOT) return path.resolve(process.env.DSH_RUNTIME_CACHE_ROOT)
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Caches", "cocode", "dsh-runtime")
	}
	if (process.platform === "win32") {
		const root = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
		return path.join(root, "Cocode", "dsh-runtime")
	}
	const root = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache")
	return path.join(root, "cocode", "dsh-runtime")
}

function stageRuntime(destination) {
	const staged = spawnSync(
		process.execPath,
		[path.resolve("scripts/stage-dsh-runtime.mjs"), "--destination", destination],
		{ stdio: "inherit", cwd: process.cwd(), env: process.env },
	)
	if (staged.error) throw staged.error
	if (staged.status !== 0) {
		throw new Error(`DSH runtime staging failed with code ${String(staged.status)}.`)
	}
}

/** Stage into a sibling directory first so a failed run cannot corrupt the cache. */
function ensureRuntimeStaged(destination) {
	const fingerprint = createRuntimeFingerprint()
	if (
		process.env.DSH_FORCE_RESTAGE !== "1" &&
		existsSync(path.join(destination, RUNTIME_ENTRY))
	) {
		try {
			const metadata = JSON.parse(readFileSync(path.join(destination, CACHE_MARKER), "utf8"))
			if (metadata.fingerprint === fingerprint) {
				console.log(`[dsh-runtime] reusing cached runtime at ${destination}`)
				return
			}
		} catch {
			// A missing or incomplete marker is treated as a cache miss.
		}
	}

	mkdirSync(path.dirname(destination), { recursive: true })
	console.log(`[dsh-runtime] staging runtime at ${destination}`)
	const stagingRoot = mkdtempSync(path.join(path.dirname(destination), ".dsh-runtime-stage-"))
	const staged = path.join(stagingRoot, "runtime")
	try {
		stageRuntime(staged)
		writeFileSync(
			path.join(staged, CACHE_MARKER),
			`${JSON.stringify({ fingerprint }, null, 2)}\n`,
		)
		rmSync(destination, { recursive: true, force: true })
		renameSync(staged, destination)
	} finally {
		rmSync(stagingRoot, { recursive: true, force: true })
	}
}

function createRuntimeFingerprint() {
	const root = process.cwd()
	return JSON.stringify({
		version: FINGERPRINT_VERSION,
		platform: process.platform,
		arch: process.arch,
		runtime: [
			fileSignature(
				path.join(root, "node_modules", "@cocode", "host-supervisor", "package.json"),
			),
			directorySignature(
				path.resolve(root, "../cocode-host-supervisor/packages/host-supervisor/lib"),
			),
			fileSignature(path.join(root, "node_modules", "@deepseek-ai", "dsh", "package.json")),
		],
		cocode: [
			...pluginFingerprintEntries(path.join(root, "packages", "cocode")),
			fileSignature(path.join(root, "scripts", "stage-dsh-runtime.mjs")),
			fileSignature(path.join(root, "scripts", "cocode-plugins.mjs")),
		],
	})
}

function pluginFingerprintEntries(root) {
	let entries
	try {
		entries = readdirSync(root, { withFileTypes: true })
	} catch {
		return [[root, null]]
	}
	return entries
		.filter((entry) => entry.isDirectory())
		.sort((left, right) => left.name.localeCompare(right.name))
		.flatMap((entry) => {
			const pluginRoot = path.join(root, entry.name)
			return [
				fileSignature(path.join(pluginRoot, "package.json")),
				fileSignature(path.join(pluginRoot, "tsconfig.build.json")),
				fileSignature(path.join(pluginRoot, "tsdown.config.ts")),
				directorySignature(path.join(pluginRoot, "src")),
				directorySignature(path.join(pluginRoot, "lib")),
			]
		})
}

function fileSignature(file) {
	try {
		const stat = statSync(file)
		return [file, stat.size, stat.mtimeMs]
	} catch {
		return [file, null]
	}
}

function directorySignature(root) {
	let count = 0
	let latestMtime = 0
	const visit = (directory) => {
		let entries
		try {
			entries = readdirSync(directory, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name === ".git") continue
			const entryPath = path.join(directory, entry.name)
			if (entry.isDirectory()) {
				visit(entryPath)
				continue
			}
			count += 1
			try {
				latestMtime = Math.max(latestMtime, statSync(entryPath).mtimeMs)
			} catch {
				// The file may disappear while the developer is editing it.
			}
		}
	}
	visit(root)
	return [root, count, latestMtime]
}
