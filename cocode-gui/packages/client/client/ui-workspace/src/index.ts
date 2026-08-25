/**
 * Workspace picker plugin, node half. The Host half owns the durable default
 * storage setting; the browser half owns the picker and its settings row.
 * so the plugin appears in the host cordis.yml / Loader (load and lifecycle
 * follow the host; the browser half ships via exports["./client"], discovered
 * through the package.json dsh.client declaration).
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  WORKSPACE_SETTINGS_NAMESPACE, WorkspaceSettingsSchema,
} from './storage-settings.ts'

export {
  DEFAULT_STORAGE_PATH_FIELD, WORKSPACE_SETTINGS_NAMESPACE, WorkspaceSettingsSchema,
} from './storage-settings.ts'
export type { WorkspaceSettings } from './storage-settings.ts'

export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(WORKSPACE_SETTINGS_NAMESPACE),
      WorkspaceSettingsSchema,
    )
  })
}
