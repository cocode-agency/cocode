import { describe, expect, it, vi } from 'vitest'
import { renameSession } from '../../src/runtime/session-rename.ts'

describe('session rename', () => {
  it('trims the title and returns the accepted host result', async () => {
    const rename = vi.fn(async (sessionId: string, title: string) => ({ title, seq: 4 }))
    await expect(renameSession({ renameSession: rename }, { sessionRename: true }, 's1', '  Work  ')).resolves.toEqual({
      kind: 'accepted',
      result: { title: 'Work', seq: 4 },
    })
    expect(rename).toHaveBeenCalledWith('s1', 'Work')
  })

  it('does not send empty titles or unsupported requests', async () => {
    const rename = vi.fn()
    await expect(renameSession({ renameSession: rename }, { sessionRename: false }, 's1', ' ')).resolves.toEqual({ kind: 'unavailable' })
    expect(rename).not.toHaveBeenCalled()
  })
})
