import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import {
	verifyGitHubReleaseAssets,
	verifyLocalGitHubReleaseAssets,
} from "../../scripts/release/verify-github-release-assets.mjs"

test("accepts both Linux architectures and their updater metadata", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-release-assets-test-"))
	try {
		const x64 = path.join(root, "x64")
		const arm64 = path.join(root, "arm64")
		mkdirSync(x64, { recursive: true })
		mkdirSync(arm64, { recursive: true })
		const x64Fixture = writeFixture(x64, "x86_64", "latest-linux.yml")
		const arm64Fixture = writeFixture(arm64, "arm64", "latest-linux-arm64.yml")
		writeEvidence(x64, "x64", x64Fixture)
		writeEvidence(arm64, "arm64", arm64Fixture)
		assert.doesNotThrow(() =>
			verifyLocalGitHubReleaseAssets("v1.0.1", root, {
				packageVersion: "1.0.1",
			}),
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects a release asset set with a missing architecture", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-release-assets-test-"))
	try {
		writeFixture(root, "x86_64", "latest-linux.yml")
		assert.throws(
			() => verifyLocalGitHubReleaseAssets("v1.0.1", root, { packageVersion: "1.0.1" }),
			/missing Linux release assets.*arm64/i,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("requires the architecture-scoped assets in the remote GitHub Release", () => {
	const assets = [
		"Cocode-1.0.1-x86_64.deb",
		"Cocode-1.0.1-x86_64.rpm",
		"Cocode-1.0.1-x86_64.deb.asc",
		"Cocode-1.0.1-x86_64.rpm.asc",
		"Cocode-1.0.1-arm64.deb",
		"Cocode-1.0.1-arm64.rpm",
		"Cocode-1.0.1-arm64.deb.asc",
		"Cocode-1.0.1-arm64.rpm.asc",
		"latest-linux.yml",
		"latest-linux-arm64.yml",
		"SHA256SUMS-x64",
		"SHA256SUMS-arm64",
		"linux-release-manifest-x64.json",
		"linux-release-manifest-arm64.json",
	]
	assert.deepEqual(
		verifyGitHubReleaseAssets("v1.0.1", {
			packageVersion: "1.0.1",
				run: () => JSON.stringify({ assets: assets.map((name) => ({ name })) }),
		}),
		[...assets].sort(),
	)
})

function writeFixture(
	root: string,
	archLabel: string,
	metadataName: string,
	): { packages: string[]; metadata: string; signatures: string[] } {
	const packages = [
		path.join(root, `Cocode-1.0.1-${archLabel}.deb`),
		path.join(root, `Cocode-1.0.1-${archLabel}.rpm`),
	]
	for (const file of packages) writeFileSync(file, path.basename(file))
	const signatures = packages.map((file) => `${file}.asc`)
	for (const file of signatures) writeFileSync(file, path.basename(file))
	const metadata = path.join(root, metadataName)
	const rows = packages
		.map((file) => {
			const name = path.basename(file)
			const sha512 = createHash("sha512").update(name).digest("base64")
			return [`  - url: "${name}"`, `    sha512: "${sha512}"`]
		})
	writeFileSync(
		metadata,
		[
			"version: 1.0.1",
			"files:",
			...rows.flat(),
			`path: "${path.basename(packages[0])}"`,
			`sha512: "${createHash("sha512").update(path.basename(packages[0])).digest("base64")}"`,
			"",
		].join("\n"),
	)
	return { packages, metadata, signatures }
}

function writeEvidence(
	root: string,
	arch: "x64" | "arm64",
	{ packages, metadata, signatures }: { packages: string[]; metadata: string; signatures: string[] },
): void {
	const manifest = path.join(root, `linux-release-manifest-${arch}.json`)
	const artifacts = packages.map((file) => ({
		file: path.basename(file),
		format: path.extname(file).slice(1),
		sha256: createHash("sha256").update(readFile(file)).digest("hex"),
		sha512: createHash("sha512").update(readFile(file)).digest("base64"),
	}))
	writeFileSync(
		manifest,
		`${JSON.stringify(
			{
				schemaVersion: 2,
				target: { platform: "linux", arch },
				artifacts,
				signatures: signatures.map((file) => path.basename(file)),
				metadata: [path.basename(metadata)],
			},
			null,
		2,
		)}\n`,
	)
	const rows = [...packages, metadata, ...signatures, manifest]
		.map((file) => `${createHash("sha256").update(readFile(file)).digest("hex")}  ${path.basename(file)}`)
		.join("\n")
	writeFileSync(path.join(root, `SHA256SUMS-${arch}`), `${rows}\n`)
}

function readFile(file: string): Buffer {
	return readFileSync(file)
}
