import assert from "node:assert/strict"
import test from "node:test"
import {
	installDshTransport,
	rebindDshTransport,
} from "../../src/renderer/app/bootstrap/dsh-transport"
import { ConnectionController } from "../../packages/client/client/connection/src/client/connection"

test("desktop transport rebinds newly created WebSockets to the new Runtime origin", () => {
	const originalWindow = globalThis.window
	const urls: string[] = []
	class FakeWebSocket extends EventTarget {
		public readonly url: string
		public constructor(url: string | URL) {
			super()
			this.url = String(url)
			urls.push(this.url)
		}
	}
	class FakeEventSource extends EventTarget {
		public constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
			super()
			void url
			void eventSourceInitDict
		}
	}

	const fakeWindow = {
		location: { origin: "http://localhost:5173", href: "http://localhost:5173/index.html" },
		fetch: globalThis.fetch,
		WebSocket: FakeWebSocket,
		EventSource: FakeEventSource,
		desktopApi: { dsh: { cancelRequest: () => undefined, request: async () => ({}) } },
	} as unknown as Window
	globalThis.window = fakeWindow
	try {
		installDshTransport("http://127.0.0.1:43127")
		new fakeWindow.WebSocket("/api/events.host")
		rebindDshTransport("http://127.0.0.1:43128")
		new fakeWindow.WebSocket("/api/events.host")
		assert.deepEqual(urls, [
			"ws://127.0.0.1:43127/api/events.host",
			"ws://127.0.0.1:43128/api/events.host",
		])
	} finally {
		globalThis.window = originalWindow
	}
})

test("Host handshake timeouts request runtime recovery", async () => {
	const states: string[] = []
	const waitForAbort = async function* (signal: AbortSignal): AsyncGenerator<never> {
		await new Promise<void>((resolve) =>
			signal.addEventListener("abort", () => resolve(), { once: true }),
		)
		yield* []
	}
	const api = {
		events: {
			mux: (_payload: unknown, signal: AbortSignal) => waitForAbort(signal),
			host: (_payload: unknown, signal: AbortSignal) => waitForAbort(signal),
		},
		host: {
			describe: async () => {
				throw new DOMException("timed out", "TimeoutError")
			},
		},
	} as never
	const controller = new ConnectionController(
		api,
		{
			onStateChange: (state) => states.push(state),
		},
		{ backoffBaseMs: 1, backoffMaxMs: 1, streamOpenTimeoutMs: 1 },
	)
	controller.start()
	await waitUntil(() => states.includes("reconnecting"))
	controller.stop()
	assert.deepEqual(states, ["reconnecting"])
})

async function waitUntil(predicate: () => boolean, timeoutMs = 250): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!predicate() && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
	if (!predicate()) throw new Error("timed out waiting for condition")
}
