/**
 * Appearance section slot store: a mirror of the theme service snapshot. The
 * plugin's apply-world change listener is the only writer; the section
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_MESSAGE_FONT_SIZE,
  type MessageFontSize,
  type ThemePreference,
} from '../theme-settings.ts'
import type { LogoPreference } from './logo-settings.ts'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceSectionState {
  /** Persisted preference (light, dark, or system/auto). */
  preference: ThemePreference
  /** Resolved scheme while preference is `system`. */
  activeColorScheme: 'light' | 'dark'
  /** Selected sidebar logo style. */
  logoPreference: LogoPreference
  /** Conversation message-list font size in pixels. */
  messageFontSize: MessageFontSize
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceSectionActions = {
  sync: (
    draft: AppearanceSectionState,
    preference: ThemePreference,
    activeColorScheme: 'light' | 'dark',
    logoPreference: LogoPreference,
    messageFontSize: MessageFontSize,
    revision: number,
  ) => void
}

/**
 * Declares the Appearance section state and write surface.
 * @returns the store handle.
 */
export function createAppearanceSectionStore(): EngineStoreHandle<AppearanceSectionState, AppearanceSectionActions> {
  return defineStore({
    init: (): AppearanceSectionState => ({
      preference: 'system',
      activeColorScheme: 'light',
      logoPreference: 'cocode',
      messageFontSize: DEFAULT_MESSAGE_FONT_SIZE,
      revision: -1,
    }),
    actions: {
      sync: (
        d,
        preference: ThemePreference,
        activeColorScheme: 'light' | 'dark',
        logoPreference: LogoPreference,
        messageFontSize: MessageFontSize,
        revision: number,
      ) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.activeColorScheme = activeColorScheme
        d.logoPreference = logoPreference
        d.messageFontSize = messageFontSize
        d.revision = revision
      },
    },
  })
}
