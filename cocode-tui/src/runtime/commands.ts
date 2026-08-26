/**
 * Local slash table. Missing wire capabilities stay off the menu.
 */

import type { TuiCapabilities } from './capabilities.ts'
import type { TuiCommandCtx } from './app-contracts.ts'
import { DEFAULT_BINDINGS, formatKeyBinding, type CommandId, type Keymap } from './keymap.ts'
import type { UiLocale } from './ui-locale.ts'

export type Command = {
  name: string
  summary: string
  summaryZh?: string
  input?: { hint: string }
  kind: 'local' | 'prompt-text'
  available: (caps: TuiCapabilities) => boolean
  run: (app: TuiCommandCtx, args: string) => void
}

export class CommandRegistry {
  private readonly commands: Command[] = []

  register(command: Command): void {
    this.commands.push(command)
  }

  list(caps: TuiCapabilities): Command[] {
    return this.commands.filter((command) => command.available(caps))
  }

  find(name: string, caps: TuiCapabilities): Command | undefined {
    const needle = name.replace(/^\//, '').toLowerCase()
    return this.list(caps).find((command) => command.name === needle)
  }
}

export function filterCommands(commands: readonly Command[], draft: string): readonly Command[] {
  if (!/^\/\S*$/.test(draft)) return []
  const prefix = draft.slice(1).toLowerCase()
  return commands.filter((command) => command.name.toLowerCase().startsWith(prefix))
}

export function createBuiltinCommands(): CommandRegistry {
  const registry = new CommandRegistry()
  const local = (
    name: string,
    summary: string,
    run: Command['run'],
    summaryZh?: string,
  ): void => {
    registry.register({
      name,
      summary,
      ...(summaryZh === undefined ? {} : { summaryZh }),
      kind: 'local',
      available: () => true,
      run,
    })
  }
  const localWithInput = (
    name: string,
    summary: string,
    input: string,
    run: Command['run'],
    summaryZh?: string,
  ): void => {
    registry.register({
      name,
      summary,
      ...(summaryZh === undefined ? {} : { summaryZh }),
      input: { hint: input },
      kind: 'local',
      available: () => true,
      run,
    })
  }

  local('help', 'Show keyboard and command help', (ctx) => {
    ctx.dispatch({ type: 'toggleHelp' })
  })
  local('exit', 'Shut down the runtime and leave', (ctx) => {
    ctx.dispatch({ type: 'quit' })
  })
  local('quit', 'Exit the TUI', (ctx) => {
    ctx.dispatch({ type: 'quit' })
  }, '退出 TUI')
  local('q', 'Exit the TUI', (ctx) => {
    ctx.dispatch({ type: 'quit' })
  }, '退出 TUI')
  local('clear', 'Clear the projected transcript', (ctx) => {
    ctx.clearTranscript()
  })
  local('redraw', 'Redraw the terminal without clearing the session', (ctx) => {
    ctx.dispatch({ type: 'redraw' })
  })
  local('status', 'Show session, model, and agent state', (ctx) => {
    ctx.showStatus()
  })
  local('doctor', 'Show safe launch and initialize diagnostics', (ctx) => {
    ctx.showDoctor?.()
  })
  localWithInput('theme', 'Switch the terminal theme', 'dark | light', (ctx, args) => {
    const name = args.trim().toLowerCase()
    if (name !== 'dark' && name !== 'light') {
      ctx.notice('info', 'Use /theme dark or /theme light.')
      return
    }
    ctx.setTheme?.(name)
  })
  localWithInput('lang', 'Switch the interface language', 'zh | en', (ctx, args) => {
    const value = args.trim().toLowerCase()
    if (value !== 'zh' && value !== 'en') {
      ctx.setLocale?.(value)
      return
    }
    ctx.setLocale?.(value)
  })
  localWithInput('model', 'Switch the active model and start a new session', '<model>', (ctx, args) => {
    const value = args.trim()
    if (value === '') ctx.showModelPicker?.()
    else ctx.setModel?.(value)
  })
  registry.register({
    name: 'rename',
    summary: 'Rename the current session',
    summaryZh: '重命名当前会话',
    input: { hint: '<title>' },
    kind: 'local',
    available: (caps) => caps.sessionRename === true,
    run: (ctx, args) => ctx.renameSession?.(args),
  })
  localWithInput('effort', 'Set reasoning effort for the current model', '<level>', (ctx, args) => {
    const value = args.trim()
    if (value === '') ctx.showEffortPicker?.()
    else ctx.setEffort?.(value)
  }, '设置当前模型的推理强度')
  registry.register({
    name: 'rewind',
    summary: 'Rewind the conversation to a previous message',
    summaryZh: '回滚到之前的消息',
    kind: 'local',
    available: (caps) => caps.rewind,
    run: (ctx) => ctx.showRewindPicker?.(),
  })
  local('thinking', 'Toggle detailed thinking and tool output', (ctx) => {
    ctx.dispatch({ type: 'toggleVerbose' })
  }, '切换 thinking 和完整工具详情显示')
  local('tokens', 'Show the latest token usage', (ctx) => {
    ctx.showUsage?.()
  }, '查看最近 token 用量')
  local('cost', 'Show the latest token and cache usage', (ctx) => {
    ctx.showUsage?.()
  }, '查看最近 token 和缓存用量')
  local('models', 'Browse available models and switch the active model', (ctx, args) => {
    if (args.trim() !== '') {
      ctx.notice('info', 'Use /models without arguments.')
      return
    }
    ctx.showModelPicker?.()
  })
  local('export', 'Export the projected session as Markdown', (ctx) => {
    void ctx.exportTranscript?.()
  })
  local('copy', 'Copy the latest assistant reply to the clipboard', (ctx) => {
    ctx.copyLatestAssistant?.()
  })
  registry.register({
    name: 'paste-image',
    summary: 'Paste an image from the system clipboard',
    summaryZh: '从系统剪贴板粘贴图片',
    kind: 'local',
    available: (caps) => caps.imageAttachments,
    run: (ctx) => ctx.pasteImage?.(),
  })
  registry.register({
    name: 'todos',
    summary: 'Show the current task checklist',
    summaryZh: '查看当前任务清单',
    kind: 'local',
    available: () => true,
    run: (ctx) => ctx.showChecklist?.(),
  })
  registry.register({
    name: 'review',
    summary: 'Review Git changes in the current workspace',
    summaryZh: 'Review 当前工作区的 Git 改动',
    kind: 'local',
    available: () => true,
    run: (ctx, args) => {
      ctx.review?.(args)
    },
  })
  registry.register({
    name: 'focus',
    summary: 'Toggle the latest-turn focus view',
    summaryZh: '切换最近一轮聚焦视图',
    kind: 'local',
    available: () => true,
    run: (ctx) => {
      ctx.toggleFocus?.()
    },
  })
  local('init', 'Create AGENTS.md when the workspace has none', (ctx) => {
    void ctx.initWorkspace?.()
  })
  registry.register({
    name: 'resume',
    summary: 'List local session history for this workspace',
    kind: 'local',
    available: (caps) => caps.sessionList !== 'none' && caps.open,
    run: (ctx) => {
      void ctx.resumeSessions?.()
    },
  })
  local('new', 'Start a new session id (not a fork)', (ctx) => {
    ctx.newSession()
  })
  local('compact', 'Request host compaction through the prompt path', (ctx) => {
    ctx.dispatch({ type: 'compact' })
  })
  localWithInput('use', 'Switch between API Key and Cocode', 'byok | cocode', (ctx, args) => {
    const target = args.trim().toLowerCase()
    if (target !== 'byok' && target !== 'cocode') {
      ctx.notice('info', 'Use /use byok or /use cocode.')
      return
    }
    ctx.useAuth?.(target)
  })
  local('login', 'Sign in with Cocode', (ctx) => {
    ctx.useAuth?.('login')
  })
  local('logout', 'Sign out of Cocode Nut', (ctx) => {
    void ctx.logout()
  })
  registry.register({
    name: 'skills',
    summary: 'Browse workspace skills available for user invocation',
    kind: 'local',
    available: (caps) => caps.skills,
    run: (ctx) => {
      ctx.showSkillsPicker?.()
    },
  })
  registry.register({
    name: 'plugins',
    summary: 'Show the DeepSeek plugins loaded by the current runtime',
    summaryZh: '查看当前运行时加载的 DeepSeek 插件',
    kind: 'local',
    available: (caps) => caps.plugins,
    run: (ctx, args) => {
      ctx.showPlugins?.(args)
    },
  })
  registry.register({
    name: 'permission',
    summary: 'Choose a runtime permission preset',
    summaryZh: '选择运行时权限 preset',
    kind: 'local',
    available: (caps) => caps.permissionMode,
    run: (ctx) => ctx.dispatch({ type: 'permission.open' }),
  })
  registry.register({
    name: 'permissions',
    summary: 'Cycle runtime permission mode',
    summaryZh: '切换运行时权限模式',
    kind: 'local',
    available: (caps) => caps.permissionMode,
    run: (ctx) => ctx.dispatch({ type: 'permission.toggle' }),
  })
  registry.register({
    name: 'plan',
    summary: 'Toggle runtime plan mode',
    summaryZh: '切换计划模式',
    kind: 'local',
    available: (caps) => caps.planMode,
    run: (ctx) => ctx.dispatch({ type: 'plan.toggle' }),
  })
  registry.register({
    name: 'fork',
    summary: 'Create a child session from the current conversation',
    summaryZh: '从当前对话创建子会话',
    kind: 'local',
    available: (caps) => caps.fork,
    run: (ctx) => ctx.showForkPicker?.(),
  })
  registry.register({
    name: 'clone',
    summary: 'Clone the current conversation into a new session',
    summaryZh: '将当前对话复制到新会话',
    kind: 'local',
    available: (caps) => caps.fork,
    run: (ctx) => ctx.cloneSession?.(),
  })
  registry.register({
    name: 'tree',
    summary: 'Show the session tree from runtime metadata',
    summaryZh: '显示运行时会话树',
    kind: 'local',
    available: (caps) => caps.sessionList !== 'none' && caps.open,
    run: (ctx) => {
      void ctx.showSessionTree?.()
    },
  })
  registry.register({
    name: 'sessions',
    summary: 'List sessions from the runtime when supported',
    summaryZh: '列出运行时会话（如果支持）',
    kind: 'local',
    available: (caps) => caps.sessionList === 'rpc' && caps.open,
    run: (ctx) => {
      void ctx.showSessionTree?.()
    },
  })
  registry.register({
    name: 'queue',
    summary: 'Inspect queued prompts',
    summaryZh: '查看待发送输入队列',
    kind: 'local',
    available: () => true,
    run: (ctx) => ctx.showQueuePicker?.(),
  })
  registry.register({
    name: 'subagents',
    summary: 'List direct child subagents for the current session',
    summaryZh: '查看当前会话的直接子代理',
    kind: 'local',
    available: (caps) => caps.subagentList,
    run: (ctx) => ctx.showSubagents?.(),
  })
  registry.register({
    name: 'history',
    summary: 'Reload the current session history from the Host',
    summaryZh: '从 Host 重新读取当前会话历史',
    input: { hint: '[older]' },
    kind: 'local',
    available: (caps) => caps.sessionHistory,
    run: (ctx, args) => ctx.showHistory?.(args.trim()),
  })
  registry.register({
    name: 'subagent-history',
    summary: 'Open a direct child subagent history as read-only',
    summaryZh: '以只读方式打开直接子代理历史',
    input: { hint: '<child-session-id>' },
    kind: 'local',
    available: (caps) => caps.subagentHistory,
    run: (ctx, args) => ctx.showSubagentHistory?.(args.trim()),
  })
  registry.register({
    name: 'subagent-prompt',
    summary: 'Send a prompt to a continuable direct child',
    summaryZh: '向可继续的直接子代理发送输入',
    input: { hint: '<child-session-id> <text>' },
    kind: 'local',
    available: (caps) => caps.subagentPrompt,
    run: (ctx, args) => {
      const match = /^(\S+)\s+([\s\S]+)$/.exec(args.trim())
      if (match === null) {
        ctx.notice('info', 'Use /subagent-prompt <child-session-id> <text>.')
        return
      }
      ctx.promptSubagent?.(match[1] ?? '', match[2] ?? '')
    },
  })
  registry.register({
    name: 'subagent-interrupt',
    summary: 'Interrupt a continuable direct child',
    summaryZh: '中断可继续的直接子代理',
    input: { hint: '<child-session-id>' },
    kind: 'local',
    available: (caps) => caps.subagentInterrupt,
    run: (ctx, args) => ctx.interruptSubagent?.(args.trim()),
  })
  registry.register({
    name: 'queue-edit',
    summary: 'Edit a pending Host queue item',
    summaryZh: '编辑 Host 队列中的输入',
    input: { hint: '<item-id> <text>' },
    kind: 'local',
    available: (caps) => caps.queueMutation,
    run: (ctx, args) => {
      const match = /^(\S+)\s+([\s\S]+)$/.exec(args.trim())
      if (match === null) {
        ctx.notice('info', 'Use /queue-edit <item-id> <text>.')
        return
      }
      ctx.editRemoteQueue?.(match[1] ?? '', match[2] ?? '')
    },
  })

  return registry
}

export function parseSlash(line: string): { name: string; args: string } | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return null
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (match === null) return null
  return { name: match[1] ?? '', args: (match[2] ?? '').trim() }
}

export function helpText(
  caps: TuiCapabilities,
  registry: CommandRegistry,
  locale: UiLocale = 'en',
  additional: readonly Command[] = [],
  keymap: Keymap = DEFAULT_BINDINGS,
): string {
  const commands = [...registry.list(caps), ...additional]
    .map((command) => `/${command.name}  ${commandSummary(command, locale)}`)
    .join('\n')
  const shortcut = (id: CommandId): string | undefined =>
    formatKeyBinding(keymap[id][0])
  const displayShortcut = (id: CommandId): string | undefined => {
    const value = shortcut(id)
    return value === undefined || locale === 'zh' ? value : value.toLowerCase()
  }
  const globalShortcuts = [
    shortcut('session.new') === undefined
      ? undefined
      : locale === 'zh'
        ? `${shortcut('session.new')} 新会话`
        : `${shortcut('session.new')} new session`,
    caps.sessionList !== 'none' && caps.open && shortcut('session.open') !== undefined
      ? locale === 'zh'
        ? `${shortcut('session.open')} 会话`
        : `${shortcut('session.open')} sessions`
      : undefined,
    caps.permissionMode && shortcut('permission.toggle') !== undefined
      ? locale === 'zh'
        ? `${shortcut('permission.toggle')} 权限`
        : `${shortcut('permission.toggle')} permissions`
      : undefined,
    shortcut('file.open') === undefined
      ? undefined
      : locale === 'zh'
        ? `${shortcut('file.open')} 文件`
        : `${shortcut('file.open')} files`,
  ].filter((item): item is string => item !== undefined)
  const detailShortcuts = [
    displayShortcut('transcript.toggleVerbose') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('transcript.toggleVerbose')} 详情`
        : `${displayShortcut('transcript.toggleVerbose')} details`,
    displayShortcut('editor.open') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('editor.open')} 编辑`
        : `${displayShortcut('editor.open')} editor`,
    displayShortcut('history.prev') === undefined || displayShortcut('history.next') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('history.prev')}/${displayShortcut('history.next')} 历史`
        : `${displayShortcut('history.prev')}/${displayShortcut('history.next')} history`,
    displayShortcut('history.search') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('history.search')} 搜索`
        : `${displayShortcut('history.search')} search`,
    displayShortcut('messages.select') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('messages.select')} 消息选择`
        : `${displayShortcut('messages.select')} message select`,
  ].filter((item): item is string => item !== undefined)
  const coreShortcuts = [
    displayShortcut('input.submit') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('input.submit')} 发送`
        : `${displayShortcut('input.submit')} send`,
    displayShortcut('session.interruptOrQuit') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('session.interruptOrQuit')} 中断或退出`
        : `${displayShortcut('session.interruptOrQuit')} interrupt-or-quit`,
    displayShortcut('help.toggle') === undefined
      ? undefined
      : locale === 'zh'
        ? `${displayShortcut('help.toggle')} 帮助`
        : `${displayShortcut('help.toggle')} help`,
  ].filter((item): item is string => item !== undefined)
  return [
    locale === 'zh' ? 'Cocode TUI（终端界面）' : 'Cocode TUI',
    coreShortcuts.join(' · '),
    locale === 'zh'
      ? 'Ctrl/Meta+A 全选 · Ctrl/Meta+C 复制选中 · Ctrl/Meta+X 剪切（Command 需终端转发）'
      : 'Ctrl/Meta+A select all · Ctrl/Meta+C copy selection · Ctrl/Meta+X cut (Command requires terminal forwarding)',
    [
      ...detailShortcuts,
      caps.planMode ? (locale === 'zh' ? 'Tab Build/Plan' : 'tab Build/Plan') : undefined,
    ]
      .filter((item): item is string => item !== undefined)
      .join(' · '),
    globalShortcuts.join(' · '),
    '',
    locale === 'zh'
      ? '本地命令（不是 GUI 命令注册表）：'
      : 'Local commands (not the GUI command registry):',
    commands,
  ].join('\n')
}

export function commandSummary(command: Command, locale: UiLocale): string {
  return locale === 'zh' ? command.summaryZh ?? command.summary : command.summary
}
