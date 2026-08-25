import { Box, Text } from 'ink'
import {
  SUBAGENT_PICKER_WINDOW_SIZE,
  visibleSubagents,
  type SubagentPickerState,
} from '../../runtime/subagent-picker.ts'
import type { UiLocale } from '../../runtime/ui-locale.ts'
import { listWindowStart } from '../list-window.ts'
import { glyphs } from '../glyphs.ts'
import { selectionStyle } from '../selection.ts'
import { PANEL_BORDER } from '../layout.ts'
import { theme } from '../theme.ts'

export function SubagentPicker(props: {
  state: SubagentPickerState
  locale: UiLocale
  maxRows?: number
}) {
  const items = visibleSubagents(props.state)
  const windowSize = props.maxRows === undefined
    ? SUBAGENT_PICKER_WINDOW_SIZE
    : Math.max(1, Math.min(SUBAGENT_PICKER_WINDOW_SIZE, Math.trunc(props.maxRows) - 7))
  const start = listWindowStart(props.state.selected, items.length, windowSize)
  const visible = items.slice(start, start + windowSize)

  return (
    <Box flexDirection="column" marginTop={1} borderStyle={PANEL_BORDER} borderColor={theme.border} paddingX={1}>
      <Text color={theme.text} bold wrap="truncate-end">
        {props.locale === 'zh' ? '子代理' : 'Subagents'}{' '}
        <Text color={theme.mute}>· {props.locale === 'zh' ? '输入过滤 · ↑↓ 选择 · Enter 查看历史 · Esc 关闭' : 'type to filter · ↑↓ select · enter history · esc close'}</Text>
      </Text>
      <Text color={theme.dim} wrap="truncate-end">
        {props.locale === 'zh' ? `筛选：${props.state.query || '…'}` : `filter: ${props.state.query || '…'}`}
      </Text>
      {start > 0 ? <Text color={theme.mute}>↑ {start}</Text> : null}
      {visible.length === 0 ? (
        <Text color={theme.mute}>{props.locale === 'zh' ? '当前没有匹配的子代理。' : 'No matching subagents.'}</Text>
      ) : visible.map((entry, offset) => {
        const active = start + offset === props.state.selected
        const label = entry.label ?? entry.id.slice(0, 8)
        const state = entry.activity === 'running' ? (props.locale === 'zh' ? '运行中' : 'running') : (props.locale === 'zh' ? '未运行' : 'inactive')
        return (
          <Text key={entry.id} {...selectionStyle(active)} wrap="truncate-end">
            {active ? glyphs.optionActive : glyphs.optionInactive} {label}{' '}
            <Text color={active ? theme.text : theme.dim}>· {entry.mode} · {state} · {entry.id.slice(0, 8)}</Text>
          </Text>
        )
      })}
      {items.length - start - visible.length > 0 ? <Text color={theme.mute}>↓ {items.length - start - visible.length}</Text> : null}
    </Box>
  )
}
