/**
 * Shared product constants for auth and cloud routing.
 */

import { deviceKeyName } from './device-name.ts'

export const DEFAULT_ORIGIN = 'https://cocode.agency'
export const DEFAULT_PROVIDER = 'deepseek-official'
export const DEFAULT_MODEL = 'deepseek-v4-flash'
export const CLOUD_PROVIDER = 'cocode-nut'
export const LEGACY_CLOUD_PROVIDER = 'cocode-cloud'
export const CLOUD_KEY_REF = 'COCODE_NUT_API_KEY'
export const LEGACY_CLOUD_KEY_REF = 'COCODE_CLOUD_API_KEY'
export const DEEPSEEK_KEY_REF = 'DEEPSEEK_API_KEY'
export { deviceKeyName } from './device-name.ts'
export const KEY_NAME = deviceKeyName()

/**
 * 设备密钥的兜底有效期。密钥与登录会话没有任何关联，客户端崩溃、换机器或直接删掉
 * 本地配置都会跳过登出，只有到期才能让这类密钥自行消失。登录时会验证并按需续领，
 * 且远长于 refresh token 的 30 天，正常使用感知不到。
 */
export const KEY_TTL_DAYS = 90

export const DEVICE_SCOPES = [
  'profile:read',
  'organizations:read',
  'account:read',
  'models:read',
  'inference:write',
] as const

export type AuthMode = 'byok' | 'cocode'

export type MeProfile = {
  displayName: string
  email?: string
}

export type CloudModel = {
  id: string
  name: string
  reasoningEfforts?: Readonly<Record<string, string>>
}

export const CLOUD_API = 'openai-responses'
export const CLOUD_MAX_RETRIES = 5
export const CLOUD_DEFAULT_REASONING = 'high'

export type CloudProviderProfile = {
  displayName: string
  api: typeof CLOUD_API
  baseURL: string
  apiKeyEnv: typeof CLOUD_KEY_REF
  reasoning: typeof CLOUD_DEFAULT_REASONING
  retryPolicy: { mode: 'normal'; maxRetries: typeof CLOUD_MAX_RETRIES }
  models: CloudModel[]
  cocodeClient: {
    product: 'cocode'
    surface: 'tui'
    version: string
    build: string
    os: 'darwin' | 'linux' | 'windows'
    arch: 'arm64' | 'x64'
    installationId: string
  }
}

export type AccountRecord = {
  origin: string
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
  personalKeyId?: string
  personalKeyName?: string
}

export type ResolvedAuth = {
  mode: AuthMode
  provider: string
  model: string
  cwd: string
  origin: string
  accountHome: string
  dshHome: string
  cloudProvider?: CloudProviderProfile
  env: NodeJS.ProcessEnv
}

export type AuthSnapshot = {
  phase: 'gate' | 'byok' | 'device' | 'busy' | 'ready' | 'failed'
  mode?: AuthMode
  profile?: MeProfile
  device?: {
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresIn: number
  }
  error?: string
  envLocked: boolean
  channels?: { byok: boolean; cocode: boolean }
}

export type AuthAction =
  | { type: 'chooseByok' }
  | { type: 'submitByok'; provider: string; key: string }
  | { type: 'chooseCocode' }
  | { type: 'cancel' }
  | { type: 'logout' }
