/**
 * Estimate rendered rows and keep the newest nodes within a row budget.
 */

import type { ConversationNode } from '../runtime/nodes/types.ts'
import { nodeKey } from '../runtime/nodes/types.ts'
import { formatReasoning, formatToolResult } from './text-format.ts'
import {
  extractPartialJsonStringArgument,
  truncatePlanProgress,
} from '../runtime/nodes/tool-view.ts'
import { BLOCK_GAP, BODY_INDENT, MESSAGE_CHROME } from './layout.ts'
import { countMarkdownRows } from './markdown-layout.ts'
import { countWrappedRows } from './text-wrap.ts'

export function visibleTail(
  nodes: readonly ConversationNode[],
  maxRows: number,
  verbose = false,
  expandedNodeIds: ReadonlySet<string> = EMPTY_EXPANDED_NODES,
): readonly ConversationNode[] {
  const budget = Math.max(0, Math.trunc(maxRows))
  if (budget === 0 || nodes.length === 0) return []

  let used = 0
  let start = nodes.length
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node === undefined) continue
    const rows = estimateNodeRows(
      node,
      verbose,
      expandedNodeIds.has(nodeKey(node.kind, node.id)),
      undefined,
      nodeAttached(nodes, index),
    )
    if (rows === 0) {
      start = index
      continue
    }
    if (used > 0 && used + rows > budget) break
    used += rows
    start = index
    if (used >= budget) break
  }
  return nodes.slice(start).filter(
    (node) => estimateNodeRows(
      node,
      verbose,
      expandedNodeIds.has(nodeKey(node.kind, node.id)),
    ) > 0,
  )
}

export function nodeAttached(
  nodes: readonly ConversationNode[],
  index: number,
): boolean {
  const node = nodes[index]
  const previous = nodes[index - 1]
  return node?.kind === 'tool' && isRailedKind(previous?.kind)
}

export function estimateNodeRows(
  node: ConversationNode,
  verbose = false,
  expanded = false,
  maxColumns?: number,
  attached = false,
): number {
  const detailed = verbose || expanded
  switch (node.kind) {
    case 'user':
      return BLOCK_GAP + Math.max(1, countWrappedRows(node.text, contentColumns(maxColumns, MESSAGE_CHROME)))
    case 'context': {
      if (!detailed) return 0
      if (!expanded && verbose) return 2
      const columns = contentColumns(maxColumns, MESSAGE_CHROME)
      if (node.sections.length === 0) return 2 + countWrappedRows(node.text, columns)
      return 2 + node.sections.reduce(
        (rows, section, index) =>
          rows + Number(index > 0) + 1 + countWrappedRows(section.text, columns),
        0,
      )
    }
    case 'assistant': {
      const reasoning = formatReasoning(
        node.reasoning,
        detailed,
        node.streaming && node.thinking !== false,
        node.thinkingDurationMs,
      )
      const columns = contentColumns(maxColumns, MESSAGE_CHROME)
      const thinkingIndicator =
        node.streaming && node.thinking !== false && node.text === '' && reasoning === undefined ? 1 : 0
      const thinkingRows =
        countWrappedRows(reasoning, columns) + thinkingIndicator
      const bodyRows = countMarkdownRows(node.text, columns)
      const thinkingGap = thinkingRows > 0 && bodyRows > 0 ? BLOCK_GAP : 0
      return BLOCK_GAP + thinkingRows + thinkingGap + bodyRows
    }
    case 'tool': {
      const result = formatToolResult(node.result, detailed)
      const toolName = node.name.trim() === '' ? 'tool' : node.name
      const plan =
        toolName === 'exit_plan_mode'
          ? extractPartialJsonStringArgument(node.args, 'plan')
          : undefined
      const planRows =
        plan === undefined
          ? 0
          : countWrappedRows(
              truncatePlanProgress(plan),
              contentColumns(maxColumns, MESSAGE_CHROME + BODY_INDENT),
            ) + 1
      const questionRows =
        toolName === 'ask_user_question' && node.status === 'running'
          ? 1 +
            (extractPartialJsonStringArgument(node.args, 'question') ===
            undefined
              ? 0
              : 1)
          : 0
      const gap = attached ? 0 : BLOCK_GAP
      if (!detailed) return gap + 1 + planRows + questionRows
      const columns = contentColumns(maxColumns, MESSAGE_CHROME)
      return (
        gap +
        1 +
        planRows +
        questionRows +
        countWrappedRows(node.args, columns) +
        countWrappedRows(result, columns) +
        (node.error === undefined ? 0 : 1)
      )
    }
    case 'command': {
      const title = node.name === null ? 'command' : `/${node.name}`
      const summary = node.outcome?.text ?? (node.outcome === null ? 'running' : node.outcome.kind)
      const gap = BLOCK_GAP
      if (!detailed) return gap + countWrappedRows(`${title} · ${summary}`, maxColumns)
      const columns = maxColumns
      const argsRows = node.args === null ? 0 : countWrappedRows(node.args.trim(), columns)
      const outcomeRows =
        node.outcome?.text === undefined || node.outcome.text === summary
          ? 0
          : countWrappedRows(node.outcome.text, columns)
      return gap + countWrappedRows(`${title} · ${summary}`, columns) + argsRows + outcomeRows
    }
    case 'notice':
      if (node.verboseOnly === true && !verbose) return 0
      return 1 + countWrappedRows(node.message, maxColumns)
  }
}

const EMPTY_EXPANDED_NODES: ReadonlySet<string> = new Set()

function isRailedKind(kind: string | undefined): boolean {
  return kind === 'user' || kind === 'assistant' || kind === 'tool'
}

function contentColumns(maxColumns: number | undefined, chromeColumns: number): number | undefined {
  return maxColumns === undefined ? undefined : Math.max(1, maxColumns - chromeColumns)
}
