import type {
  ClientRemote,
  CredentialInfo,
  LlmConfigurableProvider,
  LlmDiscoveredModel,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsPathOpView as WireSettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

export type SettingsPathOpView = {
  op: 'set'
  path: string[]
  value: unknown
} | {
  op: 'unset'
  path: string[]
}

export type CredentialView = CredentialInfo
export type DiscoveredModelView = LlmDiscoveredModel

export interface ConfigurableProviderView {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  active: boolean
  declared?: boolean
}

export type ApiFailure = { code: string; message: string }
export type ApiResponse<T> = {
  result: { ok: true; value: T } | { ok: false; error: ApiFailure }
}

export interface ModelsApi {
  settings: {
    mutate(request: { ns: string; ops: SettingsPathOpView[]; expectedRevision?: number }): Promise<ApiResponse<SettingsNamespaceView>>
  }
  credentials: {
    describe(request: { refs: string[] }): Promise<ApiResponse<{ credentials: Record<string, CredentialInfo> }>>
    set(request: { ref: string; value: string }): Promise<ApiResponse<void>>
    unset(request: { ref: string }): Promise<ApiResponse<void>>
  }
  llm: {
    providers(request: Record<string, never>): Promise<ApiResponse<{ providers: ConfigurableProviderView[] }>>
    discoverModels(request: {
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }): Promise<ApiResponse<{ models: DiscoveredModelView[] }>>
  }
}

function wrap<T>(promise: Promise<{ ok: true; value: T } | { ok: false; error: ApiFailure }>): Promise<ApiResponse<T>> {
  return promise.then(result => ({ result }))
}

export function createModelsApi(remote: ClientRemote): ModelsApi {
  return {
    settings: {
      mutate: request => wrap(remote.settings.mutate(request.ns, request.ops as WireSettingsPathOpView[], request.expectedRevision)),
    },
    credentials: {
      describe: request => wrap(remote.credentials.describe(request.refs).then(result => result.ok
        ? { ok: true, value: { credentials: result.value } }
        : result)),
      set: request => wrap(remote.credentials.set(request.ref, request.value)),
      unset: request => wrap(remote.credentials.unset(request.ref)),
    },
    llm: {
      providers: async () => {
        const [registered, directory] = await Promise.all([
          remote.llm.listProviders(),
          remote.llm.listConfigurableProviders(),
        ])
        if (!registered.ok) return { result: registered }
        if (!directory.ok) return { result: directory }
        const active = new Set(registered.value.map(provider => provider.id))
        const declared = new Set(directory.value.map(provider => provider.provider))
        const providers: ConfigurableProviderView[] = directory.value.map((provider: LlmConfigurableProvider) => ({
          provider: provider.provider,
          displayName: provider.displayName,
          settingsNs: provider.settingsNs,
          settingsPath: [...provider.settingsPath],
          active: active.has(provider.provider),
          ...provider.declared === undefined ? {} : { declared: provider.declared },
        }))
        for (const provider of registered.value) {
          if (declared.has(provider.id)) continue
          providers.push({
            provider: provider.id,
            displayName: provider.name,
            settingsNs: '',
            settingsPath: [],
            active: true,
          })
        }
        return { result: { ok: true, value: { providers } } }
      },
      discoverModels: request => wrap(remote.llm.discoverModels(request.settingsNs, {
        ...request.provider === undefined ? {} : { provider: request.provider },
        ...request.baseURL === undefined ? {} : { baseURL: request.baseURL },
        ...request.api === undefined ? {} : { api: request.api },
        ...request.apiKey === undefined ? {} : { apiKey: request.apiKey },
      }).then(result => result.ok
        ? { ok: true, value: { models: result.value } }
        : result)),
    },
  }
}
