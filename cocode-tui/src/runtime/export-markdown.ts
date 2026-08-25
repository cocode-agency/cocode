/** Convert projected conversation nodes into a stable Markdown export. */

import type { AssistantNode, ConversationNode, ToolNode } from './nodes/types.ts'

export function nodesToMarkdown(
  nodes: readonly ConversationNode[],
  options: { includeReasoning?: boolean } = {},
): string {
  const sections = ['# Cocode Session']
  for (const node of nodes) {
    if (node.kind === 'user') {
      sections.push('## User', node.text)
    } else if (node.kind === 'assistant') {
      sections.push('## Assistant', assistantText(node, options.includeReasoning === true))
    } else if (node.kind === 'tool') {
      sections.push(toolText(node))
    } else if (node.kind === 'command') {
      sections.push(commandText(node))
    }
  }
  return `${sections.join('\n\n').trimEnd()}\n`
}

function assistantText(node: AssistantNode, includeReasoning: boolean): string {
  if (!includeReasoning || node.reasoning === '') return node.text
  if (node.text === '') return `> Reasoning\n\n${node.reasoning}`
  return `${node.text}\n\n> Reasoning\n\n${node.reasoning}`
}

function toolText(node: ToolNode): string {
  const sections = [`### Tool: ${node.name} (${node.status})`]
  if (node.args !== '') sections.push(fenced(node.args))
  if (node.result !== undefined) sections.push(fenced(node.result))
  if (node.error !== undefined) {
    sections.push(`Error: ${node.error.name} (${node.error.code})`)
  }
  return sections.join('\n\n')
}

function commandText(node: Extract<ConversationNode, { kind: 'command' }>): string {
  const title = node.name === null ? 'command' : `/${node.name}`
  const state = node.outcome === null ? 'running' : node.outcome.kind
  const sections = [`### Command: ${title} (${state})`]
  if (node.args !== null && node.args.trim() !== '') sections.push(fenced(node.args))
  if (node.outcome?.text !== undefined && node.outcome.text !== '') sections.push(node.outcome.text)
  return sections.join('\n\n')
}

function fenced(text: string): string {
  const longest = Math.max(...[...text.matchAll(/`+/g)].map((match) => match[0].length), 0)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${text}\n${fence}`
}
