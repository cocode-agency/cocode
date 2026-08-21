import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import {
	linuxArtifactArchLabel,
	linuxUpdateMetadataName,
	verifyLinuxUpdateMetadata,
	verifyLinuxReleaseManifest,
	writeLinuxReleaseManifest,
} from "../../scripts/release/verify-linux-appimage.mjs"

test("maps Linux release architectures to artifact and metadata names", () => {
	assert.equal(linuxArtifactArchLabel("x64"), "x86_64")
	assert.equal(linuxArtifactArchLabel("arm64"), "arm64")
	assert.equal(linuxUpdateMetadataName("x64"), "latest-linux.yml")
	assert.equal(linuxUpdateMetadataName("arm64"), "latest-linux-arm64.yml")
})

test("verifies Linux updater metadata against the final AppImage", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-appimage-test-"))
	try {
		const appImage = path.join(root, "Cocode-1.2.3-x86_64.AppImage")
		const metadata = path.join(root, "latest-linux.yml")
		writeFileSync(appImage, "appimage")
		chmodSync(appImage, 0o755)
		const sha512 = "s2V4Y2hhbmdlZA=="
		writeFileSync(
			metadata,
			[
				"version: 1.2.3",
				"files:",
				`  - url: ${JSON.stringify(path.basename(appImage))}`,
				`    sha512: ${JSON.stringify(sha512)}`,
				`path: ${JSON.stringify(path.basename(appImage))}`,
				`sha512: ${JSON.stringify(sha512)}`,
				"",
			].join("\n"),
		)
		assert.throws(
			() => verifyLinuxUpdateMetadata(metadata, appImage, "x64"),
			/does not match the final AppImage/,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects Linux updater metadata that points to another architecture", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-appimage-test-"))
	try {
		const appImage = path.join(root, "Cocode-1.2.3-arm64.AppImage")
		const metadata = path.join(root, "latest-linux.yml")
		writeFileSync(appImage, "arm64-appimage")
		writeFileSync(metadata, "version: 1.2.3\n")
		assert.throws(
			() => verifyLinuxUpdateMetadata(metadata, appImage, "arm64"),
			/metadata filename must be latest-linux-arm64\.yml/,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("writes architecture-scoped Linux release evidence manifests", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-appimage-test-"))
	try {
		const appImage = path.join(root, "Cocode-1.2.3-arm64.AppImage")
		writeFileSync(appImage, "arm64-appimage")
		const manifest = writeLinuxReleaseManifest({
			appImage,
			arch: "arm64",
			version: "1.2.3",
		})
		assert.equal(manifest, path.join(root, "linux-release-manifest-arm64.json"))
		assert.doesNotThrow(() => verifyLinuxReleaseManifest(manifest, appImage, "arm64"))
		writeFileSync(manifest, "{}\n")
		assert.throws(
			() => verifyLinuxReleaseManifest(manifest, appImage, "arm64"),
			/does not match the final AppImage/,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
