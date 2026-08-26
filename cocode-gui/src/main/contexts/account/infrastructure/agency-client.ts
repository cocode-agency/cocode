import { deviceKeyExpiry, deviceKeyName } from "./device-name"
import { guiClientIdentity } from "./client-identity"

type AgencyResponse<T> = { readonly status: number; readonly value: T }

export class AgencyHttpError extends Error {
	readonly status: number

	constructor(message: string, status: number) {
		super(message)
		this.name = "AgencyHttpError"
		this.status = status
	}
}

function problemDetail(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
	const record = value as Record<string, unknown>
	for (const key of ["detail", "title", "code", "message", "error"]) {
		const candidate = record[key]
		if (typeof candidate !== "string" || candidate.trim() === "") continue
		return candidate
			.trim()
			.replace(/ck_[A-Za-z0-9_-]+/g, "[redacted]")
			.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
			.slice(0, 200)
	}
	return undefined
}

export type TokenPair = {
	readonly access_token: string
	readonly refresh_token: string
	readonly expires_in: number
}

type AgencyProfile = {
	readonly user?: {
		readonly display_name?: string
		readonly email?: string
		readonly avatar_url?: string
	}
}

export type AgencyModel = {
	readonly id: string
	readonly name: string
	readonly contextWindow?: number
	readonly maxTokens?: number
	readonly reasoningEfforts?: Readonly<Record<string, string | null>>
}
export type CreatedApiKey = { readonly secret: string; readonly id: string; readonly name: string }
export type AgencyAccountUsage = {
	readonly plan: string
	readonly fiveHour: number
	readonly week: number
	readonly month: number
	readonly syncedAt: string
	readonly currentPeriodEnd?: string
	readonly fiveHourResetAt?: string
	readonly weekResetAt?: string
}

export type AgencyMessageFeedback = {
	readonly session_id: string
	readonly message_id: string
	readonly rating: "positive" | "negative"
	readonly note?: string | null
	readonly created_at?: string
	readonly updated_at?: string
}

type AgencyModelCredit = {
	readonly plan?: string
	readonly ends_at?: string
	readonly granted_microusd?: number
	readonly settled_microusd?: number
	readonly reserved_microusd?: number
}

type AgencyModelUsage = {
	readonly fresh_at?: string
	readonly reset_at?: string
	readonly totals?: { readonly billable_microusd?: number }
}

type AgencyModelUsageEvents = {
	readonly data?: readonly { readonly occurred_at?: string }[]
	readonly next_cursor?: string
}

const DEFAULT_ORIGIN = "https://cocode.agency"

export type AgencyClientOptions = {
	/** Permit COCODE_AGENCY_ORIGIN and local HTTP for development/test clients. */
	readonly allowOriginOverride?: boolean
	readonly allowLocalHttp?: boolean
}

function isAllowedAgencyProtocol(url: URL): boolean {
	if (url.protocol === "https:") return true
	return (
		url.protocol === "http:" &&
		(url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
	)
}

export function agencyOrigin(options: AgencyClientOptions = {}): string {
	const configured = process.env.COCODE_AGENCY_ORIGIN
	if (options.allowOriginOverride !== false && configured !== undefined && configured !== "")
		return normalizeOrigin(configured, options.allowLocalHttp !== false)
	return DEFAULT_ORIGIN
}

function normalizeOrigin(value: string, allowLocalHttp = true): string {
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		throw new Error("COCODE_AGENCY_ORIGIN must be a valid URL")
	}
	if (
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.search !== "" ||
		parsed.hash !== ""
	) {
		throw new Error(
			"COCODE_AGENCY_ORIGIN must be an origin without credentials or query parameters",
		)
	}
	if (!isAllowedAgencyProtocol(parsed) || (!allowLocalHttp && parsed.protocol !== "https:")) {
		throw new Error("COCODE_AGENCY_ORIGIN must use HTTPS outside local development")
	}
	return parsed.origin
}

export class AgencyClient {
	private readonly origin: string

	constructor(origin?: string, options: AgencyClientOptions = {}) {
		this.origin = normalizeOrigin(
			origin ?? agencyOrigin(options),
			options.allowLocalHttp !== false,
		)
	}

	getOrigin(): string {
		return this.origin
	}

	async startAuthorization(input: {
		readonly redirectUri: string
		readonly state: string
		readonly codeChallenge: string
	}): Promise<string> {
		const client = await guiClientIdentity()
		const response = await this.request<{ authorization_url?: string }>(
			"/v1/auth/native/authorizations",
			{
				method: "POST",
				body: {
					client_id: "cocode-desktop",
					device_label: deviceKeyName(),
					client,
					redirect_uri: input.redirectUri,
					state: input.state,
					code_challenge: input.codeChallenge,
					code_challenge_method: "S256",
					scopes: [
						"profile:read",
						"organizations:read",
						"account:read",
						"models:read",
						"inference:write",
					],
				},
			},
		)
		if (response.status !== 201 || typeof response.value.authorization_url !== "string") {
			throw new Error("could not start Cocode login")
		}
		let authorizationUrl: URL
		try {
			authorizationUrl = new URL(response.value.authorization_url)
		} catch {
			throw new Error("Cocode returned an invalid authorization URL")
		}
		if (!isAllowedAgencyProtocol(authorizationUrl)) {
			throw new Error("Cocode returned an unsafe authorization URL")
		}
		if (authorizationUrl.origin !== this.origin)
			throw new Error("Cocode returned an unexpected authorization origin")
		return authorizationUrl.href
	}

	async exchangeCode(input: {
		readonly code: string
		readonly redirectUri: string
		readonly verifier: string
	}): Promise<TokenPair> {
		const response = await this.request<TokenPair>("/v1/auth/native/token", {
			method: "POST",
			body: {
				grant_type: "authorization_code",
				client_id: "cocode-desktop",
				code: input.code,
				redirect_uri: input.redirectUri,
				code_verifier: input.verifier,
			},
		})
		if (
			response.status !== 200 ||
			typeof response.value.access_token !== "string" ||
			typeof response.value.refresh_token !== "string" ||
			typeof response.value.expires_in !== "number" ||
			!Number.isFinite(response.value.expires_in)
		) {
			throw new Error("could not exchange login code")
		}
		return response.value
	}

	async refresh(refreshToken: string): Promise<TokenPair> {
		const response = await this.request<TokenPair>("/v1/auth/token/refresh", {
			method: "POST",
			body: { refresh_token: refreshToken },
		})
		if (response.status === 401 || response.status === 403)
			throw new AgencyHttpError("session expired", response.status)
		if (
			response.status !== 200 ||
			typeof response.value.access_token !== "string" ||
			typeof response.value.expires_in !== "number" ||
			!Number.isFinite(response.value.expires_in)
		)
			throw new AgencyHttpError("could not refresh Cocode session", response.status)
		return response.value
	}

	async profile(
		accessToken: string,
	): Promise<{ displayName: string; email?: string; avatarUrl?: string }> {
		const response = await this.request<AgencyProfile>("/v1/me", {
			method: "GET",
			token: accessToken,
		})
		if (response.status !== 200)
			throw new AgencyHttpError("could not load account", response.status)
		const displayName = response.value.user?.display_name?.trim() ?? ""
		const email = response.value.user?.email
		return {
			displayName: displayName === "" ? email ?? "Cocode" : displayName,
			...(email === undefined ? {} : { email }),
			...(response.value.user?.avatar_url === undefined
				? {}
				: { avatarUrl: response.value.user.avatar_url }),
		}
	}

	async createDesktopKey(accessToken: string): Promise<CreatedApiKey> {
		const name = deviceKeyName()
		const managedClient = await guiClientIdentity()
		const response = await this.request<{ secret?: string; id?: string }>("/v1/me/api-keys", {
			method: "POST",
			token: accessToken,
			body: {
				name,
				scopes: ["models:read", "inference:write"],
				expires_at: deviceKeyExpiry(),
				managed_client: managedClient,
			},
		})
		const secret = response.value.secret?.trim()
		const id = response.value.id?.trim()
		if (
			(response.status !== 201 && response.status !== 200) ||
			typeof secret !== "string" ||
			typeof id !== "string" ||
			id === "" ||
			!/^ck_[A-Za-z0-9_-]+$/.test(secret)
		) {
			const detail = problemDetail(response.value)
			throw new AgencyHttpError(
				`could not create a device API key (HTTP ${String(response.status)})${
					detail === undefined ? "" : `: ${detail}`
				}`,
				response.status,
			)
		}
		return { secret, id, name }
	}

	async models(apiKey: string): Promise<AgencyModel[]> {
		if (!/^ck_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error("invalid Cocode Nut API key")
		const response = await this.request<{
			data?: {
				id?: string
				name?: string
				context_window?: number
				max_output_tokens?: number
				reasoning_efforts?: Record<string, string | null>
			}[]
		}>("/v1/me/models", { method: "GET", token: apiKey })
		if (response.status !== 200)
			throw new AgencyHttpError("could not list hosted models", response.status)
		const models = (response.value.data ?? [])
			.filter(
				(
					row,
				): row is {
					id: string
					name?: string
					context_window?: number
					max_output_tokens?: number
					reasoning_efforts?: Record<string, string | null>
				} => typeof row.id === "string" && row.id !== "",
			)
			.map((row) => {
				const contextWindow = positiveInteger(row.context_window)
				const maxTokens = positiveInteger(row.max_output_tokens)
				return {
					id: row.id,
					name: row.name?.trim() || row.id,
					...(contextWindow === undefined ? {} : { contextWindow }),
					...(maxTokens === undefined ? {} : { maxTokens }),
					...(row.reasoning_efforts !== undefined &&
					Object.keys(row.reasoning_efforts).length > 0
						? { reasoningEfforts: row.reasoning_efforts }
						: {}),
				}
			})
		return [...new Map(models.map((model) => [model.id, model])).values()]
	}

	async accountUsage(accessToken: string): Promise<AgencyAccountUsage> {
		const now = new Date()
		const to = now.toISOString()
		const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString()
		const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
		const [credit, fiveHourUsage, weekUsage] = await Promise.all([
			this.request<AgencyModelCredit>("/v1/me/model-credit", {
				method: "GET",
				token: accessToken,
			}),
			this.request<AgencyModelUsage>(
				`/v1/me/model-usage?from=${encodeURIComponent(
					fiveHoursAgo,
				)}&to=${encodeURIComponent(to)}`,
				{ method: "GET", token: accessToken },
			),
			this.request<AgencyModelUsage>(
				`/v1/me/model-usage?from=${encodeURIComponent(weekAgo)}&to=${encodeURIComponent(
					to,
				)}`,
				{ method: "GET", token: accessToken },
			),
		])
		if (credit.status !== 200 || fiveHourUsage.status !== 200 || weekUsage.status !== 200)
			throw new AgencyHttpError(
				"could not load account usage",
				Math.max(credit.status, fiveHourUsage.status, weekUsage.status),
			)
		const granted = finiteNumber(credit.value.granted_microusd)
		const settled = finiteNumber(credit.value.settled_microusd)
		const reserved = finiteNumber(credit.value.reserved_microusd)
		const [fiveHourResetAt, weekResetAt] = await Promise.all([
			fiveHourUsage.value.reset_at === undefined
				? this.rollingWindowResetAt(accessToken, fiveHoursAgo, to)
				: Promise.resolve(fiveHourUsage.value.reset_at),
			weekUsage.value.reset_at === undefined
				? this.rollingWindowResetAt(accessToken, weekAgo, to)
				: Promise.resolve(weekUsage.value.reset_at),
		])
		return {
			plan: credit.value.plan?.trim() || "unknown",
			fiveHour: usagePercent(
				finiteNumber(fiveHourUsage.value.totals?.billable_microusd),
				Math.round(granted / 5),
			),
			week: usagePercent(
				finiteNumber(weekUsage.value.totals?.billable_microusd),
				Math.round(granted / 2),
			),
			month: usagePercent(settled + reserved, granted),
			syncedAt: latestTimestamp(fiveHourUsage.value.fresh_at, weekUsage.value.fresh_at) ?? to,
			...(typeof credit.value.ends_at === "string"
				? { currentPeriodEnd: credit.value.ends_at }
				: {}),
			...(fiveHourResetAt === undefined ? {} : { fiveHourResetAt }),
			...(weekResetAt === undefined ? {} : { weekResetAt }),
		}
	}

	private async rollingWindowResetAt(
		accessToken: string,
		from: string,
		to: string,
	): Promise<string | undefined> {
		const response = await this.request<AgencyModelUsageEvents>(
			`/v1/me/model-usage/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
				to,
			)}&limit=100`,
			{ method: "GET", token: accessToken },
		)
		if (response.status !== 200) return undefined
		const events = [...(response.value.data ?? [])]
		let cursor = response.value.next_cursor?.trim()
		while (cursor !== undefined && cursor !== "") {
			const page = await this.request<AgencyModelUsageEvents>(
				`/v1/me/model-usage/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
					to,
				)}&limit=100&cursor=${encodeURIComponent(cursor)}`,
				{ method: "GET", token: accessToken },
			)
			if (page.status !== 200) break
			events.push(...(page.value.data ?? []))
			cursor = page.value.next_cursor?.trim()
		}
		const earliest = events
			.map((event) =>
				typeof event.occurred_at === "string" ? new Date(event.occurred_at) : undefined,
			)
			.filter((date): date is Date => date !== undefined && !Number.isNaN(date.getTime()))
			.sort((a, b) => a.getTime() - b.getTime())[0]
		if (earliest === undefined) return undefined
		return new Date(
			earliest.getTime() + (new Date(to).getTime() - new Date(from).getTime()),
		).toISOString()
	}

	async revokeApiKey(accessToken: string, keyId: string): Promise<void> {
		if (keyId.trim() === "") return
		const response = await this.request(`/v1/me/api-keys/${encodeURIComponent(keyId)}`, {
			method: "DELETE",
			token: accessToken,
		})
		if (response.status !== 200 && response.status !== 204 && response.status !== 404)
			throw new AgencyHttpError("could not revoke Cocode device key", response.status)
	}

	async listMessageFeedback(
		accessToken: string,
		sessionId: string,
	): Promise<{ readonly data: readonly AgencyMessageFeedback[] }> {
		const response = await this.request<{ readonly data?: readonly AgencyMessageFeedback[] }>(
			`/v1/me/message-feedback?session_id=${encodeURIComponent(sessionId)}`,
			{ method: "GET", token: accessToken },
		)
		if (response.status !== 200 || !Array.isArray(response.value.data))
			throw new AgencyHttpError("could not load message feedback", response.status)
		return { data: response.value.data }
	}

	async putMessageFeedback(
		accessToken: string,
		input: {
			readonly sessionId: string
			readonly messageId: string
			readonly rating: "positive" | "negative"
			readonly note?: string
		},
	): Promise<AgencyMessageFeedback> {
		const response = await this.request<AgencyMessageFeedback>("/v1/me/message-feedback", {
			method: "PUT",
			token: accessToken,
			body: {
				session_id: input.sessionId,
				message_id: input.messageId,
				rating: input.rating,
				...(input.note === undefined ? {} : { note: input.note }),
			},
		})
		if (
			response.status !== 200 ||
			typeof response.value !== "object" ||
			response.value === null
		)
			throw new AgencyHttpError("could not save message feedback", response.status)
		return response.value
	}

	async deleteMessageFeedback(
		accessToken: string,
		sessionId: string,
		messageId: string,
	): Promise<{ readonly deleted: true }> {
		const response = await this.request<{ readonly deleted?: boolean }>(
			`/v1/me/message-feedback?session_id=${encodeURIComponent(
				sessionId,
			)}&message_id=${encodeURIComponent(messageId)}`,
			{ method: "DELETE", token: accessToken },
		)
		if (response.status !== 200 || response.value.deleted !== true)
			throw new AgencyHttpError("could not delete message feedback", response.status)
		return { deleted: true }
	}

	async revoke(refreshToken: string): Promise<void> {
		try {
			await this.request("/v1/auth/token/revoke", {
				method: "POST",
				body: { refresh_token: refreshToken },
			})
		} catch {
			// Local logout remains authoritative.
		}
	}

	private async request<T>(
		path: string,
		init: { method: string; body?: unknown; token?: string },
	): Promise<AgencyResponse<T>> {
		const headers: Record<string, string> = { accept: "application/json" }
		if (init.body !== undefined) headers["content-type"] = "application/json"
		if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`
		let response: Response
		try {
			response = await fetch(`${this.origin}${path}`, {
				method: init.method,
				headers,
				body: init.body === undefined ? undefined : JSON.stringify(init.body),
			})
		} catch {
			throw new Error("Cocode Agency is unavailable")
		}
		const text = await response.text()
		let value: T
		try {
			value = text === "" ? ({} as T) : (JSON.parse(text) as T)
		} catch {
			throw new AgencyHttpError(
				`agency answered HTTP ${String(response.status)}`,
				response.status,
			)
		}
		return { status: response.status, value }
	}
}

function finiteNumber(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0
		? value
		: undefined
}

function usagePercent(used: number, limit: number): number {
	if (limit <= 0) return 0
	return Math.max(0, Math.min(100, (used / limit) * 100))
}

function latestTimestamp(...values: (string | undefined)[]): string | undefined {
	return values
		.filter(
			(value): value is string =>
				typeof value === "string" && !Number.isNaN(Date.parse(value)),
		)
		.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
}
