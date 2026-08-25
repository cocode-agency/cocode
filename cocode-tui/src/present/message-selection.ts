import type { ConversationNode } from '../runtime/nodes/types.ts'
import { nodeKey } from '../runtime/nodes/types.ts'

export function selectableMessageKeys(nodes: readonly ConversationNode[]): string[] {
  return nodes.map((node) => nodeKey(node.kind, node.id))
}

export function messageSupportsDetails(node: ConversationNode): boolean {
  switch (node.kind) {
    case 'assistant':
      return !node.streaming && node.reasoning.trim() !== ''
    case 'tool': {
      const interactiveRendererOwnsArgs =
        node.name === 'exit_plan_mode' ||
        (node.name === 'ask_user_question' && node.status === 'running')
      return (
        (!interactiveRendererOwnsArgs && node.args.trim() !== '') ||
        (node.result !== undefined && node.result.trim() !== '') ||
        node.error !== undefined ||
        node.view?.kind === 'diff'
      )
    }
    case 'context':
      return node.text.trim() !== '' || node.sections.length > 0
    case 'command':
      return node.args?.trim() !== '' || node.outcome?.text !== undefined
    case 'user':
    case 'notice':
      return false
  }
}

export function toggleMessageDetails(
  nodes: readonly ConversationNode[],
  selectedKey: string | null,
  expandedKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  if (selectedKey === null) return expandedKeys
  const selected = nodes.find((node) => nodeKey(node.kind, node.id) === selectedKey)
  if (selected === undefined || !messageSupportsDetails(selected)) return expandedKeys
  const next = new Set(expandedKeys)
  if (next.has(selectedKey)) next.delete(selectedKey)
  else next.add(selectedKey)
  return next
}

export function pruneExpandedMessageKeys(
  expandedKeys: ReadonlySet<string>,
  nodes: readonly ConversationNode[],
): ReadonlySet<string> {
  if (expandedKeys.size === 0) return expandedKeys
  const liveKeys = new Set(nodes.map((node) => nodeKey(node.kind, node.id)))
  const next = new Set([...expandedKeys].filter((key) => liveKeys.has(key)))
  return next.size === expandedKeys.size ? expandedKeys : next
}

export function moveMessageSelection(
  keys: readonly string[],
  current: string | null,
  delta: number,
): string | null {
  if (keys.length === 0) return null
  const currentIndex = current === null ? keys.length - 1 : keys.indexOf(current)
  const safeIndex = currentIndex < 0 ? keys.length - 1 : currentIndex
  const nextIndex = Math.max(0, Math.min(keys.length - 1, safeIndex + delta))
  return keys[nextIndex] ?? null
}
