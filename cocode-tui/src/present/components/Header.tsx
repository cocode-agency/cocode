import { Box, Text } from 'ink'
import type { TuiSnapshot } from '../../runtime/app-contracts.ts'
import { workspaceName, workspacePath } from '../../runtime/workspace.ts'
import { glyphs } from '../glyphs.ts'
import { theme } from '../theme.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { compactColumns } from '../panel-layout.ts'
import { totalQueueCount } from '../../runtime/queue-view.ts'

type HeaderData = Partial<TuiSnapshot['header']> & {
  sessionId: string
  cwd: string
  branch?: string
}

/**
 * Metrics are padded to a fixed width. They live at the right edge, so any
 * change in their length shifts the whole meta run and squeezes the workspace
 * name — the terminal equivalent of the design system's `tabular-nums` rule.
 */
const CONTEXT_WIDTH = 4
const COUNT_WIDTH = 4

export function Header(props: {
  header: HeaderData
  locale: UiLocale
  columns?: number
  status?: Pick<TuiSnapshot['status'], 'tokens' | 'telemetry' | 'queueCount' | 'remoteQueueCount'>
}) {
  const { header } = props
  const session = header.sessionId.slice(0, 8)
  const density = compactColumns(props.columns)
  const compact = density !== 'wide'
  const wide = density === 'wide'
  const workspace = wide ? workspacePath(header.cwd) : workspaceName(header.cwd)
  const model = header.model ?? ''
  const context = props.status?.telemetry.contextPercent
  const tokens = props.status?.tokens
  const queueCount = totalQueueCount(props.status?.queueCount ?? 0, props.status?.remoteQueueCount ?? 0)
  const meta = wide
    ? [
        model === '' ? undefined : `${header.provider ?? ''}/${model}`,
        context === undefined
          ? undefined
          : `ctx ${formatMetric(context).padStart(CONTEXT_WIDTH)}%`,
        tokens === undefined
          ? undefined
          : `${formatCount(tokens.input)}/${formatCount(tokens.output)}`,
        queueCount > 0
          ? `queue ${String(queueCount)}`
          : undefined,
      ].filter((value): value is string => value !== undefined && value !== '').join(' · ')
    : ''
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      <Box width="100%" justifyContent="space-between">
        <Box gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={theme.text} wrap="truncate-end">
            {workspace}
          </Text>
          {!compact && header.branch ? (
            <>
              <Text color={theme.mute}>·</Text>
              <Text color={theme.dim} wrap="truncate-end">
                #{header.branch}
              </Text>
            </>
          ) : null}
        </Box>
        <Box flexShrink={0}>
          {meta !== '' ? (
            <Text color={theme.dim} wrap="truncate-start">
              {meta} ·{' '}
            </Text>
          ) : null}
          <Text color={theme.mute} wrap="truncate-start">
            {header.source === 'shared-dsh'
              ? header.readOnly
                ? 'shared DSH · read-only · '
                : 'shared DSH · '
              : ''}
            {text(props.locale, 'session')} {session}
            {glyphs.chevronDown}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** Compact units keep a growing counter from widening the meta run. */
function formatCount(value: number): string {
  const compact =
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}m`
      : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}k`
      : String(value)
  return compact.padStart(COUNT_WIDTH)
}
