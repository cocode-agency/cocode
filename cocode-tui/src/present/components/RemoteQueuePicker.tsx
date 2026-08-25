import { Box, Text } from 'ink'
import {
  contentText,
  visibleRemoteQueueItems,
  type RemoteQueuePickerState,
} from '../../runtime/remote-queue-picker.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { listWindowStart } from '../list-window.ts'
import { glyphs } from '../glyphs.ts'
import { selectionStyle } from '../selection.ts'
import { PANEL_BORDER } from '../layout.ts'
import { theme } from '../theme.ts'
import { sanitizeSingleLine } from '../text-format.ts'

export function RemoteQueuePicker(props: {
  state: RemoteQueuePickerState
  locale: UiLocale
  maxRows?: number
}) {
  const items = visibleRemoteQueueItems(props.state)
  const windowSize = props.maxRows === undefined
    ? 8
    : Math.max(1, Math.min(8, Math.trunc(props.maxRows) - 7))
  const start = listWindowStart(props.state.selected, items.length, windowSize)
  const visible = items.slice(start, start + windowSize)
  return (
    <Box flexDirection="column" marginTop={1} borderStyle={PANEL_BORDER} borderColor={theme.border} paddingX={1}>
      <Text color={theme.text} bold wrap="truncate-end">
        {props.locale === 'zh' ? 'Host 队列' : 'Host queue'}{' '}
        <Text color={theme.mute}>· {props.locale === 'zh' ? '上下移动，Ctrl+D 删除，Ctrl+R steer' : 'arrows move, Ctrl+D delete, Ctrl+R steer'}</Text>
      </Text>
      <Text color={theme.dim} wrap="truncate-end">
        {props.locale === 'zh' ? `搜索：${props.state.query || '…'}` : `Search: ${props.state.query || '…'}`}
      </Text>
      {visible.length === 0 ? <Text color={theme.mute}>{text(props.locale, 'queueEmpty')}</Text> : visible.map((item, offset) => {
        const active = start + offset === props.state.selected
        return (
          <Text key={item.id} {...selectionStyle(active)} wrap="truncate-end">
            {active ? glyphs.optionActive : glyphs.optionInactive} [{item.placement}] {sanitizeSingleLine(contentText(item.content)) || '…'}
          </Text>
        )
      })}
    </Box>
  )
}
