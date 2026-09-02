import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import * as path from "pathe"
import { fileURLToPath, pathToFileURL } from "node:url"

const guiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = path.resolve(guiRoot, "..")
const supervisorRoot = path.join(repositoryRoot, "cocode-host-supervisor")
const DSH_PACKAGE_PREFIX = "@deepseek-ai/dsh"
const DSH_ABI_BRIDGES = Object.freeze({
	"@deepseek-ai/dsh-client-runtime": "0.1.1-rc.2",
	"@deepseek-ai/dsh-host-apiproxy": "0.1.1-rc.2",
})

/**
 * Check the release-train contract between the npm DSH packages and all
 * Cocode plugins. This is intentionally source-only: generated `lib/` output
 * and staged runtime closure checks belong to the full compatibility command.
 */
export function inspectDshCompatibility({
	guiRoot: inputGuiRoot = guiRoot,
	supervisorRoot: inputSupervisorRoot = supervisorRoot,
	pluginsRoot: inputPluginsRoot = path.join(inputGuiRoot, "packages", "cocode"),
	expectedDshVersion,
	resolveManifest = resolveInstalledManifest,
} = {}) {
	const errors = []
	const notes = []
	const checkedDshPackages = new Set()
	const dshPackageAnchors = new Map()
	const checkedInjectedPackages = new Set()

	const supervisorManifestPath = path.join(inputSupervisorRoot, "package.json")
	const guiManifestPath = path.join(inputGuiRoot, "package.json")
	const supervisorManifest = readJson(supervisorManifestPath, errors)
	const guiManifest = readJson(guiManifestPath, errors)
	const requestedDshVersion =
		expectedDshVersion ?? supervisorManifest?.dependencies?.["@deepseek-ai/dsh"]

	if (typeof requestedDshVersion !== "string" || requestedDshVersion.trim() === "") {
		errors.push(
			`${supervisorManifestPath}: dependencies.@deepseek-ai/dsh must declare the target DSH version.`,
		)
	}
	const targetVersion = String(requestedDshVersion ?? "").trim()
	if (!isExactVersion(targetVersion)) {
		errors.push(
			`The DSH release train must use one exact version; received ${JSON.stringify(
				targetVersion,
			)}.`,
		)
	}

	checkDshDependencySpecs(
		supervisorManifest,
		supervisorManifestPath,
		targetVersion,
		errors,
		checkedDshPackages,
		dshPackageAnchors,
	)
	checkDshDependencySpecs(
		guiManifest,
		guiManifestPath,
		targetVersion,
		errors,
		checkedDshPackages,
		dshPackageAnchors,
	)

	const plugins = discoverPlugins(inputPluginsRoot, errors)
	for (const plugin of plugins) {
		const packagePath = path.join(plugin.root, "package.json")
		checkDshDependencySpecs(
			plugin.manifest,
			packagePath,
			targetVersion,
			errors,
			checkedDshPackages,
			dshPackageAnchors,
		)
		checkPluginShape(
			plugin,
			inputGuiRoot,
			targetVersion,
			errors,
			checkedInjectedPackages,
			resolveManifest,
		)
	}

	for (const packageName of checkedDshPackages) {
		const manifest = resolveManifest(
			packageName,
			dshPackageAnchors.get(packageName) ?? guiManifestPath,
			inputGuiRoot,
		)
		if (manifest === undefined) {
			errors.push(`Unable to resolve installed DSH package ${packageName}.`)
			continue
		}
		const installedVersion = String(manifest.version)
		const expectedVersion = expectedDshVersionFor(packageName, targetVersion)
		if (installedVersion !== expectedVersion) {
			errors.push(
				`Installed ${packageName}@${installedVersion} does not match expected DSH release ${expectedVersion}.`,
			)
		}
		if (isDshAbiBridge(packageName)) {
			notes.push(`${packageName} remains on ${expectedVersion} as an npm ABI bridge.`)
		}
	}

	if (plugins.length === 0) {
		errors.push(`No Cocode plugin packages were discovered under ${inputPluginsRoot}.`)
	}
	if (errors.length === 0) {
		notes.unshift(
			`checked ${checkedDshPackages.size} DSH package declarations, ${plugins.length} Cocode plugins, and ${checkedInjectedPackages.size} injected modules`,
		)
	}

	return {
		ok: errors.length === 0,
		targetVersion,
		errors,
		notes,
		pluginNames: plugins.map((plugin) => plugin.name),
		checkedDshPackages: [...checkedDshPackages].sort(),
		checkedInjectedPackages: [...checkedInjectedPackages].sort(),
	}
}

function checkDshDependencySpecs(
	manifest,
	manifestPath,
	targetVersion,
	errors,
	checkedDshPackages,
	dshPackageAnchors,
) {
	if (!manifest) return
	for (const field of [
		"dependencies",
		"optionalDependencies",
		"peerDependencies",
		"devDependencies",
	]) {
		for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
			if (!isDshPackage(name)) continue
			checkedDshPackages.add(name)
			dshPackageAnchors.set(name, manifestPath)
			const expectedVersion = expectedDshVersionFor(name, targetVersion)
			if (spec !== expectedVersion) {
				errors.push(
					`${manifestPath}: ${field}.${name} is ${JSON.stringify(
						spec,
					)}; expected exact DSH release ${expectedVersion}.`,
				)
			}
		}
	}
}

function checkPluginShape(
	plugin,
	guiRoot,
	targetVersion,
	errors,
	checkedInjectedPackages,
	resolveManifest,
) {
	const packagePath = path.join(plugin.root, "package.json")
	const client = plugin.manifest.dsh?.client
	const hasClient = client !== undefined || plugin.manifest.exports?.["./client"] !== undefined
	if (hasClient) {
		if (client?.platform !== "web") {
			errors.push(`${plugin.name}: dsh.client.platform must be "web".`)
		}
		if (!findClientSource(plugin.root)) {
			errors.push(
				`${plugin.name}: dsh.client plugin is missing src/client/index.{ts,tsx,js,jsx}.`,
			)
		}
		if (!Array.isArray(client?.inject)) {
			errors.push(`${plugin.name}: dsh.client.inject must be an array.`)
		}
	}
	if (!Array.isArray(plugin.manifest.cocode?.runtimeDependencies)) {
		errors.push(`${plugin.name}: cocode.runtimeDependencies must be an array.`)
	}

	for (const injectedName of client?.inject ?? []) {
		if (typeof injectedName !== "string" || injectedName.trim() === "") {
			errors.push(`${plugin.name}: dsh.client.inject contains an invalid package name.`)
			continue
		}
		checkedInjectedPackages.add(injectedName)
		const injectedManifest = resolvePluginOrInstalledManifest(
			injectedName,
			plugin,
			guiRoot,
			resolveManifest,
		)
		if (injectedManifest === undefined) {
			errors.push(`${plugin.name}: injected package ${injectedName} cannot be resolved.`)
			continue
		}
		const expectedVersion = expectedDshVersionFor(injectedName, targetVersion)
		if (isDshPackage(injectedName) && String(injectedManifest.version) !== expectedVersion) {
			errors.push(
				`${plugin.name}: injected ${injectedName}@${String(
					injectedManifest.version,
				)} does not match expected DSH release ${expectedVersion}.`,
			)
		}
	}

	for (const dependencyName of plugin.manifest.cocode?.runtimeDependencies ?? []) {
		if (typeof dependencyName !== "string" || dependencyName.trim() === "") {
			errors.push(
				`${plugin.name}: cocode.runtimeDependencies contains an invalid package name.`,
			)
			continue
		}
		if (
			plugin.manifest.dependencies?.[dependencyName] === undefined &&
			plugin.manifest.optionalDependencies?.[dependencyName] === undefined
		) {
			errors.push(
				`${plugin.name}: runtime dependency ${dependencyName} is not declared in dependencies or optionalDependencies.`,
			)
		}
	}

	if (plugin.manifest.private !== true) {
		errors.push(`${packagePath}: Cocode plugins must be private workspace packages.`)
	}
}

function resolvePluginOrInstalledManifest(packageName, plugin, guiRoot, resolveManifest) {
	if (packageName.startsWith("cocode-")) {
		const localPath = path.join(guiRoot, "packages", "cocode", packageName, "package.json")
		return existsSync(localPath) ? readJson(localPath, []) : undefined
	}
	return resolveManifest(packageName, path.join(plugin.root, "package.json"), guiRoot)
}

function discoverPlugins(root, errors) {
	if (!existsSync(root)) return []
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const pluginRoot = path.join(root, entry.name)
			const manifestPath = path.join(pluginRoot, "package.json")
			if (!existsSync(manifestPath)) {
				errors.push(`${pluginRoot}: missing package.json.`)
				return []
			}
			const manifest = readJson(manifestPath, errors)
			if (
				typeof manifest?.name !== "string" ||
				manifest.private !== true ||
				manifest.cocode === undefined
			) {
				errors.push(`${manifestPath}: invalid Cocode plugin manifest.`)
				return []
			}
			return [{ name: manifest.name, root: pluginRoot, manifest }]
		})
		.sort((left, right) => left.name.localeCompare(right.name))
}

function findClientSource(pluginRoot) {
	return ["ts", "tsx", "js", "jsx"].some((extension) =>
		existsSync(path.join(pluginRoot, "src", "client", `index.${extension}`)),
	)
}

function resolveInstalledManifest(packageName, anchorManifestPath) {
	try {
		const require = createRequire(anchorManifestPath)
		const packageJson = `${packageName}/package.json`
		return readJson(require.resolve(packageJson), [])
	} catch {
		try {
			const require = createRequire(anchorManifestPath)
			const resolved = require.resolve(packageName)
			let directory = path.dirname(resolved)
			while (directory !== path.dirname(directory)) {
				const packagePath = path.join(directory, "package.json")
				if (existsSync(packagePath)) return readJson(packagePath, [])
				directory = path.dirname(directory)
			}
		} catch {
			return undefined
		}
	}
	return undefined
}

function readJson(file, errors) {
	try {
		return JSON.parse(readFileSync(file, "utf8"))
	} catch (error) {
		errors.push(`${file}: unable to read JSON (${String(error)}).`)
		return undefined
	}
}

function isDshPackage(name) {
	return name === DSH_PACKAGE_PREFIX || name.startsWith(`${DSH_PACKAGE_PREFIX}-`)
}

function isDshAbiBridge(name) {
	return Object.hasOwn(DSH_ABI_BRIDGES, name)
}

function expectedDshVersionFor(name, targetVersion) {
	return DSH_ABI_BRIDGES[name] ?? targetVersion
}

function isExactVersion(value) {
	return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
}

export function assertDshCompatibility(options = {}) {
	const report = inspectDshCompatibility(options)
	if (!report.ok) {
		throw new Error(
			[
				`DSH/Cocode compatibility check failed for ${
					report.targetVersion || "unknown version"
				}.`,
				...report.errors.map((error) => `- ${error}`),
			].join("\n"),
		)
	}
	return report
}

function printReport(report) {
	if (!report.ok) {
		console.error(
			[
				`DSH/Cocode compatibility check failed for ${
					report.targetVersion || "unknown version"
				}.`,
				...report.errors.map((error) => `- ${error}`),
			].join("\n"),
		)
		process.exitCode = 1
		return
	}
	console.log(`[dsh-compat] target DSH ${report.targetVersion}`)
	console.log(`[dsh-compat] ${report.notes[0]}`)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
	printReport(inspectDshCompatibility())
}
