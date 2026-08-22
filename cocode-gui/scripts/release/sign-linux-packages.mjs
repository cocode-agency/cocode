import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import * as path from "node:path"

const PACKAGE_EXTENSIONS = new Set([".deb", ".rpm"])

export function signLinuxPackages(
	files,
	{
		key = process.env.LINUX_SIGNING_KEY?.trim(),
		passphrase = process.env.LINUX_SIGNING_PASSPHRASE,
		gpgHome = process.env.LINUX_GPG_HOME?.trim(),
		required = process.env.RELEASE_REQUIRE_SIGNING === "1" || process.env.RELEASE_REQUIRE_SIGNING === "true",
		run = execFileSync,
	} = {},
) {
	const packages = [...new Set(files.map((file) => path.resolve(file)))].filter((file) =>
		PACKAGE_EXTENSIONS.has(path.extname(file).toLowerCase()),
	)
	if (packages.length === 0) return []
	if (!required && !key) return []
	if (!key) throw new Error("LINUX_SIGNING_KEY is required to sign Linux packages.")
	for (const file of packages) {
		if (!existsSync(file)) throw new Error(`Linux package is missing: ${file}`)
	}

	const signatures = []
	for (const file of packages) {
		const signature = `${file}.asc`
		const args = [
			"--batch",
			"--yes",
			"--armor",
			"--local-user",
			key,
			"--output",
			signature,
			"--detach-sign",
			file,
		]
		if (gpgHome) {
			mkdirSync(gpgHome, { recursive: true, mode: 0o700 })
			args.unshift("--homedir", path.resolve(gpgHome))
		}
		const options = passphrase === undefined ? { stdio: "inherit" } : { input: `${passphrase}\n`, stdio: ["pipe", "inherit", "inherit"] }
		if (passphrase !== undefined) args.unshift("--pinentry-mode", "loopback", "--passphrase-fd", "0")
		run("gpg", args, options)
		run("gpg", [
			...(gpgHome ? ["--homedir", path.resolve(gpgHome)] : []),
			"--batch",
			"--verify",
			signature,
			file,
	], { stdio: "inherit" })
		signatures.push(signature)
	}
	return signatures
}

function cli() {
	const files = process.argv.slice(2)
	if (files.length === 0) throw new Error("Usage: node scripts/release/sign-linux-packages.mjs <package.deb|package.rpm> [...]")
	signLinuxPackages(files, { required: true })
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(new URL(import.meta.url).pathname)) cli()
