import { describe, expect, it } from 'vitest'
import {
  maybeObservableHook, observableHook, sessionInfoOrAbsent, SlotAssemblyError,
} from '../src/client/session-provider.tsx'

describe('optional observable binding', () => {
  it('treats a null optional observable as absent instead of crashing WeakMap binding', () => {
    expect(() => maybeObservableHook(null as never)).not.toThrow()
  })

  it('reports a direct invalid observable as a slot assembly error', () => {
    expect(() => observableHook(undefined as never)).toThrow(SlotAssemblyError)
    expect(() => observableHook(undefined as never)).toThrow(/invalid observable source/)
  })

  it('supplies an empty session projection when a legacy host omits provideInfo', () => {
    expect(sessionInfoOrAbsent(undefined)).toEqual({ sessionId: undefined, hooks: {}, props: {} })
  })
})
