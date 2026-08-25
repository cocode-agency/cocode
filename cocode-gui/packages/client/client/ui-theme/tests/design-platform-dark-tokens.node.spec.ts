import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles/design-platform.css', import.meta.url), 'utf8')
const darkTheme = css.slice(css.indexOf('body[data-ds-dark-theme]'))

describe('dark theme surface tokens', () => {
  it('keeps menu, sidebar, and elevated button surfaces on the desktop palette', () => {
    expect(darkTheme).toContain('--dsw-specific-menu: #161619;')
    expect(darkTheme).toContain('--dsw-specific-sidebar-fill: color-mix(in srgb, #101012 88%, transparent);')
    expect(darkTheme).toContain('--dsw-alias-button-elevated-fill: #161619;')
  })

  it('uses the requested dark base, primary button, and input surfaces', () => {
    expect(darkTheme).toContain('--dsw-alias-bg-base: #0a0a0b;')
    expect(darkTheme).toContain('--dsw-alias-button-primary-fill: #f4f4f5;')
    expect(darkTheme).toContain('--dsw-specific-input-major: #121215;')
  })

  it('uses the requested dark layer, platform module, and active navigation surfaces', () => {
    expect(darkTheme).toContain('--dsw-alias-bg-layer-3: #161619;')
    expect(darkTheme).toContain('--dsw-alias-bg-module-platform: #101012;')
    expect(darkTheme).toContain('--dsw-specific-sidebar-nav-item-active: #242428;')
  })

  it('uses the requested dark overlay surface', () => {
    expect(darkTheme).toContain('--dsw-alias-bg-overlay: #161619;')
  })
})
