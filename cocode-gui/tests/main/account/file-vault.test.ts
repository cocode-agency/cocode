import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "pathe"
import test from "node:test"
import {
	FileStorageUnavailableError,
	FileVault,
	resolveCocodeFile,
} from "../../../src/main/contexts/account/infrastructure/file-vault"

test("resolves Cocode files from the logical COCODE_HOME contract", () => {
	assert.equal(
		resolveCocodeFile("account.yaml", { COCODE_HOME: "~/custom-cocode" }, "/tmp/test-user"),
		"/tmp/test-user/custom-cocode/account.yaml",
	)
	assert.equal(
		resolveCocodeFile("account.yaml", {}, "/tmp/test-user"),
		"/tmp/test-user/.cocode/account.yaml",
	)
})

test("writes and reads a private atomic YAML file vault", async () => {
	const home = await mkdtemp(join(tmpdir(), "cocode-file-vault-"))
	try {
		const file = join(home, "cocode-nut-key.yaml")
		const vault = new FileVault<{ version: 1; secret: string }>(file)
		await vault.write({ version: 1, secret: "ck_test" })

		assert.match(await readFile(file, "utf8"), /secret: ck_test/)
		if (process.platform !== "win32") {
			assert.equal((await stat(home)).mode & 0o777, 0o700)
			assert.equal((await stat(file)).mode & 0o777, 0o600)
		}
		const reloaded = new FileVault<{ version: 1; secret: string }>(file)
		assert.deepEqual(await reloaded.read(), {
			version: 1,
			secret: "ck_test",
		})
		assert.deepEqual(vault.getStatus(), { state: "available", backend: "file" })
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})

test("treats a malformed cache as recoverable and allows it to be replaced", async () => {
	const home = await mkdtemp(join(tmpdir(), "cocode-file-vault-"))
	try {
		const file = join(home, "cocode-nut-key.yaml")
		await writeFile(file, "secret: [", "utf8")
		const vault = new FileVault<{ secret: string }>(file)
		assert.equal(await vault.read(), undefined)
		assert.deepEqual(vault.getStatus(), {
			state: "unavailable",
			backend: "file",
			reason: "corrupt",
		})
		await vault.write({ secret: "ck_repaired" })
		assert.deepEqual(await new FileVault<{ secret: string }>(file).read(), {
			secret: "ck_repaired",
		})
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})

test("rejects symlink targets instead of overwriting them", async () => {
	if (process.platform === "win32") return
	const home = await mkdtemp(join(tmpdir(), "cocode-file-vault-"))
	try {
		const target = join(home, "target.txt")
		const link = join(home, "secret.yaml")
		await symlink(target, link)
		const vault = new FileVault<string>(link)
		await assert.rejects(() => vault.write("secret"), FileStorageUnavailableError)
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})

test("rejects symlinked parent directories", async () => {
	if (process.platform === "win32") return
	const home = await mkdtemp(join(tmpdir(), "cocode-file-vault-"))
	const outside = await mkdtemp(join(tmpdir(), "cocode-file-vault-outside-"))
	try {
		const linkedDirectory = join(home, "nested")
		await symlink(outside, linkedDirectory)
		const vault = new FileVault<string>(join(linkedDirectory, "secret.yaml"))
		await assert.rejects(() => vault.write("secret"), FileStorageUnavailableError)
		assert.equal(
			await readFile(join(outside, "secret.yaml"), "utf8").catch(() => undefined),
			undefined,
		)
	} finally {
		await rm(home, { recursive: true, force: true })
		await rm(outside, { recursive: true, force: true })
	}
})
