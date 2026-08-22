import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs"
import os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { assertNativeReleaseHost } from "./assert-native-release-host.mjs"
import {
	linuxUpdateMetadataName,
	verifyLinuxPackageArtifact,
	verifyLinuxPackageSignature,
	verifyLinuxReleaseManifest,
	verifyLinuxUpdateMetadata,
} from "./verify-linux-packages.mjs"

const ARCH = "arm64"
const EXPECTED_ELF_MACHINE = /aarch64/i
const DEFAULT_SMOKE_TIMEOUT_MS = 20_000

export function verifyLinuxArm64Release({
	root = path.resolve("release", "linux", ARCH),
	appRoot = path.join(root, "linux-arm64-unpacked"),
	runSmoke = true,
	smokeTimeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
	platform = process.platform,
	processArch = process.arch,
	machine,
} = {}) {
	assertNativeReleaseHost({
		targetPlatform: "linux",
		targetArch: ARCH,
		platform,
		arch: processArch,
		...(machine === undefined ? {} : { machine }),
	})

	const releaseRoot = path.resolve(root)
	if (!existsSync(releaseRoot) || !statSync(releaseRoot).isDirectory())
		throw new Error(`Linux ARM64 release directory is missing: ${releaseRoot}`)

	const packages = collectFiles(releaseRoot).filter((file) =>
		/\.(deb|rpm)$/i.test(file),
	)
	if (packages.length !== 2)
		throw new Error(`Expected one .deb and one .rpm under ${releaseRoot}; found ${packages.length}.`)
	const formats = new Set(packages.map((file) => path.extname(file).toLowerCase()))
	if (!formats.has(".deb") || !formats.has(".rpm"))
		throw new Error(`Linux ARM64 release must contain one .deb and one .rpm: ${releaseRoot}`)

	for (const file of packages) {
		verifyLinuxPackageArtifact(file, ARCH)
		verifyLinuxPackageMaintainerScripts(file)
	}

	const signatures = packages.map((file) => `${file}.asc`)
	for (const [index, file] of packages.entries())
		verifyLinuxPackageSignature(file, signatures[index])

	const metadataFile = path.join(releaseRoot, linuxUpdateMetadataName(ARCH))
	verifyLinuxUpdateMetadata(metadataFile, packages, ARCH)

	const manifestFile = path.join(releaseRoot, `linux-release-manifest-${ARCH}.json`)
	verifyLinuxReleaseManifest(manifestFile, packages, ARCH, [metadataFile], signatures)
	verifyLinuxChecksumManifest(
		path.join(releaseRoot, `SHA256SUMS-${ARCH}`),
		[...packages, ...signatures, metadataFile, manifestFile],
	)
	verifyLinuxUnpackedApplication(appRoot)
	if (runSmoke) runLinuxApplicationSmokeTest(appRoot, smokeTimeoutMs)

	return {
		root: releaseRoot,
		packages,
		signatures,
		metadataFile,
		manifestFile,
		appRoot: path.resolve(appRoot),
		smokeTest: runSmoke ? "passed" : "skipped",
	}
}

export function verifyLinuxPackageMaintainerScripts(packageFile) {
	const file = path.resolve(packageFile)
	const extension = path.extname(file).toLowerCase()
	let scripts
	if (extension === ".deb") {
		const controlRoot = mkdtempSync(path.join(os.tmpdir(), "cocode-deb-control-"))
		try {
			execFileSync("dpkg-deb", ["-e", file, controlRoot], { stdio: "ignore" })
			scripts = ["postinst", "postrm", "prerm"]
				.map((name) => path.join(controlRoot, name))
				.filter((candidate) => existsSync(candidate))
				.map((candidate) => readFileSync(candidate, "utf8"))
		} finally {
			rmSync(controlRoot, { recursive: true, force: true })
		}
	} else if (extension === ".rpm") {
		scripts = [
			execFileSync("rpm", ["-qp", "--scripts", file], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "inherit"],
			}),
		]
	} else {
		throw new Error(`Unsupported Linux package format: ${file}`)
	}
	const combined = scripts.join("\n")
	for (const required of [
		"cocode-linux-tui-wrapper:v1",
		"/usr/bin/cocode",
		"COCODE_TUI_CLIENT_KIND=\"standalone-tui\"",
		"chmod 4755",
	])
		if (!combined.includes(required))
			throw new Error(`Linux package maintainer scripts are missing ${required}: ${file}`)
	return { file, format: extension.slice(1), scripts: scripts.length }
}

export function verifyLinuxChecksumManifest(checksumFile, files) {
	const resolvedChecksum = path.resolve(checksumFile)
	if (!existsSync(resolvedChecksum))
		throw new Error(`Linux release checksum manifest is missing: ${resolvedChecksum}`)
	const rows = new Map()
	for (const line of readFileSync(resolvedChecksum, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed) continue
		const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/i)
		if (!match) throw new Error(`Invalid SHA256 manifest row: ${resolvedChecksum}`)
		const name = path.basename(match[2])
		if (rows.has(name)) throw new Error(`Duplicate SHA256 manifest row: ${name}`)
		rows.set(name, match[1].toLowerCase())
	}
	const expected = files.map((file) => path.resolve(file))
	for (const file of expected) {
		const name = path.basename(file)
		const actual = createHash("sha256").update(readFileSync(file)).digest("hex")
		if (rows.get(name) !== actual)
			throw new Error(`SHA256 manifest does not match ${name}: ${resolvedChecksum}`)
	}
	if (rows.size !== expected.length)
		throw new Error(`SHA256 manifest contains unexpected files: ${resolvedChecksum}`)
	return { checksumFile: resolvedChecksum, files: expected }
}

export function verifyLinuxUnpackedApplication(appRoot) {
	const root = path.resolve(appRoot)
	const executable = path.join(root, "cocode-gui")
	const sandboxHelper = path.join(root, "chrome-sandbox")
	const resourcesRoot = path.join(root, "resources")
	const required = [
		executable,
		sandboxHelper,
		path.join(resourcesRoot, "startup-failure.html"),
		path.join(resourcesRoot, "cocode-node"),
		path.join(resourcesRoot, "dsh-runtime", "runtime-manifest.json"),
		path.join(resourcesRoot, "tui", "manifest.json"),
		path.join(resourcesRoot, "app", ".vite", "build", "main.mjs"),
		path.join(resourcesRoot, "app", ".vite", "build", "preload.js"),
	]
	for (const file of required) assertFile(file, "packaged ARM64 application asset")
	if ((statSync(executable).mode & 0o111) === 0)
		throw new Error(`Packaged Electron executable is not executable: ${executable}`)
	if ((statSync(sandboxHelper).mode & 0o4000) === 0)
		throw new Error(`Packaged Chromium sandbox helper is missing SUID mode 4755: ${sandboxHelper}`)
	for (const file of [executable, sandboxHelper, path.join(resourcesRoot, "cocode-node")])
		assertElfArchitecture(file)

	const runtimeManifest = JSON.parse(
		readFileSync(path.join(resourcesRoot, "dsh-runtime", "runtime-manifest.json"), "utf8"),
	)
	if (runtimeManifest.platform !== "linux" || runtimeManifest.arch !== ARCH)
		throw new Error("Packaged DSH runtime manifest is not linux/arm64.")

	const tuiRoot = path.join(resourcesRoot, "tui")
	const tuiManifest = JSON.parse(readFileSync(path.join(tuiRoot, "manifest.json"), "utf8"))
	if (tuiManifest.schemaVersion !== 1 || tuiManifest.entry !== "tui/cocode-cli.mjs")
		throw new Error("Packaged TUI manifest schema is invalid.")
	const cliSha256 = createHash("sha256")
		.update(readFileSync(path.join(tuiRoot, "cocode-cli.mjs")))
		.digest("hex")
	const runtimeSha256 = createHash("sha256")
		.update(readFileSync(path.join(tuiRoot, "cocode-tui.mjs")))
		.digest("hex")
	if (tuiManifest.sha256 !== cliSha256 || tuiManifest.runtimeSha256 !== runtimeSha256)
		throw new Error("Packaged TUI manifest hashes do not match the packaged files.")

	const nativeFiles = collectFiles(root).filter((file) =>
		path.extname(file).toLowerCase() === ".node" || path.basename(file) === "cocode-node",
	)
	for (const file of nativeFiles) assertElfArchitecture(file)
	return { appRoot: root, nativeFiles }
}

export function runLinuxApplicationSmokeTest(appRoot, timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS) {
	const root = path.resolve(appRoot)
	const executable = path.join(root, "cocode-gui")
	assertFile(executable, "packaged Electron executable")
	if (spawnSync("xvfb-run", ["--help"], { stdio: "ignore" }).status !== 0)
		throw new Error("Application smoke test requires xvfb-run; install the Xvfb package first.")
	if (spawnSync("timeout", ["--version"], { stdio: "ignore" }).status !== 0)
		throw new Error("Application smoke test requires the GNU timeout command.")
	if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000)
		throw new Error("Application smoke-test timeout must be an integer of at least 5000 ms.")

	const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-arm64-smoke-"))
	const userDataRoot = path.join(temporaryRoot, "user-data")
	const logRoot = path.join(temporaryRoot, "logs")
	const seconds = Math.ceil(timeoutMs / 1000)
	const result = spawnSync(
		"xvfb-run",
		[
			"-a",
			"--server-args=-screen 0 1280x800x24",
			"timeout",
			"--signal=TERM",
			"--kill-after=5s",
			`${seconds}s`,
			executable,
			"--disable-gpu",
			"--disable-dev-shm-usage",
			"--user-data-dir",
			userDataRoot,
		],
		{
			cwd: root,
			env: {
				...process.env,
				CI: "1",
				COCODE_AUTO_INSTALL_CLI: "0",
				COCODE_LOG_ROOT: logRoot,
			},
			encoding: "utf8",
			maxBuffer: 4 * 1024 * 1024,
		},
	)
	try {
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
		const logs = collectFiles(logRoot)
			.filter((file) => /\.(jsonl|log|txt)$/i.test(file))
			.map((file) => readFileSync(file, "utf8"))
			.join("\n")
		const startupFailure = /app\.ready\.failed|startup\.failure|process\.uncaught-exception/i.test(
			logs,
		)
		if (startupFailure)
			throw new Error(`Packaged ARM64 application reported a startup failure.\n${tail(logs)}`)
		const timedOut = result.status === 124 || result.signal === "SIGTERM"
		if (!timedOut && result.status !== 0) {
			throw new Error(
				`Packaged ARM64 application exited with status ${String(result.status)}.\n${tail(output)}`,
			)
		}
		if (!timedOut && result.status === 0 && !logs.includes("app.ready.completed"))
			throw new Error(`Packaged ARM64 application exited before readiness was logged.\n${tail(output)}`)
		return { executable, timeoutMs, status: result.status, timedOut }
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true })
	}
}

function assertElfArchitecture(file) {
	let output
	try {
		output = execFileSync("readelf", ["-h", file], { encoding: "utf8" })
	} catch (error) {
		throw new Error(`Unable to inspect ARM64 ELF architecture: ${file}`, { cause: error })
	}
	const machine = output.match(/^\s*Machine:\s*(.+)$/m)?.[1]?.trim() ?? "unknown"
	if (!EXPECTED_ELF_MACHINE.test(machine))
		throw new Error(`ELF architecture mismatch for linux/arm64: ${file} (${machine})`)
}

function assertFile(file, label) {
	if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${label} is missing: ${file}`)
}

function collectFiles(root) {
	if (!existsSync(root)) return []
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(root, entry.name)
		if (entry.isSymbolicLink()) return []
		return entry.isDirectory() ? collectFiles(file) : [file]
	})
}

function tail(value, max = 4_000) {
	return value.length > max ? value.slice(-max) : value
}

function option(name) {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))) {
	const root = option("--root") ?? path.resolve("release", "linux", ARCH)
	const appRoot = option("--app-root") ?? path.join(root, "linux-arm64-unpacked")
	const skipSmoke = process.argv.includes("--skip-smoke")
	const timeoutMs = Number(option("--smoke-timeout-ms") ?? DEFAULT_SMOKE_TIMEOUT_MS)
	const result = verifyLinuxArm64Release({ root, appRoot, runSmoke: !skipSmoke, smokeTimeoutMs: timeoutMs })
	console.log(
		JSON.stringify(
			{
				status: "ok",
				architecture: "linux/arm64",
				packages: result.packages.map((file) => path.basename(file)),
				signatures: result.signatures.map((file) => path.basename(file)),
				smokeTest: result.smokeTest,
			},
			null,
			2,
		),
	)
}
