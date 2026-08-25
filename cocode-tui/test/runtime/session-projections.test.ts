import { describe, expect, it } from 'vitest'
import { createSessionProjectionStore } from '../../src/runtime/session-projections.ts'

describe('session projection store', () => {
  it('applies a baseline and ignores older updates', () => {
    const store = createSessionProjectionStore()

    store.applyBaseline({ asOfSeq: 10, values: { title: 'Initial', goal: { text: 'ship' } } })
    store.apply({ key: 'title', seq: 9, value: 'stale' })
    store.apply({ key: 'goal', seq: 10, value: { text: 'same-seq' } })

    expect([...store.values.entries()]).toEqual([
      ['title', 'Initial'],
      ['goal', { text: 'ship' }],
    ])
  })

  it('lets newer updates win and preserves unrelated keys', () => {
    const store = createSessionProjectionStore()

    store.applyBaseline({ asOfSeq: 2, values: { title: 'Initial', todo: ['one'] } })
    store.apply({ key: 'title', seq: 3, value: 'Updated' })
    store.apply({ key: 'title', seq: 3, value: 'Duplicate' })
    store.apply({ key: 'status', seq: 4, value: 'running' })

    expect([...store.values.entries()]).toEqual([
      ['title', 'Updated'],
      ['todo', ['one']],
      ['status', 'running'],
    ])
  })

  it('clears all values before loading another session', () => {
    const store = createSessionProjectionStore()

    store.apply({ key: 'title', seq: 1, value: 'Old' })
    store.clear()

    expect([...store.values.entries()]).toEqual([])
  })
})
