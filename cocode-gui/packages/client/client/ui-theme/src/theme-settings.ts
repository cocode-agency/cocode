/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation message-list font size in pixels. */
export const MESSAGE_FONT_SIZE_FIELD = 'messageFontSize'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Message-list font sizes accepted at settings and CSS boundaries. */
export const MESSAGE_FONT_SIZES = ['14', '16', '18', '20'] as const

/** Persisted message-list font size (pixel value as a string key). */
export type MessageFontSize = typeof MESSAGE_FONT_SIZES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Default message-list font size when no override is stored. */
export const DEFAULT_MESSAGE_FONT_SIZE: MessageFontSize = '14'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation message-list font size in pixels. */
  messageFontSize: MessageFontSize
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [MESSAGE_FONT_SIZE_FIELD]: z.union([...MESSAGE_FONT_SIZES]).default(DEFAULT_MESSAGE_FONT_SIZE),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Narrow one wire or registry value to a persistable message font size.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a supported message font size.
 */
export function isMessageFontSize(value: unknown): value is MessageFontSize {
  return MESSAGE_FONT_SIZES.some(size => size === value)
}
