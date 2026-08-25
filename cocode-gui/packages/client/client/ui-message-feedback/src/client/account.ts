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
    put: (input: { sessionId: string; messageId: string; rating: MessageFeedbackRating; note?: string }) => Promise<AgencyFeedback>
    delete: (sessionId: string, messageId: string) => Promise<{ readonly deleted: true }>
  }
}
type AgencyFeedback = { readonly session_id: string; readonly message_id: string; readonly rating: MessageFeedbackRating; readonly note?: string | null; readonly created_at?: string; readonly updated_at?: string }

function account(): AccountApi | undefined {
  return (window as Window & { readonly desktopApi?: { readonly account?: AccountApi } }).desktopApi?.account
}

export function subscribeAccount(listener: (signedIn: boolean) => void): () => void {
  const current = account()
  if (current === undefined) return () => undefined
  const off = current.onChanged(snapshot => listener(snapshot.phase === 'signed-in'))
  void current.snapshot().then(snapshot => listener(snapshot.phase === 'signed-in'), () => listener(false))
  return off
}

function versionOf(value: AgencyFeedback): MessageFeedbackItem['version'] {
  return (value.updated_at ?? value.created_at ?? 'agency-feedback') as MessageFeedbackItem['version']
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
      const value = await account()?.messageFeedback.list(sessionId) ?? { data: [] }
      return { ok: true, value: { ok: true, value: { items: value.data.map(itemOf) } } }
    },
    put: async ({ sessionId, messageId, rating, note }): Promise<RemoteResult<MessageFeedbackPutResult>> => {
      const value = await account()?.messageFeedback.put({ sessionId, messageId, rating, ...(note === undefined ? {} : { note }) })
      if (value === undefined) throw new Error('Cocode account is not signed in')
      return { ok: true, value: { ok: true, value: itemOf(value) } }
    },
    delete: async ({ sessionId, messageId }): Promise<RemoteResult<MessageFeedbackDeleteResult>> => {
      const value = await account()?.messageFeedback.delete(sessionId, messageId)
      if (value === undefined) throw new Error('Cocode account is not signed in')
      return { ok: true, value: { ok: true, value: { absent: true } } }
    },
  }
}
