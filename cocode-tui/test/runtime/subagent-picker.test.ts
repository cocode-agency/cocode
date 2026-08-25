import { describe, expect, it } from 'vitest'
import {
  createSubagentPicker,
  moveSubagentSelection,
  selectedSubagent,
  setSubagentQuery,
  visibleSubagents,
} from '../../src/runtime/subagent-picker.ts'

const entries = [
  { kind: 'child' as const, id: 'one', label: 'Worker', activity: 'running' as const, mode: 'continuable' as const, hasChildren: false },
  { kind: 'child' as const, id: 'two', label: 'Checks', activity: 'inactive' as const, mode: 'one-shot' as const, hasChildren: false },
  { kind: 'diagnostic' as const, id: 'broken', reason: 'corrupt' as const },
]

describe('subagent picker', () => {
  it('filters direct children and keeps selection within the filtered list', () => {
    const state = setSubagentQuery(createSubagentPicker(entries), 'check')
    expect(visibleSubagents(state).map((entry) => entry.id)).toEqual(['two'])
    expect(selectedSubagent(state)?.id).toBe('two')
    expect(moveSubagentSelection(state, 1).selected).toBe(0)
  })

  it('keeps diagnostic catalog rows visible and searchable', () => {
    const state = createSubagentPicker(entries)
    expect(visibleSubagents(state).map((entry) => entry.id)).toEqual(['one', 'two', 'broken'])
    expect(visibleSubagents(setSubagentQuery(state, 'corrupt')).map((entry) => entry.id)).toEqual(['broken'])
  })
})
