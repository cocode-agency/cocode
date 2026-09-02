import http from "node:http"

/**
 * Establish the browser session used by DSH Web's launch-token authentication.
 * The Supervisor advertises the clean endpoint and the one-time token
 * separately so callers never need to persist a credential in a URL.
 */
export async function establishDshWebAuth(endpoint, token, authority) {
	const base = new URL(endpoint)
	const resolvedToken = token ?? base.searchParams.get("token") ?? undefined
	base.search = ""
	base.hash = ""
	const cleanEndpoint = base.href.replace(/\/$/, "")
	if (resolvedToken === undefined) {
		const response = await fetchWithAuthority(cleanEndpoint, authority)
		if (!response.ok) {
			throw new Error(
				`DSH Web service returned HTTP ${String(response.status)} at ${cleanEndpoint}`,
			)
		}
		return {
			endpoint: cleanEndpoint,
			cookie: undefined,
			...(authority === undefined ? {} : { authority }),
		}
	}

	const authenticated = new URL(cleanEndpoint)
	authenticated.searchParams.set("token", resolvedToken)
	const challenge = await fetchWithAuthority(authenticated, authority, { redirect: "manual" })
	const cookie = extractSetCookie(challenge)
	if (challenge.status !== 303 || cookie === undefined) {
		throw new Error(
			`DSH Web authentication handshake failed with HTTP ${String(
				challenge.status,
			)} at ${cleanEndpoint}`,
		)
	}
	const ready = await fetchWithAuthority(cleanEndpoint, authority, {
		headers: { Cookie: cookie },
	})
	if (!ready.ok) {
		throw new Error(`DSH Web service returned HTTP ${String(ready.status)} at ${cleanEndpoint}`)
	}
	return { endpoint: cleanEndpoint, cookie, ...(authority === undefined ? {} : { authority }) }
}

function extractSetCookie(response) {
	const headers = response.headers
	const getSetCookie = headers.getSetCookie
	const values =
		typeof getSetCookie === "function"
			? getSetCookie.call(headers)
			: headers.get("set-cookie") === null
			? []
			: [headers.get("set-cookie")]
	for (const value of values) {
		if (typeof value !== "string") continue
		const first = value.split(";", 1)[0]?.trim()
		if (first !== undefined && first.includes("=")) return first
	}
	return undefined
}

async function fetchWithAuthority(url, authority, options = {}) {
	if (authority === undefined) return fetch(url, options)
	const parsed = new URL(url)
	if (parsed.protocol !== "http:")
		throw new Error("DSH Web authentication requires an HTTP loopback endpoint")
	return new Promise((resolve, reject) => {
		const request = http.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: `${parsed.pathname}${parsed.search}`,
				method: "GET",
				headers: { ...(options.headers ?? {}), Host: authority },
			},
			(response) => {
				const chunks = []
				response.on("data", (chunk) => chunks.push(chunk))
				response.on("end", () => {
					const headers = new Headers()
					for (const [name, value] of Object.entries(response.headers)) {
						if (Array.isArray(value))
							for (const item of value) headers.append(name, item)
						else if (value !== undefined) headers.set(name, value)
					}
					resolve(
						new Response(Buffer.concat(chunks), {
							status: response.statusCode ?? 0,
							statusText: response.statusMessage,
							headers,
						}),
					)
				})
			},
		)
		request.once("error", reject)
		request.end()
	})
}
