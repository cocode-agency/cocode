/**
 * Incremental SessionEvent → ConversationNode engine.
 */

import type { SessionEvent } from '@cocode/tui-connection'
import type { ConversationNode, NodeDefinition } from './nodes/types.ts'
import { nodeKey } from './nodes/types.ts'
import type { NodeRegistry } from './nodes/registry.ts'
import { createBuiltinRegistry } from './nodes/builtins.ts'

type InternalContext = {
  key: string
  kind: string
  id: string
  definition: NodeDefinition
  startSeq: number
  state: unknown
  dirty: boolean
  node: ConversationNode | null
  stateBytes: number
}

export type AssemblerOptions = {
  maxNodes?: number
  maxStateBytes?: number
}

export type AssemblerStats = {
  retainedNodes: number
  evictedNodes: number
  retainedStateBytes: number
}

export type Assembler = {
  ingest(event: SessionEvent): void
  replaceWindow(events: readonly SessionEvent[]): void
  snapshot(): readonly ConversationNode[]
  stats(): AssemblerStats
  settleOpen(boundary?: SessionEvent): void
  reset(): void
}

const DEFAULT_MAX_NODES = 2048
const DEFAULT_MAX_STATE_BYTES = 8 * 1024 * 1024

export function createAssembler(
  registry?: NodeRegistry,
  options: AssemblerOptions = {},
): Assembler {
  return new ConversationAssembler(registry ?? createBuiltinRegistry(), options)
}

class ConversationAssembler implements Assembler {
  private readonly contexts = new Map<string, InternalContext>()
  private readonly order: InternalContext[] = []
  private cache: readonly ConversationNode[] = []
  private cacheValid = true
  private highestSeq = -1
  private retainedStateBytes = 0
  private evictedNodes = 0
  private readonly maxNodes: number
  private readonly maxStateBytes: number

  constructor(private readonly registry: NodeRegistry, options: AssemblerOptions) {
    this.maxNodes = positiveInteger(options.maxNodes, DEFAULT_MAX_NODES)
    this.maxStateBytes = positiveInteger(options.maxStateBytes, DEFAULT_MAX_STATE_BYTES)
  }

  reset(): void {
    this.contexts.clear()
    this.order.length = 0
    this.cache = []
    this.cacheValid = true
    this.highestSeq = -1
    this.retainedStateBytes = 0
    this.evictedNodes = 0
  }

  replaceWindow(events: readonly SessionEvent[]): void {
    this.reset()
    for (const event of events) this.ingest(event)
  }

  ingest(event: SessionEvent): void {
    if (event.seq <= this.highestSeq) return
    this.highestSeq = event.seq
    const matched = this.matchEvent(event)
    if (matched === undefined) return
    if (matched.role === 'start') {
      this.startContext(matched.definition, matched.id, event)
    } else {
      this.updateContext(matched.definition, matched.id, event)
    }
    // Cancelled turns often omit tool/result; close in-flight tools here.
    if (event.type === 'turn/end') this.settleOpen(event)
    this.pruneCompletedContexts()
  }

  snapshot(): readonly ConversationNode[] {
    if (this.cacheValid) return this.cache
    const next: ConversationNode[] = []
    for (const context of this.order) {
      if (context.dirty) {
        const built = context.definition.buildViewNode({
          kind: context.kind,
          id: context.id,
          startSeq: context.startSeq,
          state: context.state,
        })
        // Definitions mutate their state in place, so copy on publish: the
        // presentation layer keys render caches on node identity.
        context.node = built === null ? null : ({ ...built } as ConversationNode)
        context.dirty = false
      }
      if (context.node !== null) next.push(context.node)
    }
    this.cache = next
    this.cacheValid = true
    return this.cache
  }

  stats(): AssemblerStats {
    return {
      retainedNodes: this.order.length,
      evictedNodes: this.evictedNodes,
      retainedStateBytes: this.retainedStateBytes,
    }
  }

  settleOpen(boundary?: SessionEvent): void {
    let changed = false
    for (const context of this.order) {
      const settle = context.definition.settle
      if (settle === undefined) continue
      const next = settle(context.state, boundary)
      if (next === context.state) continue
      this.retainedStateBytes -= context.stateBytes
      context.state = next
      context.stateBytes = estimateStateBytes(context.state)
      this.retainedStateBytes += context.stateBytes
      context.dirty = true
      changed = true
    }
    if (changed) this.cacheValid = false
  }

  private matchEvent(event: SessionEvent):
    | {
        definition: NodeDefinition
        id: string
        role: 'start' | 'update'
      }
    | undefined {
    for (const definition of this.registry.entries()) {
      const result = definition.match(event)
      if (result === null) continue
      return { definition, id: result.id, role: result.role }
    }
    const fallback = this.registry.fallbackEntry()
    if (fallback === undefined) return undefined
    const result = fallback.match(event)
    if (result === null) return undefined
    return { definition: fallback, id: result.id, role: result.role }
  }

  private startContext(definition: NodeDefinition, id: string, event: SessionEvent): void {
    const key = nodeKey(definition.kind, id)
    if (this.contexts.has(key)) {
      this.updateContext(definition, id, event)
      return
    }
    const context: InternalContext = {
      key,
      kind: definition.kind,
      id,
      definition,
      startSeq: event.seq,
      state: definition.start(event),
      dirty: true,
      node: null,
      stateBytes: 0,
    }
    context.stateBytes = estimateStateBytes(context.state)
    this.retainedStateBytes += context.stateBytes
    this.contexts.set(key, context)
    this.order.push(context)
    this.cacheValid = false
  }

  private updateContext(definition: NodeDefinition, id: string, event: SessionEvent): void {
    const key = nodeKey(definition.kind, id)
    const context = this.contexts.get(key)
    if (context === undefined) {
      this.startContext(definition, id, event)
      return
    }
    context.state = definition.update(context.state, event)
    this.retainedStateBytes -= context.stateBytes
    context.stateBytes = estimateStateBytes(context.state)
    this.retainedStateBytes += context.stateBytes
    context.dirty = true
    this.cacheValid = false
  }

  private pruneCompletedContexts(): void {
    while (this.order.length > this.maxNodes || this.retainedStateBytes > this.maxStateBytes) {
      const index = this.order.findIndex(
        (context) => context.definition.isComplete?.(context.state) ?? false,
      )
      if (index < 0) return
      const [removed] = this.order.splice(index, 1)
      if (removed === undefined) return
      this.contexts.delete(removed.key)
      this.retainedStateBytes -= removed.stateBytes
      this.evictedNodes += 1
      this.cacheValid = false
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isSafeInteger(value) || value <= 0 ? fallback : value
}

function estimateStateBytes(state: unknown): number {
  try {
    const serialized = JSON.stringify(state)
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8')
  } catch {
    return 0
  }
}
