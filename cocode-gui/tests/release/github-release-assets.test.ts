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
		const x64Fixture = writeFixture(x64, "Cocode-1.0.1-x86_64.AppImage", "latest-linux.yml")
		const arm64Fixture = writeFixture(arm64, "Cocode-1.0.1-arm64.AppImage", "latest-linux-arm64.yml")
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
		writeFixture(root, "Cocode-1.0.1-x86_64.AppImage", "latest-linux.yml")
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
		"Cocode-1.0.1-x86_64.AppImage",
		"Cocode-1.0.1-arm64.AppImage",
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
	appImageName: string,
	metadataName: string,
): { appImage: string; metadata: string } {
	const appImage = path.join(root, appImageName)
	writeFileSync(appImage, appImageName)
	const sha512 = createHash("sha512").update(appImageName).digest("base64")
	const metadata = path.join(root, metadataName)
	writeFileSync(
		metadata,
		[
			"version: 1.0.1",
			"files:",
			`  - url: "${appImageName}"`,
			`    sha512: "${sha512}"`,
			`path: "${appImageName}"`,
			`sha512: "${sha512}"`,
			"",
		].join("\n"),
	)
	return { appImage, metadata }
}

function writeEvidence(
	root: string,
	arch: "x64" | "arm64",
	{ appImage, metadata }: { appImage: string; metadata: string },
): void {
	const manifest = path.join(root, `linux-release-manifest-${arch}.json`)
	const appImageBytes = readFile(appImage)
	writeFileSync(
		manifest,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				target: { platform: "linux", arch },
				artifact: {
					file: path.basename(appImage),
					sha256: createHash("sha256").update(appImageBytes).digest("hex"),
					sha512: createHash("sha512").update(appImageBytes).digest("base64"),
				},
				metadata: [path.basename(metadata)],
			},
			null,
		2,
		)}\n`,
	)
	const rows = [appImage, metadata, manifest]
		.map((file) => `${createHash("sha256").update(readFile(file)).digest("hex")}  ${path.basename(file)}`)
		.join("\n")
	writeFileSync(path.join(root, `SHA256SUMS-${arch}`), `${rows}\n`)
}

function readFile(file: string): Buffer {
	return readFileSync(file)
}
