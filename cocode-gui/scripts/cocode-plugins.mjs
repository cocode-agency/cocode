import { execFileSync } from "node:child_process"
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import * as path from "pathe"
import { fileURLToPath } from "node:url"
import { shellCommandOptions } from "./lib/child-process-options.mjs"
import { hashDirectory, hashFiles, hashJson } from "./runtime-build-helpers.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pluginsRoot = path.join(repositoryRoot, "packages", "cocode")
const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack"
const pinnedPnpmArgs = ["pnpm@10.34.5"]
const defaultBuildManifestPath = path.join(
	repositoryRoot,
	".cache",
	"cocode",
	"plugin-build-manifest.json",
)
const BUILD_MANIFEST_VERSION = 1

export function discoverCocodePlugins(root = pluginsRoot) {
	const plugins = []
	if (!existsSync(root)) return plugins
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const packageRoot = path.join(root, entry.name)
		const manifestPath = path.join(packageRoot, "package.json")
		if (!existsSync(manifestPath)) continue
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		if (typeof manifest.name !== "string" || manifest.private !== true) continue
		const runtimeDependencies = manifest.cocode?.runtimeDependencies
		if (!Array.isArray(runtimeDependencies) || !runtimeDependencies.every(isPackageName)) {
			throw new Error(
				`${manifest.name} must declare cocode.runtimeDependencies as package names.`,
			)
		}
		plugins.push({
			name: manifest.name,
			version: manifest.version,
			root: packageRoot,
			manifest,
			runtimeDependencies,
		})
	}
	return plugins.sort((left, right) => left.name.localeCompare(right.name))
}

export function buildCocodePlugins({
	incremental = false,
	manifestPath = defaultBuildManifestPath,
} = {}) {
	const plugins = discoverCocodePlugins()
	const toolchainHash = hashFiles(repositoryRoot, [
		"package.json",
		"pnpm-lock.yaml",
		"tsconfig.base.json",
		"tsconfig.base.client.json",
		"packages/cocode/tsdown.client.ts",
		"scripts/cocode-plugins.mjs",
		"scripts/runtime-build-helpers.mjs",
	])
	const previous = incremental ? readBuildManifest(manifestPath) : undefined
	const reusable = previous?.toolchainHash === toolchainHash ? previous.plugins : undefined
	const nextPlugins = {}
	let rebuilt = 0
	let reused = 0

	for (const plugin of plugins) {
		const inputHash = pluginInputHash(plugin, toolchainHash)
		const cached = reusable?.[plugin.name]
		if (cached?.inputHash === inputHash && outputsMatch(plugin, cached.outputHash)) {
			nextPlugins[plugin.name] = cached
			reused += 1
			continue
		}

		rmSync(path.join(plugin.root, "lib"), { recursive: true, force: true })
		execFileSync(
			corepackCommand,
			[
				...pinnedPnpmArgs,
				"--filter",
				plugin.name,
				"exec",
				"tsc",
				"-p",
				"tsconfig.build.json",
			],
			shellCommandOptions({
				cwd: repositoryRoot,
				stdio: "inherit",
			}),
		)
		execFileSync(
			corepackCommand,
			[...pinnedPnpmArgs, "--filter", plugin.name, "exec", "tsdown"],
			shellCommandOptions({
				cwd: repositoryRoot,
				stdio: "inherit",
			}),
		)
		assertBuiltPlugin(plugin)
		nextPlugins[plugin.name] = {
			inputHash,
			outputHash: hashDirectory(path.join(plugin.root, "lib")),
		}
		rebuilt += 1
	}

	mkdirSync(path.dirname(manifestPath), { recursive: true })
	writeFileSync(
		manifestPath,
		`${JSON.stringify(
			{
				schemaVersion: BUILD_MANIFEST_VERSION,
				toolchainHash,
				plugins: nextPlugins,
			},
			null,
		)}\n`,
	)
	if (incremental && reused > 0) {
		console.log(`[cocode-build] reused ${String(reused)} plugin${reused === 1 ? "" : "s"}`)
	}
	if (incremental && rebuilt > 0) {
		console.log(`[cocode-build] rebuilt ${String(rebuilt)} plugin${rebuilt === 1 ? "" : "s"}`)
	}
}

function pluginInputHash(plugin, toolchainHash) {
	return hashJson({
		version: BUILD_MANIFEST_VERSION,
		toolchainHash,
		package: hashFiles(plugin.root, [
			"package.json",
			"tsconfig.json",
			"tsconfig.build.json",
			"tsdown.config.ts",
		]),
		source: hashDirectory(path.join(plugin.root, "src")),
	})
}

function outputsMatch(plugin, cachedOutputHash) {
	if (typeof cachedOutputHash !== "string") return false
	if (!existsSync(path.join(plugin.root, "lib", "index.js"))) return false
	if (plugin.manifest.dsh?.client || plugin.manifest.exports?.["./client"]) {
		if (!existsSync(path.join(plugin.root, "lib", "client.js"))) return false
	}
	return cachedOutputHash === hashDirectory(path.join(plugin.root, "lib"))
}

function readBuildManifest(manifestPath) {
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		if (manifest?.schemaVersion !== BUILD_MANIFEST_VERSION) return undefined
		if (!manifest.plugins || typeof manifest.plugins !== "object") return undefined
		return manifest
	} catch {
		return undefined
	}
}

export function stageCocodePlugins(runtimeRoot) {
	const runtimeModules = path.join(runtimeRoot, "node_modules")
	const runtimeManifestPath = path.join(runtimeRoot, "package.json")
	if (!existsSync(runtimeManifestPath)) {
		throw new Error(`The staged DSH runtime has no package.json: ${runtimeRoot}`)
	}

	const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf8"))
	runtimeManifest.dependencies ??= {}

	for (const plugin of discoverCocodePlugins()) {
		assertBuiltPlugin(plugin)
		const target = packagePath(runtimeModules, plugin.name)
		rmSync(target, { recursive: true, force: true })
		mkdirSync(target, { recursive: true })
		for (const entry of ["lib", "cordis.patch.yml", "LICENSE", "README.md", "README_EN.md"]) {
			const source = path.join(plugin.root, entry)
			if (existsSync(source)) cpSync(source, path.join(target, entry), { recursive: true })
		}

		const dependencies = Object.fromEntries(
			plugin.runtimeDependencies.map((name) => {
				const version = plugin.manifest.dependencies?.[name]
				if (typeof version !== "string") {
					throw new Error(
						`${plugin.name} runtime dependency ${name} is not a dependency.`,
					)
				}
				return [name, version]
			}),
		)
		const stagedManifest = {
			...plugin.manifest,
			private: true,
			dependencies,
		}
		delete stagedManifest.devDependencies
		delete stagedManifest.publishConfig
		delete stagedManifest.scripts
		writeFileSync(
			path.join(target, "package.json"),
			`${JSON.stringify(stagedManifest, null, 2)}\n`,
		)

		copyDependencyClosure(
			plugin.runtimeDependencies,
			path.join(plugin.root, "package.json"),
			runtimeModules,
		)
		runtimeManifest.dependencies[plugin.name] = plugin.version
	}

	writeFileSync(runtimeManifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`)
}

function assertBuiltPlugin(plugin) {
	// A plugin that never declares a browser entry is Host-only, so demanding a
	// client bundle from it would reject a legitimate shape.
	const outputs = ["lib/index.js"]
	if (plugin.manifest.dsh?.client || plugin.manifest.exports?.["./client"]) {
		outputs.push("lib/client.js")
	}
	for (const output of outputs) {
		if (!existsSync(path.join(plugin.root, output))) {
			throw new Error(`${plugin.name} is missing ${output}; run pnpm build:cocode-plugins.`)
		}
	}
}

function copyDependencyClosure(names, anchorManifest, targetModules) {
	const queue = names.map((name) => ({ name, anchorManifest }))
	const visited = new Set()
	for (let next = queue.shift(); next; next = queue.shift()) {
		if (visited.has(next.name) || existsSync(packagePath(targetModules, next.name))) continue
		const source = resolvePackageDirectory(next.name, next.anchorManifest)
		if (!source) continue
		visited.add(next.name)
		const target = packagePath(targetModules, next.name)
		mkdirSync(path.dirname(target), { recursive: true })
		cpSync(realpathSync(source), target, {
			recursive: true,
			dereference: true,
			filter: (entry) => path.basename(entry) !== "node_modules",
		})
		const manifestPath = path.join(source, "package.json")
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		for (const dependency of [
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.optionalDependencies ?? {}),
		]) {
			queue.push({ name: dependency, anchorManifest: manifestPath })
		}
	}
}

function resolvePackageDirectory(packageName, anchorManifest) {
	for (const searchPath of createRequire(anchorManifest).resolve.paths(packageName) ?? []) {
		const candidate = packagePath(searchPath, packageName)
		if (existsSync(path.join(candidate, "package.json"))) return candidate
	}
	return undefined
}

function packagePath(modulesRoot, packageName) {
	return path.join(modulesRoot, ...packageName.split("/"))
}

function isPackageName(value) {
	return (
		typeof value === "string" &&
		value !== "" &&
		!value.includes("\\") &&
		!value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
	)
}

const command = process.argv[2]
if (command === "build") buildCocodePlugins()
else if (command === "typecheck") {
	for (const plugin of discoverCocodePlugins()) {
		execFileSync(
			corepackCommand,
			[
				...pinnedPnpmArgs,
				"--filter",
				plugin.name,
				"exec",
				"tsc",
				"--noEmit",
				"--emitDeclarationOnly",
				"false",
				"-p",
				"tsconfig.build.json",
			],
			shellCommandOptions({
				cwd: repositoryRoot,
				stdio: "inherit",
			}),
		)
	}
} else if (command === "test") {
	for (const plugin of discoverCocodePlugins()) {
		if (!containsTestFiles(plugin.root)) continue
		execFileSync(
			corepackCommand,
			[...pinnedPnpmArgs, "--filter", plugin.name, "exec", "vitest", "run"],
			shellCommandOptions({
				cwd: repositoryRoot,
				stdio: "inherit",
			}),
		)
	}
}

function containsTestFiles(root) {
	if (!existsSync(root)) return false
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "lib") continue
		const absolute = path.join(root, entry.name)
		if (entry.isDirectory() && containsTestFiles(absolute)) return true
		if (entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return true
	}
	return false
}
