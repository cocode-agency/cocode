/**
 * RFC 8628 device authorization against the Cocode agency.
 */

import { isManagedClientMismatch, jsonRequest, problemCode } from './agency.ts'
import { TuiError } from '../errors/index.ts'
import { normalizeAgencyOrigin, validateVerificationUrl } from './origin.ts'
import { DEVICE_SCOPES, KEY_NAME, KEY_TTL_DAYS, type CloudModel, type MeProfile } from './types.ts'
import type { CocodeClientIdentity } from './client-identity.ts'

export type DeviceAuthorization = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export type TokenPair = {
  access_token: string
  refresh_token: string
  expires_in: number
}

export type AgencyClient = {
  fetch?: typeof fetch
  delay?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export async function startDeviceAuthorization(
  origin: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
  identity?: CocodeClientIdentity,
): Promise<DeviceAuthorization> {
  const safeOrigin = normalizeAgencyOrigin(origin)
  const created = await jsonRequest<DeviceAuthorization>(
    `${safeOrigin}/v1/auth/device/authorizations`,
    {
      method: 'POST',
      body: {
        client_name: 'Cocode TUI',
        device_label: KEY_NAME,
        scopes: [...DEVICE_SCOPES],
        ...(identity === undefined ? {} : { client: identity }),
      },
      fetch: client.fetch,
      signal,
    },
  )
  if (created.status !== 200 && created.status !== 201) {
    throw new TuiError('AUTH_DEVICE_START_FAILED')
  }
  const value = created.value
  if (!isRecord(value)) {
    throw new TuiError('AUTH_DEVICE_INVALID')
  }
  if (
    !isNonempty(value.device_code) ||
    !isNonempty(value.user_code) ||
    !isPositiveFinite(value.expires_in) ||
    !isPositiveFinite(value.interval)
  ) {
    throw new TuiError('AUTH_DEVICE_INVALID')
  }
  const verificationUri = validateVerificationUrl(value.verification_uri, 'verification_uri')
  const verificationUriComplete = validateVerificationUrl(
    value.verification_uri_complete,
    'verification_uri_complete',
  )
  return {
    ...value,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
  }
}

export async function pollDeviceToken(
  origin: string,
  deviceCode: string,
  intervalSec: number,
  expiresInSec: number,
  signal: AbortSignal,
  client: AgencyClient = {},
): Promise<TokenPair> {
  const delay = client.delay ?? defaultDelay
  const now = client.now ?? Date.now
  const deadline = now() + expiresInSec * 1000
  let waitSec = Math.max(1, intervalSec)
  for (;;) {
    if (signal.aborted) throw new TuiError('AUTH_LOGIN_CANCELLED')
    const remaining = deadline - now()
    if (remaining <= 0) throw new TuiError('AUTH_DEVICE_EXPIRED')
    await delay(Math.min(waitSec * 1000, remaining))
    if (signal.aborted) throw new TuiError('AUTH_LOGIN_CANCELLED')
    if (deadline - now() <= 0) throw new TuiError('AUTH_DEVICE_EXPIRED')
    const polled = await jsonRequest<TokenPair>(
      `${normalizeAgencyOrigin(origin)}/v1/auth/device/token`,
      {
        method: 'POST',
        body: { device_code: deviceCode },
        fetch: client.fetch,
        signal,
      },
    )
    if (polled.status === 200 && isTokenPair(polled.value)) {
      return polled.value
    }
    const code = problemCode(polled.value)
    if (isPendingDeviceCode(code)) continue
    if (code === 'slow_down') {
      waitSec += 5
      continue
    }
    if (isExpiredDeviceCode(code)) {
      throw new TuiError('AUTH_DEVICE_EXPIRED')
    }
    throw new TuiError('AUTH_DEVICE_DENIED')
  }
}

export async function loadProfile(
  origin: string,
  accessToken: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
): Promise<MeProfile> {
  const me = await jsonRequest<{
    user?: { display_name?: string; email?: string }
  }>(`${normalizeAgencyOrigin(origin)}/v1/me`, {
    method: 'GET',
    token: accessToken,
    fetch: client.fetch,
    signal,
  })
  if (me.status !== 200) {
    throw new TuiError('AUTH_ACCOUNT_LOAD_FAILED')
  }
  if (!isRecord(me.value)) {
    throw new TuiError('AUTH_ACCOUNT_INVALID')
  }
  const user = me.value.user
  if (user !== undefined && (typeof user !== 'object' || user === null)) {
    throw new TuiError('AUTH_ACCOUNT_INVALID')
  }
  const displayName = typeof user?.display_name === 'string' ? user.display_name.trim() : ''
  const email = typeof user?.email === 'string' ? user.email : undefined
  return {
    displayName: displayName === '' ? email ?? 'Cocode' : displayName,
    ...(email === undefined ? {} : { email }),
  }
}

export async function mintPersonalKey(
  origin: string,
  accessToken: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
  identity?: CocodeClientIdentity,
): Promise<{ secret: string; id: string }> {
  const created = await jsonRequest<{ secret?: string; id?: string }>(
    `${normalizeAgencyOrigin(origin)}/v1/me/api-keys`,
    {
      method: 'POST',
      token: accessToken,
      body: {
        name: KEY_NAME,
        scopes: ['models:read', 'inference:write'],
        expires_at: new Date(Date.now() + KEY_TTL_DAYS * 86_400_000).toISOString(),
        ...(identity === undefined ? {} : { managed_client: identity }),
      },
      fetch: client.fetch,
      signal,
    },
  )
  if (isManagedClientMismatch(created.status, created.value)) {
    throw new TuiError('AUTH_KEY_CREATE_FAILED', { detail: 'managed_client_mismatch' })
  }
  if (
    !isRecord(created.value) ||
    (created.status !== 201 && created.status !== 200) ||
    !isNonempty(created.value.secret) ||
    !isNonempty(created.value.id)
  ) {
    throw new TuiError('AUTH_KEY_CREATE_FAILED')
  }
  return { secret: created.value.secret.trim(), id: created.value.id.trim() }
}

export async function listHostedModels(
  origin: string,
  apiKey: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
): Promise<CloudModel[]> {
  const listed = await jsonRequest<{
    data?: { id?: string; name?: string }[]
  }>(`${normalizeAgencyOrigin(origin)}/v1/me/models`, {
    method: 'GET',
    token: apiKey,
    fetch: client.fetch,
    signal,
  })
  // 401/403 单独区分：密钥过期或被撤销时调用方要重新领一把，而不是当成拉取失败。
  if (listed.status === 401 || listed.status === 403) {
    throw new TuiError('AUTH_KEY_REJECTED')
  }
  if (listed.status !== 200) {
    throw new TuiError('AUTH_MODELS_LIST_FAILED')
  }
  if (!isRecord(listed.value)) {
    throw new TuiError('AUTH_MODELS_INVALID')
  }
  if (!Array.isArray(listed.value.data)) {
    throw new TuiError('AUTH_MODELS_INVALID')
  }
  return listed.value.data
    .filter(
      (row): row is { id: string; name?: string } =>
        isRecord(row) && typeof row.id === 'string' && row.id.trim() !== '',
    )
    .map((row) => ({
      id: row.id.trim(),
      name:
        typeof row.name !== 'string' || row.name.trim() === '' ? row.id.trim() : row.name.trim(),
    }))
}


/**
 * 校验本地保存的密钥是否仍被服务端接受。已过期或已在 Web 端撤销时返回 undefined，
 * 由调用方重新领取，否则登录会卡在拉模型这一步。
 */
export async function probeHostedModels(
  origin: string,
  apiKey: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
): Promise<CloudModel[] | undefined> {
  try {
    return await listHostedModels(origin, apiKey, client, signal)
  } catch (error) {
    if (error instanceof TuiError && error.code === 'AUTH_KEY_REJECTED') return undefined
    throw error
  }
}

/**
 * 撤销本机登录时创建的设备密钥。密钥的生命周期与 token 家族无关，
 * 不在登出时主动撤销就会永久留在账号里。
 */
export async function revokePersonalKey(
  origin: string,
  accessToken: string,
  keyId: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
): Promise<void> {
  try {
    await jsonRequest(
      `${normalizeAgencyOrigin(origin)}/v1/me/api-keys/${encodeURIComponent(keyId)}`,
      {
        method: 'DELETE',
        token: accessToken,
        fetch: client.fetch,
        signal,
      },
    )
  } catch {
    // Local sign-out still proceeds.
  }
}

export async function revokeToken(
  origin: string,
  refreshToken: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
): Promise<void> {
  try {
    await jsonRequest(`${normalizeAgencyOrigin(origin)}/v1/auth/token/revoke`, {
      method: 'POST',
      body: { refresh_token: refreshToken },
      fetch: client.fetch,
      signal,
    })
  } catch {
    // Local sign-out still proceeds.
  }
}

export async function refreshAccess(
  origin: string,
  refreshToken: string,
  client: AgencyClient = {},
  signal?: AbortSignal,
): Promise<TokenPair> {
  const refreshed = await jsonRequest<TokenPair>(
    `${normalizeAgencyOrigin(origin)}/v1/auth/token/refresh`,
    {
      method: 'POST',
      body: { refresh_token: refreshToken },
      fetch: client.fetch,
      signal,
    },
  )
  if (refreshed.status !== 200 || !isTokenPair(refreshed.value)) {
    throw new TuiError('AUTH_SESSION_EXPIRED')
  }
  return refreshed.value
}

function isNonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isPendingDeviceCode(code: string | undefined): boolean {
  return code === 'authorization_pending' || code === 'device_authorization_pending'
}

function isExpiredDeviceCode(code: string | undefined): boolean {
  return (
    code === 'expired_token' ||
    code === 'token_expired' ||
    code === 'device_authorization_unavailable'
  )
}

function isTokenPair(value: unknown): value is TokenPair {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    isNonempty(record.access_token) &&
    isNonempty(record.refresh_token) &&
    isPositiveFinite(record.expires_in)
  )
}
