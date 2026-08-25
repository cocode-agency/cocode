import assert from "node:assert/strict"
import test from "node:test"
import {
	AccountService,
	type AccountServiceDependencies,
	type IdentityState,
} from "../../../src/main/contexts/account/application/account-service"
import { AgencyHttpError } from "../../../src/main/contexts/account/infrastructure/agency-client"
import type { CleanupPendingState } from "../../../src/main/contexts/account/infrastructure/cleanup-pending"
import { SignInCancelledError } from "../../../src/main/contexts/account/infrastructure/sign-in-cancelled-error"
import {
	guiClientIdentity,
	harnessClientIdentity,
} from "../../../src/main/contexts/account/infrastructure/client-identity"
import {
	DshCloudConfigUnavailableError,
	type DefaultSelection,
	type ModelGroup,
	type ProviderView,
	type SettingsNamespace,
} from "../../../src/main/contexts/account/infrastructure/dsh-cloud-config-port"

class MemoryVault<T> {
	clearCount = 0
	writes: T[] = []

	constructor(public value: T | undefined) {}

	async read(): Promise<T | undefined> {
		return this.value
	}
	async write(value: T): Promise<void> {
		this.value = value
		this.writes.push(value)
	}
	async clear(): Promise<void> {
		this.value = undefined
		this.clearCount += 1
	}
}

class MemoryPending {
	clearCount = 0
	writes: CleanupPendingState[] = []

	constructor(public value: CleanupPendingState | undefined = undefined) {}

	async read(): Promise<CleanupPendingState | undefined> {
		return this.value
	}
	async write(value: CleanupPendingState): Promise<void> {
		this.value = value
		this.writes.push(value)
	}
	async clear(): Promise<void> {
		this.value = undefined
		this.clearCount += 1
	}
}

function validIdentity(overrides: Partial<IdentityState> = {}): IdentityState {
	return {
		origin: "https://cocode.agency",
		accessToken: "identity-access",
		refreshToken: "identity-refresh",
		accessExpiresAt: Date.now() + 60_000,
		...overrides,
	}
}

async function currentCocodeClient(): Promise<Record<string, string>> {
	return harnessClientIdentity(await guiClientIdentity())
}

function agency(overrides: Record<string, unknown> = {}): {
	client: never
	createdKeys: string[]
	revoked: string[]
	revokedApiKeys: string[]
} {
	const createdKeys: string[] = []
	const revoked: string[] = []
	const revokedApiKeys: string[] = []
	return {
		client: {
			getOrigin: () => "https://cocode.agency",
			startAuthorization: async () => "https://cocode.agency/authorize",
			exchangeCode: async () => ({
				access_token: "identity-access",
				refresh_token: "identity-refresh",
				expires_in: 3600,
			}),
			refresh: async () => ({
				access_token: "identity-access",
				refresh_token: "identity-refresh",
				expires_in: 3600,
			}),
			profile: async () => ({ displayName: "Cocode User" }),
			createDesktopKey: async () => {
				createdKeys.push("ck_test")
				return { secret: "ck_test", id: "key-test", name: "Cocode Device — test-host" }
			},
			models: async () => [{ id: "cloud-model", name: "Cloud Model" }],
			accountUsage: async () => ({
				plan: "pro",
				fiveHour: 10,
				week: 20,
				month: 30,
				syncedAt: "2026-08-15T00:00:00.000Z",
			}),
			revokeApiKey: async (_accessToken: string, keyId: string) => {
				revokedApiKeys.push(keyId)
			},
			revoke: async (token: string) => {
				revoked.push(token)
			},
			...overrides,
		} as never,
		createdKeys,
		revoked,
		revokedApiKeys,
	}
}

function dependencies(
	identity: MemoryVault<IdentityState>,
	cloudKey = new MemoryVault<string>(undefined),
	pending = new MemoryPending(),
): {
	deps: Partial<AccountServiceDependencies>
	cloudKey: MemoryVault<string>
	pending: MemoryPending
} {
	return {
		deps: {
			identity,
			cloudKey,
			cleanupPending: pending,
			listenForCallback: async () => {
				throw new Error("browser login was not expected")
			},
			openExternal: async () => undefined,
		},
		cloudKey,
		pending,
	}
}

test("provider conflicts are reported before a cloud key or DSH write", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client, createdKeys } = agency()
	let writes = 0
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: 4,
					value: {
						providers: {
							"cocode-nut": {
								api: "openai-completions",
								baseURL: "https://other.example/v1",
								apiKeyEnv: "OTHER_KEY",
							},
						},
					},
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: false, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async () => {
			writes += 1
		},
		setCredential: async () => {
			writes += 1
		},
		unsetCredential: async () => {
			writes += 1
		},
	} as never
	const { deps } = dependencies(identity)
	const service = new AccountService(dsh, client, deps)

	const snapshot = await service.signIn()
	assert.equal(snapshot.phase, "error")
	assert.equal(snapshot.cloud.status, "conflict")
	assert.equal(snapshot.error?.code, "cloud-provider-conflict")
	assert.deepEqual(createdKeys, [])
	assert.equal(writes, 0)
})

test("an active reserved provider without a managed route is a conflict", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client, createdKeys } = agency()
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [{ ns: "llm-pi-ai", revision: 1, value: { providers: {} } }],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: false, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [
			{
				provider: "cocode-nut",
				displayName: "Other Cloud",
				settingsNs: "llm-pi-ai",
				settingsPath: ["providers", "cocode-nut"],
				active: true,
			},
		],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async (): Promise<void> => undefined,
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
	} as never
	const { deps } = dependencies(identity)
	const snapshot = await new AccountService(dsh, client, deps).signIn()
	assert.equal(snapshot.phase, "error")
	assert.equal(snapshot.cloud.status, "conflict")
	assert.deepEqual(createdKeys, [])
})

test("reconciles a pre-existing reserved cloud credential", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client, createdKeys } = agency({
		models: async () => [
			{
				id: "cloud-model",
				name: "Cloud Model",
				reasoningEfforts: { high: "high", max: "max" },
			},
		],
	})
	let route: Record<string, unknown> | undefined
	const writes: string[] = []
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: 1,
					value:
						route === undefined
							? { providers: {} }
							: { providers: { "cocode-nut": route } },
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> =>
			route === undefined
				? []
				: [
						{
							provider: "cocode-nut",
							displayName: "Cocode Nut",
							settingsNs: "llm-pi-ai",
							settingsPath: ["providers", "cocode-nut"],
							active: true,
						},
				  ],
		models: async (): Promise<ModelGroup[]> =>
			route === undefined
				? []
				: [
						{
							id: "cocode-nut",
							name: "Cocode Nut",
							models: [{ id: "cloud-model", name: "Cloud Model" }],
						},
				  ],
		mutateSettings: async (request: { ops: { op: "set" | "unset"; value?: unknown }[] }) => {
			route = request.ops[0]?.value as Record<string, unknown>
			writes.push("route:set")
		},
		setCredential: async () => {
			writes.push("credential:set")
		},
		unsetCredential: async () => {
			writes.push("credential:unset")
		},
	} as never

	const snapshot = await new AccountService(dsh, client, dependencies(identity).deps).signIn()
	assert.equal(snapshot.phase, "signed-in")
	assert.equal(snapshot.cloud.status, "ready")
	assert.deepEqual(createdKeys, ["ck_test"])
	assert.deepEqual(writes, ["credential:set", "route:set"])
	assert.deepEqual((route?.models as unknown[] | undefined)?.[0], {
		id: "cloud-model",
		name: "Cloud Model",
		reasoningEfforts: { high: "high", max: "max" },
	})
})

test("reuses a ready device cloud route without minting another API key", async () => {
	const identity = new MemoryVault(
		validIdentity({
			personalKeyId: "key-from-tui",
			personalKeyName: "Cocode Device — test-host",
		}),
	)
	const { client, createdKeys } = agency()
	const cocodeClient = await currentCocodeClient()
	let writes = 0
	const route = {
		displayName: "Cocode Nut",
		api: "openai-responses",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
		cocodeClient,
		retryPolicy: { mode: "normal", maxRetries: 5 },
		models: [{ id: "cloud-model", name: "Cloud Model" }],
	}
	const dsh = {
		currentDefault: async () => ({ provider: "cocode-nut", model: "cloud-model" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: 3,
					value: { providers: { "cocode-nut": route } },
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [
			{
				provider: "cocode-nut",
				displayName: "Cocode Nut",
				settingsNs: "llm-pi-ai",
				settingsPath: ["providers", "cocode-nut"],
				active: true,
			},
		],
		models: async (): Promise<ModelGroup[]> => [
			{
				id: "cocode-nut",
				name: "Cocode Nut",
				models: [{ id: "cloud-model", name: "Cloud Model" }],
			},
		],
		mutateSettings: async () => {
			writes += 1
		},
		setCredential: async () => {
			writes += 1
		},
		unsetCredential: async () => {
			writes += 1
		},
	} as never

	const snapshot = await new AccountService(dsh, client, dependencies(identity).deps).signIn()
	assert.equal(snapshot.phase, "signed-in")
	assert.equal(snapshot.cloud.status, "ready")
	assert.deepEqual(createdKeys, [])
	assert.equal(writes, 0)
	assert.deepEqual(identity.value?.managedRoute, {
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
	})
})

test("refreshes hosted reasoning metadata on an existing managed route", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client, createdKeys } = agency({
		models: async () => [{
			id: "cloud-model",
			name: "Cloud Model",
			reasoningEfforts: { high: "high", max: "max" },
		}],
	})
	const cocodeClient = await currentCocodeClient()
	let route: Record<string, unknown> = {
		displayName: "Cocode Nut",
		api: "openai-responses",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
		cocodeClient,
		retryPolicy: { mode: "normal", maxRetries: 5 },
		models: [{ id: "cloud-model", name: "Cloud Model" }],
	}
	const dsh = {
		currentDefault: async () => ({ provider: "cocode-nut", model: "cloud-model" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [{ ns: "llm-pi-ai", revision: 3, value: { providers: { "cocode-nut": route } } }],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [{
			provider: "cocode-nut",
			displayName: "Cocode Nut",
			settingsNs: "llm-pi-ai",
			settingsPath: ["providers", "cocode-nut"],
			active: true,
		}],
		models: async (): Promise<ModelGroup[]> => [{
			id: "cocode-nut",
			name: "Cocode Nut",
			models: [{ id: "cloud-model", name: "Cloud Model" }],
		}],
		mutateSettings: async (request: { ops: { value?: unknown }[] }): Promise<void> => {
			route = request.ops[0]?.value as Record<string, unknown>
		},
		setCredential: async () => undefined,
		unsetCredential: async () => undefined,
	} as never

	const snapshot = await new AccountService(
		dsh,
		client,
		dependencies(identity, new MemoryVault("ck_existing")).deps,
	).signIn()
	assert.equal(snapshot.phase, "signed-in")
	assert.deepEqual(createdKeys, [])
	assert.deepEqual((route.models as unknown[])[0], {
		id: "cloud-model",
		name: "Cloud Model",
		reasoningEfforts: { high: "high", max: "max" },
	})
})

test("paid sign-in switches a custom default and the open session onto Nut Flash", async () => {
	const identity = new MemoryVault(
		validIdentity({
			personalKeyId: "key-from-tui",
			personalKeyName: "Cocode Device — test-host",
		}),
	)
	const { client } = agency()
	const cocodeClient = await currentCocodeClient()
	let current: DefaultSelection = { provider: "deepseek-official", model: "deepseek-v4-flash" }
	const selected: { sessionId: string; selection: DefaultSelection }[] = []
	const defaultOps: { op: string; path: readonly string[]; value?: unknown }[] = []
	const route = {
		displayName: "Cocode Nut",
		api: "openai-responses",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
		cocodeClient,
		retryPolicy: { mode: "normal", maxRetries: 5 },
		models: [
			{ id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
			{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
		],
	}
	const dsh = {
		currentDefault: async () => current,
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: 3,
					value: { providers: { "cocode-nut": route } },
				},
				{ ns: "agent-default-model", revision: 4, value: current },
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [
			{
				provider: "cocode-nut",
				displayName: "Cocode Nut",
				settingsNs: "llm-pi-ai",
				settingsPath: ["providers", "cocode-nut"],
				active: true,
			},
		],
		models: async (): Promise<ModelGroup[]> => [
			{
				id: "deepseek-official",
				name: "DeepSeek",
				models: [{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
			},
			{
				id: "cocode-nut",
				name: "Cocode Nut",
				models: [
					{ id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
					{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
				],
			},
		],
		mutateSettings: async (request: {
			ns: string
			ops: { op: string; path: readonly string[]; value?: unknown }[]
		}) => {
			assert.equal(request.ns, "agent-default-model")
			defaultOps.push(...request.ops)
			current = { provider: "cocode-nut", model: "deepseek-v4-flash" }
		},
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
		listSessions: async () => [
			{ sessionId: "blank-open", blank: true, running: false },
			{ sessionId: "cold-history", blank: false, running: false },
		],
		selectModel: async (sessionId: string, selection: DefaultSelection) => {
			selected.push({ sessionId, selection })
		},
	} as never

	const snapshot = await new AccountService(dsh, client, dependencies(identity).deps).signIn()
	assert.equal(snapshot.phase, "signed-in")
	assert.deepEqual(current, { provider: "cocode-nut", model: "deepseek-v4-flash" })
	assert.deepEqual(defaultOps, [
		{ op: "set", path: ["provider"], value: "cocode-nut" },
		{ op: "set", path: ["model"], value: "deepseek-v4-flash" },
		{ op: "unset", path: ["reasoningEffort"] },
	])
	assert.deepEqual(selected, [
		{
			sessionId: "blank-open",
			selection: { provider: "cocode-nut", model: "deepseek-v4-flash" },
		},
	])
})

test("free sign-in keeps a custom default model", async () => {
	const identity = new MemoryVault(
		validIdentity({
			personalKeyId: "key-from-tui",
			personalKeyName: "Cocode Device — test-host",
		}),
	)
	const { client } = agency({
		accountUsage: async () => ({
			plan: "free",
			fiveHour: 10,
			week: 20,
			month: 30,
			syncedAt: "2026-08-15T00:00:00.000Z",
		}),
	})
	const cocodeClient = await currentCocodeClient()
	let writes = 0
	const route = {
		displayName: "Cocode Nut",
		api: "openai-responses",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
		cocodeClient,
		retryPolicy: { mode: "normal", maxRetries: 5 },
		models: [{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
	}
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: 3,
					value: { providers: { "cocode-nut": route } },
				},
				{
					ns: "agent-default-model",
					revision: 4,
					value: { provider: "deepseek-official", model: "deepseek-v4-flash" },
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [
			{
				provider: "cocode-nut",
				displayName: "Cocode Nut",
				settingsNs: "llm-pi-ai",
				settingsPath: ["providers", "cocode-nut"],
				active: true,
			},
		],
		models: async (): Promise<ModelGroup[]> => [
			{
				id: "cocode-nut",
				name: "Cocode Nut",
				models: [{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
			},
		],
		mutateSettings: async () => {
			writes += 1
		},
		setCredential: async () => {
			writes += 1
		},
		unsetCredential: async () => {
			writes += 1
		},
		selectModel: async () => {
			writes += 1
		},
	} as never

	const snapshot = await new AccountService(dsh, client, dependencies(identity).deps).signIn()
	assert.equal(snapshot.phase, "signed-in")
	assert.equal(writes, 0)
})

test("upgrades a ready cloud route to the Cocode five-retry default", async () => {
	const identity = new MemoryVault(
		validIdentity({
			personalKeyId: "key-from-tui",
			personalKeyName: "Cocode Device — test-host",
		}),
	)
	const { client, createdKeys } = agency()
	let route: Record<string, unknown> = {
		displayName: "Cocode Nut",
		api: "openai-responses",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
		models: [{ id: "cloud-model", name: "Cloud Model" }],
	}
	const writes: string[] = []
	const dsh = {
		currentDefault: async () => ({ provider: "cocode-nut", model: "cloud-model" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: 3,
					value: { providers: { "cocode-nut": route } },
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [
			{
				provider: "cocode-nut",
				displayName: "Cocode Nut",
				settingsNs: "llm-pi-ai",
				settingsPath: ["providers", "cocode-nut"],
				active: true,
			},
		],
		models: async (): Promise<ModelGroup[]> => [
			{
				id: "cocode-nut",
				name: "Cocode Nut",
				models: [{ id: "cloud-model", name: "Cloud Model" }],
			},
		],
		mutateSettings: async (request: { ops: { op: "set" | "unset"; value?: unknown }[] }) => {
			route = request.ops[0]?.value as Record<string, unknown>
			writes.push("route:set")
		},
		setCredential: async () => {
			writes.push("credential:set")
		},
		unsetCredential: async () => {
			writes.push("credential:unset")
		},
	} as never
	const cloudKey = new MemoryVault("ck_live_existing")

	const snapshot = await new AccountService(
		dsh,
		client,
		dependencies(identity, cloudKey).deps,
	).signIn()
	assert.equal(snapshot.phase, "signed-in")
	assert.equal(snapshot.cloud.status, "ready")
	assert.deepEqual(createdKeys, [])
	assert.deepEqual(route.retryPolicy, { mode: "normal", maxRetries: 5 })
	assert.deepEqual(writes, ["credential:set", "route:set"])
})

test("upgrades a Completions cloud route to Responses without minting another key", async () => {
	const identity = new MemoryVault(
		validIdentity({
			personalKeyId: "key-from-tui",
			personalKeyName: "Cocode Device — test-host",
		}),
	)
	const { client, createdKeys } = agency()
	let route: Record<string, unknown> = {
		displayName: "Cocode Nut",
		api: "openai-completions",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
		models: [{ id: "cloud-model", name: "Cloud Model" }],
	}
	const writes: string[] = []
	const dsh = {
		currentDefault: async () => ({ provider: "cocode-nut", model: "cloud-model" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: 3,
					value: { providers: { "cocode-nut": route } },
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [
			{
				provider: "cocode-nut",
				displayName: "Cocode Nut",
				settingsNs: "llm-pi-ai",
				settingsPath: ["providers", "cocode-nut"],
				active: true,
			},
		],
		models: async (): Promise<ModelGroup[]> => [
			{
				id: "cocode-nut",
				name: "Cocode Nut",
				models: [{ id: "cloud-model", name: "Cloud Model" }],
			},
		],
		mutateSettings: async (request: { ops: { op: "set" | "unset"; value?: unknown }[] }) => {
			route = request.ops[0]?.value as Record<string, unknown>
			writes.push("route:set")
		},
		setCredential: async () => {
			writes.push("credential:set")
		},
		unsetCredential: async () => {
			writes.push("credential:unset")
		},
	} as never
	const cloudKey = new MemoryVault("ck_live_existing")

	const snapshot = await new AccountService(
		dsh,
		client,
		dependencies(identity, cloudKey).deps,
	).signIn()
	assert.equal(snapshot.phase, "signed-in")
	assert.equal(snapshot.cloud.status, "ready")
	assert.deepEqual(createdKeys, [])
	assert.equal(route.api, "openai-responses")
	assert.deepEqual(route.retryPolicy, { mode: "normal", maxRetries: 5 })
	assert.deepEqual(writes, ["credential:set", "route:set"])
})

test("failed provider activation rolls back the managed route and credential", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client, createdKeys } = agency()
	let route: Record<string, unknown> | undefined
	let credentialConfigured = false
	const mutations: string[] = []
	const settings = (): SettingsNamespace[] => [
		{
			ns: "llm-pi-ai",
			revision: mutations.length,
			value: route === undefined ? { providers: {} } : { providers: { "cocode-nut": route } },
		},
	]
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({ writable: true, namespaces: settings() }),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: credentialConfigured, writable: true },
		}),
		setCredential: async () => {
			credentialConfigured = true
			mutations.push("credential:set")
		},
		unsetCredential: async () => {
			credentialConfigured = false
			mutations.push("credential:unset")
		},
		mutateSettings: async (request: { ops: { op: "set" | "unset"; value?: unknown }[] }) => {
			const op = request.ops[0]
			if (op?.op === "set") route = op.value as Record<string, unknown>
			else route = undefined
			mutations.push(`route:${op?.op ?? "none"}`)
		},
		providers: async () => [
			{
				provider: "cocode-nut",
				displayName: "Cocode Nut",
				settingsNs: "llm-pi-ai",
				settingsPath: ["providers", "cocode-nut"],
				active: false,
			},
		],
		models: async (): Promise<ModelGroup[]> => [],
	} as never
	const { deps, cloudKey } = dependencies(identity)
	const service = new AccountService(dsh, client, deps)

	const snapshot = await service.signIn()
	assert.equal(snapshot.phase, "error")
	assert.equal(route, undefined)
	assert.equal(credentialConfigured, false)
	assert.deepEqual(mutations, ["credential:set", "route:set", "route:unset", "credential:unset"])
	// The key is retained in the Main-only vault so a retry does not mint a
	// second device key after a later DSH activation failure.
	assert.equal(cloudKey.value, "ck_test")
	await service.signIn()
	assert.deepEqual(createdKeys, ["ck_test"])
})

test("provider write failure before route creation still rolls back the credential", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client } = agency()
	let credentialConfigured = false
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [{ ns: "llm-pi-ai", revision: 1, value: { providers: {} } }],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: credentialConfigured, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		setCredential: async () => {
			credentialConfigured = true
		},
		unsetCredential: async () => {
			credentialConfigured = false
		},
		mutateSettings: async () => {
			throw new Error("settings write failed")
		},
	} as never
	const { deps } = dependencies(identity)
	const snapshot = await new AccountService(dsh, client, deps).signIn()
	assert.equal(snapshot.phase, "error")
	assert.equal(credentialConfigured, false)
})

test("sign out removes the managed provider first, then restores the previous default", async () => {
	const previous: DefaultSelection = { provider: "deepseek-official", model: "deepseek-v4-flash" }
	const identity = new MemoryVault(
		validIdentity({
			personalKeyId: "key-test",
			preLoginDefault: previous,
			managedRoute: {
				baseURL: "https://cocode.agency/v1",
				apiKeyEnv: "COCODE_NUT_API_KEY",
			},
		}),
	)
	const { client, revoked, revokedApiKeys } = agency()
	let current: DefaultSelection = { provider: "cocode-nut", model: "cloud-model" }
	let route: Record<string, unknown> | undefined = {
		displayName: "Cocode Nut",
		api: "openai-completions",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
		models: [{ id: "cloud-model", name: "Cloud Model" }],
	}
	const mutations: string[] = []
	const dsh = {
		currentDefault: async () => current,
		models: async () => [
			{
				id: "deepseek-official",
				name: "DeepSeek",
				models: [{ id: "deepseek-v4-flash", name: "Flash" }],
			},
			{
				id: "cocode-nut",
				name: "Cocode Nut",
				models: [{ id: "cloud-model", name: "Cloud Model" }],
			},
		],
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{ ns: "agent-default-model", revision: 7, value: current },
				{
					ns: "llm-pi-ai",
					revision: 9,
					value:
						route === undefined
							? { providers: {} }
							: { providers: { "cocode-nut": route } },
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [],
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async () => {
			mutations.push("credential:unset")
		},
		mutateSettings: async (request: {
			ns: string
			ops: { op: "set" | "unset"; path: readonly string[]; value?: unknown }[]
		}) => {
			if (request.ns === "agent-default-model") {
				current = previous
				mutations.push("default:restore")
				return
			}
			route = undefined
			mutations.push("route:unset")
		},
	} as never
	const { deps, cloudKey, pending } = dependencies(identity, new MemoryVault("ck_test"))
	const service = new AccountService(dsh, client, deps)

	await service.signOut()
	assert.deepEqual(current, previous)
	assert.deepEqual(mutations, ["route:unset", "credential:unset", "default:restore"])
	assert.equal(identity.value, undefined)
	assert.equal(cloudKey.value, undefined)
	assert.equal(pending.value, undefined)
	assert.deepEqual(revoked, ["identity-refresh"])
	assert.deepEqual(revokedApiKeys, ["key-test"])
	assert.equal((await service.snapshot()).phase, "signed-out")
})

test("sign out falls back to the deployment default when the previous model is gone", async () => {
	const identity = new MemoryVault(
		validIdentity({
			preLoginDefault: { provider: "deleted-provider", model: "deleted-model" },
			managedRoute: {
				baseURL: "https://cocode.agency/v1",
				apiKeyEnv: "COCODE_NUT_API_KEY",
			},
		}),
	)
	const { client } = agency()
	const mutations: { ns: string; ops: { op: "set" | "unset"; path: readonly string[] }[] }[] = []
	const dsh = {
		currentDefault: async () => ({ provider: "cocode-nut", model: "cloud-model" }),
		models: async () => [
			{
				id: "cocode-nut",
				name: "Cocode Nut",
				models: [{ id: "cloud-model", name: "Cloud Model" }],
			},
		],
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "agent-default-model",
					revision: 7,
					value: { provider: "cocode-nut", model: "cloud-model" },
				},
				{
					ns: "llm-pi-ai",
					revision: 9,
					value: {
						providers: {
							"cocode-nut": {
								api: "openai-responses",
								baseURL: "https://cocode.agency/v1",
								apiKeyEnv: "COCODE_NUT_API_KEY",
							},
						},
					},
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [],
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
		mutateSettings: async (request: {
			ns: string
			ops: { op: "set" | "unset"; path: readonly string[] }[]
		}) => {
			mutations.push(request)
		},
	} as never
	const { deps, pending } = dependencies(identity, new MemoryVault("ck_test"))
	const service = new AccountService(dsh, client, deps)

	await service.signOut()

	assert.deepEqual(mutations[1], {
		ns: "agent-default-model",
		expectedRevision: 7,
		ops: [
			{ op: "unset", path: ["provider"] },
			{ op: "unset", path: ["model"] },
			{ op: "unset", path: ["reasoningEffort"] },
		],
	})
	assert.equal(identity.value, undefined)
	assert.equal(pending.value, undefined)
	assert.equal((await service.snapshot()).phase, "signed-out")
})

test("sign out drops the managed provider even when default restoration fails", async () => {
	const identity = new MemoryVault(
		validIdentity({
			preLoginDefault: { provider: "deepseek-official", model: "deepseek-v4-flash" },
			managedRoute: {
				baseURL: "https://cocode.agency/v1",
				apiKeyEnv: "COCODE_NUT_API_KEY",
			},
		}),
	)
	const { client } = agency()
	const mutations: string[] = []
	let route: Record<string, unknown> | undefined = {
		api: "openai-responses",
		baseURL: "https://cocode.agency/v1",
		apiKeyEnv: "COCODE_NUT_API_KEY",
	}
	const dsh = {
		currentDefault: async () => ({ provider: "cocode-nut", model: "cloud-model" }),
		// Restoring a default model is a preference, not the meaning of signing
		// out: its failure must not leave a live managed route behind.
		models: async () => {
			throw new Error("model catalog unavailable")
		},
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "agent-default-model",
					revision: 7,
					value: { provider: "cocode-nut", model: "cloud-model" },
				},
				{
					ns: "llm-pi-ai",
					revision: 9,
					value:
						route === undefined
							? { providers: {} }
							: { providers: { "cocode-nut": route } },
				},
			],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: true, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [],
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async () => {
			mutations.push("credential:unset")
		},
		mutateSettings: async () => {
			route = undefined
			mutations.push("route:unset")
		},
	} as never
	const { deps, cloudKey, pending } = dependencies(identity, new MemoryVault("ck_test"))
	const service = new AccountService(dsh, client, deps)

	await service.signOut()

	assert.deepEqual(mutations, ["route:unset", "credential:unset"])
	assert.equal(route, undefined)
	assert.equal(identity.value, undefined)
	assert.equal(cloudKey.value, undefined)
	assert.equal(pending.value?.pending, true)
	assert.equal((await service.snapshot()).phase, "error")
})

test("a temporary refresh failure keeps the encrypted identity for retry", async () => {
	const identity = new MemoryVault(validIdentity({ accessExpiresAt: Date.now() - 1 }))
	const { client } = agency({
		refresh: async () => {
			throw new AgencyHttpError("could not refresh Cocode session", 503)
		},
	})
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({ writable: true, namespaces: [] as SettingsNamespace[] }),
		describeCredentials: async () => ({}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async (): Promise<void> => undefined,
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
	} as never
	const { deps } = dependencies(identity)
	const service = new AccountService(dsh, client, deps)

	await service.hydrate()
	assert.notEqual(identity.value, undefined)
	assert.equal((await service.snapshot()).phase, "error")
})

test("an invalid identity session is cleared after Agency rejects it", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client } = agency({
		profile: async () => {
			throw new AgencyHttpError("could not load account", 401)
		},
	})
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({ writable: true, namespaces: [] as SettingsNamespace[] }),
		describeCredentials: async () => ({}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async (): Promise<void> => undefined,
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
	} as never
	const { deps } = dependencies(identity)
	const service = new AccountService(dsh, client, deps)
	await service.hydrate()
	assert.equal(identity.value, undefined)
	assert.equal((await service.snapshot()).phase, "signed-out")
})

test("a desktop-key reauthentication requirement clears identity during hydrate", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client } = agency({
		createDesktopKey: async () => {
			throw new AgencyHttpError(
				"could not create a device API key (HTTP 403): reauthentication_required",
				403,
			)
		},
	})
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [{ ns: "llm-pi-ai", revision: 1, value: { providers: {} } }],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: false, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async (): Promise<void> => undefined,
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
	} as never
	const { deps, cloudKey } = dependencies(identity)
	const service = new AccountService(dsh, client, deps)

	await service.hydrate()
	assert.equal(identity.value, undefined)
	assert.equal(cloudKey.value, undefined)
	assert.equal((await service.snapshot()).phase, "signed-out")
})

test("desktop-key reauthentication opens a browser reauth gate before retry", async () => {
	const identity = new MemoryVault(validIdentity())
	let authorizationState = ""
	let keyAttempts = 0
	let callbackCount = 0
	let route: Record<string, unknown> | undefined
	let credentialConfigured = false
	const { client } = agency({
		startAuthorization: async (input: { state: string }) => {
			authorizationState = input.state
			return "https://cocode.agency/authorize"
		},
		exchangeCode: async () => ({
			access_token: "fresh-access",
			refresh_token: "fresh-refresh",
			expires_in: 3600,
		}),
		createDesktopKey: async () => {
			keyAttempts += 1
			if (keyAttempts === 1) {
				throw new AgencyHttpError(
					"could not create a device API key (HTTP 403): Reauthenticate this browser session within ten minutes before creating a personal API key.",
					403,
				)
			}
			return { secret: "ck_fresh", id: "key-fresh", name: "Cocode Device — test-host" }
		},
	})
	const settings = (): SettingsNamespace[] => [
		{
			ns: "llm-pi-ai",
			revision: route === undefined ? 1 : 2,
			value: route === undefined ? { providers: {} } : { providers: { "cocode-nut": route } },
		},
	]
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({ writable: true, namespaces: settings() }),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: credentialConfigured, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> =>
			route === undefined
				? []
				: [
						{
							provider: "cocode-nut",
							displayName: "Cocode Nut",
							settingsNs: "llm-pi-ai",
							settingsPath: ["providers", "cocode-nut"],
							active: credentialConfigured,
						},
				  ],
		models: async (): Promise<ModelGroup[]> =>
			route === undefined
				? []
				: [
						{
							id: "cocode-nut",
							name: "Cocode Nut",
							models: [{ id: "cloud-model", name: "Cloud Model" }],
						},
				  ],
		setCredential: async () => {
			credentialConfigured = true
		},
		unsetCredential: async () => {
			credentialConfigured = false
		},
		mutateSettings: async (request: { ops: { op: "set" | "unset"; value?: unknown }[] }) => {
			const op = request.ops[0]
			route = op?.op === "set" ? (op.value as Record<string, unknown>) : undefined
		},
	} as never
	const { deps } = dependencies(identity)
	const opened: string[] = []
	const service = new AccountService(dsh, client, {
		...deps,
		openExternal: async (url) => {
			opened.push(url)
		},
		listenForCallback: async () => {
			callbackCount += 1
			return {
				redirectUri: "http://127.0.0.1:43123/auth/callback",
				wait: async () =>
					new URL(
						`http://127.0.0.1:43123/auth/callback?code=fresh-code&state=${authorizationState}`,
					),
				close: () => undefined,
			}
		},
	})

	const snapshot = await service.signIn()
	assert.equal(snapshot.phase, "error")
	assert.equal(snapshot.error?.code, "reauthentication-required")
	assert.equal(callbackCount, 0)
	assert.equal(keyAttempts, 1)
	assert.equal(identity.value, undefined)
	assert.deepEqual(opened, ["https://cocode.agency/login?return_to=%2Faccount"])

	const retried = await service.signIn()
	assert.equal(retried.phase, "signed-in")
	assert.equal(callbackCount, 1)
	assert.equal(keyAttempts, 2)
	assert.equal(identity.value?.accessToken, "fresh-access")
	assert.deepEqual(opened, [
		"https://cocode.agency/login?return_to=%2Faccount",
		"https://cocode.agency/authorize",
	])
})

test("sign out does not send an identity token to a changed Agency origin", async () => {
	const identity = new MemoryVault(validIdentity({ origin: "https://old.cocode.agency" }))
	const { client, revoked } = agency()
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({ writable: true, namespaces: [] as SettingsNamespace[] }),
		describeCredentials: async () => ({}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async (): Promise<void> => undefined,
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
	} as never
	const { deps } = dependencies(identity)
	await new AccountService(dsh, client, deps).signOut()
	assert.deepEqual(revoked, [])
	assert.equal(identity.value, undefined)
})

test("cancelling a browser wait returns the account to a resting signed-out state", async () => {
	const identity = new MemoryVault<IdentityState>(undefined)
	const { client } = agency()
	let abortWait: ((error: Error) => void) | undefined
	const waiting = new Promise<URL>((_resolve, reject) => {
		abortWait = reject
	})
	let browserOpened: () => void = () => undefined
	const opened = new Promise<void>((resolve) => {
		browserOpened = resolve
	})
	const { deps } = dependencies(identity)
	const service = new AccountService({} as never, client, {
		...deps,
		openExternal: async () => {
			browserOpened()
		},
		listenForCallback: async () => ({
			redirectUri: "http://127.0.0.1:43123/auth/callback",
			wait: async () => waiting,
			// Mirrors the loopback listener: closing it releases whoever waits.
			close: () => {
				abortWait?.(new SignInCancelledError())
			},
		}),
	})

	const task = service.signIn()
	await opened
	await service.cancelSignIn()
	const snapshot = await task

	assert.equal(snapshot.phase, "signed-out")
	assert.equal(snapshot.error, undefined)
	assert.equal(identity.value, undefined)
	// The attempt is fully released, so the next one starts a new browser round
	// trip instead of joining the abandoned task.
	assert.equal((await service.snapshot()).phase, "signed-out")
})

test("a queued cleanup that keeps failing cannot strand the account", async () => {
	const identity = new MemoryVault<IdentityState>(undefined)
	const pending = new MemoryPending({
		pending: true,
		previousDefault: { provider: "deepseek-official", model: "deepseek-v4-flash" },
	})
	let authorizationState = ""
	const { client } = agency({
		startAuthorization: async (input: { state: string }) => {
			authorizationState = input.state
			return "https://cocode.agency/authorize"
		},
	})
	let route: Record<string, unknown> | undefined
	let credentialConfigured = false
	let credentialProbes = 0
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [
				{
					ns: "llm-pi-ai",
					revision: route === undefined ? 1 : 2,
					value:
						route === undefined
							? { providers: {} }
							: { providers: { "cocode-nut": route } },
				},
			],
		}),
		describeCredentials: async () => {
			credentialProbes += 1
			// The queued cleanup hits a runtime that cannot serve the configuration
			// API; the sign-in that follows it must still reach the browser.
			if (credentialProbes === 1) throw new DshCloudConfigUnavailableError()
			return { COCODE_NUT_API_KEY: { configured: credentialConfigured, writable: true } }
		},
		providers: async (): Promise<ProviderView[]> =>
			route === undefined
				? []
				: [
						{
							provider: "cocode-nut",
							displayName: "Cocode Nut",
							settingsNs: "llm-pi-ai",
							settingsPath: ["providers", "cocode-nut"],
							active: credentialConfigured,
						},
				  ],
		models: async (): Promise<ModelGroup[]> =>
			route === undefined
				? []
				: [
						{
							id: "cocode-nut",
							name: "Cocode Nut",
							models: [{ id: "cloud-model", name: "Cloud Model" }],
						},
				  ],
		setCredential: async () => {
			credentialConfigured = true
		},
		unsetCredential: async () => {
			credentialConfigured = false
		},
		mutateSettings: async (request: { ops: { op: "set" | "unset"; value?: unknown }[] }) => {
			const op = request.ops[0]
			route = op?.op === "set" ? (op.value as Record<string, unknown>) : undefined
		},
	} as never
	const { deps } = dependencies(identity, new MemoryVault<string>(undefined), pending)
	const opened: string[] = []
	const service = new AccountService(dsh, client, {
		...deps,
		openExternal: async (url) => {
			opened.push(url)
		},
		listenForCallback: async () => ({
			redirectUri: "http://127.0.0.1:43123/auth/callback",
			wait: async () =>
				new URL(
					`http://127.0.0.1:43123/auth/callback?code=fresh-code&state=${authorizationState}`,
				),
			close: () => undefined,
		}),
	})

	const snapshot = await service.signIn()

	assert.equal(snapshot.phase, "signed-in")
	assert.deepEqual(opened, ["https://cocode.agency/authorize"])
	assert.equal(pending.value, undefined)
})

test("DSH unavailability clears local secrets and leaves a non-secret cleanup marker", async () => {
	const identity = new MemoryVault(
		validIdentity({
			preLoginDefault: { provider: "deepseek-official", model: "deepseek-v4-flash" },
			managedRoute: {
				baseURL: "https://cocode.agency/v1",
				apiKeyEnv: "COCODE_NUT_API_KEY",
			},
		}),
	)
	const { client } = agency()
	const dsh = {
		currentDefault: async () => {
			throw new DshCloudConfigUnavailableError()
		},
		describeSettings: async () => {
			throw new DshCloudConfigUnavailableError()
		},
		describeCredentials: async () => ({}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async (): Promise<void> => undefined,
		setCredential: async (): Promise<void> => undefined,
		unsetCredential: async (): Promise<void> => undefined,
	} as never
	const { deps, cloudKey, pending } = dependencies(identity, new MemoryVault("ck_test"))
	const service = new AccountService(dsh, client, deps)

	await service.signOut()
	assert.equal(identity.value, undefined)
	assert.equal(cloudKey.value, undefined)
	assert.equal(pending.value?.pending, true)
	assert.deepEqual(pending.value?.previousDefault, {
		provider: "deepseek-official",
		model: "deepseek-v4-flash",
	})
	const snapshot = await service.snapshot()
	assert.equal(snapshot.phase, "error")
	assert.equal(snapshot.error?.code, "cleanup-pending")
})

test("renderer-visible account errors redact cloud keys and bearer tokens", async () => {
	const identity = new MemoryVault(validIdentity())
	const { client } = agency()
	const dsh = {
		currentDefault: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
		describeSettings: async () => ({
			writable: true,
			namespaces: [{ ns: "llm-pi-ai", revision: 1, value: { providers: {} } }],
		}),
		describeCredentials: async () => ({
			COCODE_NUT_API_KEY: { configured: false, writable: true },
		}),
		providers: async (): Promise<ProviderView[]> => [],
		models: async (): Promise<ModelGroup[]> => [],
		mutateSettings: async (): Promise<void> => undefined,
		setCredential: async () => {
			throw new Error("failed ck_secret Bearer eyJheader.payload.signature")
		},
		unsetCredential: async (): Promise<void> => undefined,
	} as never
	const { deps } = dependencies(identity)
	const service = new AccountService(dsh, client, deps)

	const snapshot = await service.signIn()
	assert.equal(snapshot.phase, "error")
	assert.doesNotMatch(snapshot.error?.message ?? "", /ck_secret|eyJheader|payload|signature/)
	assert.match(snapshot.error?.message ?? "", /\[redacted\]/)
})
