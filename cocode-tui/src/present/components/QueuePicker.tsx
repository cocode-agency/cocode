import { Box, Text } from 'ink'
import {
  PROMPT_QUEUE_WINDOW_SIZE,
  visiblePromptQueueItems,
  type PromptQueuePickerState,
} from '../../runtime/prompt-queue-picker.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { listWindowStart } from '../list-window.ts'
import { glyphs } from '../glyphs.ts'
import { selectionStyle } from '../selection.ts'
import { PANEL_BORDER } from '../layout.ts'
import { theme } from '../theme.ts'
import { sanitizeSingleLine } from '../text-format.ts'

export function QueuePicker(props: {
  state: PromptQueuePickerState
  locale: UiLocale
  maxRows?: number
}) {
  const items = visiblePromptQueueItems(props.state)
  const windowSize =
    props.maxRows === undefined
      ? PROMPT_QUEUE_WINDOW_SIZE
      : Math.max(1, Math.min(PROMPT_QUEUE_WINDOW_SIZE, Math.trunc(props.maxRows) - 7))
  const start = listWindowStart(props.state.selected, items.length, windowSize)
  const visible = items.slice(start, start + windowSize)

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle={PANEL_BORDER}
      borderColor={theme.border}
      paddingX={1}
    >
      <Text color={theme.text} bold wrap="truncate-end">
        {text(props.locale, 'queueTitle')} · {text(props.locale, 'queueCount', { count: String(items.length) })}{' '}
        <Text color={theme.mute}>· {text(props.locale, 'queueHint')}</Text>
      </Text>
      <Text color={theme.dim} wrap="truncate-end">
        {text(props.locale, 'queueQuery', { query: props.state.query || '…' })}
      </Text>
      {start > 0 ? <Text color={theme.mute}>↑ {start}</Text> : null}
      {visible.length === 0 ? (
        <Text color={theme.mute}>{text(props.locale, 'queueEmpty')}</Text>
      ) : (
        visible.map((item, offset) => {
          const index = start + offset
          const active = index === props.state.selected
          return (
            <Text
              key={item.id}
              {...selectionStyle(active)}
              wrap="truncate-end"
            >
              {active ? glyphs.optionActive : glyphs.optionInactive} {sanitizeSingleLine(item.text) || '…'}
              {item.attachments.length + item.images.length > 0 ? (
                <Text color={active ? theme.text : theme.dim}>
                  {' '}
                  ·{' '}
                  {text(props.locale, 'queueAttachments', {
                    count: String(item.attachments.length + item.images.length),
                  })}
                </Text>
              ) : null}
            </Text>
          )
        })
      )}
      {items.length - start - visible.length > 0 ? (
        <Text color={theme.mute}>↓ {items.length - start - visible.length}</Text>
      ) : null}
    </Box>
  )
}
