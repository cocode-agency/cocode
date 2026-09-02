import z from "schemastery"
import type Schema from "schemastery"

export const SHORTCUTS_SETTINGS_NAMESPACE = "cocode-shortcuts"
export const SHORTCUTS_SETTINGS_VERSION = 1

export const ShortcutSettingsSchema = z.object({
  version: z.number().default(SHORTCUTS_SETTINGS_VERSION),
  bindings: z.dict(z.object({
    combo: z.object({
      key: z.string(),
      primary: z.boolean().default(false),
      alt: z.boolean().default(false),
      shift: z.boolean().default(false),
      control: z.boolean().default(false),
    }).required(false),
    scope: z.union(["app", "global"]).required(false),
    disabled: z.boolean().required(false),
  })).default({}),
}) as unknown as Schema<unknown, ShortcutSettings>

export type ShortcutSettings = {
  readonly version: 1
  readonly bindings: Record<string, UserBinding>
}

export type UserBinding = {
  readonly combo?: import("./client/combo.ts").Combo
  readonly scope?: "app" | "global"
  readonly disabled?: boolean
}

export type ShortcutSettingsView = {
  readonly value: ShortcutSettings
  readonly user?: unknown
  readonly base?: unknown
  readonly revision: number
  readonly writable: boolean
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  version: 1,
  bindings: {},
}
