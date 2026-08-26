import { describe, expect, it } from 'vitest'
import { matchKey } from '../../src/runtime/keymap.ts'
import { resolveKeymap } from '../../src/runtime/keymap-config.ts'

describe('keymap', () => {
  it('opens the external editor with Ctrl+G', () => {
    expect(matchKey({ raw: 'g', ctrl: true, empty: false })).toEqual({ id: 'editor.open' })
  })

  it('matches Ctrl+Enter as explicit steering', () => {
    expect(matchKey({ raw: '', return: true, ctrl: true, empty: false })).toEqual({
      id: 'input.steer',
    })
  })

  it('keeps Ctrl+G available for an empty draft', () => {
    expect(matchKey({ raw: 'g', ctrl: true, empty: true })).toEqual({ id: 'editor.open' })
  })

  it('keeps Ctrl+L model switching and a slash redraw fallback', () => {
    expect(matchKey({ raw: '?', shift: true, empty: true })).toEqual({ id: 'help.toggle' })
    expect(matchKey({ raw: 'l', ctrl: true, empty: false })).toEqual({ id: 'model.open' })
    const keymap = resolveKeymap({ COCODE_TUI_KEYMAP: '{"model.open":"alt+l"}' })
    expect(matchKey({ raw: 'l', ctrl: true, empty: false }, keymap)).toBeUndefined()
    expect(matchKey({ raw: 'l', alt: true, empty: false }, keymap)).toEqual({ id: 'model.open' })
  })

  it('matches Crush session and permission shortcuts', () => {
    expect(matchKey({ raw: 'n', ctrl: true, empty: false })).toEqual({ id: 'session.new' })
    expect(matchKey({ raw: 's', ctrl: true, empty: false })).toEqual({ id: 'session.open' })
    expect(matchKey({ raw: 'y', ctrl: true, empty: false })).toEqual({
      id: 'permission.toggle',
    })
    expect(matchKey({ raw: 'f', ctrl: true, empty: false })).toEqual({ id: 'file.open' })
    expect(matchKey({ raw: 'v', ctrl: true, empty: false })).toEqual({ id: 'image.paste' })
    expect(matchKey({ raw: 'v', alt: true, empty: false })).toEqual({ id: 'image.paste' })
  })

  it('allows known commands to override their default bindings', () => {
    const keymap = resolveKeymap(
      { COCODE_TUI_KEYMAP: '{"historySearch":"ctrl+f","editor.open":"alt+e"}' },
      () => undefined,
    )
    expect(matchKey({ raw: 'f', ctrl: true, empty: false }, keymap)).toEqual({
      id: 'history.search',
    })
    expect(matchKey({ raw: 'e', alt: true, empty: false }, keymap)).toEqual({ id: 'editor.open' })
    expect(matchKey({ raw: 'r', ctrl: true, empty: false }, keymap)).toBeUndefined()
  })

  it('removes conflicting defaults when a custom binding takes the key', () => {
    const keymap = resolveKeymap({ COCODE_TUI_KEYMAP: '{"fileOpen":"ctrl+r"}' })
    expect(matchKey({ raw: 'r', ctrl: true, empty: false }, keymap)).toEqual({ id: 'file.open' })
    expect(matchKey({ raw: 'f', ctrl: true, empty: false }, keymap)).toBeUndefined()

    const emptyConflict = resolveKeymap({ COCODE_TUI_KEYMAP: '{"fileOpen":"ctrl+d"}' })
    expect(matchKey({ raw: 'd', ctrl: true, empty: true }, emptyConflict)).toEqual({
      id: 'file.open',
    })
  })

  it('keeps defaults and reports malformed or unknown values', () => {
    const diagnostics: string[] = []
    const keymap = resolveKeymap(
      {
        COCODE_TUI_KEYMAP: '{"unknown":"ctrl+x","editorOpen":"not-a-key","historyPrev":4}',
      },
      (message) => diagnostics.push(message),
    )
    expect(matchKey({ raw: 'g', ctrl: true, empty: false }, keymap)).toEqual({ id: 'editor.open' })
    expect(matchKey({ raw: 'up', upArrow: true, empty: false }, keymap)).toEqual({
      id: 'history.prev',
    })
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics.join('\n')).toContain('unknown keymap command')
    expect(diagnostics.join('\n')).toContain('invalid key')
  })

  it('falls back to all defaults when JSON is invalid', () => {
    const diagnostics: string[] = []
    const keymap = resolveKeymap({ COCODE_TUI_KEYMAP: '{not-json' }, (message) =>
      diagnostics.push(message),
    )
    expect(matchKey({ raw: 'r', ctrl: true, empty: false }, keymap)).toEqual({
      id: 'history.search',
    })
    expect(diagnostics).toEqual([
      'Cocode TUI: invalid COCODE_TUI_KEYMAP JSON; using default keymap.',
    ])
  })
})
