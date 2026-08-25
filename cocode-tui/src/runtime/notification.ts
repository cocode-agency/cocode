/** Route runtime notifications into app-owned state callbacks. */

import type { SessionEvent, TuiNotification, TuiRemoteQueueItem, TuiSessionProjectionUpdate } from '@cocode/tui-connection'

export function handleNotification(
  notification: TuiNotification,
  host: {
    sessionId: string
    ingest: (event: SessionEvent) => void
    isDeadOrExiting: () => boolean
    setAgent: (agent: 'idle' | 'running') => void
    clearInterrupt: () => void
    subagentStarted: (childSessionId: string) => string
    subagentFinished: (childSessionId: string) => string
    queueSnapshot?: (items: readonly TuiRemoteQueueItem[]) => void
    projectionUpdate?: (update: TuiSessionProjectionUpdate) => void
    notice: (message: string) => void
    fail: (message: string) => void
    recover: () => void
    emit: () => void
  },
): void {
  if (notification.method === 'session.event') {
    if (notification.params.sessionId !== host.sessionId) return
    const event = notification.params.event
    host.ingest(event)
    const failure = failureMessage(event)
    if (failure !== undefined && !host.isDeadOrExiting()) {
      host.fail(failure)
      if (event.type === 'turn/end') {
        host.setAgent('idle')
        host.clearInterrupt()
      }
    } else if (event.type === 'turn/end' && !host.isDeadOrExiting()) {
      host.recover()
    }
    host.emit()
    return
  }
  if (notification.method === 'session.status') {
    if (notification.params.sessionId !== host.sessionId) return
    if (host.isDeadOrExiting()) return
    host.setAgent(notification.params.status)
    host.clearInterrupt()
    host.emit()
    return
  }
  if (notification.method === 'session.queue') {
    if (notification.params.sessionId !== host.sessionId) return
    host.queueSnapshot?.(notification.params.items)
    host.emit()
    return
  }
  if (notification.method === 'session.projection') {
    if (notification.params.sessionId !== host.sessionId) return
    host.projectionUpdate?.(notification.params)
    host.emit()
    return
  }
  if (notification.method === 'subagent.started') {
    if (notification.params.parentSessionId !== host.sessionId) return
    host.notice(host.subagentStarted(notification.params.childSessionId))
    host.emit()
    return
  }
  if (notification.params.parentSessionId !== host.sessionId) return
  host.notice(host.subagentFinished(notification.params.childSessionId))
  host.emit()
}

function failureMessage(event: SessionEvent): string | undefined {
  const data = record(event.data)
  if (event.type !== 'turn/end') return undefined
  const reason = record(data?.reason)
  if (reason?.kind !== 'error') return undefined
  return messageOf(reason.error)
}

function messageOf(value: unknown): string | undefined {
  const detail = record(value)
  if (typeof detail?.message === 'string' && detail.message.trim() !== '') {
    return detail.message
  }
  return typeof detail?.code === 'string' && detail.code.trim() !== '' ? detail.code : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
