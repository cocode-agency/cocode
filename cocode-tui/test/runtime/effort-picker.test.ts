import { describe, expect, it } from 'vitest'
import {
  beginEffortChange,
  closeEffortPicker,
  completeEffortChange,
  createEffortPicker,
  failEffortChange,
  moveEffortSelection,
  selectedEffort,
} from '../../src/runtime/effort-picker.ts'

const efforts = [
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max', description: 'Slowest' },
]
const officialEfforts = [
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
  { id: 'off', name: 'Off' },
]

describe('effort picker state', () => {
  it('selects the current effort and prepends the Off choice when none is configured', () => {
    const state = createEffortPicker({
      providerId: 'deepseek-official',
      modelId: 'deepseek-v4-flash',
      efforts,
      current: 'max',
    })

    expect(state.items.map((item) => item.effort)).toEqual([undefined, 'high', 'max'])
    expect(state.items[0]?.label).toBe('Off')
    expect(selectedEffort(state)).toEqual({
      key: 'effort:max',
      effort: 'max',
      label: 'Max',
      description: 'Slowest',
    })
    expect(state.selected).toBe(2)
  })

  it('starts on the adapter default when the session has no explicit effort', () => {
    const state = createEffortPicker({
      providerId: 'p',
      modelId: 'm',
      efforts,
      defaultEffort: 'high',
    })

    expect(state.items.map((item) => item.effort)).toEqual(['high', 'max'])
    expect(selectedEffort(state)?.effort).toBe('high')
  })

  it('orders the official effort vocabulary as Off, High, Max', () => {
    const state = createEffortPicker({
      providerId: 'cocode-nut',
      modelId: 'deepseek-v4-flash',
      efforts: officialEfforts,
    })

    expect(state.items.map((item) => item.label)).toEqual(['Off', 'High', 'Max'])
    expect(selectedEffort(state)?.effort).toBe('off')
  })

  it('wraps selection and tracks pending, completion, failure, and close', () => {
    const state = createEffortPicker({
      providerId: 'p',
      modelId: 'm',
      efforts,
      current: 'high',
    })
    expect(moveEffortSelection(state, -1).selected).toBe(0)
    expect(moveEffortSelection({ ...state, selected: 0 }, -1).selected).toBe(2)
    const pending = beginEffortChange(state, 'max')
    expect(pending.pending).toBe('max')
    expect(failEffortChange(pending).pending).toBeUndefined()
    expect(completeEffortChange(pending, 'max')).toMatchObject({
      current: 'max',
      pending: undefined,
    })
    expect(closeEffortPicker(pending)).toMatchObject({ open: false, pending: undefined })
  })
})
