/**
 * Format catalog codes as "CODE · explanation".
 */

import { readTuiRpcError } from '@cocode/tui-connection'
import { redactSecrets } from '../diagnostics.ts'
import { ERROR_CATALOG, type ErrorCode, type ErrorParams, type Locale } from './catalog.ts'
import { resolveLocale } from './locale.ts'

export function formatError(
  code: ErrorCode,
  params: ErrorParams = {},
  locale: Locale = resolveLocale(),
): string {
  const entry = ERROR_CATALOG[code]
  const template = entry[locale] || entry.en
  return `${code} · ${interpolate(template, params)}`
}

export class TuiError extends Error {
  readonly code: ErrorCode
  readonly params: ErrorParams

  constructor(code: ErrorCode, params: ErrorParams = {}) {
    super(formatError(code, params))
    this.name = 'TuiError'
    this.code = code
    this.params = params
  }
}

export function displayError(error: unknown, locale: Locale = resolveLocale()): string {
  if (error instanceof TuiError) return formatError(error.code, error.params, locale)
  const code = errorCodeOf(error)
  if (code !== undefined) return formatError(code, {}, locale)
  const rpcError = readTuiRpcError(error)
  if (rpcError !== undefined) return `${rpcError.code} · ${redactSecrets(rpcError.message)}`
  const raw = errorDetail(error)
  if (isErrorCode(raw)) return formatError(raw, {}, locale)
  return formatError('RUNTIME_UNKNOWN', { detail: redactSecrets(raw) }, locale)
}

export function errorDetail(value: unknown): string {
  const path = new Set<unknown>()
  const render = (current: unknown): string => {
    if (path.has(current)) return '<circular cause>'
    path.add(current)
    try {
      if (!(current instanceof Error)) return String(current)
      const message = current.message === '' ? current.name : current.message
      const members = current instanceof AggregateError && current.errors.length > 0
        ? ` [${current.errors.map(render).join('; ')}]`
        : ''
      const cause = current.cause === undefined || current.cause === null
        ? ''
        : render(current.cause)
      return `${message}${members}${cause === '' || cause === message ? '' : `: ${cause}`}`
    } catch {
      return '<unreadable error>'
    } finally {
      path.delete(current)
    }
  }
  return render(value)
}

export function errorNotice(
  code: ErrorCode,
  params: ErrorParams = {},
): { tone: 'error'; message: string } {
  return { tone: 'error', message: formatError(code, params) }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value)
}

function errorCodeOf(error: unknown): ErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return isErrorCode(code) ? code : undefined
}

function interpolate(template: string, params: ErrorParams): string {
  const filled = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key]
    if (value === undefined || String(value) === '') return ''
    return String(value)
  })
  return filled
    .replace(/: *\./g, '.')
    .replace(/： *。/g, '。')
    .replace(/: *$/g, '.')
    .replace(/： *$/g, '。')
    .replace(/ +\./g, '.')
    .replace(/ +。/g, '。')
    .replace(/ {2,}/g, ' ')
    .trim()
}
