import type { ContentBlock, TuiRemoteQueueItem } from '@cocode/tui-connection'

export type RemoteQueuePickerState = {
  items: readonly TuiRemoteQueueItem[]
  query: string
  selected: number
  open: boolean
}

export function createRemoteQueuePicker(items: readonly TuiRemoteQueueItem[]): RemoteQueuePickerState {
  return { items: [...items], query: '', selected: 0, open: true }
}

export function setRemoteQueueItems(
  state: RemoteQueuePickerState,
  items: readonly TuiRemoteQueueItem[],
): RemoteQueuePickerState {
  return { ...state, items: [...items], selected: Math.min(state.selected, Math.max(0, items.length - 1)) }
}

export function setRemoteQueueQuery(state: RemoteQueuePickerState, query: string): RemoteQueuePickerState {
  return { ...state, query, selected: 0 }
}

export function moveRemoteQueueSelection(state: RemoteQueuePickerState, delta: number): RemoteQueuePickerState {
  const visible = visibleRemoteQueueItems(state)
  if (visible.length === 0) return { ...state, selected: 0 }
  return { ...state, selected: (((state.selected + delta) % visible.length) + visible.length) % visible.length }
}

export function selectedRemoteQueueItem(state: RemoteQueuePickerState): TuiRemoteQueueItem | undefined {
  return visibleRemoteQueueItems(state)[state.selected]
}

export function closeRemoteQueuePicker(state: RemoteQueuePickerState): RemoteQueuePickerState {
  return { ...state, open: false }
}

export function visibleRemoteQueueItems(state: RemoteQueuePickerState): TuiRemoteQueueItem[] {
  const query = state.query.trim().toLocaleLowerCase()
  if (query === '') return [...state.items]
  return state.items.filter((item) => `${item.id} ${item.placement} ${contentText(item.content)}`.toLocaleLowerCase().includes(query))
}

export function contentText(content: readonly ContentBlock[]): string {
  return content.map((block) => block.text ?? `[${block.type}]`).join(' ')
}
