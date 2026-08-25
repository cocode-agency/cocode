import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "pathe"
import test from "node:test"
import { withAccountLock } from "../../../src/main/contexts/account/infrastructure/account-lock"

test("serializes concurrent operations and allows nested account mutations", async () => {
	const home = await mkdtemp(join(tmpdir(), "cocode-gui-account-lock-"))
	try {
		const order: string[] = []
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const first = withAccountLock(join(home, "account.yaml"), async () => {
			order.push("first-enter")
			await gate
			order.push("first-exit")
		})
		const second = withAccountLock(join(home, "account.yaml"), async () => {
			order.push("second-enter")
		})
		await new Promise((resolve) => setTimeout(resolve, 20))
		assert.deepEqual(order, ["first-enter"])
		release()
		await Promise.all([first, second])
		assert.deepEqual(order, ["first-enter", "first-exit", "second-enter"])

		await withAccountLock(join(home, "account.yaml"), () =>
			withAccountLock(join(home, "account.yaml"), async () => {
				order.push("nested")
			}),
		)
		assert.equal(order.at(-1), "nested")
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})

test("recovers a lock whose owner process is gone", async () => {
	const home = await mkdtemp(join(tmpdir(), "cocode-gui-account-lock-"))
	try {
		const lock = join(home, "account.yaml.lock")
		await mkdir(lock, { mode: 0o700 })
		await writeFile(
			join(lock, "owner.json"),
			JSON.stringify({
				version: 1,
				pid: 2_147_483_647,
				instanceId: "dead-process",
				token: "dead-token",
				createdAt: Date.now(),
			}),
		)
		await withAccountLock(join(home, "account.yaml"), async () => undefined)
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})

test("recovers a legacy lock after its stale timeout", async () => {
	const home = await mkdtemp(join(tmpdir(), "cocode-gui-account-lock-"))
	try {
		const lock = join(home, "account.yaml.lock")
		await mkdir(lock, { mode: 0o700 })
		const old = new Date(Date.now() - 300_000)
		await utimes(lock, old, old)
		await withAccountLock(join(home, "account.yaml"), async () => undefined)
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})
