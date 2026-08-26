import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import {
	assertReleaseEvidenceReady,
	createReleaseEvidence,
	readReleaseEvidenceManifest,
	updateReleaseEvidenceStage,
	writeReleaseEvidenceManifest,
} from "../../scripts/release/release-evidence.mjs"

test("creates an evidence manifest with independent release stages", () => {
	const manifest = createReleaseEvidence({
		platform: "darwin",
		arch: "arm64",
		nativeHost: "darwin/arm64",
		version: "1.2.3",
	})

	assert.equal(manifest.schemaVersion, 1)
	assert.deepEqual(manifest.target, { platform: "darwin", arch: "arm64" })
	for (const stage of [
		"source",
		"staging",
		"native",
		"electronPackage",
		"installSmoke",
		"updater",
		"publication",
	]) {
		assert.equal(manifest.stages[stage].status, "not-run")
	}
	assert.deepEqual(manifest.ownership, { guiMain: [], dshRuntime: [] })
})

test("electron package evidence does not imply install smoke evidence", () => {
	const initial = createReleaseEvidence({
		platform: "darwin",
		arch: "arm64",
		nativeHost: "darwin/arm64",
		version: "1.2.3",
	})
	const sourced = updateReleaseEvidenceStage(initial, "source", {
		status: "passed",
		summary: "workspace inputs verified",
	})
	const staged = updateReleaseEvidenceStage(sourced, "staging", {
		status: "passed",
		summary: "runtime staging verified",
	})
	const native = updateReleaseEvidenceStage(staged, "native", {
		status: "passed",
		summary: "native inventory verified",
	})
	const packaged = updateReleaseEvidenceStage(native, "electronPackage", {
		status: "passed",
		command: "electron-builder --publish never",
	})

	assert.equal(packaged.stages.electronPackage.status, "passed")
	assert.equal(packaged.stages.installSmoke.status, "not-run")
	assert.throws(
		() => assertReleaseEvidenceReady(packaged, { requireInstallSmoke: true }),
		/installSmoke evidence is not passed/,
	)
	assert.doesNotThrow(() => assertReleaseEvidenceReady(packaged))
})

test("writes and reads a manifest without changing unexecuted updater or publication stages", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-release-evidence-"))
	try {
		const manifest = updateReleaseEvidenceStage(
			createReleaseEvidence({
				platform: "darwin",
				arch: "arm64",
				nativeHost: "darwin/arm64",
				version: "1.2.3",
			}),
			"electronPackage",
			{ status: "passed", artifacts: ["Cocode-1.2.3-arm64.pkg"] },
		)
		const file = writeReleaseEvidenceManifest({ outDir: root, manifest })
		assert.equal(existsSync(file), true)
		const reread = readReleaseEvidenceManifest(file)
		assert.deepEqual(reread, manifest)
		assert.equal(reread.stages.updater.status, "not-run")
		assert.equal(reread.stages.publication.status, "not-run")
		assert.equal(readFileSync(file, "utf8").endsWith("\n"), true)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects a release evidence manifest whose stage status is invalid", () => {
	const manifest = createReleaseEvidence({
		platform: "linux",
		arch: "x64",
		nativeHost: "linux/x64",
		version: "1.2.3",
	})
	assert.throws(
		() => updateReleaseEvidenceStage(manifest, "native", { status: "passed" }),
		/Missing native evidence details/,
	)
	assert.throws(
		() => assertReleaseEvidenceReady({ ...manifest, stages: { ...manifest.stages, native: { status: "broken" } } }),
		/Invalid release evidence status/,
	)
	assert.throws(
		() => updateReleaseEvidenceStage(manifest, "installSmoke", { status: "passed" }),
		/Missing installSmoke evidence details/,
	)
})
