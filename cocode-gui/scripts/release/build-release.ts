import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import * as path from "pathe"
import {
	loadReleaseEnvironment,
	requireReleaseCredentials,
	resolveReleaseTarget,
	resolveWindowsSignMode,
} from "./release-config"
import { assertNativeReleaseHost } from "./assert-native-release-host.mjs"
import {
	prepareNodePtyNatives,
	verifyNodePtyNativesRecursively,
} from "../lib/workspace-dependencies.mjs"
import { collectRuntimeNativeInventory } from "../lib/native-binary-inspection.mjs"
import { resolveNativeRuntimeMatrix } from "../lib/native-runtime-matrix.mjs"
import { hashJson } from "../runtime-build-helpers.mjs"
import packageMetadata from "../../package.json"
import {
	createReleaseEvidence,
	updateReleaseEvidenceStage,
	writeReleaseEvidenceManifest,
} from "./release-evidence.mjs"

loadReleaseEnvironment()

const platform = readOption("--platform")
const arch = readOption("--arch")
if (!platform || !arch) throw new Error("Usage: pnpm release:{mac|win|linux}:{x64|arm64}")

const runtimeArtifactRoot =
	process.env.COCODE_RUNTIME_ARTIFACT_ROOT ?? path.resolve(`release/${platform}/${arch}/runtime`)
const tuiArtifactRoot =
	process.env.COCODE_TUI_ARTIFACT_ROOT ?? path.resolve(`release/${platform}/${arch}/tui`)

const environment: NodeJS.ProcessEnv = {
	...process.env,
	RELEASE_PLATFORM: platform,
	RELEASE_ARCH: arch,
	RELEASE_REQUIRE_SIGNING: process.env.RELEASE_REQUIRE_SIGNING ?? (platform === "linux" ? "0" : "1"),
	RELEASE_REQUIRE_NATIVE_ARCH_MATCH: "1",
	RELEASE_OUTPUT_DIR: process.env.RELEASE_OUTPUT_DIR ?? `release/${platform}/${arch}`,
	COCODE_RUNTIME_ARTIFACT_ROOT: runtimeArtifactRoot,
	COCODE_TUI_ARTIFACT_ROOT: tuiArtifactRoot,
}
environment.WINDOWS_SIGN_LEDGER_DIR = path.resolve(
	environment.RELEASE_OUTPUT_DIR,
	"windows-sign-ledger",
)
delete environment.COREPACK_ROOT
const target = resolveReleaseTarget(environment)
assertNativeReleaseHost({
	targetPlatform: target.platform,
	targetArch: target.arch,
	environment,
})
requireReleaseCredentials(target, environment)

const nativeMatrix = resolveNativeRuntimeMatrix({
	platform: target.platform,
	arch: target.arch,
}).filter((entry) => entry.scope === "dsh-runtime")
const nativeOwners = [...new Set(nativeMatrix.flatMap((entry) => entry.owners))].sort()
const nativeMatrixHash = hashJson(nativeMatrix)
const hostSupervisorRoot = path.resolve(process.cwd(), "../cocode-host-supervisor")

let releaseEvidence = createReleaseEvidence({
	platform: target.platform,
	arch: target.arch,
	nativeHost: `${process.platform}/${process.arch}`,
	version: packageMetadata.version,
	ownership: {
		guiMain: ["better-sqlite3"],
		dshRuntime: nativeOwners,
	},
})
writeReleaseEvidenceManifest({ outDir: environment.RELEASE_OUTPUT_DIR, manifest: releaseEvidence })

if (target.platform === "linux") assertLinuxPackagingTools()

if (target.platform === "darwin") {
	const iconStatus = runPnpm(["run", "generate:mac-icons"])
	if (iconStatus !== 0)
		throw new Error(`macOS icon generation exited with code ${String(iconStatus)}.`)
}

if (target.platform === "win32" && resolveWindowsSignMode(environment) === "service") {
	rmSync(environment.WINDOWS_SIGN_LEDGER_DIR, { recursive: true, force: true })
	mkdirSync(environment.WINDOWS_SIGN_LEDGER_DIR, { recursive: true })
	const credentialCheck = spawnSync(
		process.execPath,
		["scripts/release/windows-sign-credentials.cjs", "check"],
		{ cwd: process.cwd(), env: environment, stdio: "inherit" },
	)
	if (credentialCheck.error) throw credentialCheck.error
	if (credentialCheck.status !== 0)
		throw new Error("Windows signing service credential preflight failed.")
}

if (target.platform === "darwin" || target.platform === "win32" || target.platform === "linux") {
	cleanNativeBuildOutputs()
	const nativeDependencyStatus = runPnpm([
		"exec",
		"electron-builder",
		"install-app-deps",
		`--platform=${target.platform}`,
		`--arch=${target.arch}`,
	])
	if (nativeDependencyStatus !== 0) {
		throw new Error(
			`${target.platform} ${target.arch} native dependency preparation exited with code ${String(nativeDependencyStatus)}.`,
		)
	}
	prepareNodePtyNatives({
		root: process.cwd(),
		platform: target.platform,
		arch: target.arch,
		force: true,
	})
}

const runtimeStatus = runPnpm([
	"run",
	"build:runtime",
	"--",
	"--clean",
	"--output",
	runtimeArtifactRoot,
])
if (runtimeStatus !== 0) throw new Error(`Runtime build exited with code ${String(runtimeStatus)}.`)
verifyNodePtyNativesRecursively({
	root: runtimeArtifactRoot,
	platform: target.platform,
	arch: target.arch,
})
collectRuntimeNativeInventory(runtimeArtifactRoot, {
	platform: target.platform,
	arch: target.arch,
})

const runtimeManifest = JSON.parse(
	readFileSync(path.join(runtimeArtifactRoot, "runtime-manifest.json"), "utf8"),
)
const nativeInventoryHash = hashJson(runtimeManifest.nativeInventory ?? [])
const sourceEvidence = {
	inputFingerprint: runtimeManifest.inputFingerprint,
	sourceFiles: [
		"package.json",
		"pnpm-lock.yaml",
		"../cocode-host-supervisor/pnpm-lock.yaml",
	],
	sourceHashes: {
		guiPackage: hashJson(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")),
		guiLockfile: hashJson(readFileSync(path.resolve(process.cwd(), "pnpm-lock.yaml"), "utf8")),
		hostSupervisorLockfile: hashJson(
			readFileSync(path.join(hostSupervisorRoot, "pnpm-lock.yaml"), "utf8"),
		),
	},
}
releaseEvidence = updateReleaseEvidenceStage(releaseEvidence, "source", {
	status: "passed",
	command: "pnpm@10.34.5 build:runtime",
	summary: "Workspace inputs and lockfile were consumed on the native release host.",
	details: sourceEvidence,
})
releaseEvidence = updateReleaseEvidenceStage(releaseEvidence, "staging", {
	status: "passed",
	details: {
		runtimeRoot: path.relative(process.cwd(), runtimeArtifactRoot),
		dependencyRecords: runtimeManifest.dependencyRecords?.length ?? 0,
		dependencyRecordsHash: runtimeManifest.dependencyRecordsHash,
		runtimeContentHash: runtimeManifest.runtimeContentHash,
	},
})
releaseEvidence = updateReleaseEvidenceStage(releaseEvidence, "native", {
	status: "passed",
	details: {
		inventoryEntries: runtimeManifest.nativeInventory?.length ?? 0,
		platform: target.platform,
		arch: target.arch,
		packageNames: nativeMatrix.map((entry) => entry.packageName),
		nativeMatrixHash,
		nativeInventoryHash,
	},
})
releaseEvidence = {
	...releaseEvidence,
	hashes: {
		...releaseEvidence.hashes,
		runtimeManifest: runtimeManifest.fingerprint,
		dependencyRecords: runtimeManifest.dependencyRecordsHash,
		runtimeContent: runtimeManifest.runtimeContentHash,
		nativeMatrix: nativeMatrixHash,
		nativeInventory: nativeInventoryHash,
		sourceInput: runtimeManifest.inputFingerprint,
	},
}
writeReleaseEvidenceManifest({ outDir: environment.RELEASE_OUTPUT_DIR, manifest: releaseEvidence })

const tuiStatus = runPnpm(["run", "build:tui", "--", "--output", tuiArtifactRoot])
if (tuiStatus !== 0) throw new Error(`TUI build exited with code ${String(tuiStatus)}.`)

const viteStatus = runPnpm(["exec", "electron-vite", "build"])
if (viteStatus !== 0) throw new Error(`Electron Vite build exited with code ${String(viteStatus)}.`)

cleanBuilderOutput(target.platform, environment.RELEASE_OUTPUT_DIR)
const builderPlatform =
	target.platform === "darwin" ? "--mac" : target.platform === "win32" ? "--win" : "--linux"
const builderArch = target.arch === "arm64" ? "--arm64" : "--x64"
process.exitCode = runPnpm([
	"exec",
	"electron-builder",
	builderPlatform,
	builderArch,
	"--config",
	"electron-builder.config.ts",
	...["--publish", "never"],
])

function cleanNativeBuildOutputs(): void {
	for (const relativePath of [
		"node_modules/better-sqlite3/build",
		"node_modules/keytar/build",
		"node_modules/node-pty/build",
	]) {
		rmSync(path.resolve(relativePath), { recursive: true, force: true })
	}
}

function cleanBuilderOutput(platform: string, outputDirectory: string | undefined): void {
	if (!outputDirectory) return
	const directoryName =
		platform === "darwin" ? "mac" : platform === "win32" ? "win-unpacked" : "linux-unpacked"
	rmSync(path.resolve(outputDirectory, directoryName), { recursive: true, force: true })
}

function assertLinuxPackagingTools(): void {
	const required = [
		{ command: "dpkg-deb", packageName: "dpkg-dev" },
		{ command: "rpmbuild", packageName: "rpm" },
	]
	const missing = required
		.filter(({ command }) => spawnSync(command, ["--version"], { stdio: "ignore" }).status !== 0)
		.map(({ command, packageName }) => `${command} (install ${packageName})`)
	if (missing.length > 0) {
		throw new Error(
			`Linux DEB/RPM packaging tools are missing: ${missing.join(", ")}. ` +
			"Install them before running the native Linux release command.",
		)
	}
}

function runPnpm(args: readonly string[]): number {
	const command = process.platform === "win32" ? "corepack.cmd" : "corepack"
	const commandOptions = process.platform === "win32" ? { shell: true } : {}
	const result = spawnSync(command, ["pnpm@10.34.5", ...args], {
		cwd: process.cwd(),
		env: environment,
		stdio: "inherit",
		...commandOptions,
	})
	if (result.error) throw result.error
	return result.status ?? 1
}

function readOption(name: string): string | undefined {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}
