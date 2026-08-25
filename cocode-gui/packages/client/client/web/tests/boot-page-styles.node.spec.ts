import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bootStyles = readFileSync(new URL('../src/boot-page.module.css', import.meta.url), 'utf8')

describe('BootPage styles', () => {
  it('keeps the boot surface draggable while content remains selectable', () => {
    expect(bootStyles).toMatch(/:global\(\[data-dsh-boot\]\)\s*\{[\s\S]*-webkit-app-region:\s*drag;/)
    expect(bootStyles).toMatch(/:global\(\[data-dsh-boot\]\)\s+:where\(\*\)\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/)
    expect(bootStyles).toMatch(/:global\(\[data-dsh-boot\]\)\s+:where\(\*\)\s*\{[\s\S]*-webkit-user-select:\s*text;/)
    expect(bootStyles).toMatch(/:global\(\[data-dsh-boot\]\)\s+:where\(img\)\s*\{[\s\S]*-webkit-user-drag:\s*auto;/)
  })
})
