import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "pathe"
import test from "node:test"

import {
	assertNativeBinaryArchitecture,
	collectRuntimeNativeInventory,
	inspectNativeBinary,
} from "../../scripts/lib/native-binary-inspection.mjs"

function pe(machine = 0x8664): Buffer {
	const value = Buffer.alloc(0x80)
	value.writeUInt16LE(0x5a4d, 0)
	value.writeUInt32LE(0x40, 0x3c)
	value.write("PE\0\0", 0x40, "ascii")
	value.writeUInt16LE(machine, 0x44)
	return value
}

function elf(machine = 0x3e): Buffer {
	const value = Buffer.alloc(0x40)
	value.write("\x7fELF", 0, "binary")
	value[4] = 2
	value[5] = 1
	value.writeUInt16LE(machine, 18)
	return value
}

function macho(cputype = 0x01000007): Buffer {
	const value = Buffer.alloc(0x40)
	value.writeUInt32LE(0xfeedfacf, 0)
	value.writeInt32LE(cputype, 4)
	return value
}

function fatMacho(): Buffer {
	const value = Buffer.alloc(0x80)
	value.writeUInt32BE(0xcafebabe, 0)
	value.writeUInt32BE(2, 4)
	value.writeInt32BE(0x01000007, 8)
	value.writeInt32BE(0x0100000c, 28)
	return value
}

test("identifies PE, ELF, and Mach-O architectures without host tools", () => {
	assert.deepEqual(inspectNativeBinary(pe()), { format: "pe", architectures: ["x86_64"] })
	assert.deepEqual(inspectNativeBinary(elf()), { format: "elf", architectures: ["x86_64"] })
	assert.deepEqual(inspectNativeBinary(macho()), { format: "macho", architectures: ["x86_64"] })
	assert.deepEqual(inspectNativeBinary(elf(0xb7)), { format: "elf", architectures: ["arm64"] })
	assert.deepEqual(inspectNativeBinary(macho(0x0100000c)), {
		format: "macho",
		architectures: ["arm64"],
	})
	assert.deepEqual(inspectNativeBinary(fatMacho()), {
		format: "macho",
		architectures: ["x86_64", "arm64"],
	})
})

test("rejects a native binary whose architecture does not match the target", () => {
	const root = mkdtempSync(path.join(tmpdir(), "cocode-native-inspection-"))
	const file = path.join(root, "addon.node")
	try {
		writeFileSync(file, elf(0xb7))
		assert.throws(
			() => assertNativeBinaryArchitecture(file, { platform: "linux", arch: "x64" }),
			/architecture mismatch.*linux\/x64/i,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("collects recursive runtime native inventory including sharp and libvips", () => {
	const root = mkdtempSync(path.join(tmpdir(), "cocode-native-inventory-"))
	try {
		const runtime = path.join(root, "node_modules")
		const sharp = path.join(runtime, "sharp")
		const sharpTarget = path.join(runtime, "@img", "sharp-linux-x64", "lib")
		const libvipsTarget = path.join(runtime, "@img", "sharp-libvips-linux-x64", "lib")
		const pty = path.join(runtime, "node-pty", "prebuilds", "linux-x64")
		mkdirSync(sharp, { recursive: true })
		mkdirSync(sharpTarget, { recursive: true })
		mkdirSync(libvipsTarget, { recursive: true })
		mkdirSync(path.join(sharp, "dist"), { recursive: true })
		mkdirSync(pty, { recursive: true })
		writeFileSync(
			path.join(sharp, "package.json"),
			JSON.stringify({
				name: "sharp",
				version: "0.35.3",
				optionalDependencies: {
					"@img/sharp-linux-x64": "0.35.3",
					"@img/sharp-libvips-linux-x64": "1.3.2",
				},
			}),
		)
		writeFileSync(
			path.join(runtime, "@img", "sharp-linux-x64", "package.json"),
			JSON.stringify({
				name: "@img/sharp-linux-x64",
				version: "0.35.3",
				os: ["linux"],
				cpu: ["x64"],
			}),
		)
		writeFileSync(
			path.join(runtime, "@img", "sharp-libvips-linux-x64", "package.json"),
			JSON.stringify({
				name: "@img/sharp-libvips-linux-x64",
				version: "1.3.2",
				os: ["linux"],
				cpu: ["x64"],
			}),
		)
		writeFileSync(
			path.join(runtime, "node-pty", "package.json"),
			JSON.stringify({ name: "node-pty", version: "1.1.0" }),
		)
		writeFileSync(path.join(sharpTarget, "sharp-linux-x64.node"), elf())
		writeFileSync(path.join(libvipsTarget, "libvips.so.42"), elf())
		writeFileSync(path.join(sharp, "dist", "libvips.cjs"), "// javascript loader")
		writeFileSync(path.join(pty, "pty.node"), elf())
		writeFileSync(path.join(pty, "spawn-helper"), elf())
		chmodSync(path.join(pty, "spawn-helper"), 0o755)

		const inventory = collectRuntimeNativeInventory(root, { platform: "linux", arch: "x64" })
		assert.equal(
			inventory.some((entry) => entry.role === "sharp-addon"),
			true,
		)
		assert.equal(
			inventory.some((entry) => entry.role === "sharp-libvips"),
			true,
		)
		assert.equal(
			inventory.some((entry) => entry.role === "node-pty-spawn-helper"),
			true,
		)
		assert.equal(
			inventory.some((entry) => entry.file.endsWith("sharp/dist/libvips.cjs")),
			false,
		)
		assert.equal(
			inventory.find((entry) => entry.role === "node-pty-pty")?.file,
			"prebuilds/linux-x64/pty.node",
		)
		assert.deepEqual(inventory.find((entry) => entry.role === "node-pty-pty")?.owners, [
			"Cocode Workbench",
			"Host Supervisor",
		])
		assert.deepEqual(inventory.find((entry) => entry.role === "sharp-addon")?.owners, [
			"DSH attachment",
		])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
