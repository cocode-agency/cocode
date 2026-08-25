import type { TuiRuntime } from '@cocode/tui-connection'
import type { TuiCapabilities } from './capabilities.ts'

export type SessionRenameResult = {
  kind: 'accepted' | 'unavailable'
  result?: { title: string; seq: number }
}

/**
 * Runs the remote session rename without coupling command handling to TuiApp.
 * Read-only shared sessions are intentionally rejected by the caller's
 * `canMutate` check so this helper only owns protocol and error translation.
 */
export async function renameSession(
  runtime: Pick<TuiRuntime, 'renameSession'>,
  capabilities: Pick<TuiCapabilities, 'sessionRename'>,
  sessionId: string,
  title: string,
): Promise<SessionRenameResult> {
  if (!capabilities.sessionRename || runtime.renameSession === undefined || title.trim() === '') {
    return { kind: 'unavailable' }
  }
  return {
    kind: 'accepted',
    result: await runtime.renameSession(sessionId, title.trim()),
  }
}
