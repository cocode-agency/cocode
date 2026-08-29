import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('settings.theme dictionaries', () => {
  it('cover every key consumed by the current Appearance row', () => {
    const keys = [
      'appearance.title',
      'appearance.light',
      'appearance.dark',
      'appearance.system',
    ] as const
    for (const key of keys) {
      expect(zh[key]).toBeTypeOf('string')
      expect(en[key]).toBeTypeOf('string')
      expect(zh[key]).not.toBe(key)
      expect(en[key]).not.toBe(key)
    }
  })
})
