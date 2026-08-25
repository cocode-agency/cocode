/** Renderer-local sidebar logo preference. */

export const LOGO_PREFERENCES = ['cocode', 'deepseek'] as const
export type LogoPreference = typeof LOGO_PREFERENCES[number]

export const DEFAULT_LOGO_PREFERENCE: LogoPreference = 'cocode'
const STORAGE_KEY = 'cocode.logo.preference'

export function isLogoPreference(value: unknown): value is LogoPreference {
  return LOGO_PREFERENCES.some(preference => preference === value)
}

/** Read the device-local display choice; unavailable storage falls back safely. */
export function readLogoPreference(): LogoPreference {
  if (typeof localStorage === 'undefined') return DEFAULT_LOGO_PREFERENCE
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLogoPreference(value) ? value : DEFAULT_LOGO_PREFERENCE
  } catch {
    return DEFAULT_LOGO_PREFERENCE
  }
}

/** Persist the display choice without making rendering depend on storage health. */
export function writeLogoPreference(preference: LogoPreference): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // A private or locked-down browser can deny storage; the live choice still applies.
  }
}
