import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles/design-platform.css', import.meta.url), 'utf8')
const darkTheme = css.slice(css.lastIndexOf('body[data-ds-dark-theme]'))

describe('dark theme surface tokens', () => {
  it('keeps menu, sidebar, and elevated button surfaces on the desktop palette', () => {
    expect(darkTheme).toContain('--cocode-surface-raised: #161619;')
    expect(css).toContain('--dsw-specific-menu: var(--cocode-surface-raised);')
    expect(darkTheme).toContain('--dsw-specific-sidebar-fill: color-mix(in srgb, var(--cocode-surface) 88%, transparent);')
    expect(css).toContain('--dsw-alias-button-elevated-fill: var(--cocode-surface-raised);')
  })

  it('uses the requested dark base, primary button, and input surfaces', () => {
    expect(darkTheme).toContain('--cocode-background: #0a0a0b;')
    expect(darkTheme).toContain('--cocode-primary: #f4f4f5;')
    expect(darkTheme).toContain('--cocode-input: #121215;')
    expect(css).toContain('--dsw-alias-bg-base: var(--cocode-background);')
    expect(css).toContain('--dsw-alias-button-primary-fill: var(--cocode-primary);')
    expect(css).toContain('--dsw-specific-input-major: var(--cocode-input);')
  })

  it('uses the requested dark layer, platform module, and active navigation surfaces', () => {
    expect(darkTheme).toContain('--cocode-surface-raised: #161619;')
    expect(darkTheme).toContain('--cocode-surface: #101012;')
    expect(darkTheme).toContain('--cocode-secondary: #242428;')
    expect(css).toContain('--dsw-alias-bg-layer-3: var(--cocode-surface-raised);')
    expect(css).toContain('--dsw-alias-bg-module-platform: var(--cocode-surface);')
    expect(css).toContain('--dsw-specific-sidebar-nav-item-active: var(--cocode-secondary);')
  })

  it('uses the requested dark overlay surface', () => {
    expect(css).toContain('--dsw-alias-bg-overlay: var(--cocode-surface-raised);')
  })
})
