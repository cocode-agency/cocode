import assert from "node:assert/strict"
import test from "node:test"
import type { MessageId, SessionId } from "../../packages/client/client/connection/src/client/api"
import {
	agencyMessageFeedbackRemote,
	subscribeAccount,
} from "../../packages/cocode/cocode-message-feedback/src/client/account.ts"

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
			list: async (): Promise<{ readonly data: readonly [] }> => ({ data: [] }),
			put: async (input: {
				sessionId: string
				messageId: string
				rating: "positive" | "negative"
				note?: string
				ifVersion: string | number | null
			}) => ({
				ok: true as const,
				value: {
					session_id: input.sessionId,
					message_id: input.messageId,
					rating: input.rating,
					note: input.note,
					version: 1,
					created_at: "2026-08-19T12:00:00Z",
					updated_at: "2026-08-19T12:00:00Z",
				},
			}),
			delete: async () => ({ ok: true as const, value: { deleted: true as const } }),
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

test("message feedback ignores a stale snapshot that resolves after an account event", async () => {
	let resolveSnapshot!: (snapshot: Snapshot) => void
	let listener: ((snapshot: Snapshot) => void) | undefined
	const snapshot = new Promise<Snapshot>((resolve) => {
		resolveSnapshot = resolve
	})
	const previous = globalThis.window
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			desktopApi: {
				account: {
					snapshot: () => snapshot,
					onChanged: (next: (value: Snapshot) => void) => {
						listener = next
						return () => {
							listener = undefined
						}
					},
					messageFeedback: {},
				},
			},
		},
	})
	try {
		const states: boolean[] = []
		subscribeAccount((signedIn) => states.push(signedIn))
		listener?.({ phase: "signed-out" })
		resolveSnapshot({ phase: "signed-in" })
		await new Promise((resolve) => setImmediate(resolve))
		assert.deepEqual(states, [false])
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
		else Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
	}
})

test("message feedback ignores a pending snapshot after unsubscribe", async () => {
	let resolveSnapshot!: (snapshot: Snapshot) => void
	const snapshot = new Promise<Snapshot>((resolve) => {
		resolveSnapshot = resolve
	})
	const previous = globalThis.window
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			desktopApi: {
				account: {
					snapshot: () => snapshot,
					onChanged:
						(_listener: (value: Snapshot) => void): (() => void) =>
						() =>
							undefined,
					messageFeedback: {},
				},
			},
		},
	})
	try {
		const states: boolean[] = []
		const unsubscribe = subscribeAccount((signedIn) => states.push(signedIn))
		unsubscribe()
		resolveSnapshot({ phase: "signed-in" })
		await new Promise((resolve) => setImmediate(resolve))
		assert.deepEqual(states, [])
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
		else Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
	}
})

test("message feedback uses only the authenticated desktop account bridge", async () => {
	const account = installAccount({ phase: "signed-in" })
	try {
		const calls: unknown[] = []
		account.api.messageFeedback.put = async (input) => {
			calls.push(input)
			return {
				ok: true as const,
				value: {
					session_id: input.sessionId,
					message_id: input.messageId,
					rating: input.rating,
					note: input.note,
					ifVersion: input.ifVersion,
					version: 1,
					created_at: "2026-08-19T12:00:00Z",
					updated_at: "2026-08-19T12:00:00Z",
				},
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
				ifVersion: null,
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
			/Cocode account bridge is unavailable/,
		)
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, "window")
		else Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
	}
})

test("message feedback maps Agency compare-and-set conflicts into the Host result", async () => {
	const account = installAccount({ phase: "signed-in" })
	try {
		account.api.messageFeedback.put = async () => ({
			ok: false as const,
			error: {
				code: "version-conflict" as const,
				current: {
					session_id: "s-1",
					message_id: "m-1",
					rating: "negative" as const,
					version: 2,
				},
			},
		})
		const result = await agencyMessageFeedbackRemote().put({
			sessionId: "s-1" as SessionId,
			messageId: "m-1" as MessageId,
			rating: "positive",
			ifVersion: "1",
		})
		assert.deepEqual(result, {
			ok: true,
			value: {
				ok: false,
				error: {
					code: "version-conflict",
					current: {
						messageId: "m-1",
						rating: "negative",
						version: "2",
						createdAt: 0,
						updatedAt: 0,
					},
				},
			},
		})
	} finally {
		account.restore()
	}
})
