/**
 * Appearance settings section: color scheme and message-list font size.
 * Registered by this package — the theme feature owns its surface.
 */
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { MessageFontSize } from './font-size.ts'
import type { AppearanceLocaleKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceSectionStore } from './settings-store.ts'
import css from './AppearanceSection.module.css'

/** Injected business face: preference writes (t rides the standard locale seat). */
export interface AppearanceSectionInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Switch the conversation message-list font size. */
  setMessageFontSize: (size: MessageFontSize) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createAppearanceSectionStore>>
  & PropsLocale<'settings.appearance'> & AppearanceSectionInjected

/** Cube order and icons: auto (system), light, dark. */
const THEME_CUBES: readonly { id: ThemePreference; labelKey: AppearanceLocaleKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'system', labelKey: 'appearance.auto', Icon: IconFollowsystemOutline16 },
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
]

const FONT_SIZE_CUBES: readonly { id: MessageFontSize; labelKey: AppearanceLocaleKey }[] = [
  { id: '14', labelKey: 'appearance.font.14' },
  { id: '16', labelKey: 'appearance.font.16' },
  { id: '18', labelKey: 'appearance.font.18' },
  { id: '20', labelKey: 'appearance.font.20' },
]

/**
 * Render the Appearance settings section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function AppearanceSection({
  t, setTheme, setMessageFontSize, useStore,
}: AppearanceSectionComponentProps) {
  const { preference, messageFontSize } = useStore(s => s)
  return (
    <div className={css.section}>
      <div className={css.group}>
        <div className={css.title}>{t('appearance.title')}</div>
        <div className={css.cubeRow}>
          {THEME_CUBES.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              type="button"
              className={clsx(css.themeCube, preference === id && css.selected)}
              aria-pressed={preference === id}
              onClick={() => { setTheme(id) }}
            >
              <Icon />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className={css.group}>
        <div className={css.title}>{t('appearance.font.title')}</div>
        <div className={css.cubeRow}>
          {FONT_SIZE_CUBES.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={clsx(css.themeCube, css.fontCube, messageFontSize === id && css.selected)}
              aria-pressed={messageFontSize === id}
              onClick={() => { setMessageFontSize(id) }}
            >
              <span className={css.fontSample} style={{ fontSize: `${id}px` }}>Aa</span>
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
