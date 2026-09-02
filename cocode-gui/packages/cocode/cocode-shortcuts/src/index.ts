import type { Context } from "./context-types.ts"
import {
  registerShortcutsRoute,
  type ShortcutSettingsFace,
  type ShortcutSettingsView,
} from "./route.ts"
import { SHORTCUTS_SETTINGS_NAMESPACE, ShortcutSettingsSchema } from "./settings.ts"

export { SHORTCUTS_SETTINGS_NAMESPACE, ShortcutSettingsSchema }
export type { ShortcutSettings, ShortcutSettingsView, UserBinding } from "./settings.ts"
export { SHORTCUTS_API_PREFIX } from "./route.ts"

export const name = "cocode-shortcuts"
export const inject = ["webServer", "webRuntime"]

/** Register the settings namespace and its plugin-owned trusted Web route. */
export function apply(ctx: Context): void {
  let settingsFace: ShortcutSettingsFace | undefined
  ctx.inject(["settings"], (settingsCtx) => {
    const namespace = SHORTCUTS_SETTINGS_NAMESPACE
    settingsCtx.settings.register(namespace, ShortcutSettingsSchema)
    const read = (): ShortcutSettingsView => {
      const descriptor = settingsCtx.settings
        .describe({ redactSecrets: true })
        .find(candidate => candidate.ns === namespace)
      if (descriptor === undefined) {
        throw new Error("the cocode-shortcuts settings namespace is not registered")
      }
      return {
        value: descriptor.value as ShortcutSettingsView["value"],
        ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
        ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
        revision: descriptor.revision,
        writable: settingsCtx.settings.writable,
      }
    }
    const face: ShortcutSettingsFace = {
      get: read,
      update: async (patch, expectedRevision) => {
        await settingsCtx.settings.update(namespace, patch, expectedRevision)
        return read()
      },
    }
    settingsFace = face
    return () => {
      if (settingsFace === face) settingsFace = undefined
    }
  })
  ctx.effect(
    () => registerShortcutsRoute(ctx, () => settingsFace),
    "cocode-shortcuts: settings route",
  )
}
