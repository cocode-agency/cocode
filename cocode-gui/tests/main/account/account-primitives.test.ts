import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "pathe"
import test from "node:test"
import { createPkce } from "../../../src/main/contexts/account/application/account-service"
import { AgencyClient } from "../../../src/main/contexts/account/infrastructure/agency-client"
import { listenForCallback } from "../../../src/main/contexts/account/infrastructure/callback-server"
import { DshCloudConfigPort } from "../../../src/main/contexts/account/infrastructure/dsh-cloud-config-port"
import { deviceKeyName } from "../../../src/main/contexts/account/infrastructure/device-name"
import { SharedAccountStore } from "../../../src/main/contexts/account/infrastructure/shared-account-store"
import * as accountHostPlugin from "../../../packages/cocode/cocode-account/src/index"

test("PKCE challenge is the base64url SHA-256 of the verifier", () => {
	const { verifier, challenge } = createPkce()
	assert.match(verifier, /^[A-Za-z0-9_-]+$/)
	assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"))
})

test("device API key names are deterministic and device-oriented", () => {
	assert.equal(deviceKeyName("  my   laptop  "), "Cocode Device — my laptop")
	assert.equal(deviceKeyName("   "), "Cocode Device")
	assert.equal(deviceKeyName("x".repeat(100)).length, "Cocode Device — ".length + 80)
})

test("shared account store writes the TUI-compatible private account file", async () => {
	const home = await mkdtemp(join(tmpdir(), "cocode-gui-account-"))
	try {
		const legacy = {
			read: async (): Promise<undefined> => undefined,
			clear: async (): Promise<void> => undefined,
		}
		const store = new SharedAccountStore(home, legacy)
		await store.write({
			origin: "https://cocode.agency",
			accessToken: "access",
			refreshToken: "refresh",
			accessExpiresAt: 1710000000000,
			personalKeyId: "key-1",
			personalKeyName: "Cocode Device — test-host",
		})
		const yaml = await readFile(join(home, "account.yaml"), "utf8")
		assert.match(yaml, /access_token: access/)
		assert.match(yaml, /personal_key_name: Cocode Device — test-host/)
		assert.doesNotMatch(yaml, /ck_|sk-/)
		assert.deepEqual(await new SharedAccountStore(home, legacy).read(), {
			origin: "https://cocode.agency",
			accessToken: "access",
			refreshToken: "refresh",
			accessExpiresAt: 1710000000000,
			personalKeyId: "key-1",
			personalKeyName: "Cocode Device — test-host",
		})
		if (process.platform !== "win32") {
			assert.equal((await stat(home)).mode & 0o777, 0o700)
			assert.equal((await stat(join(home, "account.yaml"))).mode & 0o777, 0o600)
		}
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})

test("shared account store migrates a legacy GUI identity once", async () => {
	const home = await mkdtemp(join(tmpdir(), "cocode-gui-account-"))
	let clearCalls = 0
	const legacyIdentity = {
		origin: "https://cocode.agency",
		accessToken: "legacy-access",
		refreshToken: "legacy-refresh",
		accessExpiresAt: 1710000000000,
	}
	try {
		const store = new SharedAccountStore(home, {
			read: async () => legacyIdentity,
			clear: async () => {
				clearCalls += 1
			},
		})
		assert.deepEqual(await store.read(), legacyIdentity)
		assert.match(await readFile(join(home, "account.yaml"), "utf8"), /legacy-access/)
		await store.clear()
		assert.equal(clearCalls, 1)
	} finally {
		await rm(home, { recursive: true, force: true })
	}
})

test("Cocode account host entry is a valid DSH plugin", () => {
	assert.equal(accountHostPlugin.name, "cocode-account")
	assert.deepEqual(accountHostPlugin.inject, [])
	assert.equal(typeof accountHostPlugin.apply, "function")
})

test("loopback callback accepts only the exact local callback path", async () => {
	const callback = await listenForCallback("/auth/callback", 2_000)
	const base = callback.redirectUri.replace("/auth/callback", "")
	const wrong = await fetch(`${base}/other`)
	assert.equal(wrong.status, 404)

	const arrivedPromise = callback.wait()
	const response = await fetch(`${callback.redirectUri}?state=state-value&code=code-value`)
	assert.equal(response.status, 200)
	const arrived = await arrivedPromise
	assert.equal(arrived.pathname, "/auth/callback")
	assert.equal(arrived.searchParams.get("state"), "state-value")
	assert.equal(arrived.searchParams.get("code"), "code-value")
	callback.close()
})

test("DSH cloud config port sends a typed RPC envelope and maps settings", async () => {
	const calls: { path: string; body: string }[] = []
	const runtime = {
		request: async (request: { path: string; body?: Uint8Array }) => {
			calls.push({ path: request.path, body: new TextDecoder().decode(request.body) })
			return {
				status: 200,
				statusText: "OK",
				headers: [] as [string, string][],
				body: new TextEncoder().encode(
					JSON.stringify({
						type: "server-response",
						rpcId: JSON.parse(new TextDecoder().decode(request.body)).rpcId,
						result: { ok: true, value: { writable: true, namespaces: [] } },
					}),
				),
			}
		},
	} as never

	const port = new DshCloudConfigPort(runtime)
	const settings = await port.describeSettings()
	assert.equal(settings.writable, true)
	assert.equal(calls[0]?.path, "/api/settings.describe")
	assert.equal(JSON.parse(calls[0]?.body ?? "{}").method, "settings.describe")
})

test("Agency client rejects an authorization URL outside the configured origin", async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ authorization_url: "https://example.com/oauth" }), {
			status: 201,
			headers: { "content-type": "application/json" },
		})) as typeof fetch
	try {
		const agency = new AgencyClient("https://cocode.agency")
		await assert.rejects(
			agency.startAuthorization({
				redirectUri: "http://127.0.0.1:41234/auth/callback",
				state: "state",
				codeChallenge: "challenge",
			}),
			/unexpected authorization origin/,
		)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency origin allows HTTPS and local HTTP only", async () => {
	assert.throws(() => new AgencyClient("ftp://localhost"), /must use HTTPS/)
	assert.throws(() => new AgencyClient("http://cocode.agency"), /must use HTTPS/)
	assert.equal(new AgencyClient("http://127.0.0.1:43123").getOrigin(), "http://127.0.0.1:43123")
	assert.throws(
		() => new AgencyClient("http://127.0.0.1:43123", { allowLocalHttp: false }),
		/must use HTTPS/,
	)
})

test("packaged Agency clients ignore development origin overrides", () => {
	const original = process.env.COCODE_AGENCY_ORIGIN
	process.env.COCODE_AGENCY_ORIGIN = "http://127.0.0.1:43123"
	try {
		assert.equal(
			new AgencyClient(undefined, {
				allowOriginOverride: false,
				allowLocalHttp: false,
			}).getOrigin(),
			"https://cocode.agency",
		)
	} finally {
		if (original === undefined) delete process.env.COCODE_AGENCY_ORIGIN
		else process.env.COCODE_AGENCY_ORIGIN = original
	}
})

test("Agency client accepts only ck-prefixed inference keys", async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ secret: "oauth-identity-token" }), {
			status: 201,
			headers: { "content-type": "application/json" },
		})) as typeof fetch
	try {
		await assert.rejects(
			new AgencyClient("https://cocode.agency").createDesktopKey("identity-token"),
			/could not create a device API key/,
		)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency client trims a desktop key and preserves a safe API problem detail", async () => {
	const originalFetch = globalThis.fetch
	let requestBody: Record<string, unknown> | undefined
	globalThis.fetch = (async (_input, init) => {
		requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
		return new Response(JSON.stringify({ secret: " ck_live_secret ", id: "key-1" }), {
			status: 201,
			headers: { "content-type": "application/json" },
		})
	}) as typeof fetch
	try {
		assert.deepEqual(
			await new AgencyClient("https://cocode.agency").createDesktopKey("identity-token"),
			{ secret: "ck_live_secret", id: "key-1", name: deviceKeyName() },
		)
		assert.equal(requestBody?.name, deviceKeyName())

		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					code: "reauthentication_required",
					detail: "Reauthenticate this browser session within ten minutes before creating a personal API key.",
				}),
				{
					status: 403,
					headers: { "content-type": "application/json" },
				},
			)) as typeof fetch
		await assert.rejects(
			new AgencyClient("https://cocode.agency").createDesktopKey("identity-token"),
			/Reauthenticate this browser session within ten minutes/,
		)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency client never sends a non-ck value to the model catalog", async () => {
	const originalFetch = globalThis.fetch
	let called = false
	globalThis.fetch = (async () => {
		called = true
		return new Response(JSON.stringify({ data: [] }), { status: 200 })
	}) as typeof fetch
	try {
		await assert.rejects(
			new AgencyClient("https://cocode.agency").models("oauth-identity-token"),
			/invalid Cocode Nut API key/,
		)
		assert.equal(called, false)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency client preserves hosted reasoning effort metadata", async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				data: [
					{
						id: "deepseek-v4-flash",
						name: "DeepSeek V4 Flash",
						reasoning_efforts: { high: "high", max: "max" },
					},
				],
			}),
			{ status: 200 },
		)) as typeof fetch
	try {
		assert.deepEqual(await new AgencyClient("https://cocode.agency").models("ck_test"), [
			{
				id: "deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				reasoningEfforts: { high: "high", max: "max" },
			},
		])
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency client calculates rolling account usage from credit and usage windows", async () => {
	const originalFetch = globalThis.fetch
	const requests: string[] = []
	let usageCalls = 0
	globalThis.fetch = (async (input, init) => {
		const url = String(input)
		requests.push(url)
		assert.equal(new Headers(init?.headers).get("authorization"), "Bearer identity-token")
		if (url.includes("/v1/me/model-credit")) {
			return new Response(
				JSON.stringify({
					plan: "pro",
					granted_microusd: 100,
					settled_microusd: 25,
					reserved_microusd: 5,
				}),
				{ status: 200 },
			)
		}
		if (url.includes("/v1/me/model-usage")) {
			usageCalls += 1
			return new Response(
				JSON.stringify({
					fresh_at: "2026-08-15T00:00:00.000Z",
					reset_at:
						usageCalls === 1 ? "2026-08-15T05:00:00.000Z" : "2026-08-22T00:00:00.000Z",
					totals: { billable_microusd: usageCalls === 1 ? 10 : 20 },
				}),
				{ status: 200 },
			)
		}
		return new Response("{}", { status: 404 })
	}) as typeof fetch
	try {
		const usage = await new AgencyClient("https://cocode.agency").accountUsage("identity-token")
		assert.equal(usage.plan, "pro")
		assert.equal(usage.fiveHour, 50)
		assert.equal(usage.week, 40)
		assert.equal(usage.month, 30)
		assert.equal(requests.length, 3)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency client keeps sub-percent usage so remaining can match the account site", async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async (input) => {
		const url = String(input)
		if (url.includes("/v1/me/model-credit")) {
			return new Response(
				JSON.stringify({
					plan: "pro",
					granted_microusd: 60_000_000,
					settled_microusd: 15_945,
					reserved_microusd: 0,
				}),
				{ status: 200 },
			)
		}
		if (url.includes("/v1/me/model-usage")) {
			return new Response(
				JSON.stringify({
					fresh_at: "2026-08-18T13:15:52.000Z",
					totals: { billable_microusd: 15_945 },
				}),
				{ status: 200 },
			)
		}
		return new Response("{}", { status: 404 })
	}) as typeof fetch
	try {
		const usage = await new AgencyClient("https://cocode.agency").accountUsage("identity-token")
		assert.equal(usage.plan, "pro")
		assert.ok(usage.fiveHour > 0 && usage.fiveHour < 1)
		assert.ok(usage.week > 0 && usage.week < 1)
		assert.ok(usage.month > 0 && usage.month < 1)
		assert.equal(
			(100 - usage.month).toLocaleString("en-US", { maximumFractionDigits: 2 }),
			"99.97",
		)
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency client revokes the refresh token using the native token contract", async () => {
	const originalFetch = globalThis.fetch
	let body: unknown
	globalThis.fetch = (async (_input, init) => {
		body = JSON.parse(String(init?.body ?? "{}"))
		return new Response("{}", { status: 200 })
	}) as typeof fetch
	try {
		await new AgencyClient("https://cocode.agency").revoke("refresh-token")
		assert.deepEqual(body, { refresh_token: "refresh-token" })
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency client revokes the machine API key with the account token", async () => {
	const originalFetch = globalThis.fetch
	let request: { input: string; method: string | undefined; token: string | undefined }
	globalThis.fetch = (async (input, init) => {
		const headers = init?.headers as Record<string, string> | undefined
		request = {
			input: String(input),
			method: init?.method,
			token: headers?.authorization,
		}
		return new Response(null, { status: 204 })
	}) as typeof fetch
	try {
		await new AgencyClient("https://cocode.agency").revokeApiKey("access-token", "key/test")
		assert.deepEqual(request, {
			input: "https://cocode.agency/v1/me/api-keys/key%2Ftest",
			method: "DELETE",
			token: "Bearer access-token",
		})
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency message feedback uses the authenticated account API without exposing the token in the body", async () => {
	const originalFetch = globalThis.fetch
	const requests: Array<{
		url: string
		method: string | undefined
		authorization: string | null
		body: unknown
	}> = []
	globalThis.fetch = (async (input, init) => {
		requests.push({
			url: String(input),
			method: init?.method,
			authorization: new Headers(init?.headers).get("authorization"),
			body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
		})
		if (init?.method === "PUT") {
			return new Response(
				JSON.stringify({
					session_id: "s/1",
					message_id: "m?1",
					rating: "negative",
					note: "<script>alert(1)</script>",
					created_at: "2026-08-19T12:00:00Z",
					updated_at: "2026-08-19T12:00:00Z",
				}),
				{ status: 200 },
			)
		}
		if (init?.method === "DELETE")
			return new Response(JSON.stringify({ deleted: true }), { status: 200 })
		return new Response(JSON.stringify({ data: [] }), { status: 200 })
	}) as typeof fetch
	try {
		const client = new AgencyClient("https://cocode.agency")
		await client.listMessageFeedback("account-token", "s/1")
		await client.putMessageFeedback("account-token", {
			sessionId: "s/1",
			messageId: "m?1",
			rating: "negative",
			note: "<script>alert(1)</script>",
		})
		await client.deleteMessageFeedback("account-token", "s/1", "m?1")

		assert.equal(
			requests[0]?.url,
			"https://cocode.agency/v1/me/message-feedback?session_id=s%2F1",
		)
		assert.equal(
			requests[2]?.url,
			"https://cocode.agency/v1/me/message-feedback?session_id=s%2F1&message_id=m%3F1",
		)
		for (const request of requests) {
			assert.equal(request.authorization, "Bearer account-token")
			assert.doesNotMatch(JSON.stringify(request.body) ?? "", /account-token/)
		}
		assert.deepEqual(requests[1]?.body, {
			session_id: "s/1",
			message_id: "m?1",
			rating: "negative",
			note: "<script>alert(1)</script>",
		})
	} finally {
		globalThis.fetch = originalFetch
	}
})

test("Agency message feedback reports non-success responses", async () => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ code: "feedback_invalid" }), { status: 422 })) as typeof fetch
	try {
		await assert.rejects(
			new AgencyClient("https://cocode.agency").putMessageFeedback("account-token", {
				sessionId: "s-1",
				messageId: "m-1",
				rating: "positive",
			}),
			/could not save message feedback/,
		)
	} finally {
		globalThis.fetch = originalFetch
	}
})
