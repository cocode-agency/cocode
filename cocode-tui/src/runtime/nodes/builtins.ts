/**
 * Built-in Definitions. Type checks live only in match().
 */

import type { SessionEvent } from '@cocode/tui-connection'
import { asNumber, asString, blocksToText, isRecord, reasoningToText } from '../text.ts'
import type {
  AssistantNode,
  CommandNode,
  ContextNode,
  ContextSection,
  NodeDefinition,
  NoticeNode,
  ToolNode,
  UserNode,
} from './types.ts'
import { NodeRegistry } from './registry.ts'
import { inferToolView } from './tool-view.ts'
import { parseDiffSummary } from '../diff-summary.ts'

export function createBuiltinRegistry(): NodeRegistry {
  const registry = new NodeRegistry()
  registry.register(contextDefinition)
  registry.register(userDefinition)
  registry.register(toolDefinition)
  registry.register(assistantDefinition)
  registry.register(commandDefinition)
  registry.register(fallbackDefinition)
  return registry
}

const userDefinition: NodeDefinition<UserNode> = {
  kind: 'user',
  match(event) {
    if (event.type !== 'user/message') return null
    const data = isRecord(event.data) ? event.data : {}
    const source = isRecord(data.source) ? data.source : undefined
    if (source !== undefined && source.kind !== 'user') return null
    const id = asString(data.id, String(event.seq))
    return { id, role: 'start' }
  },
  start(event) {
    const data = isRecord(event.data) ? event.data : {}
    return {
      kind: 'user',
      id: asString(data.id, String(event.seq)),
      seq: event.seq,
      time: event.time,
      text: userDisplayText(data),
    }
  },
  update(state) {
    return state
  },
  isComplete() {
    return true
  },
  buildViewNode(ctx) {
    return ctx.state
  },
}

function userDisplayText(data: Record<string, unknown>): string {
  return blocksToText(data.content)
}

const contextDefinition: NodeDefinition<ContextNode> = {
  kind: 'context',
  match(event) {
    if (event.type !== 'user/message') return null
    const data = isRecord(event.data) ? event.data : {}
    const source = isRecord(data.source) ? data.source : undefined
    // Older or foreign logs may omit source. Preserve their historical user
    // presentation; every declared non-user producer is injected context.
    if (source === undefined || source.kind === 'user') return null
    return { id: asString(data.id, String(event.seq)), role: 'start' }
  },
  start(event) {
    const data = isRecord(event.data) ? event.data : {}
    const source = isRecord(data.source) ? data.source : {}
    return {
      kind: 'context',
      id: asString(data.id, String(event.seq)),
      seq: event.seq,
      time: event.time,
      text: blocksToText(data.content),
      source: data.source,
      provenance: contextProvenance(source),
      form: optionalString(source.form),
      sections: contextSections(source.sections),
    }
  },
  update(state) {
    return state
  },
  isComplete() {
    return true
  },
  buildViewNode(ctx) {
    return ctx.state
  },
}

function contextProvenance(source: Record<string, unknown>): ContextNode['provenance'] {
  const kind = optionalString(source.kind)
  if (kind === 'session-reference') {
    return { role: 'recall', label: joinedFields(source.references, 'label') ?? kind }
  }
  if (kind === 'agent-instructions') {
    return { role: 'inject', label: joinedFields(source.changes, 'path') ?? kind }
  }
  if (kind === 'plugin') {
    return { role: 'inject', label: optionalString(source.plugin) ?? kind }
  }
  if (kind === 'skill-invocation') {
    return { role: 'inject', label: optionalString(source.name) ?? kind }
  }
  return { role: 'inject', ...(kind === undefined ? {} : { label: kind }) }
}

function joinedFields(value: unknown, field: string): string | undefined {
  if (!Array.isArray(value)) return undefined
  const values: string[] = []
  for (const item of value) {
    const record = isRecord(item) ? item : undefined
    const entry = record === undefined ? undefined : optionalString(record[field])
    if (entry !== undefined && !values.includes(entry)) values.push(entry)
  }
  return values.length === 0 ? undefined : values.join(', ')
}

function contextSections(value: unknown): ContextSection[] {
  if (!Array.isArray(value)) return []
  const sections: ContextSection[] = []
  for (const item of value) {
    const record = isRecord(item) ? item : undefined
    const name = record === undefined ? undefined : optionalString(record.name)
    const text = record === undefined ? undefined : optionalString(record.text)
    if (name !== undefined && text !== undefined) sections.push({ name, text })
  }
  return sections
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

const assistantDefinition: NodeDefinition<AssistantNode> = {
  kind: 'assistant',
  match(event) {
    if (event.type !== 'assistant/chunk' && event.type !== 'assistant/message') {
      return null
    }
    const data = isRecord(event.data) ? event.data : {}
    const id = `${asNumber(data.turn)}:${asNumber(data.step)}`
    const role = event.type === 'assistant/chunk' ? 'start' : 'update'
    return { id, role }
  },
  start(event) {
    const data = isRecord(event.data) ? event.data : {}
    const node: AssistantNode = {
      kind: 'assistant',
      id: `${asNumber(data.turn)}:${asNumber(data.step)}`,
      seq: event.seq,
      time: event.time,
      turn: asNumber(data.turn),
      step: asNumber(data.step),
      text: '',
      reasoning: '',
      streaming: event.type === 'assistant/chunk',
      thinking: event.type === 'assistant/chunk',
      thinkingStartedAt: event.type === 'assistant/chunk' ? event.time : undefined,
    }
    return applyAssistant(node, event)
  },
  update(state, event) {
    return applyAssistant({ ...state }, event)
  },
  isComplete(state) {
    return !state.streaming
  },
  settle(state, boundary) {
    if (
      boundary?.type !== 'turn/end' ||
      state.streaming !== true ||
      (state.text === '' && state.reasoning === '')
    ) {
      return state
    }
    const data = isRecord(boundary.data) ? boundary.data : {}
    const reason = data.reason
    const kind = isRecord(reason) ? reason.kind : undefined
    if (kind !== 'interrupted' && kind !== 'aborted' && kind !== 'cancelled') return state
    return { ...state, streaming: false, interrupted: true }
  },
  buildViewNode(ctx) {
    const state = ctx.state
    if (state.text === '' && state.reasoning === '' && !state.streaming) {
      return null
    }
    return state
  },
}

function applyAssistant(node: AssistantNode, event: SessionEvent): AssistantNode {
  const data = isRecord(event.data) ? event.data : {}
  if (event.type === 'assistant/chunk') {
    const chunk = isRecord(data.chunk) ? data.chunk : {}
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      node.text += chunk.text
      node.thinking = false
      finishThinking(node, event.time)
    } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
      node.reasoning += chunk.text
    } else if (chunk.type === 'tool-call-delta') {
      node.thinking = false
      finishThinking(node, event.time)
    } else if (chunk.type === 'usage' && isRecord(chunk.usage)) {
      node.usage = usageOf(chunk.usage)
    }
    if (chunk.type === 'finish') {
      node.thinking = false
      finishThinking(node, event.time)
    }
    node.streaming = chunk.type !== 'finish'
    return node
  }
  const message = isRecord(data.message) ? data.message : {}
  node.text = blocksToText(message.content)
  node.reasoning = reasoningToText(message.content)
  node.streaming = false
  node.thinking = false
  if (data.interrupted === true) node.interrupted = true
  else delete node.interrupted
  finishThinking(node, event.time)
  if (isRecord(data.usage)) node.usage = usageOf(data.usage)
  return node
}

function finishThinking(node: AssistantNode, time: number): void {
  if (node.thinkingStartedAt === undefined || node.thinkingDurationMs !== undefined) return
  node.thinkingDurationMs = Math.max(0, time - node.thinkingStartedAt)
}

function usageOf(usage: Record<string, unknown>): {
  input: number
  output: number
} {
  return {
    input: asNumber(usage.inputTokens),
    output: asNumber(usage.outputTokens),
  }
}

const toolDefinition: NodeDefinition<ToolNode> = {
  kind: 'tool',
  match(event) {
    if (event.type === 'assistant/chunk') {
      const data = isRecord(event.data) ? event.data : {}
      const chunk = isRecord(data.chunk) ? data.chunk : {}
      if (chunk.type !== 'tool-call-delta') return null
      const id = asString(chunk.id)
      return id === '' ? null : { id, role: 'start' }
    }
    if (event.type === 'tool/call') {
      const data = isRecord(event.data) ? event.data : {}
      const id = asString(data.callId)
      if (id === '') return null
      return { id, role: 'start' }
    }
    if (event.type === 'tool/result') {
      const id = toolResultCallId(event)
      if (id === '') return null
      return { id, role: 'update' }
    }
    return null
  },
  start(event) {
    const delta = toolCallDelta(event)
    if (delta !== undefined) {
      return {
        kind: 'tool',
        id: delta.id,
        seq: event.seq,
        time: event.time,
        callId: delta.id,
        name: delta.name,
        args: delta.argumentsDelta,
        status: 'running',
        streaming: true,
        view: inferToolView(delta.name, delta.argumentsDelta),
      }
    }
    const data = isRecord(event.data) ? event.data : {}
    return {
      kind: 'tool',
      id: asString(data.callId),
      seq: event.seq,
      time: event.time,
      callId: asString(data.callId),
      name: asString(data.name, 'tool'),
      args: asString(data.arguments),
      status: 'running',
      streaming: false,
      view: inferToolView(asString(data.name, 'tool'), asString(data.arguments)),
    }
  },
  update(state, event) {
    const delta = toolCallDelta(event)
    if (delta !== undefined) {
      state.args += delta.argumentsDelta
      if (delta.name !== '') state.name = delta.name
      state.streaming = true
      state.view = inferToolView(state.name, state.args)
      return state
    }
    if (event.type === 'tool/call') {
      const data = isRecord(event.data) ? event.data : {}
      state.name = asString(data.name, state.name)
      state.args = asString(data.arguments, state.args)
      state.streaming = false
      state.status = 'running'
      state.view = inferToolView(state.name, state.args)
      return state
    }
    return applyToolResult({ ...state }, event)
  },
  isComplete(state) {
    return state.status !== 'running' && state.streaming !== true
  },
  settle(state) {
    if (state.status !== 'running' && state.streaming !== true) return state
    return { ...state, status: 'cancelled', streaming: false }
  },
  buildViewNode(ctx) {
    return ctx.state
  },
}

function toolCallDelta(event: SessionEvent):
  | { id: string; name: string; argumentsDelta: string }
  | undefined {
  if (event.type !== 'assistant/chunk') return undefined
  const data = isRecord(event.data) ? event.data : {}
  const chunk = isRecord(data.chunk) ? data.chunk : {}
  if (chunk.type !== 'tool-call-delta') return undefined
  const id = asString(chunk.id)
  const argumentsDelta = asString(chunk.argumentsDelta)
  if (id === '') return undefined
  return { id, name: asString(chunk.name), argumentsDelta }
}

function toolResultCallId(event: SessionEvent): string {
  const data = isRecord(event.data) ? event.data : {}
  const message = isRecord(data.message) ? data.message : {}
  const source = isRecord(message.source) ? message.source : {}
  if (typeof source.callId === 'string' && source.callId !== '') {
    return source.callId
  }
  const content = Array.isArray(message.content) ? message.content[0] : undefined
  if (isRecord(content) && typeof content.toolCallId === 'string') {
    return content.toolCallId
  }
  return ''
}

function applyToolResult(node: ToolNode, event: SessionEvent): ToolNode {
  const data = isRecord(event.data) ? event.data : {}
  const message = isRecord(data.message) ? data.message : {}
  const block = Array.isArray(message.content) ? message.content[0] : undefined
  const isError =
    data.error !== undefined ||
    (isRecord(block) && block.type === 'tool-result' && block.isError === true)
  node.status = isError ? 'error' : 'success'
  node.streaming = false
  node.result = isRecord(block) ? blocksToText(block.content) : ''
  if (node.view?.kind === 'diff' && node.result !== undefined) {
    const summary = parseDiffSummary(node.result)
    if (summary.files.length > 0) node.view = { ...node.view, summary }
  }
  if (isRecord(data.error)) {
    node.error = {
      name: asString(data.error.name, 'Error'),
      code: asString(data.error.code, 'UNKNOWN'),
    }
  }
  return node
}

const commandDefinition: NodeDefinition<CommandNode> = {
  kind: 'command',
  match(event) {
    if (event.type !== 'command/run' && event.type !== 'command/done') return null
    const data = isRecord(event.data) ? event.data : {}
    const commandId = asString(data.commandId)
    if (commandId === '') return null
    return { id: commandId, role: event.type === 'command/run' ? 'start' : 'update' }
  },
  start(event) {
    const data = isRecord(event.data) ? event.data : {}
    const commandId = asString(data.commandId, String(event.seq))
    if (event.type === 'command/done') {
      return commandFromDone(event, commandId)
    }
    return {
      kind: 'command',
      id: commandId,
      seq: event.seq,
      time: event.time,
      commandId,
      name: optionalString(data.name) ?? null,
      args: typeof data.args === 'string' ? data.args : null,
      outcome: null,
    }
  },
  update(state, event) {
    if (event.type !== 'command/done') return state
    return commandFromDone(event, state.commandId, state)
  },
  isComplete(state) {
    return state.outcome !== null
  },
  buildViewNode(ctx) {
    return ctx.state
  },
}

function commandFromDone(
  event: SessionEvent,
  commandId: string,
  previous?: CommandNode,
): CommandNode {
  const data = isRecord(event.data) ? event.data : {}
  const kind = data.kind === 'success' || data.kind === 'error' ? data.kind : 'error'
  const sourceEventSeq =
    kind === 'success' &&
    typeof data.sourceEventSeq === 'number' &&
    Number.isSafeInteger(data.sourceEventSeq) &&
    data.sourceEventSeq >= 0
      ? data.sourceEventSeq
      : undefined
  return {
    kind: 'command',
    id: commandId,
    seq: previous?.seq ?? event.seq,
    time: previous?.time ?? event.time,
    commandId,
    name: previous?.name ?? null,
    args: previous?.args ?? null,
    outcome: {
      kind,
      ...(typeof data.text === 'string' ? { text: data.text } : {}),
      ...(sourceEventSeq === undefined ? {} : { sourceEventSeq }),
    },
  }
}

const fallbackDefinition: NodeDefinition<NoticeNode> = {
  kind: 'notice',
  fallback: true,
  match(event) {
    return { id: `fallback:${String(event.seq)}`, role: 'start' }
  },
  start(event) {
    return {
      kind: 'notice',
      id: `fallback:${String(event.seq)}`,
      seq: event.seq,
      time: event.time,
      tone: 'info',
      message: event.type,
      verboseOnly: true,
    }
  },
  update(state) {
    return state
  },
  isComplete() {
    return true
  },
  buildViewNode(ctx) {
    return ctx.state
  },
}
