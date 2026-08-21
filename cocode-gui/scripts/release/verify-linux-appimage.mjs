import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
import { verifyRuntime } from "../verify-dsh-runtime.mjs"

const ELF_MACHINES = {
	x64: /advanced micro devices x86-64|x86-64|i[3-6]86/i,
	arm64: /aarch64/i,
}

export function linuxArtifactArchLabel(arch) {
	if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported Linux architecture: ${arch}`)
	return arch === "x64" ? "x86_64" : "arm64"
}

export function linuxUpdateMetadataName(arch) {
	return arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml"
}

export function verifyLinuxUpdateMetadata(metadataFile, appImage, arch) {
	const expectedMetadata = linuxUpdateMetadataName(arch)
	if (path.basename(metadataFile) !== expectedMetadata) {
		throw new Error(`Linux updater metadata filename must be ${expectedMetadata}: ${metadataFile}`)
	}
	const metadata = parseYaml(readFileSync(metadataFile, "utf8"))
	const expectedFile = path.basename(appImage)
	const expectedSha512 = createHash("sha512").update(readFileSync(appImage)).digest("base64")
	const firstFile = metadata?.files?.[0]
	if (
		metadata?.path !== expectedFile ||
		firstFile?.url !== expectedFile ||
		metadata?.sha512 !== expectedSha512 ||
		firstFile?.sha512 !== expectedSha512
	) {
		throw new Error(`Linux updater metadata does not match the final AppImage: ${metadataFile}`)
	}
	return metadata
}

export function verifyLinuxAppImage({ appImage, arch, metadataFile, extract = true } = {}) {
	if (!appImage) throw new Error("An AppImage path is required.")
	const resolvedAppImage = path.resolve(appImage)
	if (!existsSync(resolvedAppImage) || !statSync(resolvedAppImage).isFile()) {
		throw new Error(`AppImage is missing: ${resolvedAppImage}`)
	}
	if (!resolvedAppImage.toLowerCase().endsWith(".appimage")) {
		throw new Error(`Linux release artifact must use the .AppImage extension: ${resolvedAppImage}`)
	}
	if ((statSync(resolvedAppImage).mode & 0o111) === 0) {
		throw new Error(`AppImage is not executable: ${resolvedAppImage}`)
	}
	assertElfArchitecture(resolvedAppImage, arch)
	if (metadataFile) verifyLinuxUpdateMetadata(metadataFile, resolvedAppImage, arch)

	if (!extract) return { appImage: resolvedAppImage, arch }
	const extractionRoot = mkdtempSync(path.join(os.tmpdir(), "cocode-appimage-verify-"))
	try {
		execFileSync(resolvedAppImage, ["--appimage-extract"], {
			cwd: extractionRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		})
		const appDir = path.join(extractionRoot, "squashfs-root")
		if (!existsSync(appDir)) throw new Error("AppImage extraction did not create squashfs-root.")
		verifyAppDir(appDir, arch)
		return { appImage: resolvedAppImage, arch, appDir }
	} finally {
		rmSync(extractionRoot, { recursive: true, force: true })
	}
}

export function writeLinuxReleaseManifest({
	appImage,
	arch,
	version,
	metadataFiles = [],
	outDir = path.dirname(appImage),
	hostPlatform = process.platform,
	hostArch = process.arch,
	manifestFileName = `linux-release-manifest-${arch}.json`,
} = {}) {
	const resolvedAppImage = path.resolve(appImage)
	const manifestPath = path.join(path.resolve(outDir), manifestFileName)
	const content = {
		schemaVersion: 1,
		version: String(version ?? "unknown"),
		target: { platform: "linux", arch },
		build: { hostPlatform, hostArch, createdAt: new Date().toISOString() },
		artifact: {
			file: path.basename(resolvedAppImage),
			sha256: createHash("sha256").update(readFileSync(resolvedAppImage)).digest("hex"),
			sha512: createHash("sha512").update(readFileSync(resolvedAppImage)).digest("base64"),
		},
		metadata: metadataFiles.map((file) => path.basename(file)),
	}
	writeFileSync(manifestPath, `${JSON.stringify(content, null, 2)}\n`)
	return manifestPath
}

export function verifyLinuxReleaseManifest(manifestFile, appImage, arch, metadataFiles = []) {
	const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
	const expectedArtifact = path.basename(appImage)
	const expectedMetadata = metadataFiles.map((file) => path.basename(file))
	if (
		manifest.schemaVersion !== 1 ||
		manifest.target?.platform !== "linux" ||
		manifest.target?.arch !== arch ||
		manifest.artifact?.file !== expectedArtifact ||
		manifest.artifact?.sha256 !== createHash("sha256").update(readFileSync(appImage)).digest("hex") ||
		manifest.artifact?.sha512 !== createHash("sha512").update(readFileSync(appImage)).digest("base64") ||
		expectedMetadata.some((file) => !manifest.metadata?.includes(file))
	) {
		throw new Error(`Linux release manifest does not match the final AppImage: ${manifestFile}`)
	}
	return manifest
}

function assertElfArchitecture(file, arch) {
	const output = execFileSync("readelf", ["-h", file], { encoding: "utf8" })
	const machine = output.match(/^\s*Machine:\s*(.+)$/m)?.[1]?.trim() ?? "unknown"
	if (!ELF_MACHINES[arch]?.test(machine)) {
		throw new Error(`ELF architecture mismatch for ${arch}: ${file} (${machine})`)
	}
}

function verifyAppDir(appDir, arch) {
	const required = [
		path.join(appDir, "AppRun"),
		path.join(appDir, "resources", "startup-failure.html"),
		path.join(appDir, "resources", "cocode-node"),
		path.join(appDir, "resources", "dsh-runtime", "runtime-manifest.json"),
		path.join(appDir, "resources", "tui", "manifest.json"),
	]
	for (const file of required) {
		if (!existsSync(file)) throw new Error(`AppImage resource is missing: ${file}`)
	}
	if ((statSync(path.join(appDir, "AppRun")).mode & 0o111) === 0)
		throw new Error("AppImage AppRun is not executable.")
	if (!collectFiles(appDir).some((file) => /\.(desktop|png|svg)$/i.test(file)))
		throw new Error("AppImage desktop entry or icon is missing.")

	const runtimeManifest = JSON.parse(
		readFileSync(path.join(appDir, "resources", "dsh-runtime", "runtime-manifest.json"), "utf8"),
	)
	if (runtimeManifest.platform !== "linux" || runtimeManifest.arch !== arch) {
		throw new Error(`Runtime manifest architecture mismatch for linux/${arch}.`)
	}
	verifyRuntime(path.join(appDir, "resources", "dsh-runtime"), {
		platform: "linux",
		arch,
	})
	const tuiManifest = JSON.parse(
		readFileSync(path.join(appDir, "resources", "tui", "manifest.json"), "utf8"),
	)
	if (tuiManifest.schemaVersion !== 1 || tuiManifest.entry !== "tui/cocode-cli.mjs")
		throw new Error("TUI manifest schema is invalid.")
	const tuiRoot = path.join(appDir, "resources", "tui")
	const cliSha256 = createHash("sha256")
		.update(readFileSync(path.join(tuiRoot, "cocode-cli.mjs")))
		.digest("hex")
	const runtimeSha256 = createHash("sha256")
		.update(readFileSync(path.join(tuiRoot, "cocode-tui.mjs")))
		.digest("hex")
	if (tuiManifest.sha256 !== cliSha256 || tuiManifest.runtimeSha256 !== runtimeSha256) {
		throw new Error("TUI manifest hashes do not match the packaged TUI files.")
	}

	for (const file of collectFiles(appDir).filter((candidate) =>
		/\.node$|\/cocode-node$|\/spawn-helper$/i.test(candidate),
	)) {
		assertElfArchitecture(file, arch)
	}
}

function collectFiles(root, prefix = "") {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const relative = path.join(prefix, entry.name)
		const absolute = path.join(root, entry.name)
		if (entry.isSymbolicLink()) return []
		return entry.isDirectory() ? collectFiles(absolute, relative) : [absolute]
	})
}

function resolveCliAppImage(arch) {
	const directory = path.resolve("release", "linux", arch)
	const candidates = existsSync(directory)
		? readdirSync(directory)
				.filter((entry) => entry.toLowerCase().endsWith(".appimage"))
				.map((entry) => path.join(directory, entry))
		: []
	if (candidates.length !== 1) {
		throw new Error(`Expected exactly one Linux AppImage under ${directory}; found ${candidates.length}.`)
	}
	return candidates[0]
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))) {
	const arch = option("--arch")
	if (arch !== "x64" && arch !== "arm64")
		throw new Error("Usage: node scripts/release/verify-linux-appimage.mjs --arch <x64|arm64> [--appimage <file>]")
	const appImage = option("--appimage") ?? resolveCliAppImage(arch)
	const metadataFile = option("--metadata") ?? path.join(path.dirname(appImage), linuxUpdateMetadataName(arch))
	verifyLinuxAppImage({ appImage, arch, metadataFile })
	const manifestFile = path.join(path.dirname(appImage), `linux-release-manifest-${arch}.json`)
	if (!existsSync(manifestFile))
		throw new Error(`Linux release manifest is missing: ${manifestFile}`)
	verifyLinuxReleaseManifest(manifestFile, appImage, arch, [metadataFile])
}

function option(name) {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}
