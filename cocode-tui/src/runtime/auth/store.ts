/**
 * AuthGate state machine. Tokens never appear on the snapshot.
 */

import { deleteAccount, readAccount, writeAccount } from './account.ts'
import { join } from 'node:path'
import { withAccountLock } from './account-lock.ts'
import { patchCredential, readCredentialsRecovering } from './credentials.ts'
import {
  listHostedModels,
  loadProfile,
  mintPersonalKey,
  pollDeviceToken,
  probeHostedModels,
  refreshAccess,
  revokePersonalKey,
  revokeToken,
  startDeviceAuthorization,
  type AgencyClient,
} from './device-flow.ts'
import { openExternal } from './open-url.ts'
import {
  defaultLiveContext,
  HomeBusyError,
  otherLiveCount,
  type LiveInstanceContext,
} from './live-instances.ts'
import { displayError, formatError, TuiError } from '../errors/index.ts'
import { agencyOrigin } from './origin.ts'
import { accountHome as defaultAccountHome, defaultHomeContext, dshHome as defaultDshHome, sharedDshHome as defaultSharedDshHome } from './paths.ts'
import { apiKeyEnvFor, channelAvailability, resolveAuth, saveByokKey } from './resolve.ts'
import { tuiClientIdentity } from './client-identity.ts'
import {
  captureCloudSettings,
  patchCloudRoute,
  patchAgentDefaultModel,
  restoreCloudSettings,
  syncCloudRoute,
  unsetCloudRoute,
  readSettings,
} from './settings.ts'
import {
  CLOUD_KEY_REF,
  CLOUD_PROVIDER,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEEPSEEK_KEY_REF,
  KEY_NAME,
  type AccountRecord,
  type AuthAction,
  type AuthMode,
  type AuthSnapshot,
  type CloudModel,
  type MeProfile,
  type ResolvedAuth,
} from './types.ts'

export type SelectModeResult =
  | { status: 'ready' }
  | { status: 'need-byok' }
  | { status: 'need-login' }
  | { status: 'env-locked' }
  | { status: 'home-busy' }

export type AuthStore = {
  snapshot(): AuthSnapshot
  subscribe(listener: () => void): () => void
  dispatch(action: AuthAction): void
  resolved(): ResolvedAuth
  waitUntilReady(): Promise<ResolvedAuth>
  selectMode(mode: AuthMode): Promise<SelectModeResult>
  logout(): Promise<void>
}

export type AuthStoreOptions = {
  /** Legacy alias used by isolated tests; applies to both homes. */
  home?: string
  accountHome?: string
  dshHome?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
  client?: AgencyClient
  openUrl?: (url: string, onFailure?: () => void) => void
  live?: LiveInstanceContext
}

export async function createAuthStore(options: AuthStoreOptions = {}): Promise<AuthStore> {
  const env = options.env ?? process.env
  const context = defaultHomeContext(env)
  const accountHome = options.accountHome ?? options.home ?? defaultAccountHome(context)
  const dshHome = options.dshHome ?? options.home ?? defaultDshHome(context)
  const sharedDshHome = defaultSharedDshHome(context)
  const store = new AuthStoreImpl(
    accountHome,
    dshHome,
    sharedDshHome,
    env,
    options.cwd,
    options.client,
    options.openUrl,
    options.live ?? defaultLiveContext,
  )
  await store.hydrate()
  return store
}

class AuthStoreImpl implements AuthStore {
  private snap: AuthSnapshot = {
    phase: 'gate',
    envLocked: false,
  }
  private auth: ResolvedAuth | undefined
  private readonly listeners = new Set<() => void>()
  private poll: AbortController | undefined
  private operationId = 0
  private refreshInFlight: Promise<void> | undefined
  private readyWaiters: Array<(auth: ResolvedAuth) => void> = []
  private profile: MeProfile | undefined
  private cloudModels: CloudModel[] | undefined

  constructor(
    private readonly accountHome: string,
    private readonly dshHome: string,
    private readonly sharedDshHome: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly cwd: string | undefined,
    private readonly client: AgencyClient | undefined,
    private readonly openUrl: ((url: string, onFailure?: () => void) => void) | undefined,
    private readonly live: LiveInstanceContext,
  ) {}

  private async homeIsBusy(): Promise<boolean> {
    // Live-instance markers belong to Cocode's account/runtime home. The DSH
    // home is shared with the official product and must not become a Cocode
    // process-lock directory.
    return (await otherLiveCount(join(this.accountHome, 'runtime'), this.live)) > 0
  }

  async hydrate(signal?: AbortSignal): Promise<void> {
    try {
      await this.refreshCloudAccount(signal)
      if (signal?.aborted) return
      const account = await readAccount(this.accountHome)
      const credentials = await readCredentialsRecovering(this.dshHome)
      const cloudKey = nonempty(credentials[CLOUD_KEY_REF])
      if (
        account !== undefined &&
        this.cloudModels === undefined &&
        cloudKey !== undefined
      ) {
        try {
          this.cloudModels = await listHostedModels(
            account.origin,
            cloudKey,
            this.client,
            signal,
          )
        } catch {
          this.cloudModels = []
        }
      }
      if (signal?.aborted) return
      const settings = await readSettings(this.dshHome)
      if (account !== undefined && cloudKey !== undefined) {
        const models = this.cloudModels?.length
          ? this.cloudModels
          : [fallbackCloudModel(settings)]
        await syncCloudRoute(this.dshHome, account.origin, models)
      }
      const resolved = await resolveAuth({
        dshHome: this.dshHome,
        sharedDshHome: this.sharedDshHome,
        accountHome: this.accountHome,
        env: this.env,
        cwd: this.cwd,
        cloudAccount: account !== undefined,
        cloudModels: this.cloudModels,
      })
      if (signal?.aborted) return
      if (resolved.status === 'ready') {
        this.auth = resolved.auth
        const currentCredentials = await readCredentialsRecovering(this.dshHome)
        const currentSettings = await readSettings(this.dshHome)
        this.snap = {
          phase: 'ready',
          mode: resolved.auth.mode,
          envLocked: this.envLocked(resolved.auth.mode),
          channels: channelAvailability(
            currentCredentials,
            currentSettings,
            this.env,
            account !== undefined,
          ),
          ...(this.profile === undefined ? {} : { profile: this.profile }),
        }
        this.flushReady()
        return
      }
      this.auth = undefined
      this.snap = { phase: 'gate', envLocked: resolved.envLocked }
    } catch (error) {
      if (signal?.aborted) return
      this.auth = undefined
      this.snap = {
        phase: 'failed',
        envLocked: false,
        error: displayError(error),
      }
    }
  }

  snapshot(): AuthSnapshot {
    return this.snap
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispatch(action: AuthAction): void {
    if (action.type === 'chooseByok') {
      this.beginOperation()
      this.snap = { phase: 'byok', envLocked: false }
      this.emit()
      return
    }
    if (action.type === 'submitByok') {
      void this.submitByok(action.key, this.beginOperation())
      return
    }
    if (action.type === 'chooseCocode') {
      void this.signInDevice(this.beginOperation())
      return
    }
    if (action.type === 'cancel') {
      this.beginOperation()
      this.poll = undefined
      this.snap = { phase: 'gate', envLocked: false }
      this.emit()
      return
    }
    if (action.type === 'logout') {
      void this.logout()
    }
  }

  resolved(): ResolvedAuth {
    if (this.auth === undefined) throw new TuiError('AUTH_NOT_READY')
    return this.auth
  }

  waitUntilReady(): Promise<ResolvedAuth> {
    if (this.auth !== undefined) return Promise.resolve(this.auth)
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve)
    })
  }

  async selectMode(mode: AuthMode): Promise<SelectModeResult> {
    if (nonempty(this.env.COCODE_PROVIDER) !== undefined) {
      return { status: 'env-locked' }
    }
    if (await this.homeIsBusy()) return { status: 'home-busy' }
    const settings = await readSettings(this.dshHome)
    const credentials = await readCredentialsRecovering(this.dshHome)
    if (mode === 'byok') {
      const has =
        nonempty(this.env[DEEPSEEK_KEY_REF]) !== undefined ||
        nonempty(credentials[DEEPSEEK_KEY_REF]) !== undefined
      if (!has) return { status: 'need-byok' }
      await patchAgentDefaultModel(this.dshHome, DEFAULT_PROVIDER, DEFAULT_MODEL)
    } else {
      const account = await readAccount(this.accountHome)
      const has =
        (nonempty(this.env[CLOUD_KEY_REF]) !== undefined ||
          nonempty(credentials[CLOUD_KEY_REF]) !== undefined) &&
        account !== undefined
      if (!has) return { status: 'need-login' }
      const model = this.cloudModels?.[0]?.id ?? settings.cloudModel ?? DEFAULT_MODEL
      await patchAgentDefaultModel(this.dshHome, CLOUD_PROVIDER, model)
    }
    await this.hydrate()
    return { status: 'ready' }
  }

  async logout(): Promise<void> {
    if (await this.homeIsBusy()) throw new HomeBusyError()
    const operation = this.beginOperation()
    const firstError = await withAccountLock(this.accountHome, () => this.performLogout(operation))
    this.profile = undefined
    this.cloudModels = undefined
    await this.hydrate()
    this.emit()
    if (firstError !== undefined) throw firstError
  }

  private async performLogout(operation: Operation): Promise<unknown> {
    let firstError: unknown
    let account: AccountRecord | undefined
    try {
      account = await readAccount(this.accountHome)
    } catch (error) {
      firstError = error
    }
    if (account !== undefined) {
      // 先撤设备密钥再撤 token 家族：家族一旦失效，access token 也无法再调撤销接口。
      const current = await this.accessForRevocation(account, operation.signal)
      if (current.personalKeyId !== undefined) {
        await revokePersonalKey(
          current.origin,
          current.accessToken,
          current.personalKeyId,
          this.client,
          operation.signal,
        )
      }
      await revokeToken(current.origin, current.refreshToken, this.client, operation.signal)
    }
    for (const cleanup of [
      () => deleteAccount(this.accountHome),
      () => patchCredential(this.dshHome, CLOUD_KEY_REF, undefined),
      () => unsetCloudRoute(this.dshHome),
    ]) {
      try {
        await cleanup()
      } catch (error) {
        firstError ??= error
      }
    }
    return firstError
  }

  /**
   * 登出时 access token 通常已过期，先换一张才撤得掉设备密钥。
   * 刷新失败不阻断登出，沿用旧凭据尽力而为。
   */
  private async accessForRevocation(
    account: AccountRecord,
    signal: AbortSignal,
  ): Promise<AccountRecord> {
    if (account.accessExpiresAt > Date.now() + 30_000) return account
    try {
      const refreshed = await refreshAccess(
        account.origin,
        account.refreshToken,
        this.client,
        signal,
      )
      return {
        ...account,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        accessExpiresAt: Date.now() + refreshed.expires_in * 1000,
      }
    } catch {
      return account
    }
  }

  private envLocked(mode: 'byok' | 'cocode'): boolean {
    const ref = mode === 'cocode' ? CLOUD_KEY_REF : apiKeyEnvFor(this.auth?.provider ?? '')
    if (ref === undefined) return false
    const value = this.env[ref]?.trim()
    return value !== undefined && value !== ''
  }

  private async submitByok(key: string, operation: Operation): Promise<void> {
    const trimmed = key.trim()
    if (trimmed === '') {
      this.snap = {
        phase: 'byok',
        envLocked: false,
        error: formatError('AUTH_BYOK_EMPTY'),
      }
      this.emit()
      return
    }
    this.snap = { phase: 'busy', envLocked: false }
    this.emit()
    let previousKey: string | undefined
    let didWrite = false
    try {
      this.ensureCurrent(operation)
      previousKey = (await readCredentialsRecovering(this.dshHome)).DEEPSEEK_API_KEY
      this.ensureCurrent(operation)
      await saveByokKey(this.dshHome, trimmed)
      didWrite = true
      this.ensureCurrent(operation)
      await this.hydrate(operation.signal)
      this.ensureCurrent(operation)
      this.emit()
    } catch (error) {
      if (this.isCancelled(error, operation)) {
        if (didWrite) {
          await patchCredential(this.dshHome, 'DEEPSEEK_API_KEY', previousKey).catch(() => undefined)
        }
        return
      }
      this.snap = {
        phase: 'failed',
        envLocked: false,
        error: displayError(error),
      }
      this.emit()
    }
  }

  private async signInDevice(operation: Operation): Promise<void> {
    const busy = await this.homeIsBusy()
    if (operation.id !== this.operationId || operation.signal.aborted) return
    if (busy) {
      this.snap = {
        phase: 'failed',
        envLocked: false,
        error: formatError('AUTH_HOME_BUSY'),
      }
      this.emit()
      return
    }
    const poll = operation.controller
    this.poll = poll
    this.snap = { phase: 'busy', envLocked: false }
    this.emit()
    try {
      const origin = agencyOrigin(this.env)
      const clientIdentity = await tuiClientIdentity(this.accountHome, this.env)
      const authorization = await startDeviceAuthorization(origin, this.client, poll.signal, clientIdentity)
      this.ensureCurrent(operation)
      this.snap = {
        phase: 'device',
        envLocked: false,
        device: {
          userCode: authorization.user_code,
          verificationUri: authorization.verification_uri,
          verificationUriComplete: authorization.verification_uri_complete,
          expiresIn: authorization.expires_in,
        },
      }
      this.emit()
      const onOpenFailure = (): void => {
        if (this.snap.phase !== 'device') return
        this.snap = {
          ...this.snap,
          error: formatError('AUTH_BROWSER_OPEN_FAILED'),
        }
        this.emit()
      }
      ;(this.openUrl ?? openExternal)(authorization.verification_uri_complete, onOpenFailure)
      const token = await pollDeviceToken(
        origin,
        authorization.device_code,
        authorization.interval,
        authorization.expires_in,
        poll.signal,
        this.client,
      )
      this.ensureCurrent(operation)
      // 浏览器批准之后剩下的步骤（拉账号、领 Key、写本地凭证）全自动，
      // 但要离开 device 画面，否则用户会一直看着「等待确认」。
      this.snap = { phase: 'busy', envLocked: false }
      this.emit()
      let account: AccountRecord = {
        origin,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        accessExpiresAt: Date.now() + token.expires_in * 1000,
      }
      const profile = await loadProfile(origin, account.accessToken, this.client, poll.signal)
      this.ensureCurrent(operation)
      await withAccountLock(this.accountHome, async () => {
        const existing = await readAccount(this.accountHome)
        const credentials = await readCredentialsRecovering(this.dshHome)
        const stored = credentials[CLOUD_KEY_REF]?.trim()
        const reusable =
          existing !== undefined &&
          existing.origin === origin &&
          stored !== undefined &&
          stored !== ''
        // 本地密钥会过期，也可能已在 Web 端撤销，验证通过才复用。
        let secret = stored
        let models = reusable
          ? await probeHostedModels(origin, stored, this.client, poll.signal)
          : undefined
        this.ensureCurrent(operation)
        if (reusable && models !== undefined) {
          account = {
            ...account,
            personalKeyId: existing.personalKeyId,
            personalKeyName: existing.personalKeyName ?? KEY_NAME,
          }
        } else {
          const minted = await mintPersonalKey(origin, account.accessToken, this.client, poll.signal, clientIdentity)
          this.ensureCurrent(operation)
          secret = minted.secret
          account = {
            ...account,
            personalKeyId: minted.id,
            personalKeyName: KEY_NAME,
          }
          models = await listHostedModels(origin, minted.secret, this.client, poll.signal)
          this.ensureCurrent(operation)
        }
        if (models.length === 0) throw new TuiError('AUTH_NO_HOSTED_MODELS')
        this.cloudModels = models
        const settingsBackup = await captureCloudSettings(this.dshHome)
        const previousCloudKey = credentials[CLOUD_KEY_REF]
        try {
          this.ensureCurrent(operation)
          if (secret !== stored) await patchCredential(this.dshHome, CLOUD_KEY_REF, secret)
          this.ensureCurrent(operation)
          await patchCloudRoute(this.dshHome, origin, models)
          this.ensureCurrent(operation)
          await writeAccount(this.accountHome, account)
        } catch (error) {
          this.cloudModels = undefined
          await this.restoreLoginState(existing, previousCloudKey, settingsBackup)
          throw error
        }
      })
      this.ensureCurrent(operation)
      this.profile = profile
      await this.hydrate(operation.signal)
      this.ensureCurrent(operation)
      if (this.snap.phase === 'ready') {
        this.snap = { ...this.snap, profile: this.profile }
      }
      this.emit()
    } catch (error) {
      if (this.isCancelled(error, operation)) {
        return
      }
      if (poll.signal.aborted) {
        this.snap = { phase: 'gate', envLocked: false }
        this.emit()
        return
      }
      this.snap = {
        phase: 'failed',
        envLocked: false,
        error: displayError(error),
      }
      this.emit()
    }
  }

  private flushReady(): void {
    if (this.auth === undefined) return
    const waiters = this.readyWaiters
    this.readyWaiters = []
    for (const waiter of waiters) waiter(this.auth)
  }

  private beginOperation(): Operation {
    this.poll?.abort()
    const controller = new AbortController()
    this.poll = controller
    this.operationId += 1
    return { id: this.operationId, controller, signal: controller.signal }
  }

  private ensureCurrent(operation: Operation): void {
    if (operation.id !== this.operationId || operation.signal.aborted) {
      throw new AuthCancelledError()
    }
  }

  private isCancelled(error: unknown, operation: Operation): boolean {
    return (
      error instanceof AuthCancelledError ||
      operation.id !== this.operationId ||
      operation.signal.aborted
    )
  }

  private async restoreLoginState(
    account: AccountRecord | undefined,
    cloudKey: string | undefined,
    settingsBackup: Awaited<ReturnType<typeof captureCloudSettings>>,
  ): Promise<void> {
    await Promise.allSettled([
      account === undefined ? deleteAccount(this.accountHome) : writeAccount(this.accountHome, account),
      cloudKey === undefined
        ? patchCredential(this.dshHome, CLOUD_KEY_REF, undefined)
        : patchCredential(this.dshHome, CLOUD_KEY_REF, cloudKey),
      restoreCloudSettings(this.dshHome, settingsBackup),
    ])
  }

  private async refreshCloudAccount(signal?: AbortSignal): Promise<void> {
    if (this.refreshInFlight !== undefined) {
      await this.refreshInFlight
      return
    }
    const refresh = this.doRefreshCloudAccount(signal)
    this.refreshInFlight = refresh
    try {
      await refresh
    } finally {
      if (this.refreshInFlight === refresh) this.refreshInFlight = undefined
    }
  }

  private async doRefreshCloudAccount(signal?: AbortSignal): Promise<void> {
    const account = await readAccount(this.accountHome)
    if (account === undefined || account.accessExpiresAt > Date.now() + 30_000) return
    const credentials = await readCredentialsRecovering(this.dshHome)
    if (nonempty(credentials[CLOUD_KEY_REF]) === undefined) return
    try {
      const refreshed = await refreshAccess(
        account.origin,
        account.refreshToken,
        this.client,
        signal,
      )
      if (signal?.aborted) return
      await writeAccount(this.accountHome, {
        ...account,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        accessExpiresAt: Date.now() + refreshed.expires_in * 1000,
      })
    } catch (error) {
      if (signal?.aborted) return
      await this.clearCloudState()
      if (error instanceof AuthCancelledError) throw error
    }
  }

  private async clearCloudState(): Promise<void> {
    this.cloudModels = undefined
    const errors: unknown[] = []
    for (const cleanup of [
      () => deleteAccount(this.accountHome),
      () => patchCredential(this.dshHome, CLOUD_KEY_REF, undefined),
      () => unsetCloudRoute(this.dshHome),
    ]) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors[0] !== undefined) throw errors[0]
  }

  private emit(): void {
    if (this.snap.phase === 'ready') this.flushReady()
    for (const listener of this.listeners) listener()
  }
}

type Operation = {
  id: number
  controller: AbortController
  signal: AbortSignal
}

class AuthCancelledError extends Error {
  constructor() {
    super('login cancelled')
    this.name = 'AuthCancelledError'
  }
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function fallbackCloudModel(settings: Awaited<ReturnType<typeof readSettings>>): CloudModel {
  const id = settings.cloudModel ??
    (settings.provider === CLOUD_PROVIDER ? settings.model : DEFAULT_MODEL)
  return { id, name: id }
}
