import { createHash, randomBytes } from "node:crypto"
import { shell } from "electron"
import type {
	AccountMessageFeedback,
	AccountMessageFeedbackList,
	AccountProfile,
	AccountSnapshot,
} from "../../../../contracts/ipc/account.contract"
import {
	DEFAULT_MODEL_NAMESPACE,
	type DefaultSelection,
	type DshCloudConfigPort,
	type ModelGroup,
	type ProviderView,
	type SettingsNamespace,
} from "../infrastructure/dsh-cloud-config-port"
import {
	AgencyClient,
	AgencyHttpError,
	type AgencyModel,
	type CreatedApiKey,
	type TokenPair,
} from "../infrastructure/agency-client"
import { listenForCallback as createCallbackListener } from "../infrastructure/callback-server"
import { CleanupPendingStore, type CleanupPendingState } from "../infrastructure/cleanup-pending"
import { AccountLockBusyError } from "../infrastructure/account-lock"
import {
	FileStorageUnavailableError,
	FileVault,
	resolveCocodeFile,
} from "../infrastructure/file-vault"
import { SecureStorageUnavailableError, SecureVault } from "../infrastructure/secure-vault"
import { guiClientIdentity, harnessClientIdentity } from "../infrastructure/client-identity"
import { SignInCancelledError } from "../infrastructure/sign-in-cancelled-error"
import { SharedAccountStore } from "../infrastructure/shared-account-store"

const CLOUD_PROVIDER = "cocode-nut"
const LEGACY_CLOUD_PROVIDER = "cocode-cloud"
const CLOUD_NAMESPACE = "llm-pi-ai"
const CLOUD_PATH = ["providers", CLOUD_PROVIDER] as const
const LEGACY_CLOUD_PATH = ["providers", LEGACY_CLOUD_PROVIDER] as const
const CLOUD_CREDENTIAL = "COCODE_NUT_API_KEY"
const LEGACY_CLOUD_CREDENTIAL = "COCODE_CLOUD_API_KEY"
const CLOUD_API = "openai-responses"
const CLOUD_MAX_RETRIES = 5
const CLOUD_KEY_PATTERN = /^ck_[A-Za-z0-9_-]+$/
const CLOUD_READY_ATTEMPTS = 6
const CLOUD_READY_RETRY_MS = 100
const PREFERRED_NUT_MODEL_ID = "deepseek-v4-flash"

type AccountStage =
	| "cleanup"
	| "callback-server"
	| "authorization"
	| "exchange-code"
	| "identity-refresh"
	| "profile"
	| "default-model"
	| "settings.describe"
	| "credentials.describe"
	| "providers"
	| "cloud-key"
	| "models"
	| "credentials.set"
	| "settings.mutate"
	| "cloud-verification"
	| "logout"

export type IdentityState = {
	readonly origin: string
	readonly accessToken: string
	readonly refreshToken: string
	readonly accessExpiresAt: number
	readonly profile?: AccountProfile
	readonly preLoginDefault?: DefaultSelection
	readonly managedRoute?: { readonly baseURL: string; readonly apiKeyEnv: string }
	readonly personalKeyId?: string
	readonly personalKeyName?: string
}

type Vault<T> = {
	read(): Promise<T | undefined>
	write(value: T): Promise<void>
	clear(): Promise<void>
	withLock?<R>(operation: () => Promise<R>): Promise<R>
	getStatus?: () => {
		readonly state: "unknown" | "available" | "unavailable"
		readonly reason?: string
	}
}

type AccountAgency = {
	getOrigin(): string
	startAuthorization(input: {
		redirectUri: string
		state: string
		codeChallenge: string
	}): Promise<string>
	exchangeCode(input: { code: string; redirectUri: string; verifier: string }): Promise<TokenPair>
	refresh(refreshToken: string): Promise<TokenPair>
	profile(accessToken: string): Promise<AccountProfile>
	createDesktopKey(accessToken: string): Promise<CreatedApiKey>
	models(apiKey: string): Promise<AgencyModel[]>
	accountUsage(accessToken: string): Promise<{
		readonly plan: string
		readonly fiveHour: number
		readonly week: number
		readonly month: number
		readonly syncedAt: string
		readonly currentPeriodEnd?: string
		readonly fiveHourResetAt?: string
		readonly weekResetAt?: string
	}>
	listMessageFeedback(accessToken: string, sessionId: string): Promise<AccountMessageFeedbackList>
	putMessageFeedback(
		accessToken: string,
		input: {
			sessionId: string
			messageId: string
			rating: "positive" | "negative"
			note?: string
		},
	): Promise<AccountMessageFeedback>
	deleteMessageFeedback(
		accessToken: string,
		sessionId: string,
		messageId: string,
	): Promise<{ deleted: true }>
	revokeApiKey(accessToken: string, keyId: string): Promise<void>
	revoke(refreshToken: string): Promise<void>
}

type AccountDshPort = Pick<
	DshCloudConfigPort,
	| "describeSettings"
	| "describeCredentials"
	| "providers"
	| "models"
	| "currentDefault"
	| "mutateSettings"
	| "setCredential"
	| "unsetCredential"
	| "listSessions"
	| "selectModel"
>

type CallbackListener = {
	readonly redirectUri: string
	wait(): Promise<URL>
	close(): void
}

export type AccountServiceDependencies = {
	readonly identity: Vault<IdentityState>
	readonly cloudKey: Vault<string>
	readonly cleanupPending: Pick<CleanupPendingStore, "read" | "write" | "clear">
	readonly listenForCallback: (pathname: string) => Promise<CallbackListener>
	readonly openExternal: (url: string) => Promise<unknown>
}

class CloudProviderConflictError extends Error {
	constructor(message = "cocode-nut provider is already configured by another source") {
		super(message)
		this.name = "CloudProviderConflictError"
	}
}

class InvalidIdentityError extends Error {
	constructor() {
		super("Cocode session is no longer valid")
		this.name = "InvalidIdentityError"
	}
}

function emptySnapshot(): AccountSnapshot {
	return {
		phase: "signed-out",
		profile: null,
		cloud: { status: "absent", providerId: CLOUD_PROVIDER },
	}
}

function base64Url(value: Buffer): string {
	return value.toString("base64url")
}

export function createPkce(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(32))
	const challenge = base64Url(createHash("sha256").update(verifier).digest())
	return { verifier, challenge }
}

function valueAt(root: unknown, path: readonly string[]): unknown {
	let current = root
	for (const key of path) {
		if (typeof current !== "object" || current === null || Array.isArray(current))
			return undefined
		current = (current as Record<string, unknown>)[key]
	}
	return current
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined
}

function routeOf(namespaces: readonly SettingsNamespace[]): Record<string, unknown> | undefined {
	const namespace = namespaces.find((item) => item.ns === CLOUD_NAMESPACE)
	return recordOf(valueAt(namespace?.value, CLOUD_PATH))
}

function isManagedCloudRoute(
	route: Record<string, unknown> | undefined,
	managedRoute: { readonly baseURL: string; readonly apiKeyEnv: string } | undefined,
): boolean {
	return (
		managedRoute !== undefined &&
		(route?.api === CLOUD_API || route?.api === "openai-completions") &&
		route.baseURL === managedRoute.baseURL &&
		route.apiKeyEnv === managedRoute.apiKeyEnv
	)
}

function routeIsCurrent(
	route: Record<string, unknown> | undefined,
	managedRoute: { readonly baseURL: string; readonly apiKeyEnv: string } | undefined,
	currentClient?: Record<string, string>,
): boolean {
	const retryPolicy = recordOf(route?.retryPolicy)
	const cocodeClient = recordOf(route?.cocodeClient)
	return (
		isManagedCloudRoute(route, managedRoute) &&
		route?.api === CLOUD_API &&
		retryPolicy?.mode === "normal" &&
		retryPolicy.maxRetries === CLOUD_MAX_RETRIES &&
		cocodeClient?.product === "cocode" &&
		cocodeClient.surface === "gui" &&
		(currentClient === undefined ||
			Object.entries(currentClient).every(([key, value]) => cocodeClient[key] === value))
	)
}

function cloudRouteValue(
	baseURL: string,
	models: readonly AgencyModel[],
	cocodeClient: Record<string, string>,
): Record<string, unknown> {
	return {
		displayName: "Cocode Nut",
		api: CLOUD_API,
		baseURL,
		apiKeyEnv: CLOUD_CREDENTIAL,
		cocodeClient,
		retryPolicy: { mode: "normal", maxRetries: CLOUD_MAX_RETRIES },
		models: models.map((model) => ({
			id: model.id,
			name: model.name,
			...(model.reasoningEfforts === undefined
				? {}
				: { reasoningEfforts: model.reasoningEfforts }),
		})),
	}
}

function isExpectedCloudProvider(provider: ProviderView): boolean {
	return (
		provider.settingsNs === CLOUD_NAMESPACE &&
		provider.settingsPath.length === CLOUD_PATH.length &&
		provider.settingsPath.every((part, index) => part === CLOUD_PATH[index])
	)
}

function modelExists(groups: readonly ModelGroup[], selection: DefaultSelection): boolean {
	return groups.some(
		(group) =>
			group.id === selection.provider &&
			group.models.some((model) => model.id === selection.model),
	)
}

/** Whether a provider id names the account-managed route, current or legacy. */
function isCloudProviderId(provider: string): boolean {
	return provider === CLOUD_PROVIDER || provider === LEGACY_CLOUD_PROVIDER
}

function isPaidPlan(plan: string): boolean {
	const key = plan.trim().toLowerCase()
	return key !== "" && key !== "free" && key !== "unknown"
}

function isFlashModel(model: { readonly id: string; readonly name: string }): boolean {
	return /flash/i.test(model.id) || /flash/i.test(model.name)
}

function nutFlashSelection(groups: readonly ModelGroup[]): DefaultSelection | undefined {
	const group =
		groups.find((entry) => entry.id === CLOUD_PROVIDER && entry.models.length > 0) ??
		groups.find((entry) => entry.id === LEGACY_CLOUD_PROVIDER && entry.models.length > 0)
	if (group === undefined) return undefined
	const model =
		group.models.find((entry) => entry.id === PREFERRED_NUT_MODEL_ID) ??
		group.models.find(isFlashModel) ??
		group.models[0]
	if (model === undefined) return undefined
	return { provider: group.id, model: model.id }
}

function selectionSettingsOps(selection: DefaultSelection): {
	readonly op: "set" | "unset"
	readonly path: readonly string[]
	readonly value?: unknown
}[] {
	return [
		{ op: "set", path: ["provider"], value: selection.provider },
		{ op: "set", path: ["model"], value: selection.model },
		...(selection.reasoningEffort === undefined
			? [{ op: "unset" as const, path: ["reasoningEffort"] }]
			: [
					{
						op: "set" as const,
						path: ["reasoningEffort"],
						value: selection.reasoningEffort,
					},
			  ]),
	]
}

function cleanupStateOf(state: IdentityState): CleanupPendingState {
	return {
		pending: true,
		...(state.preLoginDefault === undefined ? {} : { previousDefault: state.preLoginDefault }),
	}
}

export class AccountService {
	private snapshotValue = emptySnapshot()
	private readonly listeners = new Set<(snapshot: AccountSnapshot) => void>()
	private readonly identity: Vault<IdentityState>
	private readonly cloudKey: Vault<string>
	private readonly cleanupPending: Pick<CleanupPendingStore, "read" | "write" | "clear">
	private readonly listenForCallback: AccountServiceDependencies["listenForCallback"]
	private readonly openExternal: AccountServiceDependencies["openExternal"]
	private readonly agency: AccountAgency
	private loaded = false
	private signInTask: Promise<AccountSnapshot> | undefined
	private signInCallback: { close(): void } | undefined
	private refreshTask: Promise<void> | undefined
	private stage: AccountStage | undefined

	constructor(
		private readonly dsh: AccountDshPort,
		agency: AccountAgency = new AgencyClient(),
		dependencies: Partial<AccountServiceDependencies> = {},
	) {
		this.agency = agency
		this.identity = dependencies.identity ?? new SharedAccountStore()
		this.cloudKey = dependencies.cloudKey ?? createCloudKeyVault()
		this.cleanupPending = dependencies.cleanupPending ?? new CleanupPendingStore()
		this.listenForCallback = dependencies.listenForCallback ?? createCallbackListener
		this.openExternal = dependencies.openExternal ?? shell.openExternal
	}

	onChanged(listener: (snapshot: AccountSnapshot) => void): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	async hydrate(): Promise<void> {
		this.stage = "cleanup"
		try {
			await this.ensureLoaded()
		} catch (error) {
			this.logFailure("hydrate", error)
			this.publish({
				phase: "error",
				profile: null,
				cloud: { status: "error", providerId: CLOUD_PROVIDER },
				error: safeError(error, "account-unavailable"),
			})
			return
		}
		try {
			await this.migrateLegacyCloudSettings()
		} catch {
			// Best-effort rename; provision can still reconcile the managed route.
		}
		if (await this.retryPendingCleanup()) return
		let state = await this.identity.read()
		if (state === undefined) {
			await this.discardOrphanedCloud()
			return
		}
		try {
			this.stage = "identity-refresh"
			this.assertIdentityOrigin(state)
			state = await this.ensureIdentityAccess(state)
			this.stage = "profile"
			const profile = await this.loadIdentityProfile(state.accessToken)
			const next: IdentityState = { ...state, profile }
			await this.identity.write(next)
			this.publish({
				phase: "provisioning",
				profile,
				cloud: { status: "absent", providerId: CLOUD_PROVIDER },
			})
			await this.provision(next)
		} catch (error) {
			this.logFailure("hydrate", error)
			if (isReauthenticationRequired(error)) {
				await this.handleInvalidIdentity(state, { clearCloudKey: false })
				return
			}
			if (error instanceof InvalidIdentityError) {
				await this.handleInvalidIdentity(state)
				return
			}
			this.publish({
				phase: "error",
				profile: state.profile ?? null,
				cloud: {
					status: error instanceof CloudProviderConflictError ? "conflict" : "error",
					providerId: CLOUD_PROVIDER,
				},
				error: safeError(
					error,
					error instanceof CloudProviderConflictError
						? "cloud-provider-conflict"
						: "account-unavailable",
				),
			})
		}
	}

	async snapshot(): Promise<AccountSnapshot> {
		await this.ensureLoaded()
		if (this.snapshotValue.phase !== "signed-in") return this.snapshotValue
		const state = await this.identity.read()
		if (state === undefined) return this.snapshotValue
		try {
			this.assertIdentityOrigin(state)
			const current = await this.ensureIdentityAccess(state)
			const usage = await this.agency.accountUsage(current.accessToken)
			const snapshot = { ...this.snapshotValue, usage }
			this.publish(snapshot)
			return snapshot
		} catch (error) {
			const snapshot: AccountSnapshot = {
				...this.snapshotValue,
				usage: {
					...this.snapshotValue.usage,
					error: safeError(error, "usage-unavailable").message,
				},
			}
			this.publish(snapshot)
			return snapshot
		}
	}

	async signIn(): Promise<AccountSnapshot> {
		if (this.signInTask !== undefined) return this.signInTask
		this.signInTask = this.performSignIn().finally(() => {
			this.signInTask = undefined
			this.signInCallback = undefined
		})
		return this.signInTask
	}

	/**
	 * Abandon a sign-in that is waiting on the browser. Waiting for an external
	 * authorization can legitimately take minutes, so the desktop must be able to
	 * take that decision back; the in-flight task settles on its own signed-out
	 * snapshot once the loopback listener is gone.
	 */
	async cancelSignIn(): Promise<void> {
		if (this.signInTask === undefined) return
		this.signInCallback?.close()
		await this.signInTask
	}

	async signOut(): Promise<void> {
		this.stage = "logout"
		await this.ensureLoaded()
		if (this.identity.withLock !== undefined) {
			await this.identity.withLock(() => this.performSignOut())
			return
		}
		await this.performSignOut()
	}

	async listMessageFeedback(sessionId: string): Promise<AccountMessageFeedbackList> {
		const state = await this.requireSignedInState()
		return this.agency.listMessageFeedback(state.accessToken, sessionId)
	}

	async putMessageFeedback(input: {
		sessionId: string
		messageId: string
		rating: "positive" | "negative"
		note?: string
	}): Promise<AccountMessageFeedback> {
		const state = await this.requireSignedInState()
		return this.agency.putMessageFeedback(state.accessToken, input)
	}

	async deleteMessageFeedback(sessionId: string, messageId: string): Promise<{ deleted: true }> {
		const state = await this.requireSignedInState()
		return this.agency.deleteMessageFeedback(state.accessToken, sessionId, messageId)
	}

	/**
	 * Finish the cloud cleanup a failed sign-out left queued. Signing out always
	 * clears the local identity, so a queued marker means the runtime still holds
	 * a managed route the user can see while the account reads as signed out.
	 * Every moment the runtime becomes usable again — startup, a rebind, a
	 * restart — is a chance to close that gap.
	 * @returns whether a queued cleanup existed, regardless of its outcome.
	 */
	async retryPendingCleanup(): Promise<boolean> {
		await this.ensureLoaded()
		if ((await this.cleanupPending.read()) === undefined) return false
		if (this.identity.withLock !== undefined)
			return this.identity.withLock(() => this.performPendingCleanup())
		return this.performPendingCleanup()
	}

	private async performPendingCleanup(): Promise<boolean> {
		const pending = await this.cleanupPending.read()
		if (pending === undefined) return false
		this.stage = "cleanup"
		try {
			await this.finishPendingCleanup(pending)
			await this.clearIdentity()
			await this.cloudKey.clear()
			this.publish(emptySnapshot())
		} catch (error) {
			this.logFailure("pending cleanup", error)
			this.publish({
				phase: "error",
				profile: null,
				cloud: { status: "error", providerId: CLOUD_PROVIDER },
				error: safeError(error, "cleanup-pending"),
			})
		}
		return true
	}

	private async performSignOut(): Promise<void> {
		const state = await this.identity.read()
		const existingPending = await this.cleanupPending.read()
		const pending =
			state === undefined
				? existingPending ?? { pending: true as const }
				: cleanupStateOf(state)
		this.stage = "cleanup"
		const cleanupError = await this.cleanupManagedConfig(pending)
		if (cleanupError !== undefined) this.logFailure("sign-out cleanup", cleanupError)
		// Never send a token to a different Agency origin after a development
		// environment switch. Local cleanup remains authoritative in that case.
		if (state !== undefined && state.origin === this.agency.getOrigin()) {
			let revocationState = state
			try {
				// The device key is the machine-level authorization used by Cocode Nut.
				// Refresh first when possible so deleting it still works after an access
				// token expiry; local logout must not be blocked by a remote failure.
				revocationState = await this.ensureIdentityAccess(state)
			} catch {
				// Best effort: revoke the refresh token and clear local state below.
			}
			if (revocationState.personalKeyId !== undefined) {
				try {
					await this.agency.revokeApiKey(
						revocationState.accessToken,
						revocationState.personalKeyId,
					)
				} catch {
					// Local cleanup remains authoritative if the Agency is unavailable.
				}
			}
			try {
				await this.agency.revoke(revocationState.refreshToken)
			} catch {
				// Remote revocation is best effort; local secret cleanup must continue.
			}
		}
		await this.clearIdentity()
		await this.cloudKey.clear()
		if (cleanupError !== undefined) {
			this.publish({
				phase: "error",
				profile: null,
				cloud: { status: "error", providerId: CLOUD_PROVIDER },
				error: safeError(cleanupError, "cleanup-pending"),
			})
			return
		}
		this.publish(emptySnapshot())
	}

	dispose(): void {
		this.listeners.clear()
	}

	private async performSignIn(): Promise<AccountSnapshot> {
		try {
			await this.ensureLoaded()
			this.publish({
				phase: "signing-in",
				profile: null,
				cloud: { status: "absent", providerId: CLOUD_PROVIDER },
			})
			const pending = await this.cleanupPending.read()
			if (pending !== undefined) {
				this.stage = "cleanup"
				try {
					await this.finishPendingCleanup(pending)
				} catch (error) {
					// Draining the queue is opportunistic here: provisioning below
					// rewrites the managed route and credential, so whatever the failed
					// sign-out left behind is about to be overwritten anyway. Keeping
					// the marker would instead strand the account, because every later
					// sign-in starts by draining the same queue and failing the same way
					// before it ever reaches the browser.
					this.logFailure("sign-in cleanup", error)
					await this.cleanupPending.clear()
				}
				await this.clearIdentity()
				await this.cloudKey.clear()
			}
			let state = await this.identity.read()
			if (state !== undefined) {
				try {
					this.stage = "identity-refresh"
					this.assertIdentityOrigin(state)
					state = await this.ensureIdentityAccess(state)
				} catch (error) {
					if (!(error instanceof InvalidIdentityError)) throw error
					// An explicit retry should be able to recover from a stale or rotated
					// identity in one click instead of returning a signed-out snapshot and
					// requiring the user to click the button a second time.
					await this.handleInvalidIdentity(state)
					state = undefined
				}
			}
			if (state === undefined) {
				this.stage = "callback-server"
				const callback = await this.listenForCallback("/auth/callback")
				// Closing the listener is what releases the wait below, so this is
				// also the cancel handle for as long as the browser round trip runs.
				this.signInCallback = callback
				try {
					const { verifier, challenge } = createPkce()
					const stateValue = base64Url(randomBytes(24))
					this.stage = "authorization"
					const authorizationUrl = await this.agency.startAuthorization({
						redirectUri: callback.redirectUri,
						state: stateValue,
						codeChallenge: challenge,
					})
					await this.openExternal(authorizationUrl)
					const arrived = await callback.wait()
					if (arrived.searchParams.get("state") !== stateValue)
						throw new Error("login state mismatch")
					const code = arrived.searchParams.get("code")
					if (code === null || code === "") throw new Error("login was not approved")
					this.stage = "exchange-code"
					const token = await this.agency.exchangeCode({
						code,
						redirectUri: callback.redirectUri,
						verifier,
					})
					state = {
						origin: this.agency.getOrigin(),
						accessToken: token.access_token,
						refreshToken: token.refresh_token,
						accessExpiresAt: Date.now() + token.expires_in * 1000,
					}
					await this.identity.write(state)
				} finally {
					this.signInCallback = undefined
					callback.close()
				}
			}
			this.stage = "identity-refresh"
			this.assertIdentityOrigin(state)
			state = await this.ensureIdentityAccess(state)
			this.stage = "profile"
			const profile = await this.loadIdentityProfile(state.accessToken)
			state = { ...state, profile }
			this.stage = "default-model"
			const currentDefault = await this.dsh.currentDefault()
			if (state.preLoginDefault === undefined)
				state = { ...state, preLoginDefault: currentDefault }
			await this.identity.write(state)
			this.publish({
				phase: "provisioning",
				profile,
				cloud: { status: "absent", providerId: CLOUD_PROVIDER },
			})
			const snapshot = await this.provision(state)
			if (snapshot.phase === "signed-in") {
				try {
					await this.switchToPaidNutFlash(state.accessToken)
				} catch (error) {
					// Sign-in already landed the managed route. Switching the picker
					// is a preference and must not roll the account back to an error.
					this.logFailure("paid-nut-default", error)
				}
			}
			return snapshot
		} catch (error) {
			if (error instanceof SignInCancelledError) {
				// Abandoning a sign-in leaves the account exactly where it started.
				// Reporting it as a failure would strand the UI in an error state the
				// user has to dismiss after deliberately backing out.
				const snapshot = emptySnapshot()
				this.publish(snapshot)
				return snapshot
			}
			this.logFailure("sign-in", error)
			if (isReauthenticationRequired(error)) {
				const invalid = await this.identity.read()
				return this.handleBrowserReauthentication(invalid)
			}
			if (error instanceof InvalidIdentityError) {
				const invalid = await this.identity.read()
				if (invalid !== undefined) {
					await this.handleInvalidIdentity(invalid)
					return this.snapshotValue
				}
			}
			const current = await this.identity.read()
			const snapshot: AccountSnapshot = {
				phase: "error",
				profile: current?.profile ?? null,
				cloud: {
					status: error instanceof CloudProviderConflictError ? "conflict" : "error",
					providerId: CLOUD_PROVIDER,
				},
				error: safeError(
					error,
					error instanceof CloudProviderConflictError
						? "cloud-provider-conflict"
						: "sign-in-failed",
				),
			}
			this.publish(snapshot)
			return snapshot
		}
	}

	private async provision(state: IdentityState): Promise<AccountSnapshot> {
		if (this.identity.withLock !== undefined) {
			return this.identity.withLock(async () =>
				this.provisionLocked((await this.identity.read()) ?? state),
			)
		}
		return this.provisionLocked(state)
	}

	private async provisionLocked(state: IdentityState): Promise<AccountSnapshot> {
		const baseURL = `${this.agency.getOrigin()}/v1`
		this.stage = "settings.describe"
		const settings = await this.dsh.describeSettings()
		const cloudNamespace = settings.namespaces.find((item) => item.ns === CLOUD_NAMESPACE)
		if (!settings.writable || cloudNamespace === undefined)
			throw new Error("Cocode Nut settings are not writable")
		const route = routeOf(settings.namespaces)
		const intendedRoute = { baseURL, apiKeyEnv: CLOUD_CREDENTIAL }
		const currentClient = harnessClientIdentity(await guiClientIdentity())
		this.stage = "credentials.describe"
		const credentials = await this.dsh.describeCredentials([CLOUD_CREDENTIAL])
		this.stage = "providers"
		const providersBefore = await this.dsh.providers()
		const existingCredential = credentials[CLOUD_CREDENTIAL]
		if (existingCredential?.writable === false)
			throw new Error("Cocode Nut credential storage is not writable")
		const hasManagedMetadata =
			state.managedRoute?.baseURL === baseURL &&
			state.managedRoute.apiKeyEnv === CLOUD_CREDENTIAL
		const managed =
			route === undefined ? hasManagedMetadata : isManagedCloudRoute(route, intendedRoute)
		if (route !== undefined && !managed) throw new CloudProviderConflictError()
		const existingProvider = providersBefore.find(
			(provider) => provider.provider === CLOUD_PROVIDER,
		)
		if (
			existingProvider !== undefined &&
			(!isExpectedCloudProvider(existingProvider) ||
				(existingProvider.active && route === undefined && !managed))
		)
			throw new CloudProviderConflictError()
		if (
			routeIsCurrent(route, intendedRoute, currentClient) &&
			existingCredential?.configured === true &&
			existingProvider?.active === true
		) {
			const group = (await this.dsh.models()).find(
				(candidate) => candidate.id === CLOUD_PROVIDER,
			)
			if (group !== undefined && group.models.length > 0) {
				const next: IdentityState = { ...state, managedRoute: intendedRoute }
				await this.identity.write(next)
				const snapshot: AccountSnapshot = {
					phase: "signed-in",
					profile: next.profile ?? null,
					cloud: { status: "ready", providerId: CLOUD_PROVIDER },
				}
				this.publish(snapshot)
				return snapshot
			}
		}
		// COCODE_NUT_API_KEY is a reserved product slot. If another client (for
		// example TUI) left a value there, reconcile it to the current Agency
		// account instead of stopping with a conflict. Other provider routes still
		// fail closed above.
		const oldKey = await this.cloudKey.read()
		const hadExistingCredential = existingCredential?.configured === true && !hasManagedMetadata
		this.stage = "cloud-key"
		const key = await this.ensureCloudKey(state)
		this.stage = "models"
		const models = await this.agency.models(key.secret)
		if (models.length === 0) throw new Error("Cocode Nut returned no available models")
		// Persist a newly minted key before the DSH saga starts. If settings
		// activation fails after the Agency has created the key, the next retry
		// must reuse it instead of minting another device key.
		await this.cloudKey.write(key.secret)
		const cocodeClient = harnessClientIdentity(await guiClientIdentity())
		const oldRoute = route === undefined ? undefined : { ...route }
		try {
			this.stage = "credentials.set"
			await this.dsh.setCredential(CLOUD_CREDENTIAL, key.secret)
			this.stage = "settings.mutate"
			await this.dsh.mutateSettings({
				ns: CLOUD_NAMESPACE,
				expectedRevision: cloudNamespace?.revision,
				ops: [
					{
						op: "set",
						path: CLOUD_PATH,
						value: cloudRouteValue(baseURL, models, cocodeClient),
					},
				],
			})
			this.stage = "cloud-verification"
			const ready = await this.waitForCloudReady(models)
			if (!ready) throw new Error("Cocode Nut provider did not become active")
			const next: IdentityState = {
				...state,
				...(key.id === undefined ? {} : { personalKeyId: key.id }),
				...(key.name === undefined ? {} : { personalKeyName: key.name }),
				managedRoute: { baseURL, apiKeyEnv: CLOUD_CREDENTIAL },
			}
			await this.identity.write(next)
			const profile = next.profile ?? null
			const snapshot: AccountSnapshot = {
				phase: "signed-in",
				profile,
				cloud: { status: "ready", providerId: CLOUD_PROVIDER },
			}
			this.publish(snapshot)
			return snapshot
		} catch (error) {
			await this.rollbackProvision(oldRoute, oldKey, baseURL, hadExistingCredential)
			throw error
		}
	}

	private async rollbackProvision(
		oldRoute: Record<string, unknown> | undefined,
		oldKey: string | undefined,
		baseURL: string,
		preserveExistingCredential = false,
	): Promise<void> {
		try {
			const settings = await this.dsh.describeSettings()
			const namespace = settings.namespaces.find((item) => item.ns === CLOUD_NAMESPACE)
			const currentRoute = routeOf(settings.namespaces)
			const intendedRoute = { baseURL, apiKeyEnv: CLOUD_CREDENTIAL }
			const routeWasWritten = routeIsCurrent(currentRoute, intendedRoute)
			const credentialWasWrittenWithoutRoute =
				currentRoute === undefined && oldRoute === undefined
			if (!routeWasWritten && !credentialWasWrittenWithoutRoute) return
			if (routeWasWritten) {
				try {
					await this.dsh.mutateSettings({
						ns: CLOUD_NAMESPACE,
						expectedRevision: namespace?.revision,
						ops:
							oldRoute === undefined
								? [{ op: "unset", path: CLOUD_PATH }]
								: [{ op: "set", path: CLOUD_PATH, value: oldRoute }],
					})
				} catch {
					// Continue to credential rollback even when the settings revision
					// has changed underneath this saga.
				}
			}
			try {
				if (oldKey === undefined) {
					if (!preserveExistingCredential)
						await this.dsh.unsetCredential(CLOUD_CREDENTIAL)
				} else await this.dsh.setCredential(CLOUD_CREDENTIAL, oldKey)
			} catch {
				// A later hydrate or cleanup-pending pass can retry without touching a
				// route that no longer matches the Cocode-managed shape.
			}
		} catch {
			// A later hydrate or cleanup-pending pass can retry without touching a
			// route that no longer matches the Cocode-managed shape.
		}
	}

	private async isCloudReady(
		models: readonly AgencyModel[],
		providers: readonly ProviderView[],
	): Promise<boolean> {
		const cloud = providers.find((provider) => provider.provider === CLOUD_PROVIDER)
		if (cloud?.active !== true) return false
		const groups = await this.dsh.models()
		const group = groups.find((candidate) => candidate.id === CLOUD_PROVIDER)
		return (
			group !== undefined &&
			models.some((model) => group.models.some((candidate) => candidate.id === model.id))
		)
	}

	private async waitForCloudReady(models: readonly AgencyModel[]): Promise<boolean> {
		for (let attempt = 0; attempt < CLOUD_READY_ATTEMPTS; attempt += 1) {
			if (attempt > 0)
				await new Promise((resolve) => setTimeout(resolve, CLOUD_READY_RETRY_MS))
			if (await this.isCloudReady(models, await this.dsh.providers())) return true
		}
		return false
	}

	private async ensureCloudKey(
		state: IdentityState,
	): Promise<{ readonly secret: string; readonly id?: string; readonly name?: string }> {
		const existing = await this.cloudKey.read()
		if (existing !== undefined && CLOUD_KEY_PATTERN.test(existing)) {
			try {
				if ((await this.agency.models(existing)).length > 0) {
					return {
						secret: existing,
						...(state.personalKeyId === undefined ? {} : { id: state.personalKeyId }),
						...(state.personalKeyName === undefined
							? {}
							: { name: state.personalKeyName }),
					}
				}
			} catch (error) {
				if (
					!(error instanceof AgencyHttpError) ||
					(error.status !== 401 && error.status !== 403)
				)
					throw error
			}
		}
		if (existing !== undefined && !CLOUD_KEY_PATTERN.test(existing)) await this.cloudKey.clear()
		return this.agency.createDesktopKey(state.accessToken)
	}

	/**
	 * Remove the account-managed provider route and credential. The Cocode route
	 * ids and credential references are reserved product slots the Models page
	 * refuses to hand out, so their mere presence proves ownership: cleanup must
	 * not require a recorded route shape to match, or any drift in that shape
	 * (a renamed provider, an upgraded protocol, a lost identity file) would
	 * silently turn removal into a no-op and leave the route behind.
	 */
	private async cleanupCloud(): Promise<void> {
		const settings = await this.dsh.describeSettings()
		const namespace = settings.namespaces.find((item) => item.ns === CLOUD_NAMESPACE)
		const providers = recordOf(valueAt(namespace?.value, ["providers"]))
		const routes = [CLOUD_PATH, LEGACY_CLOUD_PATH].filter(
			(path) => providers?.[path[1]] !== undefined,
		)
		if (routes.length > 0) {
			await this.dsh.mutateSettings({
				ns: CLOUD_NAMESPACE,
				expectedRevision: namespace?.revision,
				ops: routes.map((path) => ({ op: "unset" as const, path: [...path] })),
			})
		}
		const refs = [CLOUD_CREDENTIAL, LEGACY_CLOUD_CREDENTIAL]
		const credentials = await this.dsh.describeCredentials(refs)
		for (const ref of refs) {
			if (credentials[ref]?.configured === true) await this.dsh.unsetCredential(ref)
		}
	}

	/**
	 * Drop the managed configuration, then restore the pre-login default model.
	 * The two steps are deliberately independent and ordered this way: removing
	 * the route and credential IS the meaning of signing out, while restoring a
	 * default model is a preference. Gating the former on the latter is what
	 * used to leave a live Cocode Nut route behind a signed-out account.
	 * @returns the first failure, or undefined once both steps landed.
	 */
	private async cleanupManagedConfig(pending: CleanupPendingState): Promise<unknown> {
		let failure: unknown
		try {
			await this.cleanupCloud()
		} catch (error) {
			failure = error
		}
		try {
			await this.restoreDefaultIfNeeded(pending.previousDefault)
		} catch (error) {
			failure ??= error
		}
		if (failure === undefined) {
			await this.cleanupPending.clear()
			return undefined
		}
		await this.writePendingBestEffort(pending)
		return failure
	}

	private async finishPendingCleanup(pending: CleanupPendingState): Promise<void> {
		const failure = await this.cleanupManagedConfig(pending)
		if (failure !== undefined) throw failure
	}

	/** Whether the runtime still holds the reserved Cocode route or credential. */
	private async hasManagedConfig(): Promise<boolean> {
		const settings = await this.dsh.describeSettings()
		const namespace = settings.namespaces.find((item) => item.ns === CLOUD_NAMESPACE)
		const providers = recordOf(valueAt(namespace?.value, ["providers"]))
		if (
			providers?.[CLOUD_PROVIDER] !== undefined ||
			providers?.[LEGACY_CLOUD_PROVIDER] !== undefined
		)
			return true
		const refs = [CLOUD_CREDENTIAL, LEGACY_CLOUD_CREDENTIAL]
		const credentials = await this.dsh.describeCredentials(refs)
		return refs.some((ref) => credentials[ref]?.configured === true)
	}

	/**
	 * Drop a managed route whose owner vanished without signing out — a moved
	 * userData directory, a deleted identity file, a wiped keychain entry. The
	 * shared identity file is the single source of truth for every Cocode
	 * client, so its absence means nobody is signed in and a surviving route is
	 * an orphan. Left alone it keeps presenting itself as the active provider
	 * and default model underneath a signed-out account, backed by a key no one
	 * can rotate.
	 */
	private async discardOrphanedCloud(): Promise<void> {
		let orphaned = false
		try {
			orphaned = await this.hasManagedConfig()
		} catch (error) {
			// The runtime need not expose its configuration this early. A later
			// hydrate repeats the probe, so a failed look-up stays silent rather
			// than presenting a signed-out account with an error it cannot act on.
			this.logFailure("orphan probe", error)
		}
		if (!orphaned) {
			this.publish(emptySnapshot())
			return
		}
		const failure = await this.cleanupManagedConfig({ pending: true })
		await this.cloudKey.clear()
		if (failure === undefined) {
			this.publish(emptySnapshot())
			return
		}
		this.logFailure("orphan cleanup", failure)
		this.publish({
			phase: "error",
			profile: null,
			cloud: { status: "error", providerId: CLOUD_PROVIDER },
			error: safeError(failure, "cleanup-pending"),
		})
	}

	private async handleInvalidIdentity(
		state: IdentityState,
		options: { readonly clearCloudKey?: boolean } = {},
	): Promise<void> {
		const pending = cleanupStateOf(state)
		this.stage = "cleanup"
		const cleanupError = await this.cleanupManagedConfig(pending)
		await this.clearIdentity()
		if (options.clearCloudKey !== false) await this.cloudKey.clear()
		if (cleanupError === undefined) {
			this.publish(emptySnapshot())
			return
		}
		this.publish({
			phase: "error",
			profile: null,
			cloud: { status: "error", providerId: CLOUD_PROVIDER },
			error: safeError(cleanupError, "cleanup-pending"),
		})
	}

	private async handleBrowserReauthentication(
		state: IdentityState | undefined,
	): Promise<AccountSnapshot> {
		if (state !== undefined) {
			await this.handleInvalidIdentity(state, { clearCloudKey: false })
			if (this.snapshotValue.error?.code === "cleanup-pending") return this.snapshotValue
		}
		try {
			await this.openExternal(browserReauthenticationUrl(this.agency.getOrigin()))
		} catch {
			// The actionable state is still shown in the desktop UI if the browser
			// could not be launched.
		}
		const snapshot: AccountSnapshot = {
			phase: "error",
			profile: null,
			cloud: { status: "error", providerId: CLOUD_PROVIDER },
			error: {
				code: "reauthentication-required",
				message:
					"Cocode requires a recent browser reauthentication. Complete it in the browser, then retry.",
			},
		}
		this.publish(snapshot)
		return snapshot
	}

	private async writePendingBestEffort(pending: CleanupPendingState): Promise<void> {
		try {
			await this.cleanupPending.write(pending)
		} catch {
			// Local identity cleanup remains authoritative even if the non-secret
			// retry marker cannot be persisted.
		}
	}

	/**
	 * Paid Nut login should take over the picker from a local/custom route.
	 * Free and unknown plans keep the pre-login channel. Hydrate must not call
	 * this: restarting a signed-in app must not undo a later manual switch.
	 */
	private async switchToPaidNutFlash(accessToken: string): Promise<void> {
		const usage = await this.agency.accountUsage(accessToken)
		if (!isPaidPlan(usage.plan)) return
		const current = await this.dsh.currentDefault()
		if (isCloudProviderId(current.provider)) return
		const selection = nutFlashSelection(await this.dsh.models())
		if (selection === undefined) return
		const settings = await this.dsh.describeSettings()
		const namespace = settings.namespaces.find((item) => item.ns === DEFAULT_MODEL_NAMESPACE)
		if (namespace !== undefined) {
			await this.dsh.mutateSettings({
				ns: DEFAULT_MODEL_NAMESPACE,
				expectedRevision: namespace.revision,
				ops: selectionSettingsOps(selection),
			})
		}
		await this.selectNutFlashOnOpenSessions(selection)
	}

	private async selectNutFlashOnOpenSessions(selection: DefaultSelection): Promise<void> {
		let sessions: Awaited<ReturnType<AccountDshPort["listSessions"]>>
		try {
			sessions = await this.dsh.listSessions()
		} catch {
			return
		}
		const newest = sessions[0]?.sessionId
		for (const session of sessions) {
			if (!session.blank && !session.running && session.sessionId !== newest) continue
			try {
				await this.dsh.selectModel(session.sessionId, selection)
			} catch {
				// Cold sessions are not attached; selectModel is session-local.
			}
		}
	}

	private async restoreDefaultIfNeeded(previous: DefaultSelection | undefined): Promise<void> {
		const current = await this.dsh.currentDefault()
		if (!isCloudProviderId(current.provider)) return
		const settings = await this.dsh.describeSettings()
		const namespace = settings.namespaces.find((item) => item.ns === DEFAULT_MODEL_NAMESPACE)
		// The Host decides which namespaces the configuration API exposes, and it
		// need not include this one. Restoring a default model is a preference, so
		// an unreachable namespace has to stay a no-op: failing here would abort
		// sign-out and then every later sign-in, which begins by draining the
		// cleanup queued by that failed sign-out.
		if (namespace === undefined) return
		// A pre-login default that itself named the account-managed route (its
		// legacy id included) is not a local selection worth restoring: that route
		// is being removed too. Clear the selection instead and let the runtime
		// fall back to its own default.
		const restorePrevious =
			previous !== undefined &&
			!isCloudProviderId(previous.provider) &&
			modelExists(await this.dsh.models(), previous)
		await this.dsh.mutateSettings({
			ns: DEFAULT_MODEL_NAMESPACE,
			expectedRevision: namespace.revision,
			ops:
				previous !== undefined && restorePrevious
					? selectionSettingsOps(previous)
					: [
							{ op: "unset", path: ["provider"] },
							{ op: "unset", path: ["model"] },
							{ op: "unset", path: ["reasoningEffort"] },
					  ],
		})
	}

	private async ensureAccess(state: IdentityState): Promise<IdentityState> {
		if (Date.now() < state.accessExpiresAt - 30_000) return state
		if (this.refreshTask !== undefined) {
			await this.refreshTask
			return (await this.identity.read()) ?? state
		}
		this.refreshTask = (async () => {
			const refresh = async (): Promise<void> => {
				const current = (await this.identity.read()) ?? state
				if (Date.now() < current.accessExpiresAt - 30_000) return
				this.stage = "identity-refresh"
				const refreshed = await this.agency.refresh(current.refreshToken)
				await this.identity.write({
					...current,
					accessToken: refreshed.access_token,
					refreshToken: refreshed.refresh_token || current.refreshToken,
					accessExpiresAt: Date.now() + refreshed.expires_in * 1000,
				})
			}
			if (this.identity.withLock !== undefined) await this.identity.withLock(refresh)
			else await refresh()
		})().finally(() => {
			this.refreshTask = undefined
		})
		await this.refreshTask
		return (await this.identity.read()) ?? state
	}

	private async requireSignedInState(): Promise<IdentityState> {
		await this.ensureLoaded()
		const state = await this.identity.read()
		if (state === undefined || this.snapshotValue.phase !== "signed-in")
			throw new InvalidIdentityError()
		this.assertIdentityOrigin(state)
		return this.ensureIdentityAccess(state)
	}

	private async ensureIdentityAccess(state: IdentityState): Promise<IdentityState> {
		try {
			return await this.ensureAccess(state)
		} catch (error) {
			if (isSessionFailure(error)) throw new InvalidIdentityError()
			throw error
		}
	}

	private async loadIdentityProfile(accessToken: string): Promise<AccountProfile> {
		try {
			return await this.agency.profile(accessToken)
		} catch (error) {
			if (isSessionFailure(error)) throw new InvalidIdentityError()
			throw error
		}
	}

	private assertIdentityOrigin(state: IdentityState): void {
		if (state.origin !== this.agency.getOrigin())
			throw new Error("Cocode account origin changed; sign in again")
	}

	private async clearIdentity(): Promise<void> {
		await this.identity.clear()
		this.snapshotValue = emptySnapshot()
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return
		await this.identity.read()
		if (process.platform !== "linux") {
			const legacyVault = new SecureVault<string>("cocode-cloud-key.bin")
			const legacyKey = await legacyVault.read()
			if (legacyKey !== undefined && (await this.cloudKey.read()) === undefined) {
				await this.cloudKey.write(legacyKey)
				await legacyVault.clear()
			}
		}
		await this.cloudKey.read()
		this.loaded = !vaultNeedsRetry(this.identity) && !vaultNeedsRetry(this.cloudKey)
	}

	private async migrateLegacyCloudSettings(): Promise<void> {
		const settings = await this.dsh.describeSettings()
		if (!settings.writable) return
		const cloudNamespace = settings.namespaces.find((item) => item.ns === CLOUD_NAMESPACE)
		if (cloudNamespace === undefined) return
		const providers = recordOf(valueAt(cloudNamespace.value, ["providers"]))
		if (providers === undefined || providers[LEGACY_CLOUD_PROVIDER] === undefined) return

		const legacyRoute = recordOf(providers[LEGACY_CLOUD_PROVIDER])
		const ops: {
			readonly op: "set" | "unset"
			readonly path: readonly string[]
			readonly value?: unknown
		}[] = []
		if (providers[CLOUD_PROVIDER] === undefined && legacyRoute !== undefined) {
			ops.push({
				op: "set",
				path: [...CLOUD_PATH],
				value: {
					...legacyRoute,
					displayName: "Cocode Nut",
					apiKeyEnv: CLOUD_CREDENTIAL,
					retryPolicy: { mode: "normal", maxRetries: CLOUD_MAX_RETRIES },
				},
			})
		}
		ops.push({ op: "unset", path: [...LEGACY_CLOUD_PATH] })
		await this.dsh.mutateSettings({
			ns: CLOUD_NAMESPACE,
			expectedRevision: cloudNamespace.revision,
			ops,
		})

		const agentNamespace = settings.namespaces.find(
			(item) => item.ns === DEFAULT_MODEL_NAMESPACE,
		)
		if (agentNamespace === undefined) return
		const agent = recordOf(agentNamespace.value)
		if (agent?.provider !== LEGACY_CLOUD_PROVIDER) return
		await this.dsh.mutateSettings({
			ns: DEFAULT_MODEL_NAMESPACE,
			expectedRevision: agentNamespace.revision,
			ops: [{ op: "set", path: ["provider"], value: CLOUD_PROVIDER }],
		})
	}

	private publish(snapshot: AccountSnapshot): void {
		this.snapshotValue = snapshot
		for (const listener of [...this.listeners]) listener(snapshot)
	}

	private logFailure(operation: string, error: unknown): void {
		const detail = safeError(error, "account-operation-failed")
		console.error("[cocode-account]", operation, {
			stage: this.stage ?? "unknown",
			code: detail.code,
			message: detail.message,
		})
	}
}

function isSessionFailure(error: unknown): boolean {
	return error instanceof AgencyHttpError
		? error.status === 401 || error.status === 403
		: error instanceof Error && /session expired|could not load account/.test(error.message)
}

function isReauthenticationRequired(error: unknown): boolean {
	return (
		error instanceof AgencyHttpError &&
		error.status === 403 &&
		/reauthentication[_\s-]*required|reauthenticate(?:d)?\s+(?:this\s+)?browser\s+session/i.test(
			error.message,
		)
	)
}

function browserReauthenticationUrl(origin: string): string {
	const url = new URL("/login", origin)
	url.searchParams.set("return_to", "/account")
	return url.href
}

function createCloudKeyVault(): Vault<string> {
	return process.platform === "linux"
		? new FileVault<string>(resolveCocodeFile("cocode-nut-key.yaml"))
		: new SecureVault<string>("cocode-nut-key.bin")
}

function vaultNeedsRetry(vault: Pick<Vault<unknown>, "getStatus">): boolean {
	const status = vault.getStatus?.()
	return status?.state === "unavailable" && status.reason !== "corrupt"
}

function safeError(error: unknown, code: string): { code: string; message: string } {
	const message = error instanceof Error ? error.message : String(error)
	return {
		code:
			error instanceof SecureStorageUnavailableError ||
			error instanceof FileStorageUnavailableError ||
			error instanceof AccountLockBusyError
				? error.code
				: code,
		message: message
			.replace(/ck_[A-Za-z0-9_-]+/g, "[redacted]")
			.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
			.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]"),
	}
}
