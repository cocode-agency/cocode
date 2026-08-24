/**
 * Client half: shell-like history recall from an EMPTY composer.
 *
 * - Empty draft + ArrowUp  -> enter recall mode, fill the newest message.
 * - While the draft is still the recalled text (unedited): ArrowUp walks
 *   back, ArrowDown walks forward; past the newest clears back to empty.
 * - Once the draft is edited by hand (or was already non-empty), the arrows
 *   are handed back to the app untouched — menu navigation keeps working.
 */
import type {
  ClientContext,
  ConversationNode,
  ISessions,
  SessionId,
} from "@deepseek-ai/dsh-client-runtime/client"

export const name = "cocode-input-history"
export const inject = ["sessions", "conversation"]

/** Structural faces of the ui-conversation input contract (upstream is package-private). */
interface SessionInputFace {
  setDraft(text: string): void
  readonly state: {
    getSnapshot(): { readonly draft: string }
  }
}
interface ConversationFace {
  readonly input?: {
    for(actx: ClientContext): SessionInputFace | undefined
  }
}

/** Recall cursor per session: an index into userTexts while recall mode is active. */
const recall = new Map<SessionId, number>()

/** Human-entered message texts of one session, oldest first. */
function userTexts(sessions: ISessions, sessionId: SessionId): string[] {
  const binding = sessions.binding(sessionId)
  const snapshot = binding?.session.getSnapshot()
  const nodes: readonly ConversationNode[] = snapshot?.nodes ?? []
  const texts: string[] = []
  for (const node of nodes) {
    if (node.kind !== "user" && node.kind !== "steering") continue
    const text = node.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
    if (text !== "") texts.push(text)
  }
  const seen = new Set<string>()
  const uniqueNewestFirst: string[] = []
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index]
    if (text === undefined || seen.has(text)) continue
    seen.add(text)
    uniqueNewestFirst.push(text)
  }
  return uniqueNewestFirst.reverse()
}

export function apply(ctx: ClientContext): void {
  const sessions = ctx.get("sessions") as ISessions | undefined
  if (sessions === undefined) return

  function onKeyDown(event: KeyboardEvent): void {
    // Closure-safe guard: outer narrowing does not carry into this closure.
    if (sessions === undefined) return
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    // Leave IME composition (arrows select candidates) alone.
    if (event.isComposing) return
    // Only when the composer textarea owns the focus: it is the one element
    // carrying data-phase (other inputs in the app do not).
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest("textarea[data-phase]") == null) return

    const current = sessions.list.getSnapshot().current
    if (current == null) return
    const actx = sessions.scope(current)
    if (actx == null) return
    const conversation = actx.get("conversation") as ConversationFace | undefined
    const input = conversation?.input?.for(actx)
    if (input == null) return

    const draft = input.state.getSnapshot().draft
    const texts = userTexts(sessions, current)
    if (texts.length === 0) return

    let pos = recall.get(current)

    if (event.key === "ArrowUp") {
      // Only an EMPTY composer may (re-)enter recall mode. A non-empty draft
      // that is not exactly the recalled text means the user is editing — the
      // app owns ArrowUp there.
      if (draft === "") {
        pos = texts.length // start just past the newest entry
      } else if (pos == null || texts[pos] !== draft) {
        recall.delete(current)
        return
      }
      if (pos <= 0) {
        // Already at the oldest entry: swallow the key, stay put.
        event.preventDefault()
        event.stopPropagation()
        return
      }
      pos -= 1
      const text = texts[pos]
      if (text === undefined) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      recall.set(current, pos)
      input.setDraft(text)
      event.preventDefault()
      event.stopPropagation()
      return
    }

    // ArrowDown: meaningful only inside recall mode with an unedited draft.
    if (pos == null || texts[pos] !== draft) {
      recall.delete(current)
      return
    }
    pos += 1
    if (pos >= texts.length) {
      // Past the newest: exit recall mode and clear the draft.
      recall.delete(current)
      input.setDraft("")
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const text = texts[pos]
    if (text === undefined) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    recall.set(current, pos)
    input.setDraft(text)
    event.preventDefault()
    event.stopPropagation()
  }

  // Capture phase: run before the composer's own keydown handler.
  window.addEventListener("keydown", onKeyDown, true)
  ctx.effect(() => () => {
    window.removeEventListener("keydown", onKeyDown, true)
    recall.clear()
  })
}
