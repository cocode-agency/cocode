/** General settings row for the directory used by ordinary chat sessions. */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkspaceStorageRow.module.css'

export interface WorkspaceStorageState {
  path: string
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
}

export interface WorkspaceStorageRowInjected {
  hooks: { storage: SnapshotStore<WorkspaceStorageState> }
  pickDirectory: () => Promise<string | null>
  setStoragePath: (path: string) => Promise<void>
}

export type WorkspaceStorageRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'workspace'>
  & InjectFace<WorkspaceStorageRowInjected>

export function WorkspaceStorageRow({ useStorage, pickDirectory, setStoragePath, t }: WorkspaceStorageRowProps) {
  const state = useStorage(snapshot => snapshot)
  const [busy, setBusy] = useState(false)

  const choose = (): void => {
    setBusy(true)
    void pickDirectory().then((path) => {
      if (path !== null) return setStoragePath(path)
    }).finally(() => { setBusy(false) })
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.storage.title')}</div>
        <div className={css.desc}>{t('settings.storage.description')}</div>
        <div className={css.path} title={state.path || t('settings.storage.systemDefault')}>
          {state.path || t('settings.storage.systemDefault')}
        </div>
      </div>
      <Button variant="outline" disabled={busy || !state.writable} onClick={choose}>
        {t('settings.storage.choose')}
      </Button>
    </div>
  )
}
