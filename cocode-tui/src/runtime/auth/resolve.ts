/**
 * Decide whether the TUI can skip AuthGate and how to spawn.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { patchCredential, readCredentials } from './credentials.ts'
import { agencyOrigin } from './origin.ts'
import { readSettings, type ProductSettings } from './settings.ts'
import { harnessClientIdentity, tuiClientIdentity, type CocodeClientIdentity } from './client-identity.ts'
import {
  CLOUD_API,
  CLOUD_DEFAULT_REASONING,
  CLOUD_KEY_REF,
  CLOUD_MAX_RETRIES,
  CLOUD_PROVIDER,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEEPSEEK_KEY_REF,
  type AuthMode,
  type CloudModel,
  type CloudProviderProfile,
  type ResolvedAuth,
} from './types.ts'

export type ResolveInput = {
  /** Shared DSH home containing settings and credentials. */
  dshHome?: string
  /** Shared DSH data home used by the child Host. */
  sharedDshHome?: string
  /** Legacy test/caller alias; new code should pass dshHome. */
  home?: string
  env: NodeJS.ProcessEnv
  cwd?: string
  accountHome?: string
  cloudAccount?: boolean
  cloudModels?: CloudModel[]
}

export type ResolveResult =
  | { status: 'ready'; auth: ResolvedAuth }
  | { status: 'gate'; envLocked: boolean; home: string }

export async function resolveAuth(input: ResolveInput): Promise<ResolveResult> {
  const env = input.env
  const home = input.dshHome ?? input.home
  if (home === undefined) throw new Error('resolveAuth requires dshHome')
  const sharedDshHome = input.sharedDshHome ?? input.dshHome ?? nonempty(env.COCODE_DSH_HOME) ?? join(homedir(), '.dsh')
  const accountHome = input.accountHome ?? nonempty(env.COCODE_HOME) ?? join(homedir(), '.cocode')
  const clientIdentity = await tuiClientIdentity(accountHome, env)
  const cwd = input.cwd?.trim() || process.cwd()
  const origin = agencyOrigin(env)
  const settings = await readSettings(home)
  const credentials = await readCredentials(home)
  const envProvider = nonempty(env.COCODE_PROVIDER)
  const preferred = envProvider ?? settings.provider ?? DEFAULT_PROVIDER

  const preferredReady = tryChannel(preferred, true, {
    env,
    home,
    cwd,
    origin,
    settings,
    credentials,
    cloudAccount: input.cloudAccount ?? false,
    cloudModels: input.cloudModels,
    accountHome,
    sharedDshHome,
    clientIdentity,
  })
  if (preferredReady !== undefined) return preferredReady

  if (preferred === CLOUD_PROVIDER) {
    const byok = tryChannel(DEFAULT_PROVIDER, false, {
      env,
      home,
      cwd,
      origin,
      settings,
      credentials,
      cloudAccount: input.cloudAccount ?? false,
      cloudModels: input.cloudModels,
      accountHome,
      sharedDshHome,
      clientIdentity,
    })
    if (byok !== undefined) return byok
  } else if (preferred === DEFAULT_PROVIDER) {
    const cloud = tryChannel(CLOUD_PROVIDER, false, {
      env,
      home,
      cwd,
      origin,
      settings,
      credentials,
      cloudAccount: input.cloudAccount ?? false,
      cloudModels: input.cloudModels,
      accountHome,
      sharedDshHome,
      clientIdentity,
    })
    if (cloud !== undefined) return cloud
  }

  return { status: 'gate', envLocked: envProvider !== undefined, home }
}

export function channelAvailability(
  credentials: Record<string, string>,
  settings: { hasCloudRoute: boolean },
  env: NodeJS.ProcessEnv = {},
  cloudAccount = false,
): { byok: boolean; cocode: boolean } {
  return {
    byok:
      nonempty(env[DEEPSEEK_KEY_REF]) !== undefined ||
      nonempty(credentials[DEEPSEEK_KEY_REF]) !== undefined,
    cocode:
      (nonempty(env[CLOUD_KEY_REF]) !== undefined ||
        nonempty(credentials[CLOUD_KEY_REF]) !== undefined) &&
      cloudAccount,
  }
}

export function apiKeyEnvFor(provider: string, configured?: string): string | undefined {
  if (configured !== undefined && configured.trim() !== '') {
    return configured.trim()
  }
  if (provider === CLOUD_PROVIDER) return CLOUD_KEY_REF
  if (provider === DEFAULT_PROVIDER) return DEEPSEEK_KEY_REF
  return undefined
}

export async function saveByokKey(home: string, key: string): Promise<void> {
  await patchCredential(home, DEEPSEEK_KEY_REF, key)
}

type ChannelInput = {
  env: NodeJS.ProcessEnv
  home: string
  cwd: string
  origin: string
  settings: ProductSettings
  credentials: Record<string, string>
  cloudAccount: boolean
  cloudModels?: CloudModel[]
  accountHome?: string
  sharedDshHome: string
  clientIdentity: CocodeClientIdentity
}

function tryChannel(
  provider: string,
  isPreferred: boolean,
  input: ChannelInput,
): { status: 'ready'; auth: ResolvedAuth } | undefined {
  const { env, home, cwd, origin, settings, credentials, cloudAccount, cloudModels, accountHome, sharedDshHome, clientIdentity } = input
  const providerSettings = settings.providerCredentials[provider]
  const ref = apiKeyEnvFor(provider, providerSettings?.apiKeyEnv)
  const value = ref === undefined ? undefined : nonempty(env[ref]) ?? nonempty(credentials[ref])
  const model = channelModel(provider, isPreferred, env, settings, cloudModels)
  const mode: AuthMode = provider === CLOUD_PROVIDER ? 'cocode' : 'byok'

  if (provider === CLOUD_PROVIDER && !cloudAccount) {
    return undefined
  }
  if (value !== undefined && ref !== undefined) {
    const cloudProvider =
      provider === CLOUD_PROVIDER && cloudAccount
        ? createCloudProvider(origin, model, clientIdentity, cloudModels)
        : undefined
    // Harness credentials-local resolves file-backed refs from $DSH_HOME;
    // only preserve an explicitly inherited env value in the launch env.
    const launchCredential = nonempty(env[ref]) === undefined ? {} : { [ref]: value }
    return ready(
      mode,
      provider,
      model,
      cwd,
      origin,
      accountHome ?? home,
      home,
      sharedDshHome,
      env,
      launchCredential,
      cloudProvider,
    )
  }
  if (providerSettings?.writable === false) {
    return ready(
      mode,
      provider,
      model,
      cwd,
      origin,
      accountHome ?? home,
      home,
      sharedDshHome,
      env,
      {},
    )
  }
  return undefined
}

function channelModel(
  provider: string,
  isPreferred: boolean,
  env: NodeJS.ProcessEnv,
  settings: ProductSettings,
  cloudModels?: CloudModel[],
): string {
  if (isPreferred) {
    return nonempty(env.COCODE_MODEL) ?? settings.model ?? DEFAULT_MODEL
  }
  if (provider === CLOUD_PROVIDER) {
    return cloudModels?.[0]?.id ?? settings.cloudModel ?? DEFAULT_MODEL
  }
  return DEFAULT_MODEL
}

function ready(
  mode: AuthMode,
  provider: string,
  model: string,
  cwd: string,
  origin: string,
  accountHome: string,
  dshHome: string,
  sharedDshHome: string,
  env: NodeJS.ProcessEnv,
  extra: NodeJS.ProcessEnv,
  cloudProvider?: CloudProviderProfile,
): { status: 'ready'; auth: ResolvedAuth } {
  const spawn: NodeJS.ProcessEnv = { ...env }
  delete spawn[CLOUD_KEY_REF]
  delete spawn[DEEPSEEK_KEY_REF]
  delete spawn.COCODE_LLM_PROVIDERS
  Object.assign(spawn, extra)
  spawn.COCODE_HOME = accountHome
  spawn.COCODE_DSH_HOME = sharedDshHome
  spawn.DSH_HOME = sharedDshHome
  spawn.DSH_SESSION_ROOT = join(sharedDshHome, 'sessions')
  spawn.DSH_PROFILE = 'cocode'
  spawn.COCODE_PROVIDER = provider
  spawn.COCODE_MODEL = model
  if (cloudProvider !== undefined) {
    spawn.COCODE_LLM_PROVIDERS = JSON.stringify({ [CLOUD_PROVIDER]: cloudProvider })
  }
  return {
    status: 'ready',
    auth: {
      mode,
      provider,
      model,
      cwd,
      origin,
      accountHome,
      dshHome,
      ...(cloudProvider === undefined ? {} : { cloudProvider }),
      env: spawn,
    },
  }
}

function createCloudProvider(
  origin: string,
  model: string,
  clientIdentity: CocodeClientIdentity,
  cloudModels?: CloudModel[],
): CloudProviderProfile {
  return {
    displayName: 'Cocode Nut',
    api: CLOUD_API,
    baseURL: `${origin.replace(/\/$/, '')}/v1`,
    apiKeyEnv: CLOUD_KEY_REF,
    reasoning: CLOUD_DEFAULT_REASONING,
    retryPolicy: { mode: 'normal', maxRetries: CLOUD_MAX_RETRIES },
    cocodeClient: harnessClientIdentity(clientIdentity),
    models: cloudModels?.length === 0 || cloudModels === undefined
      ? [{ id: model, name: model }]
      : cloudModels.map((entry) => ({ ...entry })),
  }
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}
