import { Box, Text } from 'ink'
import type { TuiSnapshot } from '../../runtime/app-contracts.ts'
import { AgentStatusIndicator } from './AgentStatusIndicator.tsx'
import { theme } from '../theme.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import stringWidth from 'string-width'
import { totalQueueCount } from '../../runtime/queue-view.ts'

export function noticeLines(message: string): string[] {
  return message.split('\n')
}

export const NOTICE_MAX_ROWS = 6

export function noticeRows(message: string, maxColumns = 80): number {
  const columns = Math.max(1, Math.trunc(maxColumns))
  return noticeLines(message).reduce((rows, line) => {
    return rows + Math.max(1, Math.ceil((2 + stringWidth(line)) / columns))
  }, 0)
}

export function visibleNoticeRows(message: string, maxColumns = 80): number {
  return Math.min(NOTICE_MAX_ROWS, noticeRows(message, maxColumns))
}

export function StatusLine(props: {
  status: TuiSnapshot['status']
  agent: TuiSnapshot['agent']
  notice?: TuiSnapshot['notice']
  locale: UiLocale
  noticeRows?: number
  noticeScrollOffset?: number
}) {
  const notice = props.notice
  const telemetry = props.status.telemetry
  const queueCount = totalQueueCount(
    props.status.queueCount,
    props.status.remoteQueueCount,
  )
  const telemetryBits = [
    telemetry.activity === undefined
      ? undefined
      : text(props.locale, 'telemetryActivity', {
          phase: telemetry.activity.phase,
          line: telemetry.activity.line,
        }),
    props.status.todos.length > 0
      ? text(props.locale, 'todoProgress', {
          done: String(props.status.todos.filter((todo) => todo.status === 'completed').length),
          total: String(props.status.todos.length),
        })
      : undefined,
    props.status.goal === undefined
      ? undefined
      : text(props.locale, 'goalPhase', { phase: props.status.goal.phase }),
    props.status.agentPreset === undefined
      ? undefined
      : text(props.locale, 'agentPreset', { name: props.status.agentPreset }),
    props.status.transcript === undefined
      ? undefined
      : text(props.locale, 'transcriptTrimmed', {
          count: String(props.status.transcript.evicted),
        }),
  ].filter((value): value is string => value !== undefined)
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Box width="100%" justifyContent="space-between">
        <Text color={theme.dim} wrap="truncate-end">
          <AgentStatusIndicator agent={props.agent} /> {props.status.line}
        </Text>
        <Box flexShrink={0}>
          {props.status.focusMode ? (
            <Text color={theme.accent} wrap="truncate-end">
              {text(props.locale, 'focusStatusOn')}
            </Text>
          ) : null}
          {props.status.subagents !== undefined && props.status.subagents.running > 0 ? (
            <Text color={theme.accent} wrap="truncate-end">
              {' · '}
              {text(props.locale, 'subagentsRunning', {
                count: String(props.status.subagents.running),
              })}
            </Text>
          ) : props.status.subagents?.last?.event === 'finished' ? (
            <Text color={theme.mute} wrap="truncate-end">
              {' · '}
              {text(props.locale, 'subagentFinished', {
                id: props.status.subagents.last.id,
              })}
            </Text>
          ) : null}
          {queueCount > 0 ? (
            <Text color={theme.accent} wrap="truncate-end">
              {' · '}
              {text(props.locale, 'queueCount', {
                count: String(queueCount),
              })}
            </Text>
          ) : null}
        </Box>
      </Box>
      {telemetryBits.length > 0 ? (
        <Text color={theme.mute} wrap="truncate-end">
          {telemetryBits.join(' · ')}
        </Text>
      ) : null}
      {notice ? (
        <Notice
          notice={notice}
          maxRows={props.noticeRows}
          scrollOffset={props.noticeScrollOffset}
        />
      ) : null}
    </Box>
  )
}

function Notice(props: {
  notice: NonNullable<TuiSnapshot['notice']>
  maxRows?: number
  scrollOffset?: number
}) {
  const color = props.notice.tone === 'error' ? theme.danger : theme.accent
  const mark = props.notice.tone === 'error' ? '!' : '·'
  const maxRows = Math.max(1, Math.trunc(props.maxRows ?? noticeRows(props.notice.message)))
  const scrollOffset = Math.max(0, Math.trunc(props.scrollOffset ?? 0))
  return (
    <Box height={maxRows} overflowY="hidden">
      <Box flexDirection="column" marginTop={-scrollOffset}>
        {noticeLines(props.notice.message).map((line, index) => (
          <Text key={`${String(index)}:${line}`} color={color}>
            {index === 0 ? `${mark} ` : '  '}{line}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
