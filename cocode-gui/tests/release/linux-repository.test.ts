import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import test from "node:test"
import * as path from "pathe"
import {
	DEFAULT_LINUX_REPOSITORY_BASE_URL,
	buildLinuxRepository,
	createAptSourcesList,
	createRpmRepositoryFile,
	getLinuxRepositoryLayout,
	resolveLinuxRepositoryConfig,
} from "../../scripts/release/linux-repository.mjs"

test("uses www.cocode.agency as the signed Linux repository base URL", () => {
	const config = resolveLinuxRepositoryConfig({})

	assert.equal(config.baseUrl, DEFAULT_LINUX_REPOSITORY_BASE_URL)
	assert.equal(config.aptUrl, "https://www.cocode.agency/apt")
	assert.equal(config.rpmUrl, "https://www.cocode.agency/rpm")
	assert.equal(
		createAptSourcesList(config),
		"deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/cocode-archive-keyring.gpg] https://www.cocode.agency/apt stable main\n",
	)
	assert.equal(
		createRpmRepositoryFile(config),
		"[cocode]\nname=Cocode\nbaseurl=https://www.cocode.agency/rpm/stable/$basearch/\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=https://www.cocode.agency/keys/RPM-GPG-KEY-cocode\n",
	)
})

test("allows a validated staging repository URL", () => {
	const config = resolveLinuxRepositoryConfig({ LINUX_REPOSITORY_BASE_URL: "https://repo.example.test" })

	assert.equal(config.baseUrl, "https://repo.example.test")
	assert.equal(config.aptUrl, "https://repo.example.test/apt")
	assert.equal(config.rpmUrl, "https://repo.example.test/rpm")
})

test("rejects insecure or path-bearing repository base URLs", () => {
	assert.throws(
		() => resolveLinuxRepositoryConfig({ LINUX_REPOSITORY_BASE_URL: "http://www.cocode.agency" }),
		/HTTPS/i,
	)
	assert.throws(
		() => resolveLinuxRepositoryConfig({ LINUX_REPOSITORY_BASE_URL: "https://www.cocode.agency/repo" }),
		/root URL must not include a path/i,
	)
})

test("creates stable architecture-specific APT and RPM repository paths", () => {
	const layout = getLinuxRepositoryLayout("/tmp/cocode-repository")

	assert.equal(layout.aptRoot, "/tmp/cocode-repository/apt")
	assert.equal(layout.aptPool, "/tmp/cocode-repository/apt/pool/main/c/cocode")
	assert.equal(layout.aptDists, "/tmp/cocode-repository/apt/dists/stable")
	assert.equal(layout.aptBinaryAmd64, "/tmp/cocode-repository/apt/dists/stable/main/binary-amd64")
	assert.equal(layout.aptBinaryArm64, "/tmp/cocode-repository/apt/dists/stable/main/binary-arm64")
	assert.equal(layout.rpmX8664, "/tmp/cocode-repository/rpm/stable/x86_64")
	assert.equal(layout.rpmAarch64, "/tmp/cocode-repository/rpm/stable/aarch64")
})

test("builds signed APT and RPM repository trees from both native architectures", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-repository-"))
	try {
		const inputRoot = path.join(root, "release-assets")
		const outputRoot = path.join(root, "linux-repository")
		for (const [directory, files] of [
			[
				"x64",
				["Cocode-1.2.3-x86_64.deb", "Cocode-1.2.3-x86_64.rpm"],
			],
			[
				"arm64",
				["Cocode-1.2.3-arm64.deb", "Cocode-1.2.3-arm64.rpm"],
			],
		] as const) {
			mkdirSync(path.join(inputRoot, directory), { recursive: true })
			for (const file of files) writeFileSync(path.join(inputRoot, directory, file), file)
		}

		const calls: Array<{ command: string; args: readonly string[] }> = []
		const run = (command: string, args: readonly string[], options: Record<string, unknown> = {}) => {
			calls.push({ command, args })
			if (command === "apt-ftparchive" && args[0] === "packages") return `Package: cocode\nFilename: ${args[1]}/package.deb\n`
			if (command === "apt-ftparchive" && args[0] === "release") return "Suite: stable\n"
			if (command === "gpg" && args.includes("--export")) return "PUBLIC KEY"
			if (command === "createrepo_c") {
				const directory = String(args[0])
				mkdirSync(path.join(directory, "repodata"), { recursive: true })
				writeFileSync(path.join(directory, "repodata", "repomd.xml"), "repomd")
			}
			void options
			return ""
		}

		const result = buildLinuxRepository({
			inputRoot,
			outputRoot,
			version: "1.2.3",
			key: "cocode-key",
			required: true,
			run,
		})

		assert.equal(result.baseUrl, "https://www.cocode.agency")
		assert.equal(existsSync(path.join(outputRoot, "apt/dists/stable/InRelease")), false)
		assert.equal(existsSync(path.join(outputRoot, "apt/pool/main/c/cocode/amd64/Cocode-1.2.3-x86_64.deb")), true)
		assert.equal(existsSync(path.join(outputRoot, "apt/pool/main/c/cocode/arm64/Cocode-1.2.3-arm64.deb")), true)
		assert.equal(existsSync(path.join(outputRoot, "rpm/stable/x86_64/Cocode-1.2.3-x86_64.rpm")), true)
		assert.equal(existsSync(path.join(outputRoot, "rpm/stable/aarch64/Cocode-1.2.3-arm64.rpm")), true)
		assert.match(readFileSync(path.join(outputRoot, "clients/apt/cocode.list"), "utf8"), /https:\/\/www\.cocode\.agency\/apt/)
		assert.match(readFileSync(path.join(outputRoot, "clients/rpm/cocode.repo"), "utf8"), /repo_gpgcheck=1/)
		assert.deepEqual(
			calls.filter(({ command }) => command === "apt-ftparchive").map(({ args }) => args[0]),
			["packages", "packages", "release"],
		)
		assert.equal(calls.filter(({ command }) => command === "createrepo_c").length, 2)
		assert.equal(calls.filter(({ command, args }) => command === "gpg" && args.includes("--clearsign")).length, 1)
		assert.equal(calls.filter(({ command, args }) => command === "gpg" && args.includes("--detach-sign")).length, 3)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
