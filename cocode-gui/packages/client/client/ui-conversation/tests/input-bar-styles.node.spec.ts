import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/InputBar.module.css', import.meta.url)),
  'utf8',
)

function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('InputBar primary action theme', () => {
  it('uses the custom primary theme tokens instead of the blue info tokens', () => {
    expect(declarations('.primary')?.get('background')).toBe('var(--dsw-alias-button-primary-fill)')
    expect(declarations('.primary')?.get('color')).toBe('var(--dsw-alias-label-inverse)')
    expect(declarations('.primary:hover:not(:disabled)')?.get('background')).toBe(
      'var(--dsw-alias-button-primary-hover)',
    )
  })
})
