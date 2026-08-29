import { describe, expect, it } from "vitest"
import type { MessageId, SessionId } from "@deepseek-ai/dsh-client-connection/client"
import type { MessageFeedbackItem, MessageFeedbackVersion } from "@deepseek-ai/dsh-message-feedback/types"
import { MessageFeedbackController, type MessageFeedbackRemote } from "../src/client/controller.ts"

const SESSION = "session" as SessionId
const MESSAGE = "message" as MessageId

const version = (value: string): MessageFeedbackVersion => value as MessageFeedbackVersion

function item(value = "v1"): MessageFeedbackItem {
	return { messageId: MESSAGE, rating: "positive", version: version(value), createdAt: 1, updatedAt: 1 }
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function remote(overrides: Partial<MessageFeedbackRemote> = {}) {
	const calls: string[] = []
	const value: MessageFeedbackRemote = {
		list: async () => {
			calls.push("list")
			return { ok: true, value: { ok: true, value: { items: [] } } }
		},
		put: async () => {
			calls.push("put")
			return { ok: true, value: { ok: true, value: item() } }
		},
		delete: async () => {
			calls.push("delete")
			return { ok: true, value: { ok: true, value: { absent: true } } }
		},
		...overrides,
	}
	return { value, calls }
}

describe("MessageFeedbackController lifecycle generations", () => {
	it("does not publish an old list after reset", async () => {
		const list = deferred<Awaited<ReturnType<MessageFeedbackRemote["list"]>>>()
		const { value } = remote({ list: async () => list.promise })
		const controller = new MessageFeedbackController(value, SESSION)
		const pending = controller.ensure()

		controller.reset()
		list.resolve({ ok: true, value: { ok: true, value: { items: [item()] } } })
		await pending

		expect(controller.getSnapshot().status).toBe("cold")
		expect(controller.getSnapshot().items.has(MESSAGE)).toBe(false)
	})

	it("does not commit an old mutation response after reset", async () => {
		const put = deferred<Awaited<ReturnType<MessageFeedbackRemote["put"]>>>()
		const { value } = remote({ put: async () => put.promise })
		const controller = new MessageFeedbackController(value, SESSION)
		const pending = controller.rate(MESSAGE, "positive")

		controller.reset()
		put.resolve({ ok: true, value: { ok: true, value: item() } })
		await pending

		expect(controller.getSnapshot().status).toBe("cold")
		expect(controller.getSnapshot().items.has(MESSAGE)).toBe(false)
	})

	it("keeps a newer load promise when an old load settles", async () => {
		const first = deferred<Awaited<ReturnType<MessageFeedbackRemote["list"]>>>()
		const second = deferred<Awaited<ReturnType<MessageFeedbackRemote["list"]>>>()
		let call = 0
		const { value } = remote({
			list: async () => {
				call += 1
				return call === 1 ? first.promise : second.promise
			},
		})
		const controller = new MessageFeedbackController(value, SESSION)
		const old = controller.ensure()
		controller.reset()
		const current = controller.ensure()
		first.resolve({ ok: true, value: { ok: true, value: { items: [] } } })
		await old
		const again = controller.ensure()
		expect(again).toBe(current)
		second.resolve({ ok: true, value: { ok: true, value: { items: [item("v2")] } } })
		await current
		expect(call).toBe(2)
		expect(controller.getSnapshot().items.get(MESSAGE)?.version).toBe(version("v2"))
	})
})
