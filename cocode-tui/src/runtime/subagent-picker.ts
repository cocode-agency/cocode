import type { TuiSubagentListEntry } from '@cocode/tui-connection'

export type SubagentPickerState = {
  entries: readonly TuiSubagentListEntry[]
  query: string
  selected: number
  open: boolean
}

export const SUBAGENT_PICKER_WINDOW_SIZE = 8

export function createSubagentPicker(entries: readonly TuiSubagentListEntry[]): SubagentPickerState {
  return { entries: [...entries], query: '', selected: 0, open: true }
}

export function setSubagentQuery(state: SubagentPickerState, query: string): SubagentPickerState {
  return { ...state, query, selected: 0 }
}

export function moveSubagentSelection(state: SubagentPickerState, delta: number): SubagentPickerState {
  const visible = visibleSubagents(state)
  if (visible.length === 0) return { ...state, selected: 0 }
  return {
    ...state,
    selected: (((state.selected + delta) % visible.length) + visible.length) % visible.length,
  }
}

export function selectedSubagent(state: SubagentPickerState): TuiSubagentListEntry | undefined {
  return visibleSubagents(state)[state.selected]
}

export function closeSubagentPicker(state: SubagentPickerState): SubagentPickerState {
  return { ...state, open: false }
}

export function visibleSubagents(state: SubagentPickerState): TuiSubagentListEntry[] {
  const query = state.query.trim().toLocaleLowerCase()
  if (query === '') return [...state.entries]
  return state.entries.filter((entry) =>
    entry.kind === 'diagnostic'
      ? `${entry.id} ${entry.reason}`.toLocaleLowerCase().includes(query)
      : `${entry.id} ${entry.label ?? ''} ${entry.mode} ${entry.activity}`.toLocaleLowerCase().includes(query),
  )
}
