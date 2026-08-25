import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import { finalizeLinuxReleaseAssets } from "../../scripts/release/finalize-linux-release-assets.mjs"

test("rebuilds Linux updater metadata, manifest, and checksums from signed packages", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-finalize-"))
	try {
		const releaseRoot = path.join(root, "x64")
		mkdirSync(releaseRoot, { recursive: true })
		const packages = [
			"Cocode-1.2.3-x86_64.deb",
			"Cocode-1.2.3-x86_64.rpm",
		]
		for (const file of packages) {
			writeFileSync(path.join(releaseRoot, file), `${file}-signed`)
			writeFileSync(path.join(releaseRoot, `${file}.asc`), `${file}-signature`)
		}

		const result = finalizeLinuxReleaseAssets({ root: releaseRoot, arch: "x64", version: "1.2.3" })

		assert.equal(path.basename(result.metadata), "latest-linux.yml")
		assert.equal(existsSync(result.manifest), true)
		assert.equal(existsSync(result.checksum), true)
		assert.match(readFileSync(result.metadata, "utf8"), /version: 1\.2\.3/)
		assert.match(readFileSync(result.metadata, "utf8"), /Cocode-1\.2\.3-x86_64\.rpm/)
		assert.deepEqual(JSON.parse(readFileSync(result.manifest, "utf8")).signatures.sort(), [
			"Cocode-1.2.3-x86_64.deb.asc",
			"Cocode-1.2.3-x86_64.rpm.asc",
		])
		assert.match(readFileSync(result.checksum, "utf8"), /latest-linux\.yml/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects a Linux release directory with a missing detached signature", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-finalize-"))
	try {
		writeFileSync(path.join(root, "Cocode-1.2.3-x86_64.deb"), "signed")
		writeFileSync(path.join(root, "Cocode-1.2.3-x86_64.rpm"), "signed")
		writeFileSync(path.join(root, "Cocode-1.2.3-x86_64.deb.asc"), "signature")
		assert.throws(
			() => finalizeLinuxReleaseAssets({ root, arch: "x64", version: "1.2.3" }),
			/missing Linux package signature/i,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
