// Resident conversation skeleton. Hero chrome, composer positioning, the
// chain, AND the composer bar (session-maybe slot) stay mounted across
// no-session/session transitions — the bar renders inert via owner props.

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSlotProps, InputZone } from '../contract/slots.ts'
import { HeroGlow, HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the slot contract. */
export type ConversationRootProps = ConversationSlotProps

/** How long the thumb stays visible after the last scroll event. */
const SCROLLBAR_LINGER_MS = 1200

/** Local optimistic state for a workspace pick. The label is retained across
 * workspace-list refreshes so a transient list gap cannot erase the choice. */
interface WorkspaceSelection {
  workspaceId: WorkspaceId
  label: string
  error?: string
}

function workspaceSelectionError(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  return String(reason)
}

export function ConversationRoot({
  sessionId, useSession, useSessions, useWorkspaces, useInput, useComposerBlock,
  renderSlot, renderSlotChain, selectWorkspace, t, useStore,
}: ConversationRootProps) {
  const openState = useSession(s => s.openState)
  const composerPhase = useSession(s => s.composerPhase)
  const pending = useSession(s => s.pending) ?? []
  const session = useSession(s => s)
  const inputState = useInput(s => s)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)

  const logoPreference = useStore(state => state.logoPreference) ?? 'cocode'

  const [pickerOpen, setPickerOpen] = useState(false)
  const [workspaceSelection, setWorkspaceSelection] = useState<WorkspaceSelection | undefined>()
  const [workspaceError, setWorkspaceError] = useState<string | undefined>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)
  const scrollBodyRef = useRef<HTMLDivElement>(null)
  const scrollbarLingerRef = useRef<number | undefined>(undefined)
  const scrollbarVisibleRef = useRef(false)

  // Publishes the seat's live height as --dsh-composer-height on the scroll
  // body so floating controls (ChatView back-to-bottom) clear the composer as
  // it grows. Callback ref, not an effect; stable identity prevents observer
  // churn while the first blank session fills the resident body outlet.
  const seatObserver = useRef<ResizeObserver | null>(null)
  // Scrollbars follow scroll input: drawn while the reader is moving the
  // transcript and for SCROLLBAR_LINGER_MS after, then fade out via
  // .quietBars rebinding ui-theme's thumb tokens. ClassList, not React
  // state — scroll can fire every frame and must not re-render the column.
  useEffect(() => {
    const scroller = scrollBodyRef.current
    if (scroller === null) return
    const revealBars = (): void => {
      if (!scrollbarVisibleRef.current) {
        scrollbarVisibleRef.current = true
        scroller.classList.remove(css.quietBars)
      }
      window.clearTimeout(scrollbarLingerRef.current)
      scrollbarLingerRef.current = window.setTimeout(() => {
        scrollbarLingerRef.current = undefined
        scrollbarVisibleRef.current = false
        scroller.classList.add(css.quietBars)
      }, SCROLLBAR_LINGER_MS)
    }
    scroller.addEventListener('scroll', revealBars, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', revealBars)
      window.clearTimeout(scrollbarLingerRef.current)
    }
  }, [])

  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
    })
    seatObserver.current.observe(seat)
  }, [])

  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === workspaceSelection?.workspaceId,
  )

  // Clear the optimistic pick only after the current session is actually
  // accounted to it. Do not use a temporary list gap as a deletion signal:
  // workspace/session projections refresh independently during connect.
  useEffect(() => {
    if (workspaceSelection === undefined) return
    if (sessionWorkspace?.workspaceId === workspaceSelection.workspaceId) {
      setWorkspaceSelection(undefined)
    }
  }, [workspaceSelection, sessionWorkspace?.workspaceId])

  // While a session is still replaying (loading + blank) the hero/docked
  // choice is unknowable — render the composer hidden instead of flashing
  // the centered hero and snapping to the docked bar (or vice versa).
  // Exemption: a session the list summary already proves blank can only
  // land on the hero, so hiding would blank the column for the whole
  // history round-trip (the startup auto-selection flash) for nothing.
  // The exemption is deliberately open-state-wide, not loading-only: a
  // summary-blank session is the hero before its open starts (`cold`) and
  // after one fails (`error`) for the same reason — there is no history.
  const settling = sessionId !== undefined && composerPhase === 'blank' && openState === 'loading'
    && summaryBlank !== true
  const hero = sessionId === undefined
    || (composerPhase === 'blank' && (openState === 'open' || summaryBlank === true))
  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (live row, then retained optimistic label);
  //   2. cold start, no session yet → placeholder ("Choose workspace");
  //   3. the blank session's workspace is in the list → its title;
  //   4. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   5. no optimistic selection and no owning workspace (deleted from the
  //      sidebar) → placeholder, never the deleted folder's name via cwd.
  const chipTitle = pendingWorkspace?.title
    ?? workspaceSelection?.label
    ?? (sessionId === undefined
      ? undefined
      : sessionWorkspace?.title
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? t('hero.defaultWorkspace')
          : workspaceLabel(cwd)))

  const heroWorkspaceRow = (
    <div className={css.heroWorkspaceArea}>
      <div className={css.heroWorkspaceRow}>
        <WorkspaceChip
          buttonRef={pickerAnchor}
          label={chipTitle}
          menuOpen={pickerOpen}
          onClick={() => { setPickerOpen(open => !open) }}
          onClear={sessionWorkspace !== undefined || workspaceSelection !== undefined
            ? () => {
              setPickerOpen(false)
              setWorkspaceSelection(undefined)
              setWorkspaceError(undefined)
              void selectWorkspace().catch((reason: unknown) => {
                setWorkspaceError(workspaceSelectionError(reason))
              })
            }
            : undefined}
          t={t}
        />
        {renderSlot('conversation.hero.workspace', {
          open: pickerOpen,
          anchorRef: pickerAnchor,
          selectedId: workspaceSelection?.workspaceId ?? sessionWorkspace?.workspaceId,
          onPick: (workspaceId) => {
            setPickerOpen(false)
            setWorkspaceError(undefined)
            const picked = workspaces.items.find(workspace => workspace.workspaceId === workspaceId)
            const label = picked === undefined
              ? workspaceId
              : (picked.title || workspaceLabel(picked.path))
            setWorkspaceSelection({ workspaceId, label })
            void selectWorkspace(workspaceId).catch((reason: unknown) => {
              setWorkspaceSelection(current => current?.workspaceId === workspaceId
                ? { ...current, error: workspaceSelectionError(reason) }
                : current)
            })
          },
          onClose: () => { setPickerOpen(false) },
        })}
      </div>
      {(workspaceSelection?.error ?? workspaceError) !== undefined && (
        <div className={css.heroWorkspaceError} role="alert">
          {t('workspace.selectFailed', { message: workspaceSelection?.error ?? workspaceError ?? '' })}
        </div>
      )}
    </div>
  )

  // The placeholder chip ("Choose workspace") and the Workspace-trigger input travel
  // together: no workspace picked yet (cold start, no session at all), or a
  // blank session whose workspace vanished (deleted from the sidebar). The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: t('placeholder.hero') } : {}),
    overlay: renderSlot('conversation.input.overlay', {}),
    leftItems: zone === undefined ? null : renderSlot('conversation.input.left', zone),
    rightItems: zone === undefined ? null : renderSlot('conversation.input.right', zone),
    // Stats band under the card, inside the bar's width column so both
    // share one constraint (composer.dock = stats-line family).
    footer: !hero && zone !== undefined ? renderSlot('conversation.composer.dock', zone) : null,
  })

  const composerBar = (
    <div className={clsx(css.composerStack, hero && css.composerHero)}>
      {hero && <HeroGlow className={css.heroGlow} />}
      {hero && <HeroShell t={t} logoPreference={logoPreference} />}
      {hero && heroWorkspaceRow}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
    </div>
  )

  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  const composer = renderSlotChain(
    'conversation.composer',
    { interactions: pending, session },
    { fallback: composerBar, overlay: true },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave Question/Approval panels at the content
  // end off-screen when the user is not pinned to the floor.
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="">
      {composer}
    </div>
  )

  return (
    <div className={css.root} data-phase={phase}>
      {renderSlot('conversation.session.header', {})}
      <div ref={scrollBodyRef} className={clsx(css.scrollBody, css.quietBars)} data-conversation-scroll="">
        <div className={css.scrollBodyDrag}></div>
        {renderSlot('conversation.session', {})}
        {composerSeat}
      </div>
    </div>
  )
}
