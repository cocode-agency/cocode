import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)

const block = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('ConversationRoot drag region styles', () => {
  it('keeps the conversation scroll surface draggable while descendants remain selectable and interactive', () => {
    expect(block('.titleRow')).toMatch(/-webkit-app-region:\s*drag;/)
    expect(block('.titleCluster')).toMatch(/-webkit-app-region:\s*drag;/)
    expect(css).toMatch(
      /:global\(\[data-conversation-scroll\]\)\s+:where\(\*\)\s*\{[\s\S]*-webkit-user-select:\s*text;/,
    )
    expect(css).toMatch(
      /:global\(\[data-conversation-scroll\]\)\s+:where\(img\)\s*\{[\s\S]*-webkit-user-drag:\s*auto;/,
    )
    expect(block('.scrollBodyDrag')).toMatch(/pointer-events:\s*none;/)
  })

  it('does not expand native drag regions across a large active transcript', () => {
    expect(css).toMatch(
      /\.root\[data-phase='active'\]\s+:global\(\[data-conversation-scroll\]\)\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/,
    )
    expect(css).toMatch(
      /\.root\[data-phase='hero'\]\s+:global\(\[data-conversation-scroll\]\)\s*\{[\s\S]*-webkit-app-region:\s*drag;/,
    )
    expect(css).toMatch(
      /\.root\[data-phase='active'\]\s+\.scrollBodyDrag\s*\{[\s\S]*display:\s*none;/,
    )
    expect(css).toMatch(
      /\.root\[data-phase='hero'\]\s+:global\(\[data-conversation-scroll\]\)\s+:where\(\*\)\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/,
    )
  })

  it('keeps the fallback drag strip inside the scrolling body after transcript scroll', () => {
    expect(block('.scrollBody')).toMatch(/position:\s*relative;/)
  })
})
