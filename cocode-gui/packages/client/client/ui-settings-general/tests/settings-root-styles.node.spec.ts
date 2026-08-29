import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')

describe('SettingsRoot.module.css', () => {
  it('keeps the fixed settings panel interactive above Electron drag regions', () => {
    expect(css).toMatch(/\.overlay\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/)
    expect(css).toMatch(/\.overlay\s+:where\(\*\)\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/)
  })
})
