/** Formatting helpers used by the session state machine. */

import type { ConversationNode } from './nodes/types.ts'
import type { TuiSnapshot } from './app-contracts.ts'
import { text, type UiLocale } from './ui-locale.ts'
import { redactSecrets } from './diagnostics.ts'
import { displayError, formatError } from './errors/index.ts'

export function composerPlaceholder(agent: TuiSnapshot['agent'], locale: UiLocale = 'en'): string {
  if (locale === 'zh') {
    if (agent === 'starting') return '正在连接…'
    if (agent === 'running') return '正在工作 — 回车排队，Esc 取消'
    if (agent === 'dead') return '运行时已停止 — /exit'
    return '输入消息  / 查看命令'
  }
  if (agent === 'starting') return 'Connecting…'
  if (agent === 'running') return 'Working — Enter queues, Esc cancels'
  if (agent === 'dead') return 'Runtime stopped — /exit'
  return 'Type a message  / for commands'
}

export function statusLine(
  agent: TuiSnapshot['agent'],
  _runtimeName: string,
  locale: UiLocale = 'en',
): string {
  return agent === 'idle'
    ? text(locale, 'agentIdle')
    : agent === 'running'
    ? text(locale, 'agentThinking')
    : agent === 'starting'
    ? text(locale, 'agentStarting')
    : text(locale, 'agentDead')
}

export function latestUsage(
  nodes: readonly ConversationNode[],
): { input: number; output: number } | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind === 'assistant' && node.usage !== undefined) {
      return node.usage
    }
  }
  return undefined
}

export function errorMessage(error: unknown): string {
  return displayError(error)
}

export function startErrorMessage(error: unknown): string {
  const detail = redactSecrets(error instanceof Error ? error.message : String(error))
  return `${formatError('RUNTIME_INIT_FAILED')}\n${detail}`
}
