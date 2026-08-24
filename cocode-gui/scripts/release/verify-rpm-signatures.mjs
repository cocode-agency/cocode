import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import * as path from "node:path"

/** @type {(...args: any[]) => any} */
const runCommand = (...args) => execFileSync(...args)

/**
 * Verify embedded RPM signatures against a public key imported into an isolated
 * RPM database. The caller owns the database directory lifecycle.
 */
export function verifyRpmPackageSignatures(
	files,
	{
		publicKey,
		databasePath,
		run = runCommand,
	} = {},
) {
	if (!publicKey) throw new Error("RPM signature verification requires a public key file.")
	if (!databasePath) throw new Error("RPM signature verification requires an RPM database path.")
	const keyFile = path.resolve(publicKey)
	const rpmDatabase = path.resolve(databasePath)
	if (!existsSync(keyFile)) throw new Error(`RPM public key is missing: ${keyFile}`)
	const packages = [...new Set(files.map((file) => path.resolve(file)))]
	if (packages.length === 0) throw new Error("RPM signature verification requires at least one package.")
	for (const file of packages) {
		if (!existsSync(file)) throw new Error(`RPM package is missing: ${file}`)
	}

	mkdirSync(rpmDatabase, { recursive: true })
	const rpm = (args, options) => run("rpm", ["--dbpath", rpmDatabase, ...args], options)
	rpm(["--initdb"], { stdio: "inherit" })
	rpm(["--import", keyFile], { stdio: "inherit" })
	const importedKeys = String(
		rpm(["-qa", "gpg-pubkey*", "--qf", "%{NAME}-%{VERSION}-%{RELEASE}\\n"], {
			encoding: "utf8",
		}),
	)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	if (importedKeys.length === 0) {
		throw new Error(`RPM public key was not imported into isolated database: ${rpmDatabase}`)
	}

	const verified = packages.map((file) => {
		const output = String(rpm(["--checksig", "--verbose", file], { encoding: "utf8" }) ?? "")
		if (/\b(?:NOKEY|NOTFOUND|BAD)\b/i.test(output) || !/\bSignature\b[\s\S]*\bOK\b/i.test(output)) {
			throw new Error(`RPM signature verification failed for ${file}.\n${output}`)
		}
		return { file, output }
	})

	return { databasePath: rpmDatabase, importedKeys, packages: verified }
}

function cli() {
	const [publicKey, databasePath, ...packages] = process.argv.slice(2)
	if (!publicKey || !databasePath || packages.length === 0) {
		throw new Error(
			"Usage: node scripts/release/verify-rpm-signatures.mjs <public-key> <rpm-db-path> <package.rpm> [...]",
		)
	}
	verifyRpmPackageSignatures(packages, { publicKey, databasePath })
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(new URL(import.meta.url).pathname)) cli()
