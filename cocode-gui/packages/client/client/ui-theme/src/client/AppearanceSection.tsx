/**
 * Appearance settings section: color scheme, sidebar logo, and message-list
 * font size. Registered by this package — the theme feature owns its surface.
 */
import clsx from 'clsx'
import {
  BrandWordmark, IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageFontSize, ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type { LogoPreference } from './logo-settings.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceSectionStore } from './settings-store.ts'
import css from './AppearanceSection.module.css'

/** Injected business face: preference writes (t rides the standard locale seat). */
export interface AppearanceSectionInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Switch the sidebar logo style. */
  setLogo: (id: LogoPreference) => void
  /** Switch the conversation message-list font size. */
  setMessageFontSize: (size: MessageFontSize) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createAppearanceSectionStore>>
  & PropsLocale<'settings.theme'> & AppearanceSectionInjected

/** Cube order and icons: auto (system), light, dark. */
const THEME_CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'system', labelKey: 'appearance.auto', Icon: IconFollowsystemOutline16 },
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
]

const FONT_SIZE_CUBES: readonly { id: MessageFontSize; labelKey: ThemeKey }[] = [
  { id: '14', labelKey: 'appearance.font.14' },
  { id: '16', labelKey: 'appearance.font.16' },
  { id: '18', labelKey: 'appearance.font.18' },
  { id: '20', labelKey: 'appearance.font.20' },
]

const LOGO_CELL_WIDTH = 10
const LOGO_ROW_HEIGHT = 16
const LOGO_LINES = [
  ' ▄█████ ▄████▄ ▄█████ ▄████▄ █████▄ ▄█████',
  ' ██     ██  ██ ██     ██  ██ ██  ██ ██▄▄',
  ' ██     ██  ██ ██     ██  ██ ██  ██ ██▀▀',
  ' ▀█████ ▀████▀ ▀█████ ▀████▀ █████▀ ▀█████',
] as const

/** Settings preview for the exact cocode.agency pixel wordmark. */
function CocodeLogoPreview() {
  const blocks = LOGO_LINES.flatMap((line, rowIndex) => [...line].flatMap((glyph, columnIndex) => {
    const x = columnIndex * LOGO_CELL_WIDTH
    const y = rowIndex * LOGO_ROW_HEIGHT
    if (glyph === '█') return [<rect key={`${rowIndex}-${columnIndex}`} x={x} y={y} width={LOGO_CELL_WIDTH} height={LOGO_ROW_HEIGHT} />]
    if (glyph === '▄') return [<rect key={`${rowIndex}-${columnIndex}`} x={x} y={y + LOGO_ROW_HEIGHT / 2} width={LOGO_CELL_WIDTH} height={LOGO_ROW_HEIGHT / 2} />]
    if (glyph === '▀') return [<rect key={`${rowIndex}-${columnIndex}`} x={x} y={y} width={LOGO_CELL_WIDTH} height={LOGO_ROW_HEIGHT / 2} />]
    return []
  }))
  return (
    <svg width={118.125} height={18} viewBox="0 0 420 64" shapeRendering="crispEdges" aria-hidden="true">
      <g fill="currentColor">{blocks}</g>
    </svg>
  )
}

/**
 * Render the Appearance settings section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function AppearanceSection({
  t, setTheme, setLogo, setMessageFontSize, useStore,
}: AppearanceSectionComponentProps) {
  const { preference, logoPreference, messageFontSize } = useStore(s => s)
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
        <div className={css.title}>{t('appearance.logo.title')}</div>
        <div className={css.cubeRow}>
          <button
            type="button"
            className={clsx(css.themeCube, css.logoCube, logoPreference === 'cocode' && css.selected)}
            aria-pressed={logoPreference === 'cocode'}
            onClick={() => { setLogo('cocode') }}
          >
            <span className={css.logoPreview}><CocodeLogoPreview /></span>
            {t('appearance.logo.cocode')}
          </button>
          <button
            type="button"
            className={clsx(css.themeCube, css.logoCube, logoPreference === 'deepseek' && css.selected)}
            aria-pressed={logoPreference === 'deepseek'}
            onClick={() => { setLogo('deepseek') }}
          >
            <span className={css.logoPreview}><BrandWordmark size={18} /></span>
            {t('appearance.logo.deepseek')}
          </button>
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
