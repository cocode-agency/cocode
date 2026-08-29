import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  MessageFeedbackDeleteResult,
  MessageFeedbackItem,
  MessageFeedbackListResult,
  MessageFeedbackPutResult,
  MessageFeedbackRating,
} from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackRemote } from './controller.ts'

type AccountSnapshot = { readonly phase: 'signed-out' | 'signing-in' | 'provisioning' | 'signed-in' | 'error' }
type AccountApi = {
  snapshot: () => Promise<AccountSnapshot>
  onChanged: (listener: (snapshot: AccountSnapshot) => void) => () => void
  messageFeedback: {
    list: (sessionId: string) => Promise<{ readonly data: readonly AgencyFeedback[] }>
    put: (input: { sessionId: string; messageId: string; rating: MessageFeedbackRating; note?: string; ifVersion: string | number | null }) => Promise<AgencyFeedbackPutResult>
    delete: (input: { sessionId: string; messageId: string; ifVersion: string | number }) => Promise<AgencyFeedbackDeleteResult>
  }
}
type AgencyFeedback = { readonly session_id: string; readonly message_id: string; readonly rating: MessageFeedbackRating; readonly note?: string | null; readonly version?: string | number; readonly created_at?: string; readonly updated_at?: string }
type AgencyFeedbackPutResult =
  | { readonly ok: true; readonly value: AgencyFeedback }
  | { readonly ok: false; readonly error: { readonly code: 'version-conflict'; readonly current: AgencyFeedback | null } }
type AgencyFeedbackDeleteResult =
  | { readonly ok: true; readonly value: { readonly deleted: true } }
  | { readonly ok: false; readonly error: { readonly code: 'version-conflict'; readonly current: AgencyFeedback | null } }

function account(): AccountApi | undefined {
  return (window as Window & { readonly desktopApi?: { readonly account?: AccountApi } }).desktopApi?.account
}

export function subscribeAccount(listener: (signedIn: boolean) => void): () => void {
  const current = account()
  if (current === undefined) return () => undefined
  let active = true
  let sequence = 0
  const off = current.onChanged(snapshot => {
    if (!active) return
    sequence += 1
    listener(snapshot.phase === 'signed-in')
  })
  const snapshotSequence = sequence
  void current.snapshot().then(
    snapshot => {
      if (active && snapshotSequence === sequence) listener(snapshot.phase === 'signed-in')
    },
    () => {
      if (active && snapshotSequence === sequence) listener(false)
    },
  )
  return () => {
    active = false
    sequence += 1
    off()
  }
}

function versionOf(value: AgencyFeedback): MessageFeedbackItem['version'] {
  return String(value.version ?? value.updated_at ?? value.created_at ?? 'agency-feedback') as MessageFeedbackItem['version']
}

function timestamp(value: string | undefined): number {
  if (value === undefined) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function itemOf(value: AgencyFeedback): MessageFeedbackItem {
  return {
    messageId: value.message_id as MessageId,
    rating: value.rating,
    ...(value.note == null ? {} : { note: value.note }),
    version: versionOf(value),
    createdAt: timestamp(value.created_at),
    updatedAt: timestamp(value.updated_at),
  }
}

export function agencyMessageFeedbackRemote(): MessageFeedbackRemote {
  return {
    list: async ({ sessionId }): Promise<RemoteResult<MessageFeedbackListResult>> => {
      const current = account()
      if (current === undefined) throw new Error('Cocode account bridge is unavailable')
      const value = await current.messageFeedback.list(sessionId)
      return { ok: true, value: { ok: true, value: { items: value.data.map(itemOf) } } }
    },
    put: async ({ sessionId, messageId, rating, note, ifVersion }): Promise<RemoteResult<MessageFeedbackPutResult>> => {
      const current = account()
      if (current === undefined) throw new Error('Cocode account bridge is unavailable')
      const result = await current.messageFeedback.put({ sessionId, messageId, rating, ...(note === undefined ? {} : { note }), ifVersion })
      if (result.ok) return { ok: true, value: { ok: true, value: itemOf(result.value) } }
      return { ok: true, value: { ok: false, error: { code: 'version-conflict', current: result.error.current === null ? null : itemOf(result.error.current) } } }
    },
    delete: async ({ sessionId, messageId, ifVersion }): Promise<RemoteResult<MessageFeedbackDeleteResult>> => {
      const current = account()
      if (current === undefined) throw new Error('Cocode account bridge is unavailable')
      const result = await current.messageFeedback.delete({ sessionId, messageId, ifVersion })
      if (result.ok) return { ok: true, value: { ok: true, value: { absent: true } } }
      return { ok: true, value: { ok: false, error: { code: 'version-conflict', current: result.error.current === null ? null : itemOf(result.error.current) } } }
    },
  }
}
