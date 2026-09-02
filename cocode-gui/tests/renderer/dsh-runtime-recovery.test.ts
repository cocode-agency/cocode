import assert from "node:assert/strict"
import test from "node:test"
import {
	installDshTransport,
	rebindDshTransport,
} from "../../src/renderer/app/bootstrap/dsh-transport"

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
