import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

/** @type {(...args: any[]) => any} */
const runCommand = (...args) => execFileSync(...args)

export function verifyLinuxRepositorySnapshot(root, { version, packages = [], run = runCommand } = {}) {
	const repositoryRoot = path.resolve(root)
	const repositoryPackages = packages.length > 0 ? packages : discoverRepositoryPackages(repositoryRoot)
	const required = [
		"apt/dists/stable/InRelease",
		"apt/dists/stable/Release",
		"apt/dists/stable/Release.gpg",
		"apt/dists/stable/main/binary-amd64/Packages",
		"apt/dists/stable/main/binary-arm64/Packages",
		"rpm/stable/x86_64/repodata/repomd.xml",
		"rpm/stable/x86_64/repodata/repomd.xml.asc",
		"rpm/stable/aarch64/repodata/repomd.xml",
		"rpm/stable/aarch64/repodata/repomd.xml.asc",
		"keys/cocode-archive-keyring.gpg",
		"keys/RPM-GPG-KEY-cocode",
		"clients/apt/cocode.list",
		"clients/rpm/cocode.repo",
	]
	for (const relative of required) {
		const file = path.join(repositoryRoot, relative)
		if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Missing required Linux repository path: ${file}`)
	}
	const aptSource = readFileSync(path.join(repositoryRoot, "clients/apt/cocode.list"), "utf8")
	const rpmSource = readFileSync(path.join(repositoryRoot, "clients/rpm/cocode.repo"), "utf8")
	if (!aptSource.includes("https://www.cocode.agency/apt stable main")) throw new Error("APT source does not use www.cocode.agency.")
	if (!rpmSource.includes("https://www.cocode.agency/rpm/stable/$basearch/")) throw new Error("RPM source does not use www.cocode.agency.")
	if (!rpmSource.includes("gpgcheck=1") || !rpmSource.includes("repo_gpgcheck=1")) throw new Error("RPM source signature checks are disabled.")

	for (const relative of [
		"apt/dists/stable/InRelease",
		"apt/dists/stable/Release.gpg",
		"rpm/stable/x86_64/repodata/repomd.xml.asc",
		"rpm/stable/aarch64/repodata/repomd.xml.asc",
	]) {
		const signature = path.join(repositoryRoot, relative)
		if (relative.includes("InRelease")) {
			run("gpg", ["--batch", "--verify", signature], { stdio: "inherit" })
			continue
		}
		const input = relative.includes("Release.gpg")
			? path.join(repositoryRoot, "apt/dists/stable/Release")
			: signature.slice(0, -4)
		run("gpg", ["--batch", "--verify", signature, input], { stdio: "inherit" })
	}

	for (const packageInfo of repositoryPackages) {
		const formatRoot = packageInfo.format === "deb" ? "apt/pool/main/c/cocode" : "rpm/stable"
		const architectureRoot = packageInfo.arch === "x64"
			? packageInfo.format === "deb" ? "amd64" : "x86_64"
			: packageInfo.format === "deb" ? "arm64" : "aarch64"
		const packageFile = path.join(repositoryRoot, formatRoot, architectureRoot, packageInfo.file)
		if (!existsSync(packageFile)) throw new Error(`Repository package is missing: ${packageFile}`)
		if (packageInfo.format === "rpm") run("rpm", ["--checksig", "--verbose", packageFile], { stdio: "inherit" })
	}
	if (version !== undefined) {
		for (const packageInfo of repositoryPackages) {
			if (!packageInfo.file.startsWith(`Cocode-${version}-`)) throw new Error(`Repository package version does not match ${version}: ${packageInfo.file}`)
		}
	}
	return { root: repositoryRoot, version, packages: repositoryPackages }
}

function discoverRepositoryPackages(root) {
	return [
		["x64", "deb", "apt/pool/main/c/cocode/amd64"],
		["x64", "rpm", "rpm/stable/x86_64"],
		["arm64", "deb", "apt/pool/main/c/cocode/arm64"],
		["arm64", "rpm", "rpm/stable/aarch64"],
	].flatMap(([arch, format, relative]) => {
		const directory = path.join(root, relative)
		if (!existsSync(directory)) return []
		return readdirSync(directory)
			.filter((file) => file.toLowerCase().endsWith(`.${format}`))
			.map((file) => ({ arch, format, file }))
	})
}

function cli() {
	const [root, version] = process.argv.slice(2)
	if (!root) throw new Error("Usage: node scripts/release/verify-linux-repository.mjs <repository-root> [version]")
	verifyLinuxRepositorySnapshot(root, { version })
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(new URL(import.meta.url).pathname)) cli()
