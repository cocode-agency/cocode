import { describe, expect, it } from 'vitest'
import { providerTagKey } from '../src/client/account-gate.ts'
import { zh } from '../src/client/locales.ts'

describe('model provider row tags', () => {
  it('uses the account-managed label only for Cocode Nut', () => {
    expect(providerTagKey('cocode-nut', true, true)).toBe('managedProvider')
    expect(providerTagKey('cocode-cloud', true, true)).toBe('customTag')
    expect(providerTagKey('acme-gateway', false, true)).toBe('customTag')
    expect(providerTagKey('openai', false, false)).toBeUndefined()
    expect(zh.managedProvider).toBe('由 Cocode 账号管理')
  })
})
