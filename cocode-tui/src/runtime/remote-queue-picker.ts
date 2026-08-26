import type { ContentBlock, TuiRemoteQueueItem } from '@cocode/tui-connection'
import { visibleRemoteQueueItems as filterVisibleRemoteQueueItems } from './queue-view.ts'

export type RemoteQueuePickerState = {
  items: readonly TuiRemoteQueueItem[]
  query: string
  selected: number
  open: boolean
}

export function createRemoteQueuePicker(items: readonly TuiRemoteQueueItem[]): RemoteQueuePickerState {
  return { items: filterVisibleRemoteQueueItems(items), query: '', selected: 0, open: true }
}

export function setRemoteQueueItems(
  state: RemoteQueuePickerState,
  items: readonly TuiRemoteQueueItem[],
): RemoteQueuePickerState {
  const nextItems = filterVisibleRemoteQueueItems(items)
  const nextState = { ...state, items: nextItems, open: nextItems.length > 0 && state.open }
  const visible = visibleRemoteQueueItems(nextState)
  return { ...nextState, selected: Math.min(state.selected, Math.max(0, visible.length - 1)) }
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

export function visibleRemoteQueueItems(state: RemoteQueuePickerState): readonly TuiRemoteQueueItem[] {
  const query = state.query.trim().toLocaleLowerCase()
  const items = state.items
  if (query === '') return items
  return items.filter((item) => `${item.id} ${item.placement} ${contentText(item.content)}`.toLocaleLowerCase().includes(query))
}

export function contentText(content: readonly ContentBlock[]): string {
  return content.map((block) => block.text ?? `[${block.type}]`).join(' ')
}
