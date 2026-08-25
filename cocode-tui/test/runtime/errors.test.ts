import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ERROR_CATALOG,
  TuiError,
  displayError,
  formatError,
  resolveLocale,
} from '../../src/runtime/errors/index.ts'
import { startErrorMessage } from '../../src/runtime/app-view.ts'

describe('resolveLocale', () => {
  it('prefers COCODE_LANG over LANG', () => {
    expect(resolveLocale({ COCODE_LANG: 'zh', LANG: 'en_US.UTF-8' })).toBe('zh')
    expect(resolveLocale({ COCODE_LANG: 'en', LANG: 'zh_CN.UTF-8' })).toBe('en')
  })

  it('maps zh* from LANG when COCODE_LANG is unset', () => {
    expect(resolveLocale({ LANG: 'zh_CN.UTF-8' })).toBe('zh')
    expect(resolveLocale({ LC_MESSAGES: 'zh-TW' })).toBe('zh')
  })

  it('falls back to en for unknown or empty values', () => {
    expect(resolveLocale({ COCODE_LANG: 'fr', LANG: 'zh_CN' })).toBe('en')
    expect(resolveLocale({}, 'en-US')).toBe('en')
  })

  it('uses the runtime locale when Windows has no LANG variables', () => {
    expect(resolveLocale({}, 'zh-CN')).toBe('zh')
  })
})

describe('formatError', () => {
  it('renders CODE · localized explanation', () => {
    expect(formatError('AUTH_DEVICE_EXPIRED', {}, 'en')).toBe(
      'AUTH_DEVICE_EXPIRED · Device authorization expired.',
    )
    expect(formatError('AUTH_DEVICE_EXPIRED', {}, 'zh')).toBe(
      'AUTH_DEVICE_EXPIRED · 设备登录已过期。',
    )
  })

  it('interpolates params and omits empty placeholders', () => {
    expect(formatError('COMMAND_UNKNOWN', { name: 'foo' }, 'en')).toBe(
      'COMMAND_UNKNOWN · Unknown command /foo.',
    )
    expect(formatError('RUNTIME_STOPPED', {}, 'en')).toBe('RUNTIME_STOPPED · Runtime stopped.')
    expect(formatError('RUNTIME_STOPPED', { detail: 'stderr tail' }, 'en')).toBe(
      'RUNTIME_STOPPED · Runtime stopped: stderr tail.',
    )
  })
})

describe('TuiError', () => {
  it('exposes a stable code and a formatted message', () => {
    const error = new TuiError('AUTH_NOT_READY')
    expect(error.code).toBe('AUTH_NOT_READY')
    expect(error.message).toMatch(/^AUTH_NOT_READY · /)
  })
})

describe('displayError', () => {
  it('formats TuiError by code', () => {
    expect(displayError(new TuiError('COMMAND_INVALID'), 'en')).toBe(
      'COMMAND_INVALID · Not a command.',
    )
  })

  it('maps unknown failures to RUNTIME_UNKNOWN and redacts secrets', () => {
    const message = displayError(new Error('API_KEY=sk-secret failed'), 'en')
    expect(message).toMatch(/^RUNTIME_UNKNOWN · /)
    expect(message).not.toMatch(/sk-secret|API_KEY=/)
  })

  it('shows stable Host business codes and redacts their messages', () => {
    const error = Object.assign(new Error('queue API_KEY=sk-secret failed'), {
      code: 'queue-item-not-found',
      details: { itemId: 'q1' },
    })
    const message = displayError(error, 'en')
    expect(message).toMatch(/^queue-item-not-found · /)
    expect(message).not.toMatch(/sk-secret|API_KEY=/)
  })

  it('includes the underlying transport cause', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('connect ECONNRESET 203.0.113.1:443'),
    })
    expect(displayError(error, 'en')).toBe(
      'RUNTIME_UNKNOWN · Unexpected error: fetch failed: connect ECONNRESET 203.0.113.1:443.',
    )
  })
})

describe('startErrorMessage', () => {
  it('keeps the runtime detail on following lines', () => {
    expect(startErrorMessage(new Error('line one\nline two'))).toBe(
      'RUNTIME_INIT_FAILED · Initialize failed. Check the shared DSH Host and Supervisor, then /exit.\nline one\nline two',
    )
  })
})

describe('error catalog', () => {
  it('assigns every code to a domain and both locales', () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(entry.domain, code).toMatch(/^(AUTH|RUNTIME|COMMAND|SESSION|CONFIG|IO)$/)
      expect(entry.en.trim(), `${code} en`).not.toBe('')
      expect(entry.zh.trim(), `${code} zh`).not.toBe('')
    }
  })

  it('documents every code in zh and en error guides', () => {
    const zh = readFileSync(resolve(process.cwd(), 'docs/zh/errors.md'), 'utf8')
    const en = readFileSync(resolve(process.cwd(), 'docs/en/errors.md'), 'utf8')
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(zh, code).toContain(code)
      expect(en, code).toContain(code)
      expect(zh, `${code} zh`).toContain(entry.zh)
      expect(en, `${code} en`).toContain(entry.en)
    }
  })
})
