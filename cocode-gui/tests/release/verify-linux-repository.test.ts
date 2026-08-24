import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import { verifyLinuxRepositorySnapshot } from "../../scripts/release/verify-linux-repository.mjs"

test("verifies the stable APT/RPM repository snapshot layout", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-repository-verify-"))
	try {
		const apt = path.join(root, "apt/dists/stable")
		const rpmX64 = path.join(root, "rpm/stable/x86_64")
		const rpmArm64 = path.join(root, "rpm/stable/aarch64")
		for (const directory of [
			path.join(apt, "main/binary-amd64"),
			path.join(apt, "main/binary-arm64"),
			path.join(rpmX64, "repodata"),
			path.join(rpmArm64, "repodata"),
			path.join(root, "keys"),
			path.join(root, "clients/apt"),
			path.join(root, "clients/rpm"),
		]) mkdirSync(directory, { recursive: true })
		for (const file of [
			path.join(apt, "InRelease"),
			path.join(apt, "Release"),
			path.join(apt, "Release.gpg"),
			path.join(apt, "main/binary-amd64/Packages"),
			path.join(apt, "main/binary-arm64/Packages"),
			path.join(rpmX64, "repodata/repomd.xml"),
			path.join(rpmX64, "repodata/repomd.xml.asc"),
			path.join(rpmArm64, "repodata/repomd.xml"),
			path.join(rpmArm64, "repodata/repomd.xml.asc"),
			path.join(root, "keys/cocode-archive-keyring.gpg"),
			path.join(root, "keys/RPM-GPG-KEY-cocode"),
			path.join(root, "clients/apt/cocode.list"),
			path.join(root, "clients/rpm/cocode.repo"),
		]) writeFileSync(file, file.includes("clients/apt")
			? "deb https://www.cocode.agency/apt stable main\n"
			: file.includes("clients/rpm")
				? "baseurl=https://www.cocode.agency/rpm/stable/$basearch/\ngpgcheck=1\nrepo_gpgcheck=1\n"
				: file)
		for (const file of [
			path.join(root, "apt/pool/main/c/cocode/amd64/Cocode-1.2.3-x86_64.deb"),
			path.join(root, "apt/pool/main/c/cocode/arm64/Cocode-1.2.3-arm64.deb"),
			path.join(root, "rpm/stable/x86_64/Cocode-1.2.3-x86_64.rpm"),
			path.join(root, "rpm/stable/aarch64/Cocode-1.2.3-arm64.rpm"),
		]) {
			mkdirSync(path.dirname(file), { recursive: true })
			writeFileSync(file, file)
		}

		assert.doesNotThrow(() =>
			verifyLinuxRepositorySnapshot(root, {
				version: "1.2.3",
				packages: [
					{ arch: "x64", format: "deb", file: "Cocode-1.2.3-x86_64.deb" },
					{ arch: "x64", format: "rpm", file: "Cocode-1.2.3-x86_64.rpm" },
					{ arch: "arm64", format: "deb", file: "Cocode-1.2.3-arm64.deb" },
					{ arch: "arm64", format: "rpm", file: "Cocode-1.2.3-arm64.rpm" },
				],
				run: () => "",
			}),
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects a repository snapshot missing signed metadata", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-repository-verify-"))
	try {
		assert.throws(
			() => verifyLinuxRepositorySnapshot(root, { version: "1.2.3", packages: [], run: () => "" }),
			/missing required Linux repository path/i,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
