import assert from "node:assert/strict"
import test from "node:test"
import type { MessageId, SessionId } from "../../packages/client/client/connection/src/client/api"
import {
	agencyMessageFeedbackRemote,
	subscribeAccount,
} from "../../packages/client/client/ui-message-feedback/src/client/account"

type Snapshot = {
	readonly phase: "signed-out" | "signing-in" | "provisioning" | "signed-in" | "error"
}

function installAccount(initial: Snapshot) {
	let listener: ((snapshot: Snapshot) => void) | undefined
	const api = {
		snapshot: async () => initial,
		onChanged: (next: (snapshot: Snapshot) => void) => {
			listener = next
			return () => {
				listener = undefined
			}
		},
		messageFeedback: {
			list: async (): Promise<{ readonly data: readonly never[] }> => ({ data: [] }),
			put: async (input: {
				sessionId: string
				messageId: string
				rating: "positive" | "negative"
				note?: string
			}) => ({
				session_id: input.sessionId,
				message_id: input.messageId,
				rating: input.rating,
				note: input.note,
				created_at: "2026-08-19T12:00:00Z",
				updated_at: "2026-08-19T12:00:00Z",
			}),
			delete: async () => ({ deleted: true as const }),
		},
	}
	const previous = globalThis.window
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { desktopApi: { account: api } },
	})
	return {
		api,
		emit: (snapshot: Snapshot) => listener?.(snapshot),
		restore: () => {
			if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
			else
				Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
		},
	}
}

test("message feedback visibility follows Cocode account sign-in state", async () => {
	const account = installAccount({ phase: "signed-in" })
	try {
		const states: boolean[] = []
		const unsubscribe = subscribeAccount((signedIn) => states.push(signedIn))
		await new Promise((resolve) => setImmediate(resolve))
		assert.deepEqual(states, [true])

		account.emit({ phase: "signed-out" })
		assert.deepEqual(states, [true, false])
		unsubscribe()
	} finally {
		account.restore()
	}
})

test("message feedback uses only the authenticated desktop account bridge", async () => {
	const account = installAccount({ phase: "signed-in" })
	try {
		const calls: unknown[] = []
		account.api.messageFeedback.put = async (input) => {
			calls.push(input)
			return {
				session_id: input.sessionId,
				message_id: input.messageId,
				rating: input.rating,
				note: input.note,
				created_at: "2026-08-19T12:00:00Z",
				updated_at: "2026-08-19T12:00:00Z",
			}
		}
		const result = await agencyMessageFeedbackRemote().put({
			sessionId: "s-1" as SessionId,
			messageId: "m-1" as MessageId,
			rating: "negative",
			note: "<script>alert(1)</script>",
			ifVersion: null,
		})
		assert.deepEqual(calls, [
			{
				sessionId: "s-1",
				messageId: "m-1",
				rating: "negative",
				note: "<script>alert(1)</script>",
			},
		])
		assert.equal(result.ok, true)
	} finally {
		account.restore()
	}
})

test("message feedback has no Harness fallback without the account bridge", async () => {
	const previous = globalThis.window
	Object.defineProperty(globalThis, "window", { configurable: true, value: {} })
	try {
		await assert.rejects(
			agencyMessageFeedbackRemote().put({
				sessionId: "s-1" as SessionId,
				messageId: "m-1" as MessageId,
				rating: "positive",
				ifVersion: null,
			}),
			/Cocode account is not signed in/,
		)
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
		else Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
	}
})
