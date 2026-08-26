import assert from "node:assert/strict"
import test from "node:test"
import {
	ShortcutService,
	type GlobalShortcutHost,
} from "../../../src/main/contexts/shortcuts/application/shortcut-service"

class FakeGlobalShortcutHost implements GlobalShortcutHost {
	readonly callbacks = new Map<string, () => void>()
	readonly calls: string[] = []
	readonly failures = new Set<string>()
	readonly throws = new Set<string>()

	register(accelerator: string, callback: () => void): boolean {
		this.calls.push(`register:${accelerator}`)
		if (this.throws.has(accelerator)) throw new Error("host registration threw")
		if (this.failures.has(accelerator)) return false
		this.callbacks.set(accelerator, callback)
		return true
	}

	unregister(accelerator: string): void {
		this.calls.push(`unregister:${accelerator}`)
		this.callbacks.delete(accelerator)
	}

	isRegistered(accelerator: string): boolean {
		return this.callbacks.has(accelerator)
	}
}

test("syncs only changed global bindings and removes stale registrations", () => {
	const host = new FakeGlobalShortcutHost()
	const service = new ShortcutService(() => null, host)

	assert.deepEqual(
		service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" }]),
		{ ok: true },
	)
	assert.deepEqual(host.calls, ["register:CommandOrControl+N"])
	assert.deepEqual(
		service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" }]),
		{ ok: true },
	)
	assert.deepEqual(host.calls, ["register:CommandOrControl+N"])

	assert.deepEqual(
		service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+Shift+N" }]),
		{ ok: true },
	)
	assert.deepEqual(host.calls.slice(1), [
		"unregister:CommandOrControl+N",
		"register:CommandOrControl+Shift+N",
	])
	service.dispose()
	assert.equal(host.isRegistered("CommandOrControl+Shift+N"), false)
})

test("rejects duplicate or non-global commands without changing active bindings", () => {
	const host = new FakeGlobalShortcutHost()
	const service = new ShortcutService(() => null, host)
	service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" }])

	const duplicate = service.sync([
		{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" },
		{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" },
	])
	assert.equal(duplicate.ok, false)
	assert.equal(host.isRegistered("CommandOrControl+N"), true)

	const unsupported = service.sync([
		{ commandId: "cocode.sidebar.toggle", accelerator: "CommandOrControl+B" },
	])
	assert.equal(unsupported.ok, false)
	assert.equal(host.isRegistered("CommandOrControl+N"), true)
})

test("rolls back the previous registrations when the OS rejects a new binding", () => {
	const host = new FakeGlobalShortcutHost()
	const service = new ShortcutService(() => null, host)
	service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" }])
	host.failures.add("CommandOrControl+Shift+N")

	const result = service.sync([
		{ commandId: "cocode.newSession", accelerator: "CommandOrControl+Shift+N" },
	])
	assert.equal(result.ok, false)
	assert.equal(host.isRegistered("CommandOrControl+N"), true)
	assert.equal(host.isRegistered("CommandOrControl+Shift+N"), false)
})

test("rolls back when the OS registration host throws", () => {
	const host = new FakeGlobalShortcutHost()
	const service = new ShortcutService(() => null, host)
	service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" }])
	host.throws.add("CommandOrControl+Shift+N")

	const result = service.sync([
		{ commandId: "cocode.newSession", accelerator: "CommandOrControl+Shift+N" },
	])
	assert.equal(result.ok, false)
	assert.equal(host.isRegistered("CommandOrControl+N"), true)
	assert.equal(host.isRegistered("CommandOrControl+Shift+N"), false)
})

test("forwards global triggers to the active window and rejects foreign senders", () => {
	const host = new FakeGlobalShortcutHost()
	const sent: unknown[] = []
	const window = {
		webContents: {
			id: 7,
			isDestroyed: () => false,
			send: (_channel: string, commandId: unknown) => {
				sent.push(commandId)
			},
		},
		isDestroyed: () => false,
		isMinimized: () => true,
		restore: () => {},
		isVisible: () => false,
		show: () => {},
		focus: () => {},
	}
	const service = new ShortcutService(() => window as never, host)

	assert.equal(
		service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" }], {
			id: 8,
		} as never).ok,
		false,
	)
	assert.equal(
		service.sync([{ commandId: "cocode.newSession", accelerator: "CommandOrControl+N" }], {
			id: 7,
		} as never).ok,
		true,
	)
	host.callbacks.get("CommandOrControl+N")?.()
	assert.deepEqual(sent, ["cocode.newSession"])
})
