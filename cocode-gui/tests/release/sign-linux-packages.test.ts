import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import { signLinuxPackages } from "../../scripts/release/sign-linux-packages.mjs"

test("embeds an RPM signature before creating the detached release signature", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-signing-"))
	try {
		const rpm = path.join(root, "Cocode-1.2.3-x86_64.rpm")
		writeFileSync(rpm, "rpm")
		const calls: Array<{ command: string; args: readonly string[] }> = []
		const run = (command: string, args: readonly string[]) => {
			calls.push({ command, args })
		}

		signLinuxPackages([rpm], {
			key: "cocode-key",
			passphrase: "secret",
			required: true,
			run,
		})

		assert.deepEqual(
			calls.map(({ command }) => command),
			["rpmsign", "gpg", "gpg"],
		)
		assert.equal(calls[0]?.args[0], "--addsign")
		assert.ok(calls[0]?.args.includes(rpm))
		assert.ok(calls[0]?.args.includes("--define"))
		assert.ok(calls[1]?.args.includes("--detach-sign"))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("does not invoke RPM signing for DEB-only input", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-signing-"))
	try {
		const deb = path.join(root, "Cocode-1.2.3-x86_64.deb")
		writeFileSync(deb, "deb")
		const commands: string[] = []
		signLinuxPackages([deb], {
			key: "cocode-key",
			required: true,
			run: (command) => {
				commands.push(command)
			},
		})
		assert.deepEqual(commands, ["gpg", "gpg"])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
