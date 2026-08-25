import { Box, Text } from 'ink'
import { memo } from 'react'
import type { AssistantNode } from '../../runtime/nodes/types.ts'
import { Markdown, StreamingMarkdown } from './Markdown.tsx'
import { MessageRail } from './MessageRail.tsx'
import { glyphs } from '../glyphs.ts'
import { BLOCK_GAP, messageContentColumns } from '../layout.ts'
import { theme } from '../theme.ts'
import { useSpinnerFrame } from '../use-spinner.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import {
  assistantSelectionParts,
  localTextRange,
  type MessageTextRange,
} from '../message-text-selection.ts'
import { WrappedSelectableText } from './SelectableText.tsx'

/** Shift a range when a spinner prefixes streaming thinking. */
function shiftRange(
  selection: MessageTextRange | undefined,
  offset: number,
): MessageTextRange | undefined {
  if (selection === undefined || offset <= 0) return selection
  return { start: selection.start + offset, end: selection.end + offset }
}

// A streaming reply is republished as a new node per chunk, so memoising here
// only skips replies that have already settled.
export const AssistantRow = memo(function AssistantRow(props: {
  node: AssistantNode
  verbose: boolean
  locale: UiLocale
  maxColumns?: number
  selected?: boolean
  expandedLevel?: 0 | 1 | 2
  textSelection?: MessageTextRange
}) {
  const { node, verbose } = props
  const contentColumns = messageContentColumns(props.maxColumns)
  const parts = assistantSelectionParts(node, {
    verbose,
    expandedLevel: props.expandedLevel,
  })
  const reasoning = parts.reasoning
  const reasoningLength = reasoning?.length ?? 0
  const bodyStart = reasoningLength === 0 ? 0 : reasoningLength + 1
  const reasoningSelection = localTextRange(
    props.textSelection,
    0,
    reasoningLength,
  )
  const bodySelection = localTextRange(
    props.textSelection,
    bodyStart,
    parts.body.length,
  )
  const thinkingActive =
    node.streaming && node.thinking !== false && node.text === ''
  const spinner = useSpinnerFrame(glyphs.spinner, thinkingActive)
  // The rail is the only always-visible signal that a reply is still arriving,
  // so streaming tints the line rather than adding a row of metadata.
  const railColor =
    props.selected === true || node.streaming ? theme.accent : theme.mute
  return (
    <MessageRail
      color={railColor}
      emphasis={props.selected === true}
      width={props.maxColumns}
    >
      {reasoning !== undefined ? (
        <Box
          flexDirection="column"
          flexShrink={0}
          marginBottom={node.text !== '' ? BLOCK_GAP : 0}
        >
          <WrappedSelectableText
            color={theme.mute}
            italic
            columns={contentColumns ?? 80}
            text={thinkingActive ? `${spinner} ${reasoning}` : reasoning}
            selection={
              thinkingActive
                ? shiftRange(reasoningSelection, `${spinner} `.length)
                : reasoningSelection
            }
          />
        </Box>
      ) : thinkingActive ? (
        <Text color={theme.accent} italic>
          {spinner} {text(props.locale, 'agentThinking')}
        </Text>
      ) : null}
      {node.text !== '' ? (
        <Box flexDirection="column" flexShrink={0}>
          {node.streaming ? (
            <StreamingMarkdown
              text={node.text}
              maxColumns={contentColumns}
              selection={bodySelection}
            />
          ) : (
            <Markdown
              text={node.text}
              maxColumns={contentColumns}
              selection={bodySelection}
            />
          )}
        </Box>
      ) : null}
      {node.interrupted === true ? (
        <Text color={theme.mute}>{text(props.locale, 'assistantInterrupted')}</Text>
      ) : null}
    </MessageRail>
  )
})
