import { Box, Text } from 'ink'
import { memo } from 'react'
import type { CommandNode } from '../../runtime/nodes/types.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { theme } from '../theme.ts'

export const CommandRow = memo(function CommandRow(props: {
  node: CommandNode
  locale: UiLocale
  expanded?: boolean
  selected?: boolean
  maxColumns?: number
}) {
  const { node } = props
  const state = node.outcome === null ? 'running' : node.outcome.kind
  const color =
    props.selected === true
      ? theme.accent
      : state === 'error'
        ? theme.danger
        : state === 'running'
          ? theme.accent
          : theme.mute
  const summary =
    node.outcome === null
      ? text(props.locale, 'commandRunning')
      : node.outcome.text ??
        text(props.locale, node.outcome.kind === 'error' ? 'commandFailed' : 'commandDone')
  const title = node.name === null ? text(props.locale, 'commandTitle') : `/${node.name}`
  const args = node.args?.trim() ?? ''
  const details = props.expanded === true && (args !== '' || node.outcome?.text !== undefined)
  return (
    <Box flexDirection="column" marginTop={1} width={props.maxColumns}>
      <Text color={color}>
        <Text bold>{state === 'error' ? '!' : state === 'running' ? '…' : '✓'}</Text>{' '}
        <Text bold>{title}</Text>
        <Text color={theme.mute}> · {summary}</Text>
      </Text>
      {details ? (
        <Box flexDirection="column" paddingLeft={2}>
          {args !== '' ? <Text color={theme.mute}>{args}</Text> : null}
          {node.outcome?.text !== undefined && node.outcome.text !== summary ? (
            <Text color={state === 'error' ? theme.danger : theme.mute}>{node.outcome.text}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
})
