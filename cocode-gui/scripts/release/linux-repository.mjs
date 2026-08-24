import { execFileSync } from "node:child_process"
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import * as path from "node:path"
import { gzipSync } from "node:zlib"

export const DEFAULT_LINUX_REPOSITORY_BASE_URL = "https://www.cocode.agency"
export const LINUX_REPOSITORY_CHANNEL = "stable"

/** @type {(...args: any[]) => any} */
const runCommand = (...args) => execFileSync(...args)

export function resolveLinuxRepositoryConfig(environment = process.env) {
	const rawBaseUrl = environment.LINUX_REPOSITORY_BASE_URL?.trim() || DEFAULT_LINUX_REPOSITORY_BASE_URL
	let parsed
	try {
		parsed = new URL(rawBaseUrl)
	} catch {
		throw new Error(`Linux repository root URL is invalid: ${rawBaseUrl}`)
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`Linux repository root URL must use HTTPS: ${rawBaseUrl}`)
	}
	if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
		throw new Error(`Linux repository root URL must not include a path, query, or fragment: ${rawBaseUrl}`)
	}
	const baseUrl = rawBaseUrl.replace(/\/+$/, "")
	return {
		baseUrl,
		aptUrl: `${baseUrl}/apt`,
		rpmUrl: `${baseUrl}/rpm`,
		channel: LINUX_REPOSITORY_CHANNEL,
	}
}

export function createAptSourcesList(config) {
	return `deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/cocode-archive-keyring.gpg] ${config.aptUrl} ${config.channel} main\n`
}

export function createRpmRepositoryFile(config) {
	return `[cocode]\nname=Cocode\nbaseurl=${config.rpmUrl}/${config.channel}/$basearch/\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=${config.baseUrl}/keys/RPM-GPG-KEY-cocode\n`
}

export function getLinuxRepositoryLayout(root) {
	const resolvedRoot = path.resolve(root)
	const aptRoot = path.join(resolvedRoot, "apt")
	const aptDists = path.join(aptRoot, "dists", LINUX_REPOSITORY_CHANNEL)
	const rpmRoot = path.join(resolvedRoot, "rpm", LINUX_REPOSITORY_CHANNEL)
	return {
		root: resolvedRoot,
		aptRoot,
		aptPool: path.join(aptRoot, "pool", "main", "c", "cocode"),
		aptPoolAmd64: path.join(aptRoot, "pool", "main", "c", "cocode", "amd64"),
		aptPoolArm64: path.join(aptRoot, "pool", "main", "c", "cocode", "arm64"),
		aptDists,
		aptBinaryAmd64: path.join(aptDists, "main", "binary-amd64"),
		aptBinaryArm64: path.join(aptDists, "main", "binary-arm64"),
		aptSourcesList: path.join(resolvedRoot, "clients", "apt", "cocode.list"),
		rpmX8664: path.join(rpmRoot, "x86_64"),
		rpmAarch64: path.join(rpmRoot, "aarch64"),
		rpmRepositoryFile: path.join(resolvedRoot, "clients", "rpm", "cocode.repo"),
		keysRoot: path.join(resolvedRoot, "keys"),
		aptKeyring: path.join(resolvedRoot, "keys", "cocode-archive-keyring.gpg"),
		rpmPublicKey: path.join(resolvedRoot, "keys", "RPM-GPG-KEY-cocode"),
	}
}

export function buildLinuxRepository({
	inputRoot,
	outputRoot,
	version,
	config = resolveLinuxRepositoryConfig(),
	key = process.env.LINUX_SIGNING_KEY?.trim(),
	passphrase = process.env.LINUX_SIGNING_PASSPHRASE,
	required = process.env.RELEASE_REQUIRE_SIGNING === "1" || process.env.RELEASE_REQUIRE_SIGNING === "true",
	run = runCommand,
} = {}) {
	if (!inputRoot || !outputRoot) {
		throw new Error("Linux repository build requires inputRoot and outputRoot.")
	}
	const input = path.resolve(inputRoot)
	const layout = getLinuxRepositoryLayout(outputRoot)
	const packages = findLinuxPackages(input)
	const selected = selectLinuxPackages(packages, version)
	if (required && !key) throw new Error("LINUX_SIGNING_KEY is required to sign the Linux repository.")

	rmSync(layout.root, { recursive: true, force: true })
	for (const directory of [
		layout.aptPool,
		layout.aptPoolAmd64,
		layout.aptPoolArm64,
		layout.aptBinaryAmd64,
		layout.aptBinaryArm64,
		layout.rpmX8664,
		layout.rpmAarch64,
		path.dirname(layout.aptSourcesList),
		path.dirname(layout.rpmRepositoryFile),
		layout.keysRoot,
	]) mkdirSync(directory, { recursive: true })

	for (const packageFile of selected) {
		const target = packageTargets(packageFile, layout)
		copyFileSync(packageFile.file, target)
	}

	writeFileSync(layout.aptSourcesList, createAptSourcesList(config))
	writeFileSync(layout.rpmRepositoryFile, createRpmRepositoryFile(config))
	writeAptMetadata(layout, { run, key, passphrase, required })
	writeRpmMetadata(layout, { run, key, passphrase, required })
	writeRepositoryPublicKey(layout, { run, key, required })

	return {
		layout,
		packages: selected.map(({ file }) => file),
		version,
		baseUrl: config.baseUrl,
	}
}

function findLinuxPackages(root) {
	const files = []
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name)
			if (entry.isDirectory()) visit(file)
			else if (/\.(deb|rpm)$/i.test(entry.name)) files.push(file)
		}
	}
	visit(path.resolve(root))
	return files.map((file) => ({ file, format: path.extname(file).slice(1).toLowerCase(), arch: inferArchitecture(file) }))
}

function inferArchitecture(file) {
	const normalized = file.toLowerCase()
	if (normalized.includes(`${path.sep}x64${path.sep}`) || /[_-]x86_64\.(deb|rpm)$/i.test(file)) return "x64"
	if (normalized.includes(`${path.sep}arm64${path.sep}`) || /[_-]arm64\.(deb|rpm)$/i.test(file)) return "arm64"
	throw new Error(`Cannot infer Linux package architecture from path: ${file}`)
}

function selectLinuxPackages(packages, version) {
	const selected = []
	for (const arch of ["x64", "arm64"]) {
		for (const format of ["deb", "rpm"]) {
			const matches = packages.filter((candidate) => candidate.arch === arch && candidate.format === format)
			if (matches.length !== 1) {
				throw new Error(`Expected exactly one ${format} package for ${arch}; found ${matches.length}.`)
			}
			const packageFile = matches[0]
			if (version && !path.basename(packageFile.file).includes(`-${version}-`)) {
				throw new Error(`Linux package version does not match ${version}: ${packageFile.file}`)
			}
			selected.push(packageFile)
		}
	}
	return selected
}

function packageTargets(packageFile, layout) {
	const fileName = path.basename(packageFile.file)
	if (packageFile.format === "deb") {
		return path.join(packageFile.arch === "x64" ? layout.aptPoolAmd64 : layout.aptPoolArm64, fileName)
	}
	return path.join(packageFile.arch === "x64" ? layout.rpmX8664 : layout.rpmAarch64, fileName)
}

function writeAptMetadata(layout, { run, key, passphrase, required }) {
	for (const [pool, binaryDirectory] of [
		[layout.aptPoolAmd64, layout.aptBinaryAmd64],
		[layout.aptPoolArm64, layout.aptBinaryArm64],
	]) {
		const packageIndex = run("apt-ftparchive", ["packages", path.relative(layout.aptRoot, pool)], {
			cwd: layout.aptRoot,
			encoding: "utf8",
		})
		writeFileSync(path.join(binaryDirectory, "Packages"), packageIndex)
		writeFileSync(path.join(binaryDirectory, "Packages.gz"), gzipSync(Buffer.from(packageIndex)))
	}
	const release = run("apt-ftparchive", ["release", path.relative(layout.aptRoot, layout.aptDists)], {
		cwd: layout.aptRoot,
		encoding: "utf8",
	})
	const releaseFile = path.join(layout.aptDists, "Release")
	writeFileSync(releaseFile, release)
	if (!required && !key) return
	writeGpgSignature(releaseFile, path.join(layout.aptDists, "InRelease"), "clearsign", {
		run,
		key,
		passphrase,
	})
	writeGpgSignature(releaseFile, path.join(layout.aptDists, "Release.gpg"), "detach-sign", {
		run,
		key,
		passphrase,
	})
}

function writeRpmMetadata(layout, { run, key, passphrase, required }) {
	for (const directory of [layout.rpmX8664, layout.rpmAarch64]) {
		run("createrepo_c", [directory], { stdio: "inherit" })
		if (!required && !key) continue
		const repomd = path.join(directory, "repodata", "repomd.xml")
		writeGpgSignature(repomd, `${repomd}.asc`, "detach-sign", { run, key, passphrase })
	}
}

function writeRepositoryPublicKey(layout, { run, key, required }) {
	if (!key) return
	const armored = run("gpg", ["--batch", "--armor", "--export", key], { encoding: "utf8" })
	if (!armored.trim()) throw new Error(`Linux repository signing key has no public key: ${key}`)
	writeFileSync(layout.rpmPublicKey, armored)
	run("gpg", ["--batch", "--yes", "--dearmor", "--output", layout.aptKeyring], {
		input: armored,
		stdio: ["pipe", "inherit", "inherit"],
	})
}

function writeGpgSignature(input, output, operation, { run, key, passphrase }) {
	if (!key) throw new Error(`LINUX_SIGNING_KEY is required for ${operation}: ${input}`)
	const args = ["--batch", "--yes", "--armor", "--local-user", key, "--output", output]
	if (passphrase !== undefined) args.push("--pinentry-mode", "loopback", "--passphrase-fd", "0")
	args.push(`--${operation}`, input)
	const options = passphrase === undefined ? { stdio: "inherit" } : { input: `${passphrase}\n`, stdio: ["pipe", "inherit", "inherit"] }
	run("gpg", args, options)
}

function cli() {
	const [inputRoot, outputRoot, version] = process.argv.slice(2)
	if (!inputRoot || !outputRoot) {
		throw new Error("Usage: node scripts/release/linux-repository.mjs <input-root> <output-root> [version]")
	}
	buildLinuxRepository({ inputRoot, outputRoot, version })
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(new URL(import.meta.url).pathname)) cli()
