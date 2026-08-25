/** Internal React bindings for the renderer host and active session provide bundle. */
import { createContext, useContext, type ReactNode } from 'react'
import type {
  HostObservable, MaybeSnapshotSelectorHook, SessionMaybeProvideInfo, SessionProvideInfo,
  SlotRendererHost, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from './bind.ts'

/**
 * A missing-provider assembly error: the shell wired the tree wrong. The slot
 * error boundary rethrows this class so misassembly stays fail-loud while
 * registrant errors (inject factories, entry components) are contained
 * per entry.
 */
export class SlotAssemblyError extends Error {}

/** In-package renderer host context. */
export const HostContext = createContext<SlotRendererHost | null>(null)

/**
 * Read the installed renderer host; throws outside the rendered root tree
 * (framework components must not render detached from the renderer).
 * @returns the host API.
 */
export function useHost(): SlotRendererHost {
  const host = useContext(HostContext)
  if (!host) throw new SlotAssemblyError('slot machinery rendered outside the installed renderer tree')
  return host
}

const BindingContext = createContext<SessionMaybeProvideInfo | null>(null)

/** Read the current-session-optional bundle supplied at the root. */
export function useSessionMaybeProvideInfo(): SessionMaybeProvideInfo {
  const info = useContext(BindingContext)
  if (!info) throw new SlotAssemblyError('session-aware slot rendered outside the root binding provider')
  return info
}

/**
 * Read the enclosing session provide bundle; throws outside a SessionProvider
 * subtree (session slots must not render without a session).
 * @returns the enclosing bundle.
 */
export function useSessionProvideInfo(): SessionProvideInfo {
  const info = useSessionMaybeProvideInfo()
  if (info.sessionId === undefined) throw new SlotAssemblyError('strict session slot rendered without a session')
  return info as SessionProvideInfo
}

/**
 * Identity-stable selector hook per host observable. uSES resubscribes when
 * the subscribe reference changes, so the bound hook must be created once per
 * source — cached here by source identity (sources are host-owned singletons).
 * @param source - host-provided observable.
 * @returns the cached selector hook.
 */
export function observableHook<T>(source: HostObservable<T>, label = 'unknown'): SnapshotSelectorHook<T> {
  const candidate = source as unknown
  if (candidate === null || typeof candidate !== 'object'
    || typeof (candidate as { getSnapshot?: unknown }).getSnapshot !== 'function'
    || typeof (candidate as { subscribe?: unknown }).subscribe !== 'function') {
    const kind = candidate === null ? 'null' : typeof candidate
    throw new SlotAssemblyError(`invalid observable source for ${label} (${kind})`)
  }
  let hook = hookCache.get(source)
  if (hook === undefined) {
    hook = bindSnapshotSelector(source)
    hookCache.set(source, hook)
  }
  return hook as SnapshotSelectorHook<T>
}
const hookCache = new WeakMap<object, unknown>()

const absentSource: HostObservable<undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/** Empty binding used while a legacy/HMR-overlapped host has no provider feed. */
export const ABSENT_SESSION_INFO: SessionMaybeProvideInfo = Object.freeze({
  sessionId: undefined,
  hooks: Object.freeze({}),
  props: Object.freeze({}),
})

/** Preserve the root shell when an older host omits the optional provider feed. */
export function sessionInfoOrAbsent(info: SessionMaybeProvideInfo | undefined): SessionMaybeProvideInfo {
  return info ?? ABSENT_SESSION_INFO
}

/** Bind a source that disappears with the current session to an optional selector hook. */
export function maybeObservableHook<T>(source: HostObservable<T> | undefined, label = 'optional'): MaybeSnapshotSelectorHook<T> {
  // Runtime faces can cross an HMR/legacy boundary as `null` even though the
  // TypeScript contract uses `undefined` for absence. Treat both as the same
  // capability absence before touching the WeakMap-backed source cache.
  if (source !== undefined && source !== null) return observableHook(source, label)
  return useAbsentSnapshot
}

function useAbsentSnapshot<S>(_selector: (snapshot: never) => S, _equal?: (a: S, b: S) => boolean): S | undefined {
  // The uSES subscription must still run (hook-order stability); the absent
  // source always snapshots undefined, returned explicitly.
  observableHook(absentSource, 'absent')(() => undefined)
  return undefined
}

/**
 * The useProjection framework seat (docs/subsystems/session-projection.md), one bound
 * function per provide bundle (cached by info identity — components may hold
 * it across renders). Key-addressed: the key resolves a per-session value
 * face off the projection store; the bound selector hook comes from the same
 * per-source cache as every other kit hook, so exactly one uSES subscription
 * runs per call and the subscribe reference stays stable per key. A key no
 * baseline or frame has carried (or a no-session bundle) reads `undefined` —
 * capability absence — keeping the hook order constant.
 */
export function projectionHook(info: SessionMaybeProvideInfo): (
  key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean,
) => unknown {
  let hook = projectionHookCache.get(info)
  if (hook === undefined) {
    hook = (key, selector, eq) => {
      // The no-session (faceless) branch binds the shared absent source so
      // the caller's selector still runs over `undefined` (absence flows
      // through the selector) and the uSES call count stays constant.
      const useValue = observableHook(info.projections?.faceOf(key) ?? absentSource, `projection:${key}`)
      // Whole values are finished wire payloads (reference changes only when
      // a frame or baseline lands), so the identity selector needs no
      // equality function.
      return useValue(selector ?? (value => value), eq)
    }
    projectionHookCache.set(info, hook)
  }
  return hook
}
const projectionHookCache = new WeakMap<SessionMaybeProvideInfo, (
  key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean,
) => unknown>()

/**
 * Root-level binding provider. It follows current selection without a key;
 * per-entry identity is the outlet's adoption bookkeeping (SessionMaybeEntry):
 * a blank-born incarnation adopts the first session without remounting, and
 * every later transition (switch or loss) remounts like a strict entry.
 */
export function SessionMaybeProvider({ children }: { children: ReactNode }) {
  const host = useHost()
  const info = sessionInfoOrAbsent(
    maybeObservableHook(host.sessions?.provideInfo, 'sessions.provideInfo')(s => s),
  )
  return (
    <BindingContext.Provider value={info}>
      {children}
    </BindingContext.Provider>
  )
}

/** SessionProvider API: render-prop body plus the no-session branch. */
export interface SessionProviderProps {
  /** No-session body (also covers a current id whose session cannot be resolved). */
  empty?: (() => ReactNode) | undefined
  /** Session body; remounted per session via key={sessionId}. */
  children: (sessionId: string) => ReactNode
}

/**
 * Framework-wired session area: subscribes to the host's current provide
 * source and remounts the body under `key={sessionId}` so a session switch
 * rebuilds the session subtree. This dependency-inverted layer uses plain
 * string ids; `PropsRuntime` applies the branded type at the component
 * boundary.
 */
export function SessionProvider({ empty, children }: SessionProviderProps) {
  const host = useHost()
  const info = sessionInfoOrAbsent(
    maybeObservableHook(host.sessions?.provideInfo, 'sessions.provideInfo')(s => s),
  )
  const id = info.sessionId
  if (id === undefined) return <>{empty?.() ?? null}</>
  return (
    <BindingContext.Provider value={info} key={id}>
      {children(id)}
    </BindingContext.Provider>
  )
}
