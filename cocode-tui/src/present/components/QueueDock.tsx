import { Box, Text } from 'ink'
import type { TuiRemoteQueueItem } from '@cocode/tui-connection'
import type { QueuedPrompt } from '../../runtime/prompt-queue.ts'
import { contentText } from '../../runtime/remote-queue-picker.ts'
import { totalQueueCount, visibleRemoteQueueItems } from '../../runtime/queue-view.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { PANEL_BORDER } from '../layout.ts'
import { theme } from '../theme.ts'
import { sanitizeSingleLine } from '../text-format.ts'

const MAX_QUEUE_DOCK_ITEMS = 3

export function queueDockRows(
  localItems: readonly QueuedPrompt[],
  remoteItems: readonly TuiRemoteQueueItem[],
): number {
  const count = totalQueueCount(localItems.length, visibleRemoteQueueItems(remoteItems).length)
  if (count === 0) return 0
  return Math.min(MAX_QUEUE_DOCK_ITEMS, count) + 3
}

export function QueueDock(props: {
  localItems: readonly QueuedPrompt[]
  remoteItems: readonly TuiRemoteQueueItem[]
  locale: UiLocale
  maxRows?: number
}) {
  const items = [
    ...props.localItems.map((item) => ({ source: 'local' as const, text: item.text })),
    ...visibleRemoteQueueItems(props.remoteItems).map((item) => ({
      source: 'host' as const,
      text: contentText(item.content),
    })),
  ]
  if (items.length === 0) return null

  const itemLimit = props.maxRows === undefined
    ? MAX_QUEUE_DOCK_ITEMS
    : Math.max(1, Math.min(MAX_QUEUE_DOCK_ITEMS, Math.trunc(props.maxRows) - 3))
  const visible = items.slice(0, itemLimit)
  const remaining = items.length - visible.length

  return (
    <Box
      flexDirection="column"
      height={props.maxRows}
      overflowY="hidden"
      borderStyle={PANEL_BORDER}
      borderColor={theme.border}
      paddingX={1}
    >
      <Text color={theme.text} bold wrap="truncate-end">
        {text(props.locale, 'queueTitle')} ·{' '}
        {text(props.locale, 'queueCount', { count: String(items.length) })}{' '}
        <Text color={theme.mute}>· {text(props.locale, 'queueDockHint')}</Text>
      </Text>
      {visible.map((item, index) => (
        <Text key={`${item.source}:${String(index)}:${item.text}`} color={theme.dim} wrap="truncate-end">
          {String(index + 1)}.{' '}
          <Text color={item.source === 'host' ? theme.accent : theme.text}>
            {text(props.locale, item.source === 'host' ? 'queueHost' : 'queueLocal')}
          </Text>{' · '}
          {sanitizeSingleLine(item.text) || '…'}
        </Text>
      ))}
      {remaining > 0 ? <Text color={theme.mute}>… +{String(remaining)}</Text> : null}
    </Box>
  )
}
