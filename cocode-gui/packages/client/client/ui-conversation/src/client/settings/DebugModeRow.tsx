/** General Settings row for showing low-level context diagnostics in chat. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './EnterBehaviorRow.module.css'

export interface DebugModeRowInjected {
  hooks: { debugMode: SnapshotStore<boolean> }
  setDebugMode: (enabled: boolean) => void
}

export type DebugModeRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<DebugModeRowInjected>

/** Render the opt-in debug mode switch. */
export function DebugModeRow({ useDebugMode, setDebugMode, t }: DebugModeRowProps) {
  const enabled = useDebugMode(value => value)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.debug.title')}</div>
        <div className={css.desc}>{t('settings.debug.description')}</div>
      </div>
      <button
        type="button"
        className={css.selector}
        role="switch"
        aria-checked={enabled}
        onClick={() => { setDebugMode(!enabled) }}
      >
        {enabled ? t('settings.debug.on') : t('settings.debug.off')}
      </button>
    </div>
  )
}
