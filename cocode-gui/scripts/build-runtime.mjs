import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import * as path from "pathe"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildSupervisor } from "./build-supervisor.mjs"
import { assertDshCompatibility } from "./check-dsh-compatibility.mjs"
import { hashDirectory, hashFiles, hashJson } from "./runtime-build-helpers.mjs"
import { collectRuntimeNativeInventory } from "./lib/native-binary-inspection.mjs"
import { shellCommandOptions } from "./lib/child-process-options.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function buildRuntime({ clean = false, output = defaultOutput() } = {}) {
	assertDshCompatibility()
	const command = process.platform === "win32" ? "corepack.cmd" : "corepack"
	execFileSync(command, ["pnpm@10.34.5", "run", "build:cocode-plugins"], {
		...shellCommandOptions({ cwd: repositoryRoot, stdio: "inherit" }),
	})
	const supervisor = buildSupervisor({ clean, buildGuiPlugins: false })
	// The verifier consumes runtime-closure.mjs, a generated Host Supervisor
	// artifact. Load it only after buildSupervisor has materialized the staged
	// Supervisor output; a fresh CI checkout has no generated lib directory yet.
	const { verifyRuntime } = await import("./verify-dsh-runtime.mjs")
	const inputFingerprint = hashJson({
		platform: process.platform,
		arch: process.arch,
		plugins: hashFiles(repositoryRoot, ["package.json", "pnpm-lock.yaml"]),
		supervisor: supervisor.manifest.inputHash,
	})
	mkdirSync(path.dirname(output), { recursive: true })
	rmSync(output, { recursive: true, force: true })
	const dependencyRecordsPath = path.join(output, ".runtime-dependency-records.json")
	// The stage script writes a sanitized, repository-relative closure record so
	// the runtime manifest can prove where every resolved package was placed.
	execFileSync(
		process.execPath,
		[
			path.join(repositoryRoot, "scripts", "stage-dsh-runtime.mjs"),
			"--destination",
			output,
			"--records-output",
			dependencyRecordsPath,
		],
		{ cwd: repositoryRoot, stdio: "inherit" },
	)
	const dependencyRecords = JSON.parse(readFileSync(dependencyRecordsPath, "utf8"))
	rmSync(dependencyRecordsPath, { force: true })
	execFileSync(
		process.execPath,
		[
			"--import",
			"tsx/esm",
			path.join(repositoryRoot, "scripts", "watch-dsh-client.mjs"),
			"--build-only",
			"--runtime-root",
			output,
		],
		{ cwd: repositoryRoot, stdio: "inherit" },
	)
	const manifest = {
		schemaVersion: 2,
		platform: process.platform,
		arch: process.arch,
		inputFingerprint,
		supervisor: readSupervisorManifest(output),
		plugins: discoverRuntimePlugins(output),
		dsh: readDshManifest(output),
		dependencyClosureHash: hashDirectory(path.join(output, "node_modules")),
		dependencyRecords,
		dependencyRecordsHash: hashJson(dependencyRecords),
		nativeInventory: collectRuntimeNativeInventory(output, {
			platform: process.platform,
			arch: process.arch,
		}),
		runtimeContentHash: hashDirectory(output, {
			ignore: (relative) => relative === "runtime-manifest.json",
		}),
	}
	manifest.fingerprint = hashJson(manifest)
	writeFileSync(
		path.join(output, "runtime-manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	)
	verifyRuntime(output)
	console.log(`[runtime-build] ready ${output} (${manifest.platform}/${manifest.arch})`)
	return { output, manifest }
}

function defaultOutput() {
	return path.resolve(
		process.env.COCODE_RUNTIME_ARTIFACT_ROOT?.trim() ||
			path.join(repositoryRoot, ".cache", "cocode", "release-runtime"),
	)
}

function readSupervisorManifest(root) {
	const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
	return {
		name: manifest.name,
		version: manifest.version,
		entry: "packages/host-supervisor/lib/bin.js",
		contentHash: hashDirectory(path.join(root, "packages", "host-supervisor")),
	}
}

function discoverRuntimePlugins(root) {
	const pluginsRoot = path.join(root, "runtime", "plugins")
	if (!existsSync(pluginsRoot)) return []
	return walkDirectories(pluginsRoot)
		.filter((directory) => existsSync(path.join(directory, "package.json")))
		.map((directory) => {
			const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"))
			return {
				name: manifest.name,
				version: manifest.version,
				entry: path.relative(root, path.join(directory, manifest.main || "lib/index.js")),
				contentHash: hashDirectory(directory),
			}
		})
}

function readDshManifest(root) {
	const manifest = JSON.parse(
		readFileSync(
			path.join(root, "node_modules", "@deepseek-ai", "dsh", "package.json"),
			"utf8",
		),
	)
	return {
		name: manifest.name,
		version: manifest.version,
		entry: path.join("node_modules", "@deepseek-ai", "dsh", manifest.bin?.dsh || "bin/dsh.mjs"),
		contentHash: hashDirectory(path.join(root, "node_modules", "@deepseek-ai", "dsh")),
	}
}

function walkDirectories(root) {
	const result = [root]
	for (const entry of requireReaddir(root))
		if (entry.isDirectory()) result.push(...walkDirectories(path.join(root, entry.name)))
	return result
}

function requireReaddir(root) {
	return readdirSync(root, { withFileTypes: true })
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
	const outputIndex = process.argv.indexOf("--output")
	await buildRuntime({
		clean: process.argv.includes("--clean"),
		...(outputIndex >= 0 ? { output: path.resolve(process.argv[outputIndex + 1]) } : {}),
	})
}
