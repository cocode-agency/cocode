import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('workspace settings dictionaries', () => {
  it('translate every key consumed by WorkspaceStorageRow', () => {
    const keys = [
      'settings.storage.title',
      'settings.storage.description',
      'settings.storage.systemDefault',
      'settings.storage.choose',
    ] as const
    for (const key of keys) {
      expect(zh[key]).toBeTypeOf('string')
      expect(en[key]).toBeTypeOf('string')
      expect(zh[key]).not.toBe(key)
      expect(en[key]).not.toBe(key)
    }
  })

  it('translates the recent-session group and its actions in both languages', () => {
    const keys = [
      'group.recent',
      'actions.recent.aria',
      'menu.archiveReadSessions',
      'menu.archiveReadSessions.pending',
    ] as const
    for (const key of keys) {
      expect(zh[key]).toBeTypeOf('string')
      expect(en[key]).toBeTypeOf('string')
      expect(zh[key]).not.toBe(key)
      expect(en[key]).not.toBe(key)
    }
  })
})
