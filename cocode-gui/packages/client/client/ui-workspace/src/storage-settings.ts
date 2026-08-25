/** Durable settings for ordinary chats that are not attached to a project. */

import z from '@deepseek-ai/schemastery'

/** Host settings namespace owned by the workspace plugin. */
export const WORKSPACE_SETTINGS_NAMESPACE = 'ui-workspace'

/** Field storing the directory used by ungrouped sessions. */
export const DEFAULT_STORAGE_PATH_FIELD = 'defaultStoragePath'

/** Settings section shared by the Host schema and browser scope. */
export interface WorkspaceSettings {
  defaultStoragePath: string
}

/** Empty path means the Host's normal default directory. */
export const WorkspaceSettingsSchema: z<WorkspaceSettings> = z.object({
  [DEFAULT_STORAGE_PATH_FIELD]: z.string().default(''),
})
