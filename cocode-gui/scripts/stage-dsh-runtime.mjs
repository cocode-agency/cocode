import {
	cpSync,
	existsSync,
	chmodSync,
	mkdirSync,
	rmSync,
	readFileSync,
	writeFileSync,
	readdirSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import * as path from "pathe"
import process from "node:process"
import {
	isPackageCompatible,
	pruneIncompatibleNativePackages,
	restoreNodePtyHelpers,
} from "./lib/workspace-dependencies.mjs"
import {
	copyRuntimeDependencyClosure,
	resolveRuntimeDependencyClosure,
} from "../../cocode-host-supervisor/packages/host-supervisor/lib/runtime-closure.mjs"

const destination = readArgument("--destination")
const recordsOutput = readArgument("--records-output")
if (!destination) {
	console.error("Usage: node scripts/stage-dsh-runtime.mjs --destination <directory>")
	process.exit(2)
}

const WINDOWS_PRUNABLE_DIRECTORIES = new Set([
	".cache",
	".github",
	"coverage",
	"test",
	"tests",
	"__tests__",
	"examples",
	"example",
	"benchmarks",
	"docs",
])
const WINDOWS_PRUNABLE_EXTENSIONS = new Set([
	".map",
	".pdb",
	".obj",
	".ilk",
	".tlog",
	".ts",
	".mts",
	".cts",
	".c",
	".cc",
	".cpp",
	".h",
	".hh",
	".hpp",
	".vcxproj",
	".filters",
	".sln",
	".props",
	".targets",
	".recipe",
	".cmake",
])
const pruneWindowsProductionFiles = process.platform === "win32"

function shouldCopyWindowsProductionEntry(root, entry) {
	if (!pruneWindowsProductionFiles) return true
	const relative = path.relative(root, entry)
	if (relative === "") return true
	const segments = relative.split("/")
	if (segments.some((segment) => WINDOWS_PRUNABLE_DIRECTORIES.has(segment))) return false
	return !WINDOWS_PRUNABLE_EXTENSIONS.has(path.extname(entry).toLowerCase())
}
const require = createRequire(import.meta.url)
const supervisorManifest = require.resolve("@cocode-agency/host-supervisor/package.json")
const supervisorRoot = path.dirname(supervisorManifest)
const supervisorPackage = JSON.parse(readFileSync(supervisorManifest, "utf8"))
const supervisorRequire = createRequire(supervisorManifest)
const dshManifest = supervisorRequire.resolve("@deepseek-ai/dsh/package.json")

verifyWorkspacePluginArtifacts(supervisorRoot)

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
copyTree(supervisorRoot, destination)
const dependencyRecords = materializeDependencyClosure(
	supervisorRoot,
	destination,
	readDirectory(path.join(supervisorRoot, "runtime", "plugins")).map((entry) =>
		path.join(supervisorRoot, "runtime", "plugins", entry),
	),
)
if (recordsOutput) {
	mkdirSync(path.dirname(recordsOutput), { recursive: true })
	writeFileSync(
		recordsOutput,
		`${JSON.stringify(
			dependencyRecords
				.filter((record) => record.copy)
				.map((record) => ({
					destination: path.join("node_modules", ...record.destinationSegments),
					name: record.name,
					version: record.version,
					requestedName: record.requestedName,
					lineage: record.lineage,
				})),
			null,
		)}\n`,
	)
}
pruneIncompatibleNativePackages(destination)
restoreNodePtyHelper(destination)

const marker = {
	package: supervisorPackage.name,
	supervisorVersion: supervisorPackage.version,
	dshVersion: JSON.parse(readFileSync(dshManifest, "utf8")).version,
	entry: path.join(destination, "packages", "host-supervisor", "lib", "bin.js"),
}
cpSync(dshManifest, path.join(destination, "dsh-package.json"))
process.stdout.write(
	`Staged shared DSH Host runtime ${marker.dshVersion} with Supervisor ${marker.supervisorVersion}\n`,
)

function readArgument(name) {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}

function copyTree(source, target) {
	cpSync(source, target, {
		recursive: true,
		dereference: true,
		filter: (entry) => {
			// pathe normalizes relative paths to forward slashes on every platform.
			const relative = path.relative(source, entry)
			if (relative === "") return true
			// Every installed tree is skipped, including the one pnpm creates inside
			// each workspace package. Those directories hold links into the local
			// store that `dereference` cannot resolve once a layout switch leaves one
			// dangling, and materializeDependencyClosure rebuilds the closure anyway.
			const segments = relative.split("/")
			return (
				!segments.includes("node_modules") &&
				!segments.includes(".cache") &&
				shouldCopyWindowsProductionEntry(source, entry)
			)
		},
	})
	for (const candidate of [
		path.join(
			target,
			"node_modules",
			"node-pty",
			"prebuilds",
			`${process.platform}-${process.arch}`,
			"spawn-helper",
		),
		path.join(target, "node_modules", "node-pty", "build", "Release", "spawn-helper"),
	]) {
		if (existsSync(candidate)) chmodSync(candidate, 0o755)
	}
}

/**
 * Build a self-contained npm-shaped dependency tree from the installed package
 * graph. The resolver preserves nested package versions instead of treating a
 * package name as a global singleton.
 */
function materializeDependencyClosure(supervisorRoot, destination, additionalRoots) {
	const roots = [
		{ root: supervisorRoot, destinationSegments: [], copy: false },
		...additionalRoots.map((root) => {
			const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
			return {
				root,
				destinationSegments: String(manifest.name).split("/"),
				copy: true,
			}
		}),
	]
	const records = resolveRuntimeDependencyClosure({ roots, fallbackRoot: supervisorRoot })
	for (const record of records) {
		const manifest = JSON.parse(readFileSync(path.join(record.root, "package.json"), "utf8"))
		if (!isPackageCompatible(manifest))
			throw new Error(
				`Cannot stage incompatible runtime package ${record.name}@${record.version} for ${process.platform}/${process.arch}.`,
			)
	}
	copyRuntimeDependencyClosure({
		records,
		targetModules: path.join(destination, "node_modules"),
		filter: (entry) =>
			!path.relative(supervisorRoot, entry).split("/").includes(".cache") &&
			shouldCopyWindowsProductionEntry(recordRootFor(entry, records), entry),
	})
	return records
}

function recordRootFor(entry, records) {
	for (const record of records) {
		if (isPathWithin(record.root, entry)) return record.root
	}
	return entry
}

function isPathWithin(root, candidate) {
	const relative = path.relative(path.resolve(root), path.resolve(candidate))
	return (
		relative === "" ||
		(!relative.startsWith("../") && relative !== ".." && !path.isAbsolute(relative))
	)
}

/**
 * In the workspace the Supervisor package is linked, so its committed runtime
 * artifacts must match the GUI plugin build that the current Desktop uses.
 * Published installs have no sibling GUI source and intentionally skip this
 * check.
 */
function verifyWorkspacePluginArtifacts(supervisorRoot) {
	const workspacePlugins = path.resolve(process.cwd(), "packages", "cocode")
	if (!existsSync(workspacePlugins)) return
	const bundledPlugins = path.join(supervisorRoot, "runtime", "plugins")
	for (const entry of readDirectory(workspacePlugins)) {
		const source = path.join(workspacePlugins, entry)
		const bundled = path.join(bundledPlugins, entry)
		if (!existsSync(path.join(source, "package.json"))) continue
		for (const artifact of ["lib/index.js", "lib/client.js"]) {
			const sourceFile = path.join(source, artifact)
			const bundledFile = path.join(bundled, artifact)
			if (!existsSync(sourceFile) || !existsSync(bundledFile)) continue
			if (sha256(sourceFile) !== sha256(bundledFile)) {
				throw new Error(
					`Stale Supervisor runtime plugin ${entry}/${artifact}. Run pnpm run build:cocode-plugins before staging the DSH runtime.`,
				)
			}
		}
		const sourceManifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"))
		const bundledManifestPath = path.join(bundled, "package.json")
		if (!existsSync(bundledManifestPath)) {
			throw new Error(`Supervisor runtime plugin ${entry} is missing package.json.`)
		}
		const bundledManifest = JSON.parse(readFileSync(bundledManifestPath, "utf8"))
		if (
			bundledManifest.name !== sourceManifest.name ||
			bundledManifest.version !== sourceManifest.version ||
			JSON.stringify(bundledManifest.dsh) !== JSON.stringify(sourceManifest.dsh)
		) {
			throw new Error(
				`Stale Supervisor runtime manifest for ${entry}. Run pnpm run build:cocode-plugins before staging the DSH runtime.`,
			)
		}
	}
}

function sha256(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function restoreNodePtyHelper(root) {
	restoreNodePtyHelpers({ root, platform: process.platform, arch: process.arch })
}

function readDirectory(directory) {
	return existsSync(directory) ? readdirSync(directory) : []
}
