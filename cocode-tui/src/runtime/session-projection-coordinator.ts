/** Own the live session projections and their durable history metadata. */

import type {
  SessionEvent,
  TuiSessionProjectionBaseline,
  TuiSessionProjectionUpdate,
} from '@cocode/tui-connection'
import type { Assembler } from './assembler.ts'
import type { ConversationNode } from './nodes/types.ts'
import {
  createSessionProjection,
  type SessionProjection,
} from './session-lifecycle.ts'
import {
  createSessionProjectionStore,
  type SessionProjectionStore,
} from './session-projections.ts'
import type { SessionStateProjector, SessionStateSnapshot } from './session-state.ts'
import type { TelemetryProjector, TelemetrySnapshot } from './telemetry.ts'

export type SessionProjectionSnapshot = {
  assembler: Assembler
  telemetry: TelemetryProjector
  sessionState: SessionStateProjector
  projectionStore: SessionProjectionStore
  historyEvents: readonly SessionEvent[]
  historyHasMore: boolean
  highestSessionSeq: number
}

export type SessionProjectionCoordinator = {
  readonly assembler: Assembler
  readonly telemetry: TelemetryProjector
  readonly sessionState: SessionStateProjector
  readonly projectionStore: SessionProjectionStore
  nodes(): readonly ConversationNode[]
  stats(): ReturnType<Assembler['stats']>
  telemetrySnapshot(): TelemetrySnapshot
  sessionStateSnapshot(): SessionStateSnapshot
  settleOpen(): void
  reset(): void
  resetTelemetry(): void
  resetSessionState(): void
  historyEvents(): readonly SessionEvent[]
  historyHasMore(): boolean
  setHistoryHasMore(value: boolean): void
  resetHistory(): void
  applyProjectionUpdate(update: TuiSessionProjectionUpdate): void
  replaceStore(): void
  replace(events: readonly SessionEvent[], baseline?: TuiSessionProjectionBaseline): void
  setProjection(nextProjection: SessionProjection): void
  capture(): SessionProjectionSnapshot
  restore(snapshot: SessionProjectionSnapshot): void
  ingest(event: SessionEvent): boolean
}

export function createSessionProjectionCoordinator(): SessionProjectionCoordinator {
  let projection: SessionProjection = createSessionProjection()
  let projectionStore: SessionProjectionStore = createSessionProjectionStore()
  let highestSessionSeq = -1
  let historyEvents: SessionEvent[] = []
  let historyHasMore = false

  const resetHistory = (): void => {
    highestSessionSeq = -1
    historyEvents = []
    historyHasMore = false
    projectionStore.clear()
  }

  return {
    get assembler() {
      return projection.assembler
    },
    get telemetry() {
      return projection.telemetry
    },
    get sessionState() {
      return projection.sessionState
    },
    get projectionStore() {
      return projectionStore
    },
    nodes: () => projection.assembler.snapshot(),
    stats: () => projection.assembler.stats(),
    telemetrySnapshot: () => projection.telemetry.snapshot(),
    sessionStateSnapshot: () => projection.sessionState.snapshot(),
    settleOpen: () => projection.assembler.settleOpen(),
    reset: () => {
      projection.assembler.reset()
      projection.telemetry.reset()
      projection.sessionState.reset()
      resetHistory()
    },
    resetTelemetry: () => projection.telemetry.reset(),
    resetSessionState: () => projection.sessionState.reset(),
    historyEvents: () => historyEvents,
    historyHasMore: () => historyHasMore,
    setHistoryHasMore: (value) => {
      historyHasMore = value
    },
    resetHistory,
    applyProjectionUpdate: (update) => projectionStore.apply(update),
    replaceStore: () => {
      projectionStore = createSessionProjectionStore()
    },
    setProjection: (nextProjection) => {
      projection = nextProjection
    },
    replace: (events, baseline) => {
      const nextProjection = createSessionProjection()
      resetHistory()
      if (baseline !== undefined) projectionStore.applyBaseline(baseline)
      for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
        if (event.seq <= highestSessionSeq) continue
        highestSessionSeq = event.seq
        historyEvents.push(event)
        nextProjection.assembler.ingest(event)
        nextProjection.telemetry.ingest(event)
        nextProjection.sessionState.ingest(event)
      }
      projection = nextProjection
    },
    capture: () => ({
      assembler: projection.assembler,
      telemetry: projection.telemetry,
      sessionState: projection.sessionState,
      projectionStore,
      historyEvents,
      historyHasMore,
      highestSessionSeq,
    }),
    restore: (snapshot) => {
      projection = {
        assembler: snapshot.assembler,
        telemetry: snapshot.telemetry,
        sessionState: snapshot.sessionState,
      }
      projectionStore = snapshot.projectionStore
      historyEvents = [...snapshot.historyEvents]
      historyHasMore = snapshot.historyHasMore
      highestSessionSeq = snapshot.highestSessionSeq
    },
    ingest: (event) => {
      if (event.seq <= highestSessionSeq) return false
      highestSessionSeq = event.seq
      historyEvents.push(event)
      projection.telemetry.ingest(event)
      projection.sessionState.ingest(event)
      projection.assembler.ingest(event)
      return true
    },
  }
}
