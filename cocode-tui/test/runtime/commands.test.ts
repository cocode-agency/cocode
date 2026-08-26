import { describe, expect, it } from 'vitest'
import type { TuiAction } from '../../src/runtime/app.ts'
import { createBuiltinCommands, helpText, parseSlash } from '../../src/runtime/commands.ts'
import { P0_CAPABILITIES } from '../../src/runtime/capabilities.ts'
import { resolveKeymap } from '../../src/runtime/keymap-config.ts'

describe('commands', () => {
  it('parses slash name and args', () => {
    expect(parseSlash('/status')).toEqual({ name: 'status', args: '' })
    expect(parseSlash('/theme dark')).toEqual({ name: 'theme', args: 'dark' })
    expect(parseSlash('hello')).toBeNull()
  })

  it('lists only available local commands', () => {
    const names = createBuiltinCommands()
      .list(P0_CAPABILITIES)
      .map((command) => command.name)
    expect(names).toEqual([
      'help',
      'exit',
      'quit',
      'q',
      'clear',
      'redraw',
      'status',
      'doctor',
      'theme',
      'lang',
      'model',
      'effort',
      'rewind',
      'thinking',
      'tokens',
      'cost',
      'models',
      'export',
      'copy',
      'todos',
      'review',
      'focus',
      'init',
      'new',
      'compact',
      'use',
      'login',
      'logout',
      'fork',
      'clone',
      'queue',
    ])
  })

  it('unknown names are absent', () => {
    expect(createBuiltinCommands().find('resume', P0_CAPABILITIES)).toBeUndefined()
  })

  it('hides resume when the runtime cannot open persisted sessions', () => {
    const registry = createBuiltinCommands()
    expect(
      registry.find('resume', { ...P0_CAPABILITIES, sessionList: 'jsonl', open: false }),
    ).toBeUndefined()
    expect(
      registry.find('resume', { ...P0_CAPABILITIES, sessionList: 'jsonl', open: true }),
    ).toBeDefined()
    expect(
      registry.find('resume', { ...P0_CAPABILITIES, sessionList: 'rpc', open: true }),
    ).toBeDefined()
  })

  it('localizes the focus command summary in Chinese help', () => {
    expect(helpText(P0_CAPABILITIES, createBuiltinCommands(), 'zh')).toContain(
      '/focus  切换最近一轮聚焦视图',
    )
  })

  it('shows capability-gated Crush shortcuts in help', () => {
    const capabilities = {
      ...P0_CAPABILITIES,
      sessionList: 'rpc' as const,
      open: true,
      permissionMode: true,
    }
    expect(helpText(capabilities, createBuiltinCommands(), 'zh')).toContain(
      'Ctrl+N 新会话 · Ctrl+S 会话 · Ctrl+Y 权限',
    )
    expect(createBuiltinCommands().find('permission', capabilities)?.kind).toBe('local')
    expect(helpText(capabilities, createBuiltinCommands(), 'zh')).toContain(
      'Ctrl/Meta+A 全选 · Ctrl/Meta+C 复制选中 · Ctrl/Meta+X 剪切（Command 需终端转发）',
    )
  })

  it('shows configured shortcut labels in help', () => {
    const keymap = resolveKeymap({
      COCODE_TUI_KEYMAP:
        '{"inputSubmit":"alt+enter","sessionInterruptOrQuit":"ctrl+x","helpToggle":"alt+h","sessionNew":"alt+n","sessionOpen":"ctrl+e","permissionToggle":"shift+y","transcriptToggleVerbose":"alt+o","editorOpen":"alt+g","historySearch":"alt+r","messagesSelect":"shift+up"}',
    })
    const help =
      helpText(
        { ...P0_CAPABILITIES, sessionList: 'rpc', open: true, permissionMode: true },
        createBuiltinCommands(),
        'zh',
        [],
        keymap,
      )
    expect(help).toContain('Alt+N 新会话 · Ctrl+E 会话 · Shift+Y 权限')
    expect(help).toContain('Alt+Enter 发送 · Ctrl+X 中断或退出 · Alt+H 帮助')
    expect(help).toContain('Alt+O 详情 · Alt+G 编辑 · ↑/↓ 历史 · Alt+R 搜索 · Shift+↑ 消息选择')
  })

  it('describes transcript verbosity as details in English help', () => {
    expect(helpText(P0_CAPABILITIES, createBuiltinCommands(), 'en')).toContain(
      'ctrl+o details',
    )
  })

  it('shows explicit steering in help when the runtime supports it', () => {
    expect(
      helpText({ ...P0_CAPABILITIES, promptMode: true }, createBuiltinCommands(), 'en'),
    ).toContain('ctrl+enter steer while running')
  })

  it('/exit dispatches quit', () => {
    const actions: TuiAction[] = []
    const command = createBuiltinCommands().find('exit', P0_CAPABILITIES)
    command?.run(
      {
        dispatch: (action) => actions.push(action),
        newSession: () => {},
        clearTranscript: () => {},
        showStatus: () => {},
        notice: () => {},
        logout: async () => {},
      },
      '',
    )
    expect(actions).toEqual([{ type: 'quit' }])
  })

  it('/use byok delegates to useAuth', () => {
    const used: string[] = []
    const command = createBuiltinCommands().find('use', P0_CAPABILITIES)
    command?.run(commandCtx({ useAuth: (target) => used.push(target) }), 'byok')
    expect(used).toEqual(['byok'])
  })

  it('/use without a channel explains the usage', () => {
    const notices: string[] = []
    const command = createBuiltinCommands().find('use', P0_CAPABILITIES)
    command?.run(commandCtx({ notice: (_tone, message) => notices.push(message) }), '')
    expect(notices.join('\n')).toMatch(/\/use byok/)
    expect(notices.join('\n')).not.toMatch(/sk-|ck_/)
  })

  it('/login delegates to useAuth', () => {
    const used: string[] = []
    const command = createBuiltinCommands().find('login', P0_CAPABILITIES)
    command?.run(commandCtx({ useAuth: (target) => used.push(target) }), '')
    expect(used).toEqual(['login'])
  })

  it('/lang delegates the requested locale', () => {
    const locales: string[] = []
    const command = createBuiltinCommands().find('lang', P0_CAPABILITIES)
    command?.run(commandCtx({ setLocale: (value) => locales.push(value) }), 'zh')
    expect(locales).toEqual(['zh'])
  })

  it('/model delegates the requested model', () => {
    const models: string[] = []
    const command = createBuiltinCommands().find('model', P0_CAPABILITIES)
    command?.run(commandCtx({ setModel: (value) => models.push(value) }), 'm2')
    expect(models).toEqual(['m2'])
  })

  it('/model without an argument and /models open the model picker', () => {
    const opened: string[] = []
    const registry = createBuiltinCommands()
    registry.find('model', P0_CAPABILITIES)?.run(commandCtx({ showModelPicker: () => opened.push('model') }), '')
    registry.find('models', P0_CAPABILITIES)?.run(commandCtx({ showModelPicker: () => opened.push('models') }), '')
    expect(opened).toEqual(['model', 'models'])
  })

  it('/effort opens the picker or applies a level', () => {
    const opened: string[] = []
    const levels: string[] = []
    const registry = createBuiltinCommands()
    registry.find('effort', P0_CAPABILITIES)?.run(
      commandCtx({ showEffortPicker: () => opened.push('effort') }),
      '',
    )
    registry.find('effort', P0_CAPABILITIES)?.run(
      commandCtx({ setEffort: (value) => levels.push(value) }),
      'high',
    )
    expect(opened).toEqual(['effort'])
    expect(levels).toEqual(['high'])
  })

  it('/compact sends a prompt-path request', () => {
    const actions: TuiAction[] = []
    const command = createBuiltinCommands().find('compact', P0_CAPABILITIES)
    command?.run(commandCtx({ dispatch: (action) => actions.push(action) }), '')
    expect(actions).toEqual([{ type: 'compact' }])
  })

  it('maps rewind, thinking, and usage commands to existing app callbacks', () => {
    const actions: TuiAction[] = []
    const calls: string[] = []
    const registry = createBuiltinCommands()
    const ctx = commandCtx({
      dispatch: (action) => actions.push(action),
      showRewindPicker: () => calls.push('rewind'),
      showUsage: () => calls.push('usage'),
    })

    registry.find('rewind', { ...P0_CAPABILITIES, rewind: true })?.run(ctx, '')
    registry.find('thinking', P0_CAPABILITIES)?.run(ctx, '')
    registry.find('tokens', P0_CAPABILITIES)?.run(ctx, '')
    registry.find('cost', P0_CAPABILITIES)?.run(ctx, '')

    expect(calls).toEqual(['rewind', 'usage', 'usage'])
    expect(actions).toEqual([{ type: 'toggleVerbose' }])
  })

  it('keeps quit aliases on the normal quit action', () => {
    const actions: TuiAction[] = []
    const ctx = commandCtx({ dispatch: (action) => actions.push(action) })
    const registry = createBuiltinCommands()

    registry.find('quit', P0_CAPABILITIES)?.run(ctx, '')
    registry.find('q', P0_CAPABILITIES)?.run(ctx, '')

    expect(actions).toEqual([{ type: 'quit' }, { type: 'quit' }])
  })

  it('/copy delegates to the latest assistant callback', () => {
    let called = false
    const command = createBuiltinCommands().find('copy', P0_CAPABILITIES)
    command?.run(commandCtx({ copyLatestAssistant: () => (called = true) }), '')
    expect(called).toBe(true)
  })

  it('/focus delegates to the focus callback', () => {
    let called = false
    const command = createBuiltinCommands().find('focus', P0_CAPABILITIES)
    command?.run(commandCtx({ toggleFocus: () => (called = true) }), '')
    expect(called).toBe(true)
  })

  it('/todos opens the checklist panel', () => {
    let called = false
    const command = createBuiltinCommands().find('todos', P0_CAPABILITIES)
    command?.run(commandCtx({ showChecklist: () => (called = true) }), '')
    expect(called).toBe(true)
  })
})

function commandCtx(
  overrides: Partial<{
    dispatch: (action: TuiAction) => void
    notice: (tone: 'info' | 'error', message: string) => void
    useAuth: (target: 'byok' | 'cocode' | 'login') => void
    setLocale: (value: string) => void
    setModel: (value: string) => void
    showModelPicker: () => void
    showEffortPicker: () => void
    setEffort: (value: string) => void
    showRewindPicker: () => void
    showUsage: () => void
    copyLatestAssistant: () => void
    toggleFocus: () => void
    showChecklist: () => void
  }> = {},
) {
  return {
    dispatch: overrides.dispatch ?? (() => {}),
    newSession: () => {},
    clearTranscript: () => {},
    showStatus: () => {},
    notice: overrides.notice ?? (() => {}),
    logout: async () => {},
    useAuth: overrides.useAuth,
    setLocale: overrides.setLocale,
    setModel: overrides.setModel,
    showModelPicker: overrides.showModelPicker,
    showEffortPicker: overrides.showEffortPicker,
    setEffort: overrides.setEffort,
    showRewindPicker: overrides.showRewindPicker,
    showUsage: overrides.showUsage,
    copyLatestAssistant: overrides.copyLatestAssistant,
    toggleFocus: overrides.toggleFocus,
    showChecklist: overrides.showChecklist,
  }
}
