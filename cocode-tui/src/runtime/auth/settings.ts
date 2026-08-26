/**
 * Read/patch the shared DSH settings document (LLM routes + default model).
 */

import {
  CLOUD_API,
  CLOUD_KEY_REF,
  CLOUD_MAX_RETRIES,
  CLOUD_PROVIDER,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  LEGACY_CLOUD_PROVIDER,
  type CloudModel,
} from './types.ts'
import { settingsPath } from './paths.ts'
import { readYamlUnknown, writeYamlFile } from './io.ts'
import { TuiError } from '../errors/index.ts'

export type ProductSettings = {
  provider: string
  model: string
  hasCloudRoute: boolean
  cloudModel?: string
  providerCredentials: Record<string, { apiKeyEnv?: string; writable?: boolean }>
}

export type CloudSettingsBackup = {
  hadRoute: boolean
  route?: unknown
  hadAgent: boolean
  agent?: unknown
}

export async function captureCloudSettings(home: string): Promise<CloudSettingsBackup> {
  const root = await loadRoot(home)
  const llm = isRecord(root['llm-pi-ai']) ? root['llm-pi-ai'] : {}
  const providers = isRecord(llm.providers) ? llm.providers : {}
  return {
    hadRoute: Object.prototype.hasOwnProperty.call(providers, CLOUD_PROVIDER),
    route: providers[CLOUD_PROVIDER],
    hadAgent: Object.prototype.hasOwnProperty.call(root, 'agent-default-model'),
    agent: root['agent-default-model'],
  }
}

export async function restoreCloudSettings(
  home: string,
  backup: CloudSettingsBackup,
): Promise<void> {
  const root = await loadRoot(home)
  const llm = isRecord(root['llm-pi-ai']) ? root['llm-pi-ai'] : {}
  const providers = isRecord(llm.providers) ? llm.providers : {}
  if (backup.hadRoute) providers[CLOUD_PROVIDER] = backup.route
  else delete providers[CLOUD_PROVIDER]
  llm.providers = providers
  root['llm-pi-ai'] = llm
  if (backup.hadAgent) root['agent-default-model'] = backup.agent
  else delete root['agent-default-model']
  await writeYamlFile(settingsPath(home), root, 0o600)
}

export async function readSettings(home: string): Promise<ProductSettings> {
  const loaded = await readYamlUnknown(settingsPath(home))
  if (loaded.missing || !isRecord(loaded.value)) {
    return {
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      hasCloudRoute: false,
      providerCredentials: {},
    }
  }
  const agent = isRecord(loaded.value['agent-default-model'])
    ? loaded.value['agent-default-model']
    : {}
  const llm = isRecord(loaded.value['llm-pi-ai']) ? loaded.value['llm-pi-ai'] : {}
  const providers = isRecord(llm.providers) ? llm.providers : {}
  const providerCredentials: ProductSettings['providerCredentials'] = {}
  for (const [provider, value] of Object.entries(providers)) {
    if (!isRecord(value)) continue
    const apiKeyEnv =
      typeof value.apiKeyEnv === 'string' && value.apiKeyEnv !== '' ? value.apiKeyEnv : undefined
    if (apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
      throw new TuiError('CONFIG_PROVIDER_REF', { provider })
    }
    const writable = typeof value.writable === 'boolean' ? value.writable : undefined
    providerCredentials[provider] = {
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
      ...(writable === undefined ? {} : { writable }),
    }
  }
  const cloudRoute = providers[CLOUD_PROVIDER] ?? providers[LEGACY_CLOUD_PROVIDER]
  const cloudModels =
    isRecord(cloudRoute) && Array.isArray(cloudRoute.models) ? cloudRoute.models : []
  const firstCloud = isRecord(cloudModels[0]) ? cloudModels[0] : undefined
  const cloudModel =
    typeof firstCloud?.id === 'string' && firstCloud.id !== '' ? firstCloud.id : undefined
  return {
    provider:
      typeof agent.provider === 'string' && agent.provider !== ''
        ? agent.provider
        : DEFAULT_PROVIDER,
    model: typeof agent.model === 'string' && agent.model !== '' ? agent.model : DEFAULT_MODEL,
    hasCloudRoute: isRecord(providers[CLOUD_PROVIDER]) || isRecord(providers[LEGACY_CLOUD_PROVIDER]),
    ...(cloudModel === undefined ? {} : { cloudModel }),
    providerCredentials,
  }
}

export async function patchCloudRoute(
  home: string,
  origin: string,
  models: CloudModel[],
): Promise<void> {
  await writeCloudRoute(home, origin, models, true)
}

export async function syncCloudRoute(
  home: string,
  origin: string,
  models: CloudModel[],
): Promise<void> {
  await writeCloudRoute(home, origin, models, false)
}

async function writeCloudRoute(
  home: string,
  origin: string,
  models: CloudModel[],
  select: boolean,
): Promise<void> {
  const root = await loadRoot(home)
  const llm = isRecord(root['llm-pi-ai']) ? root['llm-pi-ai'] : {}
  const providers = isRecord(llm.providers) ? llm.providers : {}
  providers[CLOUD_PROVIDER] = {
    displayName: 'Cocode Nut',
    api: CLOUD_API,
    baseURL: `${origin.replace(/\/$/, '')}/v1`,
    apiKeyEnv: CLOUD_KEY_REF,
    retryPolicy: { mode: 'normal', maxRetries: CLOUD_MAX_RETRIES },
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
      ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts }),
    })),
  }
  llm.providers = providers
  root['llm-pi-ai'] = llm
  if (select) {
    const agent = isRecord(root['agent-default-model']) ? root['agent-default-model'] : {}
    agent.provider = CLOUD_PROVIDER
    if (models[0] !== undefined) agent.model = models[0].id
    root['agent-default-model'] = agent
  }
  await writeYamlFile(settingsPath(home), root, 0o600)
}

export async function patchAgentDefaultModel(
  home: string,
  provider: string,
  model: string,
): Promise<void> {
  const root = await loadRoot(home)
  const agent = isRecord(root['agent-default-model']) ? root['agent-default-model'] : {}
  agent.provider = provider
  agent.model = model
  root['agent-default-model'] = agent
  await writeYamlFile(settingsPath(home), root, 0o600)
}

export async function unsetCloudRoute(home: string): Promise<void> {
  const root = await loadRoot(home)
  const llm = isRecord(root['llm-pi-ai']) ? root['llm-pi-ai'] : {}
  const providers = isRecord(llm.providers) ? llm.providers : {}
  delete providers[CLOUD_PROVIDER]
  llm.providers = providers
  root['llm-pi-ai'] = llm
  const agent = isRecord(root['agent-default-model']) ? root['agent-default-model'] : {}
  if (agent.provider === CLOUD_PROVIDER) {
    agent.provider = DEFAULT_PROVIDER
    agent.model = DEFAULT_MODEL
    root['agent-default-model'] = agent
  }
  await writeYamlFile(settingsPath(home), root, 0o600)
}

async function loadRoot(home: string): Promise<Record<string, unknown>> {
  const loaded = await readYamlUnknown(settingsPath(home))
  if (loaded.missing) return {}
  if (!isRecord(loaded.value)) {
    throw new TuiError('AUTH_SETTINGS_PARSE')
  }
  const migrated = migrateLegacyCloudRoot(loaded.value)
  if (migrated !== loaded.value) {
    await writeYamlFile(settingsPath(home), migrated, 0o600)
  }
  return migrated
}

function migrateLegacyCloudRoot(root: Record<string, unknown>): Record<string, unknown> {
  const llm = isRecord(root['llm-pi-ai']) ? root['llm-pi-ai'] : undefined
  if (llm === undefined) return root
  const providers = isRecord(llm.providers) ? llm.providers : undefined
  if (providers === undefined || !Object.prototype.hasOwnProperty.call(providers, LEGACY_CLOUD_PROVIDER)) {
    return root
  }
  const next: Record<string, unknown> = { ...root }
  const nextLlm: Record<string, unknown> = { ...llm }
  const nextProviders: Record<string, unknown> = { ...providers }
  const legacyRoute = nextProviders[LEGACY_CLOUD_PROVIDER]
  if (!Object.prototype.hasOwnProperty.call(nextProviders, CLOUD_PROVIDER) && legacyRoute !== undefined) {
    nextProviders[CLOUD_PROVIDER] = {
      ...(isRecord(legacyRoute) ? legacyRoute : {}),
      displayName: 'Cocode Nut',
      apiKeyEnv: CLOUD_KEY_REF,
      retryPolicy: { mode: 'normal', maxRetries: CLOUD_MAX_RETRIES },
    }
  }
  delete nextProviders[LEGACY_CLOUD_PROVIDER]
  nextLlm.providers = nextProviders
  next['llm-pi-ai'] = nextLlm
  const agent = isRecord(root['agent-default-model']) ? root['agent-default-model'] : undefined
  if (agent?.provider === LEGACY_CLOUD_PROVIDER) {
    next['agent-default-model'] = { ...agent, provider: CLOUD_PROVIDER }
  }
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
