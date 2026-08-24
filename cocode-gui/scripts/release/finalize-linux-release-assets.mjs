import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const PACKAGE_EXTENSIONS = new Set([".deb", ".rpm"])
const EXPECTED_ARCH = {
	x64: { deb: "x86_64", rpm: "x86_64", metadata: "latest-linux.yml" },
	arm64: { deb: "arm64", rpm: "arm64", metadata: "latest-linux-arm64.yml" },
}

export function finalizeLinuxReleaseAssets({ root, arch, version } = {}) {
	if (!root || !version) throw new Error("Linux release finalization requires root and version.")
	const expected = EXPECTED_ARCH[arch]
	if (!expected) throw new Error(`Unsupported Linux architecture: ${arch}`)
	const releaseRoot = path.resolve(root)
	const packages = readdirSync(releaseRoot)
		.map((name) => path.join(releaseRoot, name))
		.filter((file) => statSync(file).isFile() && PACKAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
		.sort()
	if (packages.length !== 2 || !packages.some((file) => file.endsWith(".deb")) || !packages.some((file) => file.endsWith(".rpm"))) {
		throw new Error(`Expected one .deb and one .rpm package under ${releaseRoot}.`)
	}
	for (const file of packages) {
		const name = path.basename(file)
		if (!name.startsWith(`Cocode-${version}-`)) throw new Error(`Linux package version does not match ${version}: ${file}`)
		const format = path.extname(file).slice(1).toLowerCase()
		const marker = format === "deb" ? expected.deb : expected.rpm
		if (!name.toLowerCase().includes(marker.toLowerCase())) {
			throw new Error(`Linux package architecture does not match ${arch}: ${file}`)
		}
		if (!existsSync(`${file}.asc`)) throw new Error(`Missing Linux package signature: ${file}.asc`)
	}

	const metadata = path.join(releaseRoot, expected.metadata)
	const rows = packages.map((file) => ({
		fileName: path.basename(file),
		sha512: hash(file, "sha512", "base64"),
	}))
	writeFileSync(
		metadata,
		[
			`version: ${version}`,
			"files:",
			...rows.flatMap(({ fileName, sha512 }) => [`  - url: ${yamlString(fileName)}`, `    sha512: ${yamlString(sha512)}`]),
			`path: ${yamlString(rows[0].fileName)}`,
			`sha512: ${yamlString(rows[0].sha512)}`,
			`releaseName: ${yamlString(`Cocode ${version}`)}`,
			`releaseDate: ${yamlString(new Date().toISOString())}`,
			"",
		].join("\n"),
	)

	const signatures = packages.map((file) => path.basename(`${file}.asc`)).sort()
	const manifest = path.join(releaseRoot, `linux-release-manifest-${arch}.json`)
	writeFileSync(
		manifest,
		`${JSON.stringify(
			{
				schemaVersion: 2,
				version: String(version),
				target: { platform: "linux", arch },
				artifacts: packages.map((file) => ({
					file: path.basename(file),
					format: path.extname(file).slice(1),
					sha256: hash(file, "sha256", "hex"),
					sha512: hash(file, "sha512", "base64"),
				})),
				signatures,
				metadata: [path.basename(metadata)],
			},
			null,
		)}\n`,
	)

	const checksum = path.join(releaseRoot, `SHA256SUMS-${arch}`)
	const checksumFiles = [...packages, ...packages.map((file) => `${file}.asc`), metadata, manifest]
		.map((file) => `${hash(file, "sha256", "hex")}  ${path.basename(file)}`)
		.sort()
	writeFileSync(checksum, `${checksumFiles.join("\n")}\n`)
	return { packages, metadata, manifest, checksum, signatures: packages.map((file) => `${file}.asc`) }
}

function hash(file, algorithm, encoding) {
	return createHash(algorithm).update(readFileSync(file)).digest(encoding)
}

function yamlString(value) {
	return JSON.stringify(String(value))
}

function cli() {
	const [root, arch, version] = process.argv.slice(2)
	if (!root || !arch || !version) {
		throw new Error("Usage: node scripts/release/finalize-linux-release-assets.mjs <root> <x64|arm64> <version>")
	}
	finalizeLinuxReleaseAssets({ root, arch, version })
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(new URL(import.meta.url).pathname)) cli()
