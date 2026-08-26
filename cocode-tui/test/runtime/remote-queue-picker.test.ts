import { describe, expect, it } from 'vitest'
import {
  createRemoteQueuePicker,
  selectedRemoteQueueItem,
  setRemoteQueueItems,
  setRemoteQueueQuery,
} from '../../src/runtime/remote-queue-picker.ts'

const text = (value: string) => [{ type: 'text' as const, text: value }]

describe('remote queue picker', () => {
  it('excludes context entries from the user-visible queue', () => {
    const state = createRemoteQueuePicker([
      { id: 'context-1', placement: 'context', content: text('internal') },
      { id: 'queued-1', placement: 'queued', content: text('follow-up') },
    ])

    expect(state.items.map((item) => item.id)).toEqual(['queued-1'])
  })

  it('clamps selection against the filtered list after a Host update', () => {
    const initial = createRemoteQueuePicker([
      { id: 'one', placement: 'queued', content: text('first task') },
      { id: 'two', placement: 'queued', content: text('second task') },
    ])
    const filtered = { ...setRemoteQueueQuery(initial, 'task'), selected: 1 }
    const updated = setRemoteQueueItems(filtered, [
      { id: 'one', placement: 'queued', content: text('first task') },
      { id: 'two', placement: 'queued', content: text('renamed') },
    ])

    expect(updated.selected).toBe(0)
    expect(selectedRemoteQueueItem(updated)?.id).toBe('one')
  })

  it('closes after the Host queue becomes empty', () => {
    const state = createRemoteQueuePicker([
      { id: 'one', placement: 'queued', content: text('first task') },
    ])

    expect(setRemoteQueueItems(state, []).open).toBe(false)
  })
})
