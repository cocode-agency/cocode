/** Pure command-name and invocation helpers. */

import type { SkillEntry } from '@cocode/tui-connection'

export function externalCommandAllowed(name: string): boolean {
  return new Set([
    'help',
    'exit',
    'quit',
    'q',
    'redraw',
    'status',
    'doctor',
    'theme',
    'lang',
    'thinking',
    'tokens',
    'cost',
    'export',
    'copy',
    'todos',
    'focus',
    'clear',
    'resume',
    'new',
    'tree',
    'sessions',
  ]).has(name.toLowerCase())
}

export function safeSubagentId(value: string): string {
  return [...value]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .slice(0, 32)
}

export function skillCommandName(skill: SkillEntry): string {
  const source = skill.source
  if (source === undefined || source === '') return skill.name
  const prefix =
    source.startsWith('project-')
      ? 'project'
      : source.startsWith('user-')
      ? 'user'
      : source
  return `${prefix}:${skill.name}`
}

export function formatSkillInvocation(skill: SkillEntry, args: string): string {
  const suffix = args.trim()
  return suffix === '' ? `/${skill.name}` : `/${skill.name} ${suffix}`
}
