/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  nav: '外观',
  'appearance.title': '外观',
  'appearance.auto': '跟随系统',
  'appearance.system': '跟随系统',
  'appearance.light': '浅色',
  'appearance.dark': '深色',
  'appearance.font.title': '消息字号',
  'appearance.font.14': '14 像素',
  'appearance.font.16': '16 像素',
  'appearance.font.18': '18 像素',
  'appearance.font.20': '20 像素',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  nav: 'Appearance',
  'appearance.title': 'Appearance',
  'appearance.auto': 'Follow system',
  'appearance.system': 'Follow system',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.font.title': 'Message font size',
  'appearance.font.14': '14 px',
  'appearance.font.16': '16 px',
  'appearance.font.18': '18 px',
  'appearance.font.20': '20 px',
} satisfies Record<ThemeKey, string>
