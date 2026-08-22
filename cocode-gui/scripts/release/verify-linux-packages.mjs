import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

const PACKAGE_EXTENSIONS = new Set([".deb", ".rpm"])
const PACKAGE_LISTING_MAX_BUFFER = 64 * 1024 * 1024
const EXPECTED_ARCH = {
	x64: { deb: "amd64", rpm: "x86_64" },
	arm64: { deb: "arm64", rpm: "aarch64" },
}

export function linuxPackageFiles(artifacts) {
	return artifacts.filter((file) => PACKAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
}

export function linuxUpdateMetadataName(arch) {
	if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported Linux architecture: ${arch}`)
	return arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml"
}

export function verifyLinuxPackageArtifact(file, arch, { run = execFileSync, inspect = true } = {}) {
	const resolved = path.resolve(file)
	const extension = path.extname(resolved).toLowerCase().slice(1)
	if (!PACKAGE_EXTENSIONS.has(`.${extension}`))
		throw new Error(`Linux release artifact must be a .deb or .rpm package: ${resolved}`)
	if (!existsSync(resolved) || !statSync(resolved).isFile())
		throw new Error(`Linux package is missing: ${resolved}`)
	if (!inspect) return { file: resolved, format: extension }
	const expected = EXPECTED_ARCH[arch]?.[extension]
	if (!expected) throw new Error(`Unsupported Linux architecture: ${arch}`)
	const packageTool = extension === "deb" ? "dpkg-deb" : "rpm"
	if (spawnSync(packageTool, ["--version"], { stdio: "ignore" }).status !== 0) {
		const marker = arch === "x64" ? /(?:x86_64|amd64|x64)/i : /(?:arm64|aarch64)/i
		if (!marker.test(path.basename(resolved)))
			throw new Error(`Cannot verify ${extension} architecture without ${packageTool}: ${resolved}`)
		return { file: resolved, format: extension, architecture: "unverified" }
	}
	const actual = extension === "deb"
		? run("dpkg-deb", ["-f", resolved, "Architecture"], { encoding: "utf8" }).trim()
		: run("rpm", ["-qp", "--qf", "%{ARCH}", resolved], { encoding: "utf8" }).trim()
	if (actual !== expected)
		throw new Error(`Linux package architecture mismatch for ${arch}: ${resolved} (${actual})`)
	const listing = extension === "deb"
		? run("dpkg-deb", ["-c", resolved], {
			encoding: "utf8",
			maxBuffer: PACKAGE_LISTING_MAX_BUFFER,
		})
		: run("rpm", ["-qpl", "--dump", resolved], {
			encoding: "utf8",
			maxBuffer: PACKAGE_LISTING_MAX_BUFFER,
		})
	for (const required of ["cocode-gui", "resources/startup-failure.html", "resources/cocode-node", "resources/dsh-runtime", "resources/tui"]) {
		if (!listing.includes(required)) throw new Error(`Linux package is missing ${required}: ${resolved}`)
	}
	if (!listing.includes("chrome-sandbox"))
		throw new Error(`Linux package is missing chrome-sandbox: ${resolved}`)
	if (extension === "deb") {
		const sandboxRow = listing.split(/\r?\n/).find((row) => row.includes("chrome-sandbox"))
		if (!/^-rwsr-xr-x\s/.test(sandboxRow ?? ""))
			throw new Error(`Linux package chrome-sandbox must retain SUID mode 4755: ${resolved}`)
	} else {
		const sandboxRow = listing.split(/\r?\n/).find((row) => row.includes("/chrome-sandbox"))
		if (!/(?:^|\s)0?104755(?:\s|$)/.test(sandboxRow ?? ""))
			throw new Error(`Linux package chrome-sandbox must retain SUID mode 4755: ${resolved}`)
	}
	return { file: resolved, format: extension, architecture: actual }
}

export function verifyLinuxPackageSignature(
	packageFile,
	signatureFile = `${packageFile}.asc`,
	{ run = execFileSync, gpgHome = process.env.LINUX_GPG_HOME?.trim() } = {},
) {
	const packagePath = path.resolve(packageFile)
	const signaturePath = path.resolve(signatureFile)
	if (!existsSync(packagePath) || !statSync(packagePath).isFile())
		throw new Error(`Linux package is missing: ${packagePath}`)
	if (!existsSync(signaturePath) || !statSync(signaturePath).isFile())
		throw new Error(`Linux package signature is missing: ${signaturePath}`)
	if (spawnSync("gpg", ["--version"], { stdio: "ignore" }).status !== 0)
		throw new Error("GPG is required to verify Linux package signatures.")
	const args = ["--batch"]
	if (gpgHome) args.push("--homedir", path.resolve(gpgHome))
	args.push("--verify", signaturePath, packagePath)
	try {
		run("gpg", args, { stdio: "inherit" })
	} catch (error) {
		throw new Error(`Linux package signature verification failed: ${signaturePath}`, {
			cause: error,
		})
	}
	return { packageFile: packagePath, signatureFile: signaturePath }
}

export function verifyLinuxUpdateMetadata(metadataFile, artifacts, arch) {
	const expectedMetadata = linuxUpdateMetadataName(arch)
	if (path.basename(metadataFile) !== expectedMetadata)
		throw new Error(`Linux updater metadata filename must be ${expectedMetadata}: ${metadataFile}`)
	const metadata = parseYaml(readFileSync(metadataFile, "utf8"))
	const expected = new Map(linuxPackageFiles(artifacts).map((file) => [
		path.basename(file), createHash("sha512").update(readFileSync(file)).digest("base64"),
	]))
	const rows = metadata?.files ?? []
	if (!Array.isArray(rows) || rows.length !== expected.size)
		throw new Error(`Linux updater metadata does not list every package: ${metadataFile}`)
	for (const row of rows) {
		if (typeof row?.url !== "string" || typeof row?.sha512 !== "string")
			throw new Error(`Linux updater metadata contains an invalid file row: ${metadataFile}`)
		if (expected.get(row.url) !== row.sha512)
			throw new Error(`Linux updater metadata hash does not match ${row.url}: ${metadataFile}`)
		expected.delete(row.url)
	}
	if (expected.size !== 0)
		throw new Error(`Linux updater metadata is missing package entries: ${metadataFile}`)
	return metadata
}

export function writeLinuxReleaseManifest({
	packages,
	arch,
	version,
	metadataFiles = [],
	signatures = [],
	outDir = path.dirname(packages[0]),
	hostPlatform = process.platform,
	hostArch = process.arch,
	manifestFileName = `linux-release-manifest-${arch}.json`,
} = {}) {
	if (!Array.isArray(packages) || packages.length === 0) throw new Error("Linux release packages are required.")
	const resolvedPackages = linuxPackageFiles(packages).map((file) => path.resolve(file))
	const manifestPath = path.join(path.resolve(outDir), manifestFileName)
	const content = {
		schemaVersion: 2,
		version: String(version ?? "unknown"),
		target: { platform: "linux", arch },
		build: { hostPlatform, hostArch, createdAt: new Date().toISOString() },
		artifacts: resolvedPackages.map((file) => ({
			file: path.basename(file),
			format: path.extname(file).slice(1),
			sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
			sha512: createHash("sha512").update(readFileSync(file)).digest("base64"),
		})),
		signatures: signatures.map((file) => path.basename(file)),
		metadata: metadataFiles.map((file) => path.basename(file)),
	}
	writeFileSync(manifestPath, `${JSON.stringify(content, null, 2)}\n`)
	return manifestPath
}

export function verifyLinuxReleaseManifest(manifestFile, packages, arch, metadataFiles = [], signatures = []) {
	const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
	const expectedPackages = linuxPackageFiles(packages).map((file) => path.resolve(file)).sort()
	if (
		manifest.schemaVersion !== 2 ||
		manifest.target?.platform !== "linux" ||
		manifest.target?.arch !== arch ||
		JSON.stringify(manifest.artifacts?.map((item) => item.file).sort()) !== JSON.stringify(expectedPackages.map((file) => path.basename(file))) ||
		JSON.stringify(manifest.metadata?.slice().sort()) !== JSON.stringify(metadataFiles.map((file) => path.basename(file)).sort()) ||
		JSON.stringify(manifest.signatures?.slice().sort()) !== JSON.stringify(signatures.map((file) => path.basename(file)).sort())
	) {
		throw new Error(`Linux release manifest does not match the final packages: ${manifestFile}`)
	}
	for (const file of expectedPackages) {
		const entry = manifest.artifacts.find((item) => item.file === path.basename(file))
		if (entry?.sha256 !== createHash("sha256").update(readFileSync(file)).digest("hex") ||
			entry?.sha512 !== createHash("sha512").update(readFileSync(file)).digest("base64")) {
			throw new Error(`Linux release manifest hash does not match ${file}: ${manifestFile}`)
		}
	}
	return manifest
}

function collectFiles(root) {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(root, entry.name)
		return entry.isDirectory() ? collectFiles(file) : [file]
	})
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))) {
	const arch = process.argv[process.argv.indexOf("--arch") + 1]
	const root = process.argv[process.argv.indexOf("--root") + 1] ?? path.resolve("release", "linux", arch)
	if (arch !== "x64" && arch !== "arm64") throw new Error("Usage: node scripts/release/verify-linux-packages.mjs --arch <x64|arm64> [--root <directory>]")
	const files = collectFiles(root).filter((file) => PACKAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
	if (files.length !== 2) throw new Error(`Expected one .deb and one .rpm under ${root}; found ${files.length}.`)
	for (const file of files) verifyLinuxPackageArtifact(file, arch)
	const metadata = path.join(root, linuxUpdateMetadataName(arch))
	verifyLinuxUpdateMetadata(metadata, files, arch)
	const signatures = files.map((file) => `${file}.asc`)
	for (const [index, file] of files.entries()) verifyLinuxPackageSignature(file, signatures[index])
	const manifest = path.join(root, `linux-release-manifest-${arch}.json`)
	verifyLinuxReleaseManifest(manifest, files, arch, [metadata], signatures)
}
