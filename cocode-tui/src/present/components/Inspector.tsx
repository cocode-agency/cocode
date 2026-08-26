import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { TuiSnapshot } from '../../runtime/app-contracts.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { glyphs } from '../glyphs.ts'
import {
  useInspectorScroll,
  type InspectorMouseInput,
} from '../inspector-scroll.ts'
import { PANEL_BORDER, PANEL_PADDING_X } from '../layout.ts'
import { theme } from '../theme.ts'
import { ScrollablePanel } from './ScrollablePanel.tsx'
import { totalQueueCount } from '../../runtime/queue-view.ts'

const INSPECTOR_WIDTH = 30

export { INSPECTOR_WIDTH }

export function Inspector(props: {
  snapshot: TuiSnapshot
  locale: UiLocale
  maxRows: number
  width?: number
  resizing?: boolean
  mouseInput?: InspectorMouseInput
}) {
  const {
    snapshot,
    locale,
    maxRows,
    width = INSPECTOR_WIDTH,
    resizing = false,
    mouseInput,
  } = props
  const telemetry = snapshot.status.telemetry
  const queueCount = totalQueueCount(
    snapshot.status.queueCount,
    snapshot.status.remoteQueueCount,
  )
  const completedTodos = snapshot.status.todos.filter((todo) => todo.status === 'completed').length
  const hasActivity =
    snapshot.agent !== 'idle' ||
    telemetry.activity !== undefined ||
    snapshot.status.subagents?.running !== 0 ||
    queueCount > 0
  const hasContext =
    snapshot.status.tokens !== undefined ||
    telemetry.contextPercent !== undefined ||
    telemetry.cacheHitRate !== undefined ||
    telemetry.tps !== undefined ||
    telemetry.reasoningEffort !== undefined
  const hasFiles = snapshot.composer.attachments.length > 0
  const { scrollOffset, updateMetrics } = useInspectorScroll({
    sessionId: snapshot.header.sessionId,
    maxRows,
    mouseInput,
  })

  return (
    // A shell region, not a floating card: one dividing rule instead of a
    // rounded frame, which also returns two rows and two columns to content.
    <Box
      width={width}
      height={maxRows}
      flexShrink={0}
      flexDirection="column"
      borderStyle={PANEL_BORDER}
      borderColor={resizing ? theme.accent : theme.border}
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      paddingX={PANEL_PADDING_X}
      marginLeft={1}
      minHeight={0}
    >
      <Text color={theme.text} bold>
        <Text color={resizing ? theme.accent : theme.mute}>{glyphs.resizeMark}</Text>{' '}
        {capitalizeInitial(text(locale, 'inspector'))}
      </Text>
      <ScrollablePanel
        height={Math.max(1, maxRows - 1)}
        scrollOffset={scrollOffset}
        onMetricsChange={updateMetrics}
        upHint={locale === 'zh' ? '滚轮 / Alt+↑' : 'wheel / Alt+↑'}
        downHint={locale === 'zh' ? '滚轮 / Alt+↓' : 'wheel / Alt+↓'}
      >
        <Section title={text(locale, 'inspectorActivity')}>
          {hasActivity ? (
            <>
              <Line label={text(locale, 'inspectorStatus')} value={snapshot.status.line} color={theme.text} />
              {telemetry.activity !== undefined ? (
                <Line
                  label={telemetry.activity.phase || text(locale, 'inspectorActivity')}
                  value={telemetry.activity.line}
                  color={theme.accent}
                />
              ) : null}
              {snapshot.status.subagents?.running !== undefined &&
              snapshot.status.subagents.running > 0 ? (
                <Line
                  label={text(locale, 'inspectorAgents')}
                  value={String(snapshot.status.subagents.running)}
                  color={theme.accent}
                />
              ) : null}
              {queueCount > 0 ? (
                <Line
                  label={text(locale, 'inspectorQueue')}
                  value={String(queueCount)}
                  color={theme.accent}
                />
              ) : null}
            </>
          ) : (
            <Text color={theme.mute}>{text(locale, 'inspectorEmpty')}</Text>
          )}
        </Section>
        <Section title={text(locale, 'inspectorContext')}>
          {hasContext ? (
            <>
              {snapshot.status.tokens !== undefined ? (
                <Line
                  label={text(locale, 'inspectorTokens')}
                  value={`${snapshot.status.tokens.input} ${text(locale, 'tokensInShort')} · ${snapshot.status.tokens.output} ${text(locale, 'tokensOutShort')}`}
                />
              ) : null}
              {telemetry.contextPercent !== undefined ? (
                <Line label={text(locale, 'inspectorWindow')} value={`${formatMetric(telemetry.contextPercent)}%`} />
              ) : null}
              {telemetry.cacheHitRate !== undefined ? (
                <Line label={text(locale, 'inspectorCache')} value={`${formatMetric(telemetry.cacheHitRate)}%`} />
              ) : null}
              {telemetry.tps !== undefined ? (
                <Line label={text(locale, 'inspectorSpeed')} value={`${formatMetric(telemetry.tps)} t/s`} />
              ) : null}
              {telemetry.reasoningEffort !== undefined ? (
                <Line label={text(locale, 'inspectorReasoning')} value={telemetry.reasoningEffort} />
              ) : null}
            </>
          ) : (
            <Text color={theme.mute}>{text(locale, 'inspectorEmpty')}</Text>
          )}
        </Section>
        <Section title={text(locale, 'inspectorFiles')}>
          <Line label={text(locale, 'inspectorCwd')} value={snapshot.header.cwd} />
          {hasFiles ? (
            snapshot.composer.attachments.map((path) => (
              <Text key={path} color={theme.text} wrap="truncate-start">
                @ {path}
              </Text>
            ))
          ) : (
            <Text color={theme.mute}>{text(locale, 'inspectorNoAttachments')}</Text>
          )}
        </Section>
        <Section title={text(locale, 'inspectorSession')}>
          <Line label={text(locale, 'inspectorModel')} value={snapshot.header.model} />
          <Line label={text(locale, 'inspectorId')} value={snapshot.header.sessionId.slice(0, 8)} />
          {snapshot.status.sessionTitle !== undefined ? (
            <Line label={text(locale, 'inspectorTitle')} value={snapshot.status.sessionTitle} />
          ) : null}
          {snapshot.status.goal !== undefined ? (
            <>
              <Line label={text(locale, 'inspectorGoal')} value={snapshot.status.goal.phase} />
              <Text color={theme.text} wrap="truncate-end">
                {snapshot.status.goal.objective}
              </Text>
            </>
          ) : null}
          {snapshot.status.todos.length > 0 ? (
            <Line
              label={text(locale, 'inspectorTodos')}
              value={`${completedTodos}/${snapshot.status.todos.length}`}
            />
          ) : null}
          {snapshot.status.agentPreset !== undefined ? (
            <Line label={text(locale, 'inspectorPreset')} value={snapshot.status.agentPreset} />
          ) : null}
        </Section>
        <Section title={text(locale, 'inspectorRuntime')}>
          <Line
            label={text(locale, 'inspectorRuntimeName')}
            value={snapshot.runtimeInfo.name || text(locale, 'inspectorUnavailable')}
            color={snapshot.runtimeInfo.name === '' ? theme.mute : theme.text}
          />
          <Line
            label={text(locale, 'inspectorMcp')}
            value={
              snapshot.runtimeInfo.mcp.status === 'connected'
                ? `${text(locale, 'inspectorAvailable')} · ${snapshot.runtimeInfo.mcp.name ?? ''}`
                : snapshot.runtimeInfo.mcp.status === 'unknown'
                ? text(locale, 'inspectorNotReported')
                : text(locale, 'inspectorUnavailable')
            }
            color={snapshot.runtimeInfo.mcp.status === 'connected' ? theme.success : theme.mute}
          />
          <Line
            label={text(locale, 'inspectorCapabilitySource')}
            value={snapshot.runtimeInfo.capabilitySource}
          />
        </Section>
        <Section title={text(locale, 'inspectorShortcuts')}>
          <Shortcut text={text(locale, 'footerScroll')} />
          <Shortcut text={text(locale, 'footerMessages')} />
          <Shortcut text={text(locale, 'footerMenu')} />
          <Shortcut text={text(locale, 'footerDetails')} />
        </Section>
      </ScrollablePanel>
    </Box>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <Box flexDirection="column" marginTop={1} minHeight={0}>
      <Text color={theme.accent} bold>
        {capitalizeInitial(props.title)}
      </Text>
      {props.children}
    </Box>
  )
}

function Line(props: { label: string; value: string; color?: string }) {
  return (
    <Text color={props.color ?? theme.dim} wrap="truncate-end">
      {capitalizeInitial(props.label)}: {props.value}
    </Text>
  )
}

function Shortcut(props: { text: string }) {
  return (
    <Text color={theme.mute} wrap="truncate-end">
      {props.text}
    </Text>
  )
}

function capitalizeInitial(value: string): string {
  if (value.length === 0) return value
  return value[0].toUpperCase() + value.slice(1)
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
