import stringWidth from 'string-width'
import { graphemeSegments, normalizeGraphemeOffset } from '../runtime/grapheme.ts'
import { readableNodeText } from '../runtime/clipboard.ts'
import type { AssistantNode, ConversationNode } from '../runtime/nodes/types.ts'
import { nodeKey } from '../runtime/nodes/types.ts'
import { BLOCK_GAP, MESSAGE_CHROME, messageContentColumns } from './layout.ts'
import { formatToolSummaryLine } from './tool-display.ts'
import { formatReasoning } from './text-format.ts'
import { wrapPlainText } from './text-wrap.ts'
import { layoutMarkdownSource } from './markdown-layout.ts'
import { nodeAttached } from './visible-tail.ts'
import { measureTranscript } from './transcript-layout.ts'

export type MessageTextPoint = {
  nodeKey: string
  offset: number
}

export type MessageTextSelection = {
  anchor: MessageTextPoint
  focus: MessageTextPoint
}

export type MessageTextRange = {
  start: number
  end: number
}

export type MessageTextView = {
  verbose?: boolean
  expandedNodeIds?: ReadonlySet<string>
  locale?: 'en' | 'zh'
  maxColumns?: number
}

type TextLine = {
  start: number
  end: number
  indent?: number
  visual?: string
  sourceMap?: readonly number[]
  sourceEnd?: number
}

/** Convert a 1-based SGR column to the message body cell. */
export function contentColumnFromMouseX(x: number): number {
  return Math.trunc(x) - 1 - MESSAGE_CHROME
}

/** Visible text a drag can land on, including thinking when it is shown. */
export function selectableNodeText(node: ConversationNode, view: MessageTextView = {}): string {
  if (node.kind === 'tool') {
    return formatToolSummaryLine(node, view.locale ?? 'en', view.maxColumns ?? 80)
  }
  if (node.kind === 'command') {
    const title = node.name === null ? 'command' : `/${node.name}`
    const summary = node.outcome?.text ?? (node.outcome === null ? 'running' : node.outcome.kind)
    return `${title} · ${summary}`
  }
  if (node.kind !== 'assistant') return readableNodeText(node)
  const parts = assistantSelectionParts(node, viewFor(node, view))
  if (parts.reasoning !== undefined && parts.body !== '') {
    return `${parts.reasoning}\n${parts.body}`
  }
  return parts.reasoning ?? parts.body
}

export function assistantSelectionParts(node: AssistantNode, options: { verbose: boolean; expandedLevel?: 0 | 1 | 2 }): { reasoning: string | undefined; body: string } {
  return {
    reasoning: formatReasoning(node.reasoning, options.verbose, node.streaming && node.thinking !== false, node.thinkingDurationMs, options.expandedLevel ?? (options.verbose ? 2 : 0)),
    body: node.text,
  }
}

/** Map a node-local range onto one visible slice of that node. */
export function localTextRange(selection: MessageTextRange | undefined, sourceStart: number, length: number): MessageTextRange | undefined {
  if (selection === undefined || length <= 0) return undefined
  const sourceEnd = sourceStart + length
  const start = Math.max(selection.start, sourceStart)
  const end = Math.min(selection.end, sourceEnd)
  return start < end ? { start: start - sourceStart, end: end - sourceStart } : undefined
}

/** Return the selected substring across an inclusive message range. */
export function selectedMessageText(nodes: readonly ConversationNode[], selection: MessageTextSelection | undefined, view: MessageTextView = {}): string {
  const ordered = orderedSelection(nodes, selection, view)
  if (ordered === undefined) return ''
  const { startIndex, startOffset, endIndex, endOffset } = ordered
  const startNode = nodes[startIndex]
  if (startNode === undefined) return ''
  if (startIndex === endIndex) {
    return selectableNodeText(startNode, view).slice(startOffset, endOffset)
  }
  const values: string[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    const node = nodes[index]
    if (node === undefined) continue
    const value = selectableNodeText(node, view)
    if (index === startIndex) values.push(value.slice(startOffset))
    else if (index === endIndex) values.push(value.slice(0, endOffset))
    else values.push(value)
  }
  return values.join('\n\n')
}

/** Return the local text range selected in one message, if any. */
export function textRangeForMessage(nodes: readonly ConversationNode[], selection: MessageTextSelection | undefined, key: string, view: MessageTextView = {}): MessageTextRange | undefined {
  const ordered = orderedSelection(nodes, selection, view)
  if (ordered === undefined) return undefined
  const index = nodes.findIndex((node) => nodeKey(node.kind, node.id) === key)
  if (index < 0 || index < ordered.startIndex || index > ordered.endIndex) return undefined
  const node = nodes[index]
  if (node === undefined) return undefined
  const text = selectableNodeText(node, view)
  const start = index === ordered.startIndex ? ordered.startOffset : 0
  const end = index === ordered.endIndex ? ordered.endOffset : text.length
  return start < end ? { start, end } : undefined
}

/** Resolve a mouse cell to a grapheme-safe point in the visible transcript. */
export function textPointAtViewportRow(options: { nodes: readonly ConversationNode[]; maxRows: number; viewportRow: number; cellColumn: number; verbose?: boolean; expandedNodeIds?: ReadonlySet<string>; scrollOffset?: number; maxColumns?: number; locale?: 'en' | 'zh' }): MessageTextPoint | undefined {
  const verbose = options.verbose ?? false
  const expandedNodeIds = options.expandedNodeIds
  const view: MessageTextView = {
    verbose,
    expandedNodeIds,
    locale: options.locale,
    maxColumns: options.maxColumns,
  }
  const layout = measureTranscript({
    nodes: options.nodes,
    maxRows: options.maxRows,
    verbose,
    expandedNodeIds,
    maxColumns: options.maxColumns,
    scrollOffset: options.scrollOffset,
  })
  const window = layout.window
  const columns = messageContentColumns(options.maxColumns) ?? 80
  let rowStart = -window.hiddenRowsBefore
  const startIndex = window.startIndex
  for (let offset = 0; offset < window.nodes.length; offset += 1) {
    const node = window.nodes[offset]
    if (node === undefined) continue
    const key = nodeKey(node.kind, node.id)
    const attached = nodeAttached(options.nodes, startIndex + offset)
    const nodeRows = layout.rows[startIndex + offset] ?? 0
    if (options.viewportRow >= rowStart && options.viewportRow < rowStart + nodeRows) {
      const text = selectableNodeText(node, view)
      if (text === '') return undefined
      const lines = layoutNodeText(node, view, columns)
      const textRow = options.viewportRow - rowStart - leadingChromeRows(attached)
      if (textRow < 0) return { nodeKey: key, offset: 0 }
      const line = lines[Math.min(textRow, lines.length - 1)]
      if (line === undefined) return { nodeKey: key, offset: text.length }
      return {
        nodeKey: key,
        offset: offsetAtCell(text, line, options.cellColumn),
      }
    }
    rowStart += nodeRows
  }
  return undefined
}

function viewFor(node: ConversationNode, view: MessageTextView): { verbose: boolean; expandedLevel?: 0 | 1 | 2 } {
  const expanded = view.expandedNodeIds?.has(nodeKey(node.kind, node.id)) === true
  return { verbose: view.verbose === true || expanded }
}

function leadingChromeRows(attached: boolean): number {
  return attached ? 0 : BLOCK_GAP
}

function layoutNodeText(node: ConversationNode, view: MessageTextView, columns: number): TextLine[] {
  if (node.kind === 'tool') {
    const text = selectableNodeText(node, view)
    return [{ start: 0, end: text.length }]
  }
  if (node.kind !== 'assistant') {
    return wrapPlainText(selectableNodeText(node, view), columns)
  }
  const parts = assistantSelectionParts(node, viewFor(node, view))
  const lines: TextLine[] = []
  if (parts.reasoning !== undefined && parts.reasoning !== '') {
    lines.push(...wrapPlainText(parts.reasoning, columns))
    if (parts.body !== '') {
      lines.push({
        start: parts.reasoning.length,
        end: parts.reasoning.length,
      })
    }
  }
  if (parts.body !== '') {
    const bodyStart = parts.reasoning ? parts.reasoning.length + 1 : 0
    for (const line of layoutMarkdownSource(parts.body, columns)) {
      lines.push({
        start: line.start + bodyStart,
        end: line.end + bodyStart,
        ...(line.indent !== undefined ? { indent: line.indent } : {}),
        ...(line.visual !== undefined ? { visual: line.visual } : {}),
        ...(line.sourceMap !== undefined ? { sourceMap: line.sourceMap.map((value) => value + bodyStart) } : {}),
        ...(line.sourceEnd !== undefined ? { sourceEnd: line.sourceEnd + bodyStart } : {}),
      })
    }
  }
  return lines.length === 0 ? [{ start: 0, end: 0 }] : lines
}

function orderedSelection(
  nodes: readonly ConversationNode[],
  selection: MessageTextSelection | undefined,
  view: MessageTextView,
):
  | {
      startIndex: number
      startOffset: number
      endIndex: number
      endOffset: number
    }
  | undefined {
  if (selection === undefined) return undefined
  const anchorIndex = nodes.findIndex((node) => nodeKey(node.kind, node.id) === selection.anchor.nodeKey)
  const focusIndex = nodes.findIndex((node) => nodeKey(node.kind, node.id) === selection.focus.nodeKey)
  if (anchorIndex < 0 || focusIndex < 0) return undefined
  const anchorNode = nodes[anchorIndex]
  const focusNode = nodes[focusIndex]
  if (anchorNode === undefined || focusNode === undefined) return undefined
  const anchorText = selectableNodeText(anchorNode, view)
  const focusText = selectableNodeText(focusNode, view)
  const anchorOffset = normalizeGraphemeOffset(anchorText, selection.anchor.offset)
  const focusOffset = normalizeGraphemeOffset(focusText, selection.focus.offset)
  if (anchorIndex < focusIndex || (anchorIndex === focusIndex && anchorOffset <= focusOffset)) {
    return {
      startIndex: anchorIndex,
      startOffset: anchorOffset,
      endIndex: focusIndex,
      endOffset: focusOffset,
    }
  }
  return {
    startIndex: focusIndex,
    startOffset: focusOffset,
    endIndex: anchorIndex,
    endOffset: anchorOffset,
  }
}

function offsetAtCell(text: string, line: TextLine, cellColumn: number): number {
  const target = Math.max(0, Math.trunc(cellColumn) - (line.indent ?? 0))
  if (line.visual !== undefined && line.sourceMap !== undefined) {
    let width = 0
    for (const entry of graphemeSegments(line.visual)) {
      const entryWidth = stringWidth(entry.segment)
      if (target < width + Math.max(1, entryWidth) / 2) {
        return line.sourceMap[entry.index] ?? line.start
      }
      width += entryWidth
    }
    return line.sourceEnd ?? line.end
  }
  let width = 0
  for (const entry of graphemeSegments(text.slice(line.start, line.end))) {
    const entryWidth = stringWidth(entry.segment)
    if (target < width + Math.max(1, entryWidth) / 2) {
      return line.start + entry.index
    }
    width += entryWidth
  }
  return line.end
}
