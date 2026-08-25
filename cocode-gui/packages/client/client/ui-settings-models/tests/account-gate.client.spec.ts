import { describe, expect, it } from 'vitest'
import { isAccountManagedProvider, isAccountManagedProviderPath } from '../src/client/account-gate.ts'

describe('account-managed model providers', () => {
  it('recognizes the reserved Cocode routes', () => {
    expect(isAccountManagedProvider('cocode-nut')).toBe(true)
    expect(isAccountManagedProvider('cocode-cloud')).toBe(true)
    expect(isAccountManagedProvider('openai')).toBe(false)
  })

  it('recognizes only reserved pi-ai provider profile paths', () => {
    expect(isAccountManagedProviderPath('llm-pi-ai', ['providers', 'cocode-nut'])).toBe(true)
    expect(isAccountManagedProviderPath('llm-pi-ai', ['providers', 'openai'])).toBe(false)
    expect(isAccountManagedProviderPath('llm-deepseek', ['providers', 'cocode-nut'])).toBe(false)
  })
})
