import stringWidth from 'string-width'
import { formatKeyBinding, type CommandId, type Keymap } from '../runtime/keymap.ts'
import { text, type UiLocale, type UiTextKey } from '../runtime/ui-locale.ts'

export type FooterOverlay =
  | 'slash'
  | 'file'
  | 'history'
  | 'resume'
  | 'sessionTree'
  | 'queue'
  | 'checklist'
  | 'rewind'
  | 'fork'
  | 'skills'
  | 'plugins'
  | 'model'
  | 'modelInput'
  | 'effort'
  | 'question'
  | 'approval'
  | 'review'
  | 'help'
  | 'commandPalette'
  | 'messageActions'

export type FooterHint = {
  id: string
  commandId?: CommandId
  labelKey: UiTextKey
  priority: number
  group: 'primary' | 'navigation' | 'secondary'
}

export type ResolvedFooter = {
  hints: readonly { id: string; text: string; shortcut?: string; label: string }[]
  hiddenCount: number
}

export type FooterProjectionContext = {
  activeOverlay?: FooterOverlay
  agent: 'idle' | 'running' | 'starting' | 'dead'
  draft: string
  readOnly?: boolean
  messageSelection: boolean
  paneFocus?: 'conversation' | 'inspector'
  overlayConfirming?: boolean
  detailsAvailable?: boolean
  messageDetailsAvailable?: boolean
  messageDetailsExpanded?: boolean
  steeringAvailable?: boolean
}

const SEPARATOR = ' · '

export function resolveFooterHints(
  context: FooterProjectionContext,
  keymap: Keymap,
  locale: UiLocale,
  columns: number,
): ResolvedFooter {
  const candidates = footerCandidates(context)
  const resolved = candidates.flatMap((hint, order) => {
    const shortcut = hint.commandId === undefined
      ? fixedShortcut(hint.id)
      : formatKeyBinding(keymap[hint.commandId]?.[0])
    if (hint.commandId !== undefined && shortcut === undefined) return []
    const fullText = text(locale, hint.labelKey)
    let label = shortcut === undefined
      ? fullText
      : stripShortcut(fullText, shortcut)
    let displayShortcut = shortcut
    if (hint.commandId === undefined && shortcut !== undefined) {
      const extracted = extractFixedShortcut(fullText)
      if (extracted !== undefined) {
        displayShortcut = extracted.shortcut
        label = extracted.label
      }
    }
    return [{
      id: hint.id,
      text: hint.commandId === undefined ? fullText : `${shortcut} ${label}`,
      shortcut: displayShortcut,
      label,
      order,
      priority: hint.priority,
    }]
  })

  if (!Number.isFinite(columns) || columns <= 0 || resolved.length === 0) {
    return { hints: [], hiddenCount: resolved.length }
  }

  const selected = new Set<string>()
  let used = 0
  for (const hint of [...resolved].sort(
    (left, right) => right.priority - left.priority || left.order - right.order,
  )) {
    const width = stringWidth(hint.text)
    const next = selected.size === 0 ? width : used + stringWidth(SEPARATOR) + width
    if (next > Math.trunc(columns)) continue
    selected.add(hint.id)
    used = next
  }

  const hints = resolved
    .filter((hint) => selected.has(hint.id))
    .map(({ id, text: value, shortcut, label }) => ({ id, text: value, shortcut, label }))
  return { hints, hiddenCount: resolved.length - hints.length }
}

function stripShortcut(value: string, shortcut: string): string {
  const prefix = new RegExp(`^${escapeRegExp(shortcut)}\\s+`, 'i')
  return value.replace(prefix, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\[\]\\]/g, '\\$&')
}

function extractFixedShortcut(value: string): { shortcut: string; label: string } | undefined {
  const match = value.match(
    /^((?:PageUp|PageDown|pgup|pgdn)(?:\s*\/\s*(?:PageUp|PageDown|pgup|pgdn))?|(?:Ctrl|Alt|Shift)\+\S+|[↑↓←→]+|Enter|Esc|Tab|Space|M|\/redraw)\s+(.+)$/i,
  )
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  return { shortcut: match[1], label: match[2] }
}

function fixedShortcut(id: string): string | undefined {
  return {
    'message-move': '↑↓',
    'message-copy': 'Ctrl+C',
    'message-actions': 'M',
    'message-close': 'Esc',
    'read-only-back': 'Esc',
    'read-only-quit': 'Ctrl+C',
    'message-details': 'Ctrl+O',
    'pane-scroll': 'PageUp / PageDown',
    'message-scroll': 'pgup / pgdn',
    'message-select': 'Shift+↑',
    close: 'Esc',
    move: '↑↓',
    confirm: 'Enter',
    cancel: 'Esc',
    select: '↑↓',
    search: undefined,
    use: 'Enter',
    toggle: 'Space',
    run: 'Enter',
    scroll: 'pgup / pgdn',
    redraw: '/redraw',
  }[id]
}

function footerCandidates(context: FooterProjectionContext): readonly FooterHint[] {
  if (context.activeOverlay !== undefined) {
    return overlayCandidates(context.activeOverlay, context.overlayConfirming === true)
  }
  if (context.messageSelection) {
    return [
      fixed('message-move', 'footerMove', 100, 'navigation'),
      fixed('message-copy', 'footerCopyMessages', 98, 'primary'),
      fixed('message-actions', 'footerMessageActions', 95, 'primary'),
      ...(context.messageDetailsAvailable === true
        ? [command(
            'message-details',
            'transcript.toggleVerbose',
            context.messageDetailsExpanded === true
              ? 'footerMessageCollapse'
              : 'footerMessageExpand',
            90,
            'secondary',
          )]
        : []),
      fixed('message-close', 'footerClose', 85, 'secondary'),
    ]
  }

  if (context.readOnly === true) {
    return [
      fixed('message-scroll', 'footerScroll', 100, 'navigation'),
      fixed('message-select', 'footerMessages', 95, 'navigation'),
      ...(context.detailsAvailable === true
        ? [command('details', 'transcript.toggleVerbose', 'footerDetailsLabel', 90, 'secondary')]
        : []),
      fixed('read-only-back', 'footerReadOnlyBack', 50, 'secondary'),
      fixed('read-only-quit', 'footerReadOnlyQuit', 40, 'secondary'),
    ]
  }

  if (context.agent === 'running' || context.agent === 'starting') {
    return [
      command('interrupt', 'session.interruptOrQuit', 'footerRunningLabel', 100, 'primary'),
      ...(context.draft.trim() === ''
        ? []
        : [
            command('queue-draft', 'input.submit', 'footerQueueDraftLabel', 90, 'secondary'),
            ...(context.steeringAvailable === true
              ? [command('steer-draft', 'input.steer', 'footerSteerDraftLabel', 80, 'secondary')]
              : []),
          ]),
    ]
  }

  const draft = context.draft.trim() !== ''
  return [
    command('send', 'input.submit', 'footerSend', 100, 'primary'),
    ...(draft ? [command('newline', 'input.newline', 'footerNewline', 95, 'primary')] : []),
    command('history', 'history.prev', 'footerHistoryLabel', 80, 'navigation'),
    ...(context.paneFocus === 'inspector'
      ? [fixed('pane-scroll', 'footerScroll', 75, 'navigation')]
      : [
          fixed('message-scroll', 'footerScroll', 70, 'navigation'),
          fixed('message-select', 'footerMessages', 68, 'navigation'),
        ]),
    ...(draft ? [] : [command('help', 'help.toggle', 'footerHelpLabel', 60, 'secondary')]),
    command('model', 'model.open', 'footerModelLabel', 55, 'secondary'),
    ...(context.detailsAvailable === true
      ? [command('details', 'transcript.toggleVerbose', 'footerDetailsLabel', 50, 'secondary')]
      : []),
    command('quit', 'session.interruptOrQuit', 'footerQuitLabel', 40, 'secondary'),
    fixed('redraw', 'footerRedrawLabel', 20, 'secondary'),
  ]
}

function overlayCandidates(overlay: FooterOverlay, confirming: boolean): readonly FooterHint[] {
  switch (overlay) {
    case 'help':
      return [fixed('close', 'footerClose', 100, 'primary')]
    case 'approval':
      return [
        fixed('move', 'footerMove', 100, 'navigation'),
        fixed('confirm', 'footerConfirm', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
      ]
    case 'question':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('confirm', 'footerConfirm', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
      ]
    case 'modelInput':
      return [
        fixed('confirm', 'footerConfirm', 100, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
      ]
    case 'model':
    case 'resume':
    case 'sessionTree':
    case 'skills':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('confirm', 'footerConfirm', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
        fixed('search', 'footerSearch', 50, 'secondary'),
      ]
    case 'effort':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('confirm', 'footerConfirm', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
      ]
    case 'plugins':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('toggle', 'footerToggle', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
        fixed('search', 'footerSearch', 50, 'secondary'),
      ]
    case 'queue':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('use', 'footerUse', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
        fixed('search', 'footerSearch', 50, 'secondary'),
      ]
    case 'checklist':
      return [
        fixed('move', 'footerMove', 100, 'navigation'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
      ]
    case 'rewind':
    case 'fork':
      return confirming
        ? [
            fixed('confirm', 'footerConfirm', 100, 'primary'),
            fixed('cancel', 'footerCancel', 90, 'secondary'),
          ]
        : [
            fixed('select', 'footerSelect', 100, 'navigation'),
            fixed('confirm', 'footerConfirm', 95, 'primary'),
            fixed('cancel', 'footerCancel', 90, 'secondary'),
          ]
    case 'review':
      return [
        fixed('move', 'footerMove', 100, 'navigation'),
        fixed('confirm', 'footerConfirm', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
        fixed('scroll', 'footerScroll', 70, 'secondary'),
      ]
    case 'commandPalette':
    case 'messageActions':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('run', 'footerRun', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
      ]
    case 'history':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('use', 'footerUse', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
      ]
    case 'slash':
    case 'file':
      return [
        fixed('select', 'footerSelect', 100, 'navigation'),
        fixed('use', 'footerUse', 95, 'primary'),
        fixed('cancel', 'footerCancel', 90, 'secondary'),
        fixed('search', 'footerSearch', 50, 'secondary'),
      ]
  }
}

function command(
  id: string,
  commandId: CommandId,
  labelKey: UiTextKey,
  priority: number,
  group: FooterHint['group'],
): FooterHint {
  return { id, commandId, labelKey, priority, group }
}

function fixed(
  id: string,
  labelKey: UiTextKey,
  priority: number,
  group: FooterHint['group'],
): FooterHint {
  return { id, labelKey, priority, group }
}
