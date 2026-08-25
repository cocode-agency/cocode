import type { SessionTreeRow } from './session-tree.ts'

export type SessionTreePickerItem = SessionTreeRow & {
  path?: string
  source: 'rpc' | 'jsonl' | 'external'
  externalSessionId?: string
  updatedAt?: number
  activity?: 'idle' | 'running'
  blank?: boolean
  origin?: 'subagent'
  agentPreset?: string
}

export type SessionTreePickerState = {
  items: readonly SessionTreePickerItem[]
  query: string
  selected: number
  open: boolean
}

export const SESSION_TREE_WINDOW_SIZE = 8

export function createSessionTreePicker(
  items: readonly SessionTreePickerItem[],
): SessionTreePickerState {
  return { items: [...items], query: '', selected: 0, open: true }
}

export function setSessionTreeQuery(
  state: SessionTreePickerState,
  query: string,
): SessionTreePickerState {
  return { ...state, query, selected: 0 }
}

export function replaceSessionTreeItems(
  state: SessionTreePickerState,
  items: readonly SessionTreePickerItem[],
): SessionTreePickerState {
  return { ...state, items: [...items], selected: 0 }
}

export function moveSessionTreeSelection(
  state: SessionTreePickerState,
  delta: number,
): SessionTreePickerState {
  const visible = visibleSessionTreeItems(state)
  if (visible.length === 0) return { ...state, selected: 0 }
  const selected = (((state.selected + delta) % visible.length) + visible.length) % visible.length
  return { ...state, selected }
}

export function selectedSessionTreeItem(
  state: SessionTreePickerState,
): SessionTreePickerItem | undefined {
  return visibleSessionTreeItems(state)[state.selected]
}

export function closeSessionTreePicker(state: SessionTreePickerState): SessionTreePickerState {
  return { ...state, open: false }
}

export function setSessionTreeActivity(
  state: SessionTreePickerState,
  sessionId: string,
  activity: 'idle' | 'running',
): SessionTreePickerState {
  let changed = false
  const items = state.items.map((item) => {
    if (item.session.id !== sessionId || item.activity === activity) return item
    changed = true
    return { ...item, activity }
  })
  return changed ? { ...state, items } : state
}

export function visibleSessionTreeItems(state: SessionTreePickerState): SessionTreePickerItem[] {
  const query = state.query.trim().toLocaleLowerCase()
  if (query === '') return [...state.items]
  return state.items.filter((item) =>
    `${item.session.id} ${item.session.title ?? ''} ${item.session.preview ?? ''} ${
      item.session.cwd ?? ''
    }`
      .toLocaleLowerCase()
      .includes(query),
  )
}
