import assert from "node:assert/strict"
import test from "node:test"
import { createDshRuntimeProxy, normalizeRuntimeUrl } from "../../vite.renderer.config"

// The dev server proxies the shared Host's Web service through same-origin
// paths. The single invariant that everything else hangs off is `changeOrigin:
// false`: the /api trust fence (client-connection) requires the request Host
// header to match the browser's Origin host, and the page always calls
// same-origin (localhost:5273). Rewriting Host to the target would 403 every
// /api RPC, so these tests pin that behavior down.

test("preserves the browser Host header by keeping changeOrigin false on every route", () => {
	const proxy = createDshRuntimeProxy("http://127.0.0.1:3080")
	for (const route of ["/api", "/cocode", "/sidebar", "/plugins"]) {
		assert.equal(proxy[route]?.changeOrigin, false, `${route} must not rewrite Host`)
	}
})

test("forwards exactly the Host Web routes over a WebSocket-capable proxy", () => {
	const proxy = createDshRuntimeProxy("http://127.0.0.1:3080")
	assert.deepEqual(Object.keys(proxy).sort(), ["/api", "/cocode", "/plugins", "/sidebar"])
	for (const options of Object.values(proxy)) {
		assert.equal(options?.ws, true)
	}
})

test("points every route at the shared Host URL", () => {
	const target = "http://127.0.0.1:3080"
	const proxy = createDshRuntimeProxy(target)
	for (const options of Object.values(proxy)) {
		assert.equal(options?.target, target)
	}
})

test("normalizes the runtime URL by trimming and dropping one trailing slash", () => {
	assert.equal(normalizeRuntimeUrl(undefined), undefined)
	assert.equal(normalizeRuntimeUrl(""), undefined)
	assert.equal(normalizeRuntimeUrl("  "), undefined)
	assert.equal(normalizeRuntimeUrl("http://127.0.0.1:3080/"), "http://127.0.0.1:3080")
	assert.equal(normalizeRuntimeUrl("http://127.0.0.1:3080"), "http://127.0.0.1:3080")
})
