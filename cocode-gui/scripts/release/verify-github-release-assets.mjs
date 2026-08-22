import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { verifyLinuxUpdateMetadata } from "./verify-linux-packages.mjs"

const packageMetadata = createRequire(import.meta.url)("../../package.json")

export function verifyLocalGitHubReleaseAssets(tag, root, { packageVersion = packageMetadata.version } = {}) {
	assertTagVersion(tag, packageVersion)
	const files = collectFiles(path.resolve(root))
	const byName = new Map()
	for (const file of files) {
		const name = path.basename(file)
		if (byName.has(name)) throw new Error(`Duplicate GitHub release asset: ${name}`)
		byName.set(name, file)
	}
	const architectureAssets = []
	for (const [arch, metadataName] of [
		["x64", "latest-linux.yml"],
		["arm64", "latest-linux-arm64.yml"],
	]) {
		const packages = [...byName.values()].filter((file) => {
			const name = path.basename(file).toLowerCase()
			return [".deb", ".rpm"].some((extension) => name.endsWith(extension)) && packageMatchesArch(name, arch)
		})
		const metadata = byName.get(metadataName)
		if (packages.length !== 2 || !metadata) {
			throw new Error(`Missing Linux release assets for ${arch}: one .deb, one .rpm and ${metadataName}.`)
		}
		const signatures = packages.map((file) => byName.get(`${path.basename(file)}.asc`))
		if (signatures.some((file) => !file)) throw new Error(`Missing Linux package signature for ${arch}.`)
		verifyLinuxUpdateMetadata(metadata, packages, arch)
		architectureAssets.push({ arch, packages, metadata, signatures })
	}
	for (const { arch, packages, metadata, signatures } of architectureAssets)
		verifyLocalEvidence(arch, packages, metadata, signatures)
	return [...byName.keys()].sort()
}

export function verifyGitHubReleaseAssets(
	tag,
	{ packageVersion = packageMetadata.version, run = execFileSync } = {},
) {
	assertTagVersion(tag, packageVersion)
	const raw = run("gh", ["release", "view", tag, "--json", "assets"], { encoding: "utf8" })
	const payload = JSON.parse(raw)
	const names = (payload.assets ?? []).map((asset) => asset.name).filter(Boolean)
	const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
	if (duplicates.length > 0) throw new Error(`Duplicate GitHub release assets: ${duplicates.join(", ")}`)
	const required = [
		"latest-linux.yml",
		"latest-linux-arm64.yml",
		"SHA256SUMS-x64",
		"SHA256SUMS-arm64",
		"linux-release-manifest-x64.json",
		"linux-release-manifest-arm64.json",
	]
	const missing = required.filter((name) => !names.includes(name))
	if (missing.length > 0) throw new Error(`GitHub Release is missing assets: ${missing.join(", ")}`)
	for (const arch of ["x64", "arm64"]) {
		const packages = names.filter((name) => [".deb", ".rpm"].some((extension) => name.toLowerCase().endsWith(extension)) && packageMatchesArch(name, arch))
		if (packages.length !== 2) throw new Error(`GitHub Release must contain one .deb and one .rpm for ${arch}.`)
		const missingSignatures = packages.map((name) => `${name}.asc`).filter((name) => !names.includes(name))
		if (missingSignatures.length > 0) throw new Error(`GitHub Release is missing Linux signatures: ${missingSignatures.join(", ")}`)
	}
	return names.sort()
}

function assertTagVersion(tag, packageVersion) {
	if (tag !== `v${packageVersion}`) {
		throw new Error(`Release tag ${tag} does not match package version v${packageVersion}.`)
	}
}

function verifyLocalEvidence(arch, packages, metadata, signatures) {
	const metadataName = path.basename(metadata)
	const checksumName = `SHA256SUMS-${arch}`
	const manifestName = `linux-release-manifest-${arch}.json`
	const evidenceRoot = path.dirname(packages[0])
	const checksumFile = path.join(evidenceRoot, checksumName)
	const manifestFile = path.join(evidenceRoot, manifestName)
	if (!existsSync(checksumFile))
		throw new Error(`Missing Linux release evidence asset: ${checksumName}`)
	if (!existsSync(manifestFile))
		throw new Error(`Missing Linux release evidence asset: ${manifestName}`)

	const checksumRows = new Map(
		readFileSync(checksumFile, "utf8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i)
				if (!match) throw new Error(`Invalid SHA256 manifest row: ${checksumFile}`)
				return [path.basename(match[2]), match[1].toLowerCase()]
			}),
	)
	for (const file of [...packages, metadata, ...signatures, manifestFile]) {
		const expected = createSha256(file)
		if (checksumRows.get(path.basename(file)) !== expected) {
			throw new Error(`SHA256 manifest does not match ${path.basename(file)}: ${checksumFile}`)
		}
	}

	const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
	if (
		manifest.schemaVersion !== 2 ||
		manifest.target?.platform !== "linux" ||
		manifest.target?.arch !== arch ||
		JSON.stringify(manifest.artifacts?.map((item) => item.file).sort()) !== JSON.stringify(packages.map((file) => path.basename(file)).sort()) ||
		JSON.stringify(manifest.signatures?.slice().sort()) !== JSON.stringify(signatures.map((file) => path.basename(file)).sort()) ||
		!manifest.metadata?.includes(metadataName)
	) {
		throw new Error(`Linux release manifest does not match ${arch}: ${manifestFile}`)
	}
	for (const packageFile of packages) {
		const entry = manifest.artifacts.find((item) => item.file === path.basename(packageFile))
		if (entry?.sha256 !== createSha256(packageFile) || entry?.sha512 !== createSha512(packageFile))
			throw new Error(`Linux release manifest hash does not match ${packageFile}: ${manifestFile}`)
	}
}

function packageMatchesArch(name, arch) {
	const normalized = name.toLowerCase()
	if (arch === "x64") return /(?:x86_64|amd64|x64)(?:[._-]|\.)/.test(normalized)
	return /(?:arm64|aarch64)(?:[._-]|\.)/.test(normalized)
}

function createSha256(file) {
	return cryptoHash("sha256", file, "hex")
}

function createSha512(file) {
	return cryptoHash("sha512", file, "base64")
}

function cryptoHash(algorithm, file, encoding) {
	return createHash(algorithm).update(readFileSync(file)).digest(encoding)
}

function collectFiles(root) {
	if (!existsSync(root)) throw new Error(`Release asset directory is missing: ${root}`)
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const absolute = path.join(root, entry.name)
		return entry.isDirectory() ? collectFiles(absolute) : [absolute]
	})
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))) {
	const tag = process.argv[2]
	const source = process.argv[3]
	if (!tag || !source) throw new Error("Usage: node scripts/release/verify-github-release-assets.mjs <tag> <directory|github-release>")
	if (source === "github-release") verifyGitHubReleaseAssets(tag)
	else verifyLocalGitHubReleaseAssets(tag, source)
}
