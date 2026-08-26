import { describe, expect, it, vi } from 'vitest'
import type { TuiApp, TuiSnapshot } from '../../src/runtime/app.ts'
import {
  dispatchComposerShortcut,
  dispatchComposerTab,
  dispatchHelpInput,
  dispatchKeyCommand,
  isCopyShortcut,
  moveSelection,
} from '../../src/present/chat-input.ts'

describe('chat input helpers', () => {
  it('wraps selection indexes and handles empty menus', () => {
    expect(moveSelection(0, -1, 3)).toBe(2)
    expect(moveSelection(2, 1, 3)).toBe(0)
    expect(moveSelection(4, 1, 0)).toBe(0)
  })

  it('dispatches stable keymap commands to TuiApp actions', () => {
    const dispatch = vi.fn()
    const app = { dispatch } as unknown as TuiApp
    dispatchKeyCommand(app, 'input.submit', 'hello')
    dispatchKeyCommand(app, 'input.steer', 'steer this')
    dispatchKeyCommand(app, 'input.newline', '')
    dispatchKeyCommand(app, 'session.new', '')
    dispatchKeyCommand(app, 'session.open', '')
    dispatchKeyCommand(app, 'file.open', '')
    dispatchKeyCommand(app, 'permission.toggle', '')
    dispatchKeyCommand(app, 'history.next', '')
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'submit', text: 'hello' }],
      [{ type: 'steer', text: 'steer this' }],
      [{ type: 'insertDraft', text: '\n' }],
      [{ type: 'session.new' }],
      [{ type: 'session.open' }],
      [{ type: 'file.open' }],
      [{ type: 'permission.toggle' }],
      [{ type: 'historyNext' }],
    ])
  })

  it('routes interrupt keys while help is open and consumes other input', () => {
    const dispatch = vi.fn()
    const app = { dispatch } as unknown as TuiApp

    expect(dispatchHelpInput(app, '', { escape: true })).toBe(true)
    expect(dispatchHelpInput(app, 'x', {})).toBe(true)
    expect(dispatch.mock.calls).toEqual([[{ type: 'interruptOrQuit' }]])
  })

  it('queues a draft while running and toggles plan mode while idle', () => {
    const dispatch = vi.fn()
    const app = { dispatch } as unknown as TuiApp
    const base = {
      composer: { text: 'follow up' },
      capabilities: { planMode: true },
    } as TuiSnapshot

    expect(dispatchComposerTab(app, { ...base, agent: 'running' })).toBe(true)
    expect(dispatchComposerTab(app, { ...base, agent: 'idle' })).toBe(true)
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'queuePrompt' }],
      [{ type: 'plan.toggle' }],
    ])
  })

  it('does not consume Tab when no mode action is available', () => {
    const dispatch = vi.fn()
    const app = { dispatch } as unknown as TuiApp
    const snapshot = {
      agent: 'running',
      composer: { text: '' },
      capabilities: { planMode: false },
    } as TuiSnapshot
    expect(dispatchComposerTab(app, snapshot)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('routes composer selection shortcuts without stealing unselected Ctrl+C', () => {
    const dispatch = vi.fn()
    const app = { dispatch } as unknown as TuiApp
    const base = {
      composer: { text: 'hello', selection: { start: 0, end: 5 } },
    } as TuiSnapshot

    expect(dispatchComposerShortcut(app, base, 'a', { ctrl: true })).toBe(true)
    expect(dispatchComposerShortcut(app, base, 'c', { meta: true })).toBe(true)
    expect(dispatchComposerShortcut(app, base, 'x', { ctrl: true })).toBe(true)
    expect(dispatchComposerShortcut(app, base, 'a', { super: true })).toBe(true)
    expect(dispatchComposerShortcut(app, base, 'c', { super: true })).toBe(true)
    expect(dispatchComposerShortcut(app, base, 'x', { super: true })).toBe(true)
    expect(
      dispatchComposerShortcut(
        app,
        { ...base, composer: { text: 'hello' } } as TuiSnapshot,
        'c',
        { ctrl: true },
      ),
    ).toBe(false)
    expect(
      dispatchComposerShortcut(
        app,
        { ...base, composer: { text: 'hello' } } as TuiSnapshot,
        'c',
        { super: true },
      ),
    ).toBe(true)
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'selectAllDraft' }],
      [{ type: 'copyDraftSelection' }],
      [{ type: 'cutDraftSelection' }],
      [{ type: 'selectAllDraft' }],
      [{ type: 'copyDraftSelection' }],
      [{ type: 'cutDraftSelection' }],
    ])
  })

  it('treats bare C and modifier+C as copy chords', () => {
    expect(isCopyShortcut('c', {})).toBe(true)
    expect(isCopyShortcut('c', { ctrl: true })).toBe(true)
    expect(isCopyShortcut('c', { meta: true })).toBe(true)
    expect(isCopyShortcut('c', { super: true })).toBe(true)
    expect(isCopyShortcut('C', { ctrl: true })).toBe(true)
    expect(isCopyShortcut('c', { shift: true })).toBe(false)
    expect(isCopyShortcut('x', { ctrl: true })).toBe(false)
  })
})
