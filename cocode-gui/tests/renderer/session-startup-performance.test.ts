import assert from "node:assert/strict"
import test from "node:test"
import { Context } from "@deepseek-ai/cordis"
import { SessionRuntime } from "../../packages/client/client/runtime/src/client/sessions/service"

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

test("starts restoring the persisted session history while session.list is pending", async () => {
	const previousStorage = (globalThis as typeof globalThis & { localStorage?: unknown })
		.localStorage
	const storage = new Map([
		["dsh.sessions.current", JSON.stringify({ sessionId: "startup-session" })],
	])
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value)
			},
			removeItem: (key: string) => {
				storage.delete(key)
			},
		},
	})

	try {
		const list = deferred<unknown>()
		const historyCalls: string[] = []
		const api = {
			sessions: {
				list: () => list.promise,
				history: async ({ sessionId }: { sessionId: string }) => {
					historyCalls.push(sessionId)
					return {
						result: { ok: true, value: { events: [] as unknown[], hasMore: false } },
					}
				},
			},
			subagents: {
				list: async () => ({
					result: {
						ok: true,
						value: { entries: [] as unknown[], parentAvailable: true },
					},
				}),
			},
		}
		const runtime = new SessionRuntime(new Context(), api as never, {} as never)

		runtime.handleConnected()
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		// The persisted selection is only validated against the first successful
		// session.list snapshot; do not open history for an id that may no longer
		// exist while the baseline is still pending.
		assert.deepEqual(historyCalls, [])
		list.resolve({
			result: {
				ok: true,
				value: {
					items: [
						{
							sessionId: "startup-session",
							updatedAt: 1,
							running: false,
							blank: false,
						},
					],
				},
			},
		})
		await list.promise
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		assert.deepEqual(historyCalls, ["startup-session"])
	} finally {
		if (previousStorage === undefined)
			delete (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage
		else
			Object.defineProperty(globalThis, "localStorage", {
				configurable: true,
				value: previousStorage,
			})
	}
})
