import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('settings.theme dictionaries', () => {
  it('cover every key consumed by the current Appearance section', () => {
    const keys = [
      'nav',
      'appearance.title',
      'appearance.auto',
      'appearance.light',
      'appearance.dark',
      'appearance.font.title',
      'appearance.font.14',
      'appearance.font.16',
      'appearance.font.18',
      'appearance.font.20',
    ] as const
    for (const key of keys) {
      expect(zh[key]).toBeTypeOf('string')
      expect(en[key]).toBeTypeOf('string')
      expect(zh[key]).not.toBe(key)
      expect(en[key]).not.toBe(key)
    }
  })
})
