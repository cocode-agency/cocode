import { Box, Text, useCursor } from 'ink'
import type { TuiSnapshot } from '../../runtime/app-contracts.ts'
import { formatFileMention } from '../../runtime/file-mentions.ts'
import { isAppleTerminalEnvironment } from '../../runtime/platform.ts'
import {
  clipComposerRow,
  composerCursorStyle,
  composerImeCaret,
  renderComposerRows,
  visibleComposerRows,
} from '../composer-layout.ts'
import { glyphs } from '../glyphs.ts'
import { theme } from '../theme.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import {
  COMPOSER_META_SEPARATOR,
  COMPOSER_ROUTE_SEPARATOR,
  composerHeaderLayout,
} from '../composer-header.ts'

export function Composer(props: {
  composer: TuiSnapshot['composer']
  agent: TuiSnapshot['agent']
  planMode: boolean
  planModeAvailable: boolean
  provider: string
  model: string
  reasoningEffort?: string
  locale: UiLocale
  maxRows?: number
  maxColumns?: number
  /** 0-based Ink row of the first composer input line. */
  inputRow?: number
}) {
  const { composer } = props
  const { setCursorPosition } = useCursor()
  const hardwareCaret = !composer.disabled && props.inputRow !== undefined
  const cursorStyle = composerCursorStyle(isAppleTerminalEnvironment(), composer.disabled)
  const empty = composer.text === ''
  const header = composerHeaderLayout({
    composer,
    agent: props.agent,
    planMode: props.planMode,
    planModeAvailable: props.planModeAvailable,
    locale: props.locale,
    provider: props.provider,
    model: props.model,
    reasoningEffort: props.reasoningEffort,
    columns: props.maxColumns,
  })
  const titleColor = !composer.mask && props.planMode ? theme.accent : theme.accent
  const rows = empty
    ? []
    : visibleComposerRows(
        renderComposerRows(composer.text, composer.cursor, composer.selection, {
          caretCell: !hardwareCaret,
        }),
        props.maxRows ?? 6,
      ).map((row) => clipComposerRow(row, Math.max(1, (props.maxColumns ?? 80) - 2)))
  const caret = composerImeCaret({
    text: composer.text,
    cursor: composer.cursor,
    selection: composer.selection,
    maxInputRows: props.maxRows ?? 6,
    maxColumns: props.maxColumns ?? 80,
  })
  // Ink's useCursor must be set during render so IME follows this frame's caret.
  setCursorPosition(
    composer.disabled || props.inputRow === undefined
      ? undefined
      : { x: caret.column, y: props.inputRow + caret.rowIndex },
  )
  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      {/* Native IME follows Ink's hardware cursor on the draft row. */}
      {composer.attachments.length > 0 ? (
        <Text color={theme.accent} wrap="truncate-end">
          {text(props.locale, 'attached')} ·{' '}
          {composer.attachments.map(formatFileMention).join(' · ')}
        </Text>
      ) : null}
      {composer.images.length > 0 ? (
        <Text color={theme.accent} wrap="truncate-end">
          image · {composer.images.map((image) => image.name).join(' · ')}
        </Text>
      ) : null}
      <Box width="100%" height={1} overflowY="hidden" justifyContent="space-between">
        <Box minWidth={0} flexShrink={1} height={1} overflowY="hidden">
          <Box flexShrink={0}>
            <Text color={composer.disabled ? theme.mute : titleColor} bold>
              {header.title}
            </Text>
          </Box>
          {header.showRoute ? (
            <>
              <Box flexShrink={0}>
                <Text color={theme.mute}>{COMPOSER_META_SEPARATOR}</Text>
              </Box>
              {!header.compact ? (
                <>
                  <Box flexShrink={0}>
                    <Text color={composer.disabled ? theme.mute : theme.dim}>
                      {props.provider}
                    </Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Text color={theme.mute}>{COMPOSER_ROUTE_SEPARATOR}</Text>
                  </Box>
                </>
              ) : null}
              <Box minWidth={0} flexShrink={1}>
                <Text
                  color={composer.disabled ? theme.mute : theme.accent}
                  underline={!composer.disabled}
                  wrap="truncate-end"
                >
                  {header.modelLabel ?? props.model}
                </Text>
              </Box>
            </>
          ) : null}
        </Box>
        {header.hint === '' ? null : (
          <Text color={theme.mute} wrap="truncate-end">
            {header.hint}
          </Text>
        )}
      </Box>
      <Box flexDirection="column">
        {empty ? (
          <Box width="100%" height={1} overflowY="hidden">
            <Text color={composer.disabled ? theme.mute : theme.accent}>{'> '}</Text>
            <Text color={theme.mute} wrap="truncate-end">
              {composer.placeholder}
            </Text>
          </Box>
        ) : (
          rows.map((row, index) => (
            <Box key={index} width="100%" height={1} overflowY="hidden">
              <Text color={composer.disabled ? theme.mute : theme.accent}>
                {index === 0 ? '> ' : `${glyphs.rail} `}
              </Text>
              {row.spans.map((span, spanIndex) => (
                <Text
                  key={`${spanIndex}:${span.text}`}
                  inverse={!hardwareCaret && cursorStyle.inverse && span.cursor === true}
                  underline={!hardwareCaret && cursorStyle.underline && span.cursor === true}
                  color={composer.disabled ? theme.mute : theme.text}
                  backgroundColor={
                    !composer.disabled && span.selected === true ? theme.border : undefined
                  }
                >
                  {span.text}
                </Text>
              ))}
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}
