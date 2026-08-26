import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { resolveFooterHints, type FooterOverlay } from '../../src/present/footer-hints.ts'
import { resolveKeymap } from '../../src/runtime/keymap-config.ts'
import { DEFAULT_BINDINGS, type Keymap } from '../../src/runtime/keymap.ts'

describe('resolveFooterHints', () => {
  it.each(['en', 'zh'] as const)('packs %s hints within common terminal widths', (locale) => {
    for (const columns of [40, 60, 80, 120, 160]) {
      const footer = resolveFooterHints(
        { agent: 'idle', draft: '', messageSelection: false },
        resolveKeymap({}),
        locale,
        columns,
      )
      const rendered = renderFooter(footer)
      expect(stringWidth(rendered)).toBeLessThanOrEqual(columns)
      expect(rendered).not.toMatch(/^ · | · $| ·  · /)
      expect(footer.hints.every((hint) => hint.text.length > 0)).toBe(true)
    }
  })

  it('uses configured bindings and never leaves the default shortcut behind', () => {
    const footer = resolveFooterHints(
      { agent: 'idle', draft: 'hello', messageSelection: false },
      resolveKeymap({ COCODE_TUI_KEYMAP: '{"model.open":"alt+l"}' }),
      'en',
      160,
    )
    expect(renderFooter(footer)).toContain('Alt+L model')
    expect(renderFooter(footer)).not.toContain('Ctrl+L')
  })

  it('omits commands without a binding', () => {
    const keymap: Keymap = { ...DEFAULT_BINDINGS, 'model.open': [] }
    const footer = resolveFooterHints(
      { agent: 'idle', draft: '', messageSelection: false },
      keymap,
      'en',
      160,
    )
    expect(footer.hints.map((hint) => hint.id)).not.toContain('model')
  })

  it('keeps complete high-priority hints and reports hidden items', () => {
    const footer = resolveFooterHints(
      { agent: 'idle', draft: '', messageSelection: false },
      resolveKeymap({}),
      'en',
      12,
    )
    expect(footer.hints[0]?.id).toBe('send')
    expect(footer.hiddenCount).toBeGreaterThan(0)
  })

  it('returns no partial hint when the terminal is too narrow', () => {
    const footer = resolveFooterHints(
      { agent: 'idle', draft: '', messageSelection: false },
      resolveKeymap({}),
      'en',
      4,
    )
    expect(footer.hints).toEqual([])
    expect(footer.hiddenCount).toBeGreaterThan(0)
  })

  it('keeps every overlay isolated from main chat hints', () => {
    const overlays: readonly FooterOverlay[] = [
      'slash', 'file', 'history', 'resume', 'sessionTree', 'queue', 'checklist',
      'rewind', 'fork', 'skills', 'plugins', 'model', 'modelInput', 'effort', 'question',
      'approval', 'review', 'help', 'commandPalette', 'messageActions',
    ]
    for (const activeOverlay of overlays) {
      const footer = resolveFooterHints(
        { activeOverlay, agent: 'running', draft: 'draft', messageSelection: true },
        resolveKeymap({}),
        'en',
        160,
      )
      const rendered = renderFooter(footer)
      expect(rendered).not.toContain('model')
      expect(rendered).not.toContain('interrupt')
      expect(stringWidth(rendered)).toBeLessThanOrEqual(160)
    }
  })

  it('projects draft, running, selection, focus, and confirmation states', () => {
    const keymap = resolveKeymap({})
    expect(resolveFooterHints({ agent: 'running', draft: '', messageSelection: false }, keymap, 'en', 160).hints.map((hint) => hint.id)).toEqual(['interrupt'])
    expect(resolveFooterHints({ agent: 'running', draft: 'queued', messageSelection: false }, keymap, 'en', 160).hints.map((hint) => hint.id)).toEqual(['interrupt', 'queue-draft'])
    expect(resolveFooterHints({ agent: 'running', draft: 'queued', messageSelection: false, steeringAvailable: true }, keymap, 'en', 160).hints.map((hint) => hint.id)).toEqual(['interrupt', 'queue-draft', 'steer-draft'])
    const customKeymap = resolveKeymap({
      COCODE_TUI_KEYMAP: '{"input.submit":"alt+enter","input.steer":"ctrl+shift+enter"}',
    })
    const custom = resolveFooterHints(
      { agent: 'running', draft: 'queued', messageSelection: false, steeringAvailable: true },
      customKeymap,
      'en',
      160,
    )
    expect(renderFooter(custom)).toContain('Alt+Enter queue draft')
    expect(renderFooter(custom)).toContain('Ctrl+Shift+Enter steer')
    expect(resolveFooterHints({ agent: 'idle', draft: '', messageSelection: true }, keymap, 'en', 160).hints.map((hint) => hint.id)).toEqual(['message-move', 'message-copy', 'message-actions', 'message-close'])
    expect(resolveFooterHints({ agent: 'idle', draft: '', messageSelection: true, messageDetailsAvailable: true }, keymap, 'en', 160).hints.map((hint) => hint.id)).toContain('message-details')
    expect(resolveFooterHints({ agent: 'idle', draft: '', messageSelection: false, paneFocus: 'inspector' }, keymap, 'en', 160).hints.map((hint) => hint.id)).toContain('pane-scroll')
    expect(resolveFooterHints({ activeOverlay: 'rewind', overlayConfirming: true, agent: 'idle', draft: '', messageSelection: false }, keymap, 'en', 160).hints.map((hint) => hint.id)).toEqual(['confirm', 'cancel'])
  })

  it('shows transcript controls instead of an Esc quit hint for read-only sessions', () => {
    const footer = resolveFooterHints(
      {
        agent: 'idle',
        draft: '',
        readOnly: true,
        messageSelection: false,
        detailsAvailable: true,
      },
      resolveKeymap({}),
      'en',
      160,
    )
    expect(footer.hints.map((hint) => hint.id)).toEqual([
      'message-scroll',
      'message-select',
      'details',
      'read-only-back',
      'read-only-quit',
    ])
    expect(renderFooter(footer)).not.toContain('Esc interrupt')
    expect(renderFooter(footer)).toContain('Ctrl+C quit')
    expect(renderFooter(footer)).toContain('Esc back')
  })
})

function renderFooter(footer: ReturnType<typeof resolveFooterHints>): string {
  return footer.hints.map((hint) => hint.text).join(' · ')
}
