import type { TuiModelReasoningEffort } from '@cocode/tui-connection'

export type EffortChoice = {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

export type EffortPickerState = {
  providerId: string
  modelId: string
  items: readonly EffortChoice[]
  current?: string
  selected: number
  open: boolean
  pending?: string | null
}

export const EFFORT_PICKER_WINDOW_SIZE = 8

export function createEffortPicker(options: {
  providerId: string
  modelId: string
  efforts: readonly TuiModelReasoningEffort[]
  defaultEffort?: string
  current?: string
}): EffortPickerState {
  const items = effortChoices(options.efforts, options.defaultEffort)
  const current = options.current ?? options.defaultEffort
  const selected = Math.max(0, items.findIndex((item) => item.effort === current))
  return {
    providerId: options.providerId,
    modelId: options.modelId,
    items,
    selected,
    open: true,
    ...(current === undefined ? {} : { current }),
  }
}

export function effortChoices(
  efforts: readonly TuiModelReasoningEffort[],
  defaultEffort?: string,
): EffortChoice[] {
  const ordered = [...efforts].sort((left, right) => {
    if (left.id === 'off') return -1
    if (right.id === 'off') return 1
    return 0
  })
  return [
    ...defaultEffort === undefined && !ordered.some((effort) => effort.id === 'off')
      ? [{ key: 'effort:off', effort: undefined, label: 'Off' }]
      : [],
    ...ordered.map((effort) => ({
      key: `effort:${effort.id}`,
      effort: effort.id,
      label: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    })),
  ]
}

export function moveEffortSelection(state: EffortPickerState, delta: number): EffortPickerState {
  if (state.items.length === 0) return { ...state, selected: 0 }
  return {
    ...state,
    selected: (((state.selected + delta) % state.items.length) + state.items.length) % state.items.length,
  }
}

export function selectedEffort(state: EffortPickerState): EffortChoice | undefined {
  return state.items[state.selected]
}

export function closeEffortPicker(state: EffortPickerState): EffortPickerState {
  return { ...state, open: false, pending: undefined }
}

export function beginEffortChange(state: EffortPickerState, effort?: string): EffortPickerState {
  return { ...state, pending: effort ?? null }
}

export function completeEffortChange(
  state: EffortPickerState,
  effort?: string,
): EffortPickerState {
  const selected = Math.max(0, state.items.findIndex((item) => item.effort === effort))
  return {
    ...state,
    selected,
    pending: undefined,
    ...(effort === undefined ? { current: undefined } : { current: effort }),
  }
}

export function failEffortChange(state: EffortPickerState): EffortPickerState {
  return { ...state, pending: undefined }
}
