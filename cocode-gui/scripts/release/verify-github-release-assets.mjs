import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import packageMetadata from "../../package.json" with { type: "json" }
import { verifyLinuxUpdateMetadata } from "./verify-linux-appimage.mjs"

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
	for (const [arch, appImageName, metadataName] of [
		["x64", `Cocode-${packageVersion}-x86_64.AppImage`, "latest-linux.yml"],
		["arm64", `Cocode-${packageVersion}-arm64.AppImage`, "latest-linux-arm64.yml"],
	]) {
		const appImage = byName.get(appImageName)
		const metadata = byName.get(metadataName)
		if (!appImage || !metadata) {
			throw new Error(
				`Missing Linux release assets for ${arch}: ${appImageName} and ${metadataName}.`,
			)
		}
		verifyLinuxUpdateMetadata(metadata, appImage, arch)
		architectureAssets.push({ arch, appImage, metadata })
	}
	for (const { arch, appImage, metadata } of architectureAssets)
		verifyLocalEvidence(arch, appImage, metadata)
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
		`Cocode-${packageVersion}-x86_64.AppImage`,
		`Cocode-${packageVersion}-arm64.AppImage`,
		"latest-linux.yml",
		"latest-linux-arm64.yml",
		"SHA256SUMS-x64",
		"SHA256SUMS-arm64",
		"linux-release-manifest-x64.json",
		"linux-release-manifest-arm64.json",
	]
	const missing = required.filter((name) => !names.includes(name))
	if (missing.length > 0) throw new Error(`GitHub Release is missing assets: ${missing.join(", ")}`)
	return names.sort()
}

function assertTagVersion(tag, packageVersion) {
	if (tag !== `v${packageVersion}`) {
		throw new Error(`Release tag ${tag} does not match package version v${packageVersion}.`)
	}
}

function verifyLocalEvidence(arch, appImage, metadata) {
	const appImageName = path.basename(appImage)
	const metadataName = path.basename(metadata)
	const checksumName = `SHA256SUMS-${arch}`
	const manifestName = `linux-release-manifest-${arch}.json`
	const evidenceRoot = path.dirname(appImage)
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
	for (const file of [appImage, metadata, manifestFile]) {
		const expected = createSha256(file)
		if (checksumRows.get(path.basename(file)) !== expected) {
			throw new Error(`SHA256 manifest does not match ${path.basename(file)}: ${checksumFile}`)
		}
	}

	const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
	if (
		manifest.schemaVersion !== 1 ||
		manifest.target?.platform !== "linux" ||
		manifest.target?.arch !== arch ||
		manifest.artifact?.file !== appImageName ||
		manifest.artifact?.sha256 !== createSha256(appImage) ||
		manifest.artifact?.sha512 !== createSha512(appImage) ||
		!manifest.metadata?.includes(metadataName)
	) {
		throw new Error(`Linux release manifest does not match ${appImageName}: ${manifestFile}`)
	}
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
