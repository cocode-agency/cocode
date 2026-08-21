import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "pathe"
import { fileURLToPath, pathToFileURL } from "node:url"
import { shellCommandOptions } from "./lib/child-process-options.mjs"
import {
	ensureLinuxNodePtyNatives,
	ensureWindowsNodePtyNatives,
	ensureWorkspaceDependencies,
} from "./lib/workspace-dependencies.mjs"
import { hashFiles, listFiles, sha256File } from "./runtime-build-helpers.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const supervisorRoot = path.resolve(repositoryRoot, "../cocode-host-supervisor")
const guiPluginsRoot = path.join(repositoryRoot, "packages", "cocode")
const defaultManifestPath = path.join(
	repositoryRoot,
	".cache",
	"cocode",
	"supervisor-build-manifest.json",
)

export function buildSupervisor({ clean = false, manifestPath = defaultManifestPath } = {}) {
	if (!existsSync(supervisorRoot))
		throw new Error(`Supervisor checkout not found: ${supervisorRoot}`)
	const guiPlugins = discoverGuiPlugins()
	const inputFiles = [
		"package.json",
		"pnpm-lock.yaml",
		"packages/host-supervisor/tsconfig.json",
		"packages/host-supervisor/tsconfig.build.json",
		"packages/host-supervisor/scripts/build.mjs",
		...listFiles(
			path.join(supervisorRoot, "packages", "host-supervisor", "src"),
			"packages/host-supervisor/src",
		),
		...guiPlugins.flatMap(({ directory }) => [
			path.relative(supervisorRoot, path.join(directory, "package.json")),
			...listFiles(
				path.join(directory, "lib"),
				path.relative(supervisorRoot, path.join(directory, "lib")),
			),
		]),
	]
	const inputHash = hashFiles(supervisorRoot, inputFiles)
	const requiredRuntimeArtifacts = [
		"runtime/plugins.json",
		...guiPlugins.flatMap(({ name, hasClient }) => [
			`runtime/plugins/${name}/package.json`,
			`runtime/plugins/${name}/lib/index.js`,
			...(hasClient ? [`runtime/plugins/${name}/lib/client.js`] : []),
		]),
	]
	const outputFiles = [
		...listFiles(
			path.join(supervisorRoot, "packages", "host-supervisor", "lib"),
			"packages/host-supervisor/lib",
		),
		...listFiles(
			path.join(supervisorRoot, "packages", "host-supervisor", "bin"),
			"packages/host-supervisor/bin",
		),
		...listFiles(path.join(supervisorRoot, "runtime", "plugins"), "runtime/plugins"),
		...(existsSync(path.join(supervisorRoot, "runtime", "plugins.json"))
			? ["runtime/plugins.json"]
			: []),
	]
	const previous = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, "utf8"))
		: undefined
	const valid =
		!clean &&
		previous?.inputHash === inputHash &&
		requiredRuntimeArtifacts.every(
			(file) =>
				existsSync(path.join(supervisorRoot, file)) &&
				previous.artifacts?.[file] === sha256File(path.join(supervisorRoot, file)),
		) &&
		outputFiles.every(
			(file) => previous.artifacts?.[file] === sha256File(path.join(supervisorRoot, file)),
		)
	ensureSupervisorDependencies()
	const nativeOptions = {
		root: supervisorRoot,
		platform: process.platform,
		arch: process.arch,
		force: process.env.RELEASE_REQUIRE_NATIVE_ARCH_MATCH === "1",
	}
	ensureWindowsNodePtyNatives(nativeOptions)
	ensureLinuxNodePtyNatives(nativeOptions)
	if (!valid) {
		console.log("[supervisor-build] building @cocode-agency/host-supervisor")
		execFileSync(
			process.platform === "win32" ? "corepack.cmd" : "corepack",
			["pnpm@10.34.5", "run", "build:with-gui-plugins"],
			shellCommandOptions({ cwd: supervisorRoot, stdio: "inherit" }),
		)
	}
	const artifacts = Object.fromEntries(
		[
			...listFiles(
				path.join(supervisorRoot, "packages", "host-supervisor", "lib"),
				"packages/host-supervisor/lib",
			),
			...listFiles(
				path.join(supervisorRoot, "packages", "host-supervisor", "bin"),
				"packages/host-supervisor/bin",
			),
			...listFiles(path.join(supervisorRoot, "runtime", "plugins"), "runtime/plugins"),
			...(existsSync(path.join(supervisorRoot, "runtime", "plugins.json"))
				? ["runtime/plugins.json"]
				: []),
		].map((file) => [file, sha256File(path.join(supervisorRoot, file))]),
	)
	if (!artifacts["packages/host-supervisor/lib/bin.js"])
		throw new Error("Supervisor build did not emit packages/host-supervisor/lib/bin.js.")
	for (const file of requiredRuntimeArtifacts) {
		if (!artifacts[file]) throw new Error(`Supervisor build did not emit ${file}.`)
	}
	const runtimePluginManifest = JSON.parse(
		readFileSync(path.join(supervisorRoot, "runtime", "plugins.json"), "utf8"),
	)
	const expectedPluginNames = guiPlugins.map(({ name }) => name).sort()
	const actualPluginNames = [...(runtimePluginManifest.plugins ?? [])].sort()
	if (JSON.stringify(actualPluginNames) !== JSON.stringify(expectedPluginNames)) {
		throw new Error(
			`Supervisor runtime plugin set is incomplete: expected ${expectedPluginNames.join(
				", ",
			)}; ` + `received ${actualPluginNames.join(", ") || "none"}.`,
		)
	}
	mkdirSync(path.dirname(manifestPath), { recursive: true })
	writeFileSync(
		manifestPath,
		`${JSON.stringify({ schemaVersion: 1, inputHash, artifacts }, null, 2)}\n`,
	)
	return { manifestPath, manifest: { schemaVersion: 1, inputHash, artifacts }, supervisorRoot }
}

function ensureSupervisorDependencies() {
	ensureWorkspaceDependencies({
		root: supervisorRoot,
		label: "@cocode-agency/host-supervisor",
		requiredPaths: [
			path.join(supervisorRoot, "node_modules", "esbuild", "package.json"),
			path.join(supervisorRoot, "node_modules", "typescript", "package.json"),
			path.join(supervisorRoot, "node_modules", "node-pty", "package.json"),
		],
	})
}

function discoverGuiPlugins() {
	if (!existsSync(guiPluginsRoot)) return []
	return readdirSync(guiPluginsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const directory = path.join(guiPluginsRoot, entry.name)
			const manifestPath = path.join(directory, "package.json")
			if (!existsSync(manifestPath)) return []
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
			if (typeof manifest.name !== "string" || manifest.private !== true || !manifest.cocode)
				return []
			// A Host-only plugin never declares a browser entry, so demanding a
			// client bundle from it would reject a legitimate shape.
			const hasClient = Boolean(manifest.dsh?.client || manifest.exports?.["./client"])
			return [{ name: manifest.name, directory, hasClient }]
		})
		.sort((left, right) => left.name.localeCompare(right.name))
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
	buildSupervisor({ clean: process.argv.includes("--clean") })
}
