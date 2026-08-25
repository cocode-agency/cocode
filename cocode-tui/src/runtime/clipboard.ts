import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ConversationNode } from './nodes/types.ts'
import { clipboardCommandCandidates } from './platform.ts'

export type ClipboardCommand = {
  command: string
  args: readonly string[]
}

export type ClipboardResult =
  | { ok: true; command: string }
  | { ok: false; reason: 'unsupported' | 'unavailable' }

export type ClipboardSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'ignore', 'ignore'] },
) => ChildProcessWithoutNullStreams

export function clipboardCommands(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ClipboardCommand[] {
  return clipboardCommandCandidates(platform, env)
}

export async function copyToClipboard(
  value: string,
  options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    spawn?: ClipboardSpawn
  } = {},
): Promise<ClipboardResult> {
  const commands = clipboardCommands(options.platform, options.env)
  if (commands.length === 0) return { ok: false, reason: 'unsupported' }
  const spawnCommand = options.spawn ?? (spawn as unknown as ClipboardSpawn)
  for (const candidate of commands) {
    if (await runClipboardCommand(candidate, value, spawnCommand)) {
      return { ok: true, command: candidate.command }
    }
  }
  return { ok: false, reason: 'unavailable' }
}

async function runClipboardCommand(
  candidate: ClipboardCommand,
  value: string,
  spawnCommand: ClipboardSpawn,
): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnCommand(candidate.command, candidate.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
      })
    } catch {
      resolve(false)
      return
    }
    let settled = false
    const timeout = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // The process may have already exited or be a minimal test double.
      }
      finish(false)
    }, 1500)
    const finish = (success: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(success)
    }
    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0))
    try {
      child.stdin.end(value)
    } catch {
      finish(false)
    }
  })
}

export function readableNodeText(node: ConversationNode): string {
  switch (node.kind) {
    case 'user':
      return node.text
    case 'context':
      return node.text
    case 'assistant':
      return node.text !== '' ? node.text : node.reasoning
    case 'tool':
      return node.result !== undefined && node.result !== ''
        ? node.result
        : node.args !== ''
        ? node.args
        : node.name
    case 'command':
      return node.outcome?.text ?? node.args ?? node.name ?? 'command'
    case 'notice':
      return ''
  }
}
