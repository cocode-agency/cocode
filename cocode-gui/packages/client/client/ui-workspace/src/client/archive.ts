import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SessionSummary, SubagentDescendantSummary,
} from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Workspace bulk-archive eligibility. `completed` is the manager-owned
 * finished-but-unviewed reminder, so its absence is the existing read fact.
 * Pending interactions and running descendants remain active conversations
 * even when the parent session's own `running` bit is false.
 */
export function sessionArchiveEligible(
  session: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
): boolean {
  return !session.blank
    && !session.running
    && session.pendingInteraction === undefined
    && session.completed !== true
    && (descendants.get(session.id)?.runningCount ?? 0) === 0
}
