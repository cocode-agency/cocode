import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "node:path"
import test from "node:test"
import { verifyRpmPackageSignatures } from "../../scripts/release/verify-rpm-signatures.mjs"

test("imports and verifies RPM signatures through one isolated database", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-rpm-signature-verify-"))
	try {
		const publicKey = path.join(root, "RPM-GPG-KEY-cocode")
		const databasePath = path.join(root, "rpmdb")
		const rpm = path.join(root, "Cocode-1.2.3-x86_64.rpm")
		writeFileSync(publicKey, "PUBLIC KEY")
		writeFileSync(rpm, "RPM")
		const calls = []

		const result = verifyRpmPackageSignatures([rpm], {
			publicKey,
			databasePath,
			run: (command, args) => {
				calls.push({ command, args })
				if (args.includes("-qa")) return "gpg-pubkey-f8a9bc65-00000000\n"
				if (args.includes("--checksig")) {
					return `${rpm}:\n    Header V4 RSA/SHA512 Signature, key ID f8a9bc65: OK\n`
				}
				return ""
			},
		})

		assert.deepEqual(result.importedKeys, ["gpg-pubkey-f8a9bc65-00000000"])
		assert.equal(result.packages.length, 1)
		assert.deepEqual(
			calls.map(({ command }) => command),
			["rpm", "rpm", "rpm", "rpm"],
		)
		for (const { args } of calls) assert.deepEqual(args.slice(0, 2), ["--dbpath", databasePath])
		assert.ok(calls[0]?.args.includes("--initdb"))
		assert.ok(calls[1]?.args.includes("--import"))
		assert.ok(calls[3]?.args.includes("--checksig"))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects an RPM signature when the isolated database reports NOKEY", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-rpm-signature-verify-"))
	try {
		const publicKey = path.join(root, "RPM-GPG-KEY-cocode")
		const databasePath = path.join(root, "rpmdb")
		const rpm = path.join(root, "Cocode-1.2.3-x86_64.rpm")
		writeFileSync(publicKey, "PUBLIC KEY")
		writeFileSync(rpm, "RPM")

		assert.throws(
			() =>
				verifyRpmPackageSignatures([rpm], {
					publicKey,
					databasePath,
					run: (_command, args) => {
						if (args.includes("-qa")) return "gpg-pubkey-f8a9bc65-00000000\n"
						if (args.includes("--checksig")) {
							return `${rpm}:\n    Header V4 RSA/SHA512 Signature, key ID f8a9bc65: NOKEY\n`
						}
						return ""
					},
				}),
			/RPM signature verification failed.*NOKEY/is,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
