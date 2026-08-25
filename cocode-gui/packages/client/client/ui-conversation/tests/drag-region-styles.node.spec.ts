import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)

describe('ConversationRoot drag region styles', () => {
  it('keeps the conversation scroll surface draggable while descendants remain selectable and interactive', () => {
    expect(css).toMatch(
      /:global\(\[data-conversation-scroll\]\)\s*\{[\s\S]*-webkit-app-region:\s*drag;/,
    )
    expect(css).toMatch(
      /:global\(\[data-conversation-scroll\]\)\s+:where\(\*\)\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/,
    )
    expect(css).toMatch(
      /:global\(\[data-conversation-scroll\]\)\s+:where\(\*\)\s*\{[\s\S]*-webkit-user-select:\s*text;/,
    )
    expect(css).toMatch(
      /:global\(\[data-conversation-scroll\]\)\s+:where\(img\)\s*\{[\s\S]*-webkit-user-drag:\s*auto;/,
    )
    expect(css).toMatch(/\.scrollBodyDrag\s*\{[\s\S]*pointer-events:\s*none;/)
  })

  it('disables the conversation drag hit region while the settings panel is open', () => {
    expect(css).toMatch(
      /:global\(body:has\(\[data-settings-panel\]\) \[data-conversation-scroll\]\)\s*\{[\s\S]*-webkit-app-region:\s*no-drag;/,
    )
  })
})
