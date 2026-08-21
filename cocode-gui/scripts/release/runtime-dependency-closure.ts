import { createRequire } from "node:module"
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs"
import { basename, dirname, extname, join, relative } from "node:path"
import { pruneIncompatibleNativePackages } from "../lib/workspace-dependencies.mjs"

type NativeStagingTarget = {
	readonly platform: "darwin" | "win32" | "linux"
	readonly arch: "x64" | "arm64"
}

interface PackageManifest {
	readonly name?: unknown
	readonly version?: unknown
	readonly dependencies?: Record<string, string>
	readonly optionalDependencies?: Record<string, string>
	readonly peerDependencies?: Record<string, string>
	readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface PackageRecord {
	readonly root: string
	readonly manifest: PackageManifest & { readonly name: string }
	readonly requestedName: string
	readonly destinationSegments: readonly string[]
}

interface PackageLineageEntry {
	readonly root: string
	readonly requestedName: string
}

interface PendingDependency {
	readonly dependency: string
	readonly fromManifest: string
	readonly optional: boolean
	readonly destinationParent: readonly string[]
	readonly lineage: readonly PackageLineageEntry[]
}

export function copyProductionDependencyClosure(options: {
	readonly sourceRoot: string
	readonly appRoot: string
	readonly dependencies: readonly string[]
	readonly target?: NativeStagingTarget
}): readonly string[] {
	const packages = resolveProductionDependencyClosure(options)
	const targetModules = join(options.appRoot, "node_modules")
	rmSync(targetModules, { recursive: true, force: true })

	for (const record of packages) {
		const destination = packageDestination(targetModules, record.destinationSegments)
		mkdirSync(dirname(destination), { recursive: true })
		cpSync(record.root, destination, {
  recursive: true,
  dereference: true,
  filter: (source) => {
    if (basename(source) === "node_modules") return false
    return options.target?.platform !== "win32" || shouldCopyWindowsProductionEntry(record.root, source)
  },
})
		if (options.target) pruneNativePrebuilds(destination, options.target)
	}
	if (options.target)
		pruneIncompatibleNativePackages(options.appRoot, options.target)

	for (const record of packages) {
		const destination = packageDestination(targetModules, record.destinationSegments)
		if (!existsSync(join(destination, "package.json")))
			throw new Error(
				`Copied production dependency is missing its package manifest: ${record.requestedName}`,
			)
		if (lstatSync(destination).isSymbolicLink())
			throw new Error(`Copied production dependency is still a symlink: ${record.requestedName}`)
	}

	return packages.map(({ requestedName }) => requestedName)
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

function shouldCopyWindowsProductionEntry(root: string, source: string): boolean {
  const relativePath = relative(root, source)
  if (relativePath.length === 0) return true
  const segments = relativePath.split(/[\\/]+/)
  if (segments.some((segment) => WINDOWS_PRUNABLE_DIRECTORIES.has(segment))) return false
  return !WINDOWS_PRUNABLE_EXTENSIONS.has(extname(source).toLowerCase())
}

function pruneNativePrebuilds(root: string, target: NativeStagingTarget): void {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) return
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const file = join(root, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "prebuilds") {
				prunePrebuildDirectory(file, target)
				continue
			}
			pruneNativePrebuilds(file, target)
		}
	}
}

function prunePrebuildDirectory(directory: string, target: NativeStagingTarget): void {
	const expected = `${target.platform}-${target.arch}`
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = join(directory, entry.name)
		const marker = nativePrebuildMarker(entry.name)
		if (marker) {
			if (marker !== expected) rmSync(file, { recursive: true, force: true })
			continue
		}
		if (entry.isDirectory()) pruneNativePrebuilds(file, target)
	}
}

function nativePrebuildMarker(name: string): string | undefined {
	const match = /^(linux(?:musl)?|darwin|win32)-(x64|arm64)(?:\.|$)/i.exec(name)
	return match ? `${match[1].toLowerCase()}-${match[2].toLowerCase()}` : undefined
}

export function resolveProductionDependencyClosure(options: {
	readonly sourceRoot: string
	readonly dependencies: readonly string[]
}): readonly PackageRecord[] {
	const sourceManifest = join(options.sourceRoot, "package.json")
	if (!existsSync(sourceManifest))
		throw new Error(`Runtime dependency source manifest is missing: ${sourceManifest}`)

	const pending: PendingDependency[] = []
	const packages = new Map<string, PackageRecord>()

	const enqueueDependencies = (
		record: PackageRecord,
		lineage: readonly PackageLineageEntry[],
	): void => {
		for (const dependency of Object.keys(record.manifest.dependencies ?? {})) {
			pending.push({
				dependency,
				fromManifest: join(record.root, "package.json"),
				optional: false,
				destinationParent: record.destinationSegments,
				lineage,
			})
		}
		for (const dependency of Object.keys(record.manifest.optionalDependencies ?? {})) {
			pending.push({
				dependency,
				fromManifest: join(record.root, "package.json"),
				optional: true,
				destinationParent: record.destinationSegments,
				lineage,
			})
		}
		for (const dependency of Object.keys(record.manifest.peerDependencies ?? {})) {
			pending.push({
				dependency,
				fromManifest: join(record.root, "package.json"),
				optional: record.manifest.peerDependenciesMeta?.[dependency]?.optional === true,
				destinationParent: record.destinationSegments,
				lineage,
			})
		}
	}

	// Reserve every requested main-process dependency at the top level first.
	// This ensures a transitive dependency cannot occupy a slot required by a
	// direct dependency with another version.
	for (const dependency of options.dependencies) {
		const root = resolvePackageRoot(sourceManifest, dependency)
		const destinationSegments = dependency.split("/")
		const destinationKey = destinationSegments.join("/")
		const existing = packages.get(destinationKey)
		if (existing && existing.root !== root)
			throw new Error(
				`Conflicting direct production dependencies at ${destinationKey}: ${existing.root} and ${root}`,
			)
		if (existing) continue
		const record: PackageRecord = {
			root,
			manifest: readPackageManifest(root),
			requestedName: dependency,
			destinationSegments,
		}
		packages.set(destinationKey, record)
		enqueueDependencies(record, [{ root, requestedName: dependency }])
	}

	while (pending.length > 0) {
		const current = pending.shift()!
		let root: string
		try {
			root = resolvePackageRoot(current.fromManifest, current.dependency)
		} catch (error) {
			if (current.optional) continue
			throw new Error(
				`Unable to resolve production dependency ${current.dependency} from ${current.fromManifest}: ${String(error)}`,
			)
		}

		const manifest = readPackageManifest(root)
		if (
			isPackageVisible(
				packages,
				current.destinationParent,
				current.dependency,
				root,
			)
		)
			continue
		if (
			current.lineage.some(
				(entry) => entry.root === root && entry.requestedName === current.dependency,
			)
		)
			throw new Error(
				`Production dependency cycle is not reachable in the staged tree: ${current.dependency}`,
			)

		const topLevelSegments = current.dependency.split("/")
		const topLevel = packages.get(topLevelSegments.join("/"))
		const destinationSegments = topLevel
			? [...current.destinationParent, "node_modules", ...topLevelSegments]
			: topLevelSegments
		const destinationKey = destinationSegments.join("/")
		const existing = packages.get(destinationKey)
		if (existing) {
			if (existing.root !== root)
				throw new Error(
					`Conflicting production dependencies at ${destinationKey}: ${existing.root} and ${root}`,
				)
			continue
		}

		const record: PackageRecord = {
			root,
			manifest,
			requestedName: current.dependency,
			destinationSegments,
		}
		packages.set(destinationKey, record)
		enqueueDependencies(record, [
			...current.lineage,
			{ root, requestedName: current.dependency },
		])
	}

	return [...packages.values()]
}

function isPackageVisible(
	packages: ReadonlyMap<string, PackageRecord>,
	parentDestination: readonly string[],
	dependency: string,
	root: string,
): boolean {
	const dependencySegments = dependency.split("/")
	let ancestor = [...parentDestination]
	while (ancestor.length > 0) {
		const candidate = [...ancestor, "node_modules", ...dependencySegments].join("/")
		if (packages.get(candidate)?.root === root) return true
		const nodeModulesIndex = ancestor.lastIndexOf("node_modules")
		if (nodeModulesIndex === -1) break
		ancestor = ancestor.slice(0, nodeModulesIndex)
	}
	return packages.get(dependencySegments.join("/"))?.root === root
}

export function verifyProductionDependencyClosure(
	appRoot: string,
	dependencies: readonly string[],
): void {
	for (const dependency of dependencies) {
		const manifestPath = join(
			appRoot,
			"node_modules",
			...dependency.split("/"),
			"package.json",
		)
		if (!existsSync(manifestPath))
			throw new Error(`Packaged production dependency is missing: ${dependency}`)
	}
}

function packageDestination(targetModules: string, destinationSegments: readonly string[]): string {
	return join(targetModules, ...destinationSegments)
}

function resolvePackageRoot(fromManifest: string, dependency: string): string {
	const packageRequire = createRequire(fromManifest)
	for (const searchPath of packageRequire.resolve.paths(dependency) ?? []) {
		const candidate = join(searchPath, ...dependency.split("/"))
		if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
	}
	let resolved: string
	try {
		resolved = packageRequire.resolve(`${dependency}/package.json`)
		return realpathSync(dirname(resolved))
	} catch {
		resolved = packageRequire.resolve(dependency)
	}
	let current = realpathSync(dirname(resolved))
	while (true) {
		const manifestPath = join(current, "package.json")
		if (existsSync(manifestPath)) {
			const manifest = readPackageManifest(current)
			if (manifest.name === dependency) return current
		}
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}
	throw new Error(`Resolved ${dependency} but could not locate its package root.`)
}

function readPackageManifest(root: string): PackageRecord["manifest"] {
	const manifestPath = join(root, "package.json")
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest
	if (typeof manifest.name !== "string" || manifest.name.length === 0)
		throw new Error(`Package manifest has no valid name: ${manifestPath}`)
	return manifest as PackageRecord["manifest"]
}
