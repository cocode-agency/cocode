import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs"
import * as path from "pathe"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { watch } from "chokidar"
import { build } from "tsdown"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const clientRoot = path.join(repositoryRoot, "packages", "client")
const cocodeClientRoot = path.join(repositoryRoot, "packages", "cocode")
const clientTsconfig = path.join(repositoryRoot, "tsconfig.base.client.json")
const clientRoots = [clientRoot, cocodeClientRoot]

// These are the only CommonJS requires the browser loader can resolve from
// its frozen module table. Older bundles may still be newer than their source
// tree while carrying a dependency externalized by the previous tsdown policy;
// startup must rebuild those artifacts after a policy change.
const CLIENT_MODULE_TABLE_EXTERNALS = new Set([
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
	"cordis",
	"@deepseek-ai/cordis",
	"@deepseek-ai/dsh-client-ui-slots",
	"@deepseek-ai/dsh-client-ui-primitives",
	"@deepseek-ai/dsh-client-runtime/client",
])

export function discoverDshClientPackages(root = clientRoot) {
	const packages = []
	visit(root)
	return packages.sort((left, right) => left.id.localeCompare(right.id))

	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "lib")
				continue
			const packageRoot = path.join(directory, entry.name)
			const manifestPath = path.join(packageRoot, "package.json")
			if (!existsSync(manifestPath)) {
				visit(packageRoot)
				continue
			}
			const configPath = path.join(packageRoot, "tsdown.config.ts")
			const sourceEntry = [
				path.join(packageRoot, "src", "client", "index.ts"),
				path.join(packageRoot, "src", "client", "index.tsx"),
			].find((candidate) => existsSync(candidate))
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
			if (
				existsSync(configPath) &&
				sourceEntry !== undefined &&
				manifest.dsh?.client?.platform === "web" &&
				typeof manifest.name === "string"
			) {
				packages.push({
					directory: directory.name,
					id: manifest.name,
					root: packageRoot,
					configPath,
					sourceRoot: path.join(packageRoot, "src"),
					tsconfigPath: resolveClientBuildTsconfig(packageRoot),
					bundlePath: path.join(packageRoot, "lib", "client.js"),
				})
			}
			// A workspace/category directory may itself carry a manifest while
			// still containing nested client packages. Continue below it instead
			// of treating that manifest as a traversal boundary.
			visit(packageRoot)
		}
	}
}

/**
 * The mirrored upstream packages keep their full-harness project references,
 * including packages that are intentionally absent from this Electron
 * checkout. The watch build only transpiles one browser entry and must not ask
 * Rolldown to resolve that project graph. Project-owned Cocode packages remain
 * on their own tsconfig because their references live in this repository.
 */
export function resolveClientBuildTsconfig(packageRoot) {
	if (isPathWithin(clientRoot, packageRoot)) return clientTsconfig
	const packageTsconfig = path.join(packageRoot, "tsconfig.json")
	return existsSync(packageTsconfig) ? packageTsconfig : clientTsconfig
}

export function resolveRuntimeClientBundlePath(runtimeRoot, packageId) {
	const segments = packageId.split("/")
	const scoped = packageId.startsWith("@")
	if (
		(scoped && segments.length !== 2) ||
		(!scoped && segments.length !== 1) ||
		segments.some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new Error(`Invalid DSH client package id: ${packageId}`)
	}
	return path.join(runtimeRoot, "node_modules", ...segments, "lib", "client.js")
}

export function isClientBundleStale(clientPackage) {
	if (!existsSync(clientPackage.bundlePath)) return true
	const bundleMtime = statSync(clientPackage.bundlePath).mtimeMs
	return (
		latestMtime(clientPackage.sourceRoot) > bundleMtime ||
		hasUnregisteredClientExternal(clientPackage.bundlePath) ||
		hasUnsupportedClientRuntimeGlobal(clientPackage.bundlePath)
	)
}

const UNSUPPORTED_CLIENT_RUNTIME_GLOBAL = /\bprocess\.(?:env|platform|arch|versions|execArgv)\b/g

/**
 * Browser client bundles are loaded by the renderer's module table, not by a
 * Node runtime. Any remaining access to a Node `process` property is therefore
 * a stale or incorrectly configured artifact and will throw during plugin load.
 */
export function hasUnsupportedClientRuntimeGlobal(bundlePath) {
	if (!existsSync(bundlePath)) return true
	UNSUPPORTED_CLIENT_RUNTIME_GLOBAL.lastIndex = 0
	return UNSUPPORTED_CLIENT_RUNTIME_GLOBAL.test(readFileSync(bundlePath, "utf8"))
}

export function assertBrowserSafeClientBundle(bundlePath) {
	if (!hasUnsupportedClientRuntimeGlobal(bundlePath)) return
	throw new Error(
		`DSH client bundle still references a Node process global: ${bundlePath}`,
	)
}

export function hasUnregisteredClientExternal(bundlePath) {
	if (!existsSync(bundlePath)) return true
	const source = readFileSync(bundlePath, "utf8")
	for (const match of source.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
		const specifier = match[2]
		if (specifier?.startsWith("${")) continue
		if (specifier !== undefined && !CLIENT_MODULE_TABLE_EXTERNALS.has(specifier)) return true
	}
	return false
}

export async function createClientBuildConfig(clientPackage) {
	const configModule = await import(pathToFileURL(clientPackage.configPath).href)
	const exportedConfig = configModule.default
	const packageConfigs =
		typeof exportedConfig === "function" ? await exportedConfig({ env: {} }) : exportedConfig
	const configs = Array.isArray(packageConfigs) ? packageConfigs : [packageConfigs]
	const clientConfig = configs.find(
		(candidate) => candidate?.name === `${clientPackage.id}/client`,
	)
	if (!clientConfig) {
		throw new Error(`${clientPackage.id} did not expose a /client tsdown configuration.`)
	}

	const entries = Object.fromEntries(
		Object.entries(clientConfig.entry ?? {}).map(([name, entry]) => [
			name,
			path.resolve(clientPackage.root, entry),
		]),
	)
	return {
		...clientConfig,
		cwd: repositoryRoot,
		config: false,
		entry: entries,
		outDir: path.join(clientPackage.root, "lib"),
		tsconfig: clientPackage.tsconfigPath,
		target: "es2024",
		report: false,
	}
}

async function rebuildClientPackage(clientPackage, runtimeRoot) {
	console.log(`[client-watch] rebuilding ${clientPackage.id}`)
	await build(await createClientBuildConfig(clientPackage))
	assertBrowserSafeClientBundle(clientPackage.bundlePath)
	syncClientBundle(clientPackage, runtimeRoot)
	console.log(`[client-watch] updated ${clientPackage.id}`)
}

function syncClientBundle(clientPackage, runtimeRoot) {
	if (!existsSync(clientPackage.bundlePath)) {
		throw new Error(`Client bundle was not emitted: ${clientPackage.bundlePath}`)
	}
	assertBrowserSafeClientBundle(clientPackage.bundlePath)
	const destination = resolveRuntimeClientBundlePath(runtimeRoot, clientPackage.id)
	if (!existsSync(destination)) {
		console.warn(
			`[client-watch] ${clientPackage.id} is not present in the staged runtime; skipping HMR sync.`,
		)
		return false
	}
	const temporary = `${destination}.${String(process.pid)}.tmp`
	copyFileSync(clientPackage.bundlePath, temporary)
	renameSync(temporary, destination)
	return true
}

function latestMtime(root) {
	let latest = 0
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const entryPath = path.join(root, entry.name)
		latest = Math.max(
			latest,
			entry.isDirectory() ? latestMtime(entryPath) : statSync(entryPath).mtimeMs,
		)
	}
	return latest
}

function isPathWithin(root, candidate) {
	const relative = path.relative(root, candidate)
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function createBuildScheduler(packages, runtimeRoot) {
	const states = new Map()

	return (filename) => {
		const changedPath = path.resolve(repositoryRoot, filename)
		const clientPackage = packages.find((candidate) =>
			isPathWithin(candidate.sourceRoot, changedPath),
		)
		if (!clientPackage) return
		let state = states.get(clientPackage.id)
		if (!state) {
			state = { dirty: false, running: false }
			states.set(clientPackage.id, state)
		}
		state.dirty = true
		if (state.running) return
		state.running = true
		void (async () => {
			try {
				while (state.dirty) {
					state.dirty = false
					await rebuildClientPackage(clientPackage, runtimeRoot)
				}
			} catch (error) {
				console.error(`[client-watch] failed to rebuild ${clientPackage.id}:`, error)
			} finally {
				state.running = false
			}
		})()
	}
}

async function prepareClientPackages(packages, runtimeRoot) {
	let syncedPackages = 0
	const stalePackages = packages.filter((clientPackage) => isClientBundleStale(clientPackage))
	const freshPackages = packages.filter((clientPackage) => !isClientBundleStale(clientPackage))
	await Promise.all(
		stalePackages.map((clientPackage) => rebuildClientPackage(clientPackage, runtimeRoot)),
	)
	for (const clientPackage of freshPackages) {
		syncedPackages += Number(syncClientBundle(clientPackage, runtimeRoot))
	}
	for (const clientPackage of stalePackages) {
		syncedPackages += Number(
			existsSync(resolveRuntimeClientBundlePath(runtimeRoot, clientPackage.id)),
		)
	}
	if (syncedPackages === 0) {
		throw new Error("No staged DSH client bundles were found for synchronization.")
	}
}

export async function buildDshClientPackages(runtimeRoot) {
	const packages = clientRoots.flatMap((root) => discoverDshClientPackages(root))
	if (packages.length === 0)
		throw new Error("No dsh.client packages were found under packages/client.")
	await prepareClientPackages(packages, runtimeRoot)
	return packages
}

async function startWatcher(runtimeRoot) {
	const packages = clientRoots.flatMap((root) => discoverDshClientPackages(root))
	if (packages.length === 0)
		throw new Error("No dsh.client packages were found under packages/client.")

	const scheduleBuild = createBuildScheduler(packages, runtimeRoot)
	const watcher = watch(
		packages.map((clientPackage) =>
			path.join(clientPackage.sourceRoot, "**", "*.{ts,tsx,css}"),
		),
		{
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
		},
	)
	watcher.on("add", scheduleBuild)
	watcher.on("change", scheduleBuild)
	watcher.on("unlink", scheduleBuild)
	const watcherReady = new Promise((resolve, reject) => {
		watcher.once("ready", resolve)
		watcher.once("error", reject)
	})

	await prepareClientPackages(packages, runtimeRoot)
	await watcherReady
	return { packages, watcher }
}

function readRuntimeRoot() {
	const argumentIndex = process.argv.indexOf("--runtime-root")
	const value =
		argumentIndex === -1 ? process.env.DSH_RUNTIME_ROOT : process.argv[argumentIndex + 1]
	if (!value) throw new Error("Usage: watch-dsh-client.mjs --runtime-root <staged-runtime>")
	return path.resolve(value)
}

async function main() {
	if (process.argv.includes("--build-only")) {
		const packages = await buildDshClientPackages(readRuntimeRoot())
		console.log(`[client-build] ready ${String(packages.length)} DSH client packages`)
		return
	}
	const { packages, watcher } = await startWatcher(readRuntimeRoot())
	console.log(`[client-watch] watching ${String(packages.length)} DSH client packages`)
	process.send?.({ type: "ready", packages: packages.length })

	const close = async () => {
		await watcher.close()
		process.exit(0)
	}
	process.once("SIGINT", () => void close())
	process.once("SIGTERM", () => void close())
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
	main().catch((error) => {
		const scope = process.argv.includes("--build-only") ? "client-build" : "client-watch"
		console.error(`[${scope}] startup failed:`, error)
		process.send?.({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		})
		process.exitCode = 1
	})
}
