import type { TuiRemoteQueueItem } from '@cocode/tui-connection'

export function isVisibleRemoteQueueItem(item: TuiRemoteQueueItem): boolean {
  return item.placement !== 'context'
}

export function visibleRemoteQueueItems(items: readonly TuiRemoteQueueItem[]): TuiRemoteQueueItem[] {
  return items.filter(isVisibleRemoteQueueItem)
}

export function totalQueueCount(localCount: number, remoteCount: number): number {
  return localCount + remoteCount
}
