import type { SessionEvent, TuiRuntime } from '@cocode/tui-connection'

/**
 * Probe cold-history image references without making a failed image hide the
 * surrounding message. The returned event copies only failed image blocks.
 */
export async function markUnavailableHistoryAttachments(
  runtime: Pick<TuiRuntime, 'readAttachment'>,
  sessionId: string,
  events: readonly SessionEvent[],
): Promise<SessionEvent[]> {
  if (runtime.readAttachment === undefined) return [...events]
  const ids = new Set<string>()
  for (const event of events) collectAttachmentIds(event.data, ids)
  if (ids.size === 0) return [...events]
  const unavailable = new Set<string>()
  await Promise.all([...ids].map(async (attachmentId) => {
    try {
      await runtime.readAttachment?.(sessionId, attachmentId)
    } catch {
      unavailable.add(attachmentId)
    }
  }))
  if (unavailable.size === 0) return [...events]
  return events.map((event) => ({ ...event, data: markUnavailable(event.data, unavailable) }))
}

function collectAttachmentIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentIds(item, ids)
    return
  }
  if (!isRecord(value)) return
  if (value.type === 'image') {
    const attachment = isRecord(value.attachment) ? value.attachment : value
    if (typeof attachment.attachmentId === 'string' && attachment.attachmentId !== '') ids.add(attachment.attachmentId)
  }
  for (const child of Object.values(value)) collectAttachmentIds(child, ids)
}

function markUnavailable(value: unknown, unavailable: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => markUnavailable(item, unavailable))
  if (!isRecord(value)) return value
  if (value.type === 'image') {
    const attachment = isRecord(value.attachment) ? value.attachment : value
    const attachmentId = typeof attachment.attachmentId === 'string' ? attachment.attachmentId : undefined
    if (attachmentId !== undefined && unavailable.has(attachmentId)) {
      return isRecord(value.attachment)
        ? { ...value, attachment: { ...value.attachment, unavailable: true } }
        : { ...value, unavailable: true }
    }
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, markUnavailable(child, unavailable)]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
