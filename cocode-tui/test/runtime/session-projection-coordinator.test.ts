import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@cocode/tui-connection'
import { createSessionProjectionCoordinator } from '../../src/runtime/session-projection-coordinator.ts'

function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq, data }
}

describe('SessionProjectionCoordinator', () => {
  it('deduplicates events while keeping all projections in sync', () => {
    const coordinator = createSessionProjectionCoordinator()
    const user = event('user/message', 1, {
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    })

    expect(coordinator.ingest(user)).toBe(true)
    expect(coordinator.ingest(user)).toBe(false)
    expect(coordinator.nodes()).toHaveLength(1)
    expect(coordinator.historyEvents()).toEqual([user])
  })

  it('sorts replacement events and restores captured session state', () => {
    const coordinator = createSessionProjectionCoordinator()
    const title = event('session/title', 2, { title: 'new title' })
    const user = event('user/message', 1, {
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    })

    coordinator.replace([title, user])
    const captured = coordinator.capture()
    coordinator.replace([])
    expect(coordinator.nodes()).toEqual([])

    coordinator.restore(captured)
    expect(coordinator.nodes()).toContainEqual(expect.objectContaining({ kind: 'user', text: 'hello' }))
    expect(coordinator.sessionStateSnapshot().title).toBe('new title')
    expect(coordinator.historyEvents().map((item) => item.seq)).toEqual([1, 2])
  })
})
