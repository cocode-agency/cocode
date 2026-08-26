/** Session tree adapters shared by local and shared-dsh navigation. */

import type {
  SessionEvent,
  TuiSessionOpenResult,
} from '@cocode/tui-connection'
import type {
  ExternalSessionEvent,
  ExternalSessionSummary,
} from '@cocode-agency/host-supervisor'
import { buildSessionTree, flattenSessionTree } from './session-tree.ts'
import type { SessionTreePickerItem } from './session-tree-picker.ts'

export function makeSessionTreeItems(
  sessions: ReadonlyArray<{
    id: string
    createdAt: number
    updatedAt?: number
    cwd?: string
    title?: string
    preview?: string
    parentSession?: string
    seedLength?: number
    running?: boolean
    blank?: boolean
    origin?: 'subagent'
    agentPreset?: string
    path: string
    externalSessionId?: string
  }>,
  source: 'rpc' | 'jsonl' | 'external',
  currentSessionId: string,
  activities: ReadonlyMap<string, 'idle' | 'running'>,
): SessionTreePickerItem[] {
  const tree = buildSessionTree(sessions)
  return flattenSessionTree(tree, currentSessionId).map((row) => {
    const sourceSession = sessions.find((session) => session.id === row.session.id)
    const activity = activities.get(row.session.id)
    return {
      ...row,
      source,
      ...(sourceSession?.path === undefined || sourceSession.path === ''
        ? {}
        : { path: sourceSession.path }),
      ...(sourceSession?.updatedAt === undefined ? {} : { updatedAt: sourceSession.updatedAt }),
      ...(sourceSession?.running === undefined ? {} : { activity: sourceSession.running ? 'running' : 'idle' }),
      ...(sourceSession?.blank === undefined ? {} : { blank: sourceSession.blank }),
      ...(sourceSession?.origin === undefined ? {} : { origin: sourceSession.origin }),
      ...(sourceSession?.agentPreset === undefined ? {} : { agentPreset: sourceSession.agentPreset }),
      ...(sourceSession?.externalSessionId === undefined
        ? {}
        : { externalSessionId: sourceSession.externalSessionId }),
      ...(activity === undefined ? {} : { activity }),
    }
  })
}

export function makeExternalSessionTreeItems(
  summaries: readonly ExternalSessionSummary[],
  currentSessionIdentity: string,
): SessionTreePickerItem[] {
  const sessions = summaries.map((summary) => ({
    id: externalSessionIdentity(summary.id),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    cwd: summary.cwd,
    title: summary.title,
    preview: summary.preview,
    parentSession:
      summary.parentSession === undefined
        ? undefined
        : externalSessionIdentity(summary.parentSession),
    seedLength: summary.seedLength,
    path: summary.path,
    externalSessionId: summary.id,
  }))
  return makeSessionTreeItems(
    sessions,
    'external',
    currentSessionIdentity,
    new Map(),
  )
}

export function externalSessionIdentity(sessionId: string): string {
  return `shared-dsh:${sessionId}`
}

export function toSessionEvent(event: ExternalSessionEvent): SessionEvent {
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: event.data,
    ...(event.ignorable === true ? { ignorable: true as const } : {}),
  }
}

export function normalizeOpenResult(result: boolean | TuiSessionOpenResult): TuiSessionOpenResult {
  return typeof result === 'boolean' ? { opened: result } : result
}
