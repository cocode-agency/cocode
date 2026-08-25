/**
 * Shell root: boot loading page → (boot settled) → real UI in one switch.
 * Pure kernel component with zero plugin dependencies — before settled it may
 * only rely on itself (the fail-loud presentation must not depend on the
 * system whose failure it reports; the status/signal stores are kernel-own,
 * shell self-sufficiency rule); the real UI is produced by the
 * app-shell entry once every entry is active. A failed boot keeps the
 * loading page, lists the per-entry fiber states and the sweep report (fail
 * loud, no partial UI).
 */
import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { KernelSignal, LoaderStatus } from './loader-status.ts'
import css from './AppRoot.module.css'

/** AppRoot props: settled signal, fiber-state projection feed, boot failure report, deferred real-UI factory. */
export interface AppRootProps {
  /** True once the boot chain settled (loader quiesced + all entries ACTIVE); the boot closure flips it. */
  settled: KernelSignal<boolean>
  /** Per-entry fiber-state projection store (drives loading/failed rendering). */
  status: KernelSignal<LoaderStatus>
  /** Boot failure report (the settle rejection message); undefined while loading or after success. */
  error: KernelSignal<string | undefined>
  /** Builds the real UI; called only after settled. */
  renderApp: () => ReactNode
  /** Reloads the shell with a fresh boot graph after a failed startup. */
  onRetry?: () => void
}

/** Boot gate: loading page until the boot settles; failures stay here. */
export function AppRoot(props: AppRootProps) {
  const settled = useSyncExternalStore(props.settled.subscribe, props.settled.getSnapshot)
  const status = useSyncExternalStore(props.status.subscribe, props.status.getSnapshot)
  const error = useSyncExternalStore(props.error.subscribe, props.error.getSnapshot)
  const failed = Object.entries(status).filter(([, s]) => s === 'failed')
  const [retrying, setRetrying] = useState(false)

  if (settled) return <>{props.renderApp()}</>

  const loud = error !== undefined || failed.length > 0

  return (
    <div className={css.boot}>
      <div className={css.card}>
        <div className={css.wordmark}>HARNESS</div>
        {!loud
          ? (
            <>
              <div className={css.spinner} />
              <div className={css.hint}>正在准备应用…</div>
            </>
          )
          : (
            <div className={css.failed} role="alert">
              <div className={css.failedIcon} aria-hidden="true">!</div>
              <div className={css.failedTitle}>Cocode 暂时还没准备好</div>
              <div className={css.failedMessage}>
                启动时遇到了一点问题，我们已经自动尝试修复。请点击“重新尝试”；如果仍然打不开，请重启应用。
              </div>
              <div className={css.actions}>
                <button
                  type="button"
                  className={css.primaryAction}
                  disabled={retrying || props.onRetry === undefined}
                  onClick={() => {
                    setRetrying(true)
                    props.onRetry?.()
                  }}
                >
                  {retrying ? '正在重新打开…' : '重新尝试'}
                </button>
                <button type="button" className={css.secondaryAction} onClick={() => window.location.reload()}>
                  重启应用
                </button>
              </div>
              <details className={css.details}>
                <summary>查看技术信息</summary>
                <div className={css.detailBody}>
                  {failed.map(([id]) => <div key={id} className={css.failedItem}>{id}</div>)}
                  {error !== undefined && <pre className={css.failedItem}>{error}</pre>}
                </div>
              </details>
            </div>
          )}
      </div>
    </div>
  )
}
