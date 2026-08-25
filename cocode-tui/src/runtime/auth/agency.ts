/**
 * Agency HTTP helper. Logs never include token bodies.
 */

import { errorDetail, TuiError } from '../errors/index.ts'

export type AgencyResponse<T> = { status: number; value: T }

export class AgencyError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, title: string, code?: string) {
    super(title)
    this.name = 'AgencyError'
    this.status = status
    this.code = code
  }
}

export async function jsonRequest<T>(
  url: string,
  init: {
    method: string
    body?: unknown
    token?: string
    fetch?: typeof fetch
    signal?: AbortSignal
  },
): Promise<AgencyResponse<T>> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`
  const fetchImpl = init.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal:
        init.signal === undefined
          ? AbortSignal.timeout(15_000)
          : AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    })
  } catch (error) {
    throw new TuiError('AUTH_NETWORK_FAILED', { detail: errorDetail(error) })
  }
  const text = await response.text()
  let value: T
  try {
    value = text === '' ? ({} as T) : (JSON.parse(text) as T)
  } catch {
    throw new AgencyError(response.status, `agency answered HTTP ${String(response.status)}`)
  }
  return { status: response.status, value }
}

export function problemCode(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as { code?: unknown; error?: unknown }
  if (typeof record.code === 'string') return record.code
  if (typeof record.error === 'string') return record.error
  return undefined
}

export function problemTitle(value: unknown, fallback: string): string {
  if (value !== null && typeof value === 'object') {
    const record = value as { title?: unknown; detail?: unknown }
    if (typeof record.detail === 'string' && record.detail !== '') {
      return record.detail
    }
    if (typeof record.title === 'string' && record.title !== '') {
      return record.title
    }
  }
  return fallback
}

export function isManagedClientMismatch(status: number, value: unknown): boolean {
  if (status !== 422) return false
  return /managed client metadata does not match/i.test(
    `${problemCode(value) ?? ''} ${problemTitle(value, '')}`,
  )
}
