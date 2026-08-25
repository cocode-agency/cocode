/**
 * Conversation Node contract. Assembler never switches on event.type.
 */

import type { SessionEvent } from '@cocode/tui-connection'
import type { DiffSummary } from '../diff-summary.ts'

export type NodeMatch = { id: string; role: 'start' | 'update' }

export type NodeDefinition<State = unknown> = {
  kind: string
  fallback?: boolean
  match(event: SessionEvent): NodeMatch | null
  start(event: SessionEvent): State
  update(state: State, event: SessionEvent): State
  isComplete?(state: State): boolean
  settle?(state: State, boundary?: SessionEvent): State
  buildViewNode(ctx: {
    kind: string
    id: string
    startSeq: number
    state: State
  }): ConversationNode | null
}

export type ConversationNode = UserNode | ContextNode | AssistantNode | ToolNode | NoticeNode

export type UserNode = {
  kind: 'user'
  id: string
  seq: number
  time: number
  text: string
}

export type ContextSection = {
  name: string
  text: string
}

/** Model-facing context injected by the runtime rather than typed by the user. */
export type ContextNode = {
  kind: 'context'
  id: string
  seq: number
  time: number
  text: string
  source: unknown
  provenance: {
    role: 'inject' | 'recall'
    label?: string
  }
  form?: string
  sections: readonly ContextSection[]
}

export type AssistantNode = {
  kind: 'assistant'
  id: string
  seq: number
  time: number
  turn: number
  step: number
  text: string
  reasoning: string
  streaming: boolean
  /** The Host finalized this visible prefix because the turn was interrupted. */
  interrupted?: boolean
  /** Whether the assistant is still in its reasoning phase. */
  thinking?: boolean
  /** Internal event-clock start used while assembling the node. */
  thinkingStartedAt?: number
  /** Event-clock duration spent in reasoning before answer/tool output began. */
  thinkingDurationMs?: number
  usage?: { input: number; output: number }
}

export type ToolNode = {
  kind: 'tool'
  id: string
  seq: number
  time: number
  callId: string
  name: string
  args: string
  status: 'running' | 'success' | 'error' | 'cancelled'
  streaming?: boolean
  view?: ToolView
  result?: string
  error?: { name: string; code: string }
}

export type ToolView =
  | { kind: 'read'; path?: string }
  | { kind: 'search'; query?: string }
  | { kind: 'diff'; paths?: readonly string[]; summary?: DiffSummary }
  | { kind: 'terminal'; command?: string }

export type NoticeNode = {
  kind: 'notice'
  id: string
  seq: number
  time: number
  tone: 'info' | 'error'
  message: string
  verboseOnly?: boolean
}

export function nodeKey(kind: string, id: string): string {
  return `${kind}:${id}`
}
