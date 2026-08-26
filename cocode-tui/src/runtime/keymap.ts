/**
 * Keystroke → command id. Present translates; this table does not run side
 * effects.
 */

export type CommandId =
  | 'input.submit'
  | 'input.steer'
  | 'input.newline'
  | 'session.interruptOrQuit'
  | 'session.new'
  | 'session.open'
  | 'file.open'
  | 'app.quit'
  | 'app.redraw'
  | 'model.open'
  | 'image.paste'
  | 'transcript.toggleVerbose'
  | 'editor.open'
  | 'help.toggle'
  | 'history.prev'
  | 'history.next'
  | 'history.search'
  | 'messages.select'
  | 'command.palette'
  | 'permission.toggle'

export type KeyMatch = {
  id: CommandId
  /** When true, only fire if the composer is empty. */
  emptyOnly?: boolean
}

export type Keymap = Readonly<Record<CommandId, readonly KeyBinding[]>>

export type KeyBinding = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  emptyOnly?: boolean
}

export function formatKeyBinding(binding: KeyBinding | undefined): string | undefined {
  if (binding === undefined) return undefined
  const modifiers = [
    binding.ctrl ? 'Ctrl' : undefined,
    binding.alt ? 'Alt' : undefined,
    binding.shift ? 'Shift' : undefined,
  ].filter((value): value is string => value !== undefined)
  const key =
    binding.key.length === 1
      ? binding.key.toUpperCase()
      : ({
          up: '↑',
          down: '↓',
          left: '←',
          right: '→',
          enter: 'Enter',
          escape: 'Esc',
          tab: 'Tab',
          backspace: 'Backspace',
          delete: 'Delete',
        }[binding.key] ?? binding.key)
  return [...modifiers, key].join('+')
}

type KeymapInput = {
  raw: string
  return?: boolean
  escape?: boolean
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  tab?: boolean
  backspace?: boolean
  delete?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  empty: boolean
}

export const DEFAULT_BINDINGS: Readonly<Record<CommandId, readonly KeyBinding[]>> = {
  'input.submit': [binding('enter')],
  'input.steer': [binding('enter', { ctrl: true })],
  'input.newline': [binding('enter', { shift: true }), binding('j', { ctrl: true })],
  'session.interruptOrQuit': [binding('escape'), binding('c', { ctrl: true })],
  'session.new': [binding('n', { ctrl: true })],
  'session.open': [binding('s', { ctrl: true })],
  'file.open': [binding('f', { ctrl: true })],
  'app.quit': [binding('d', { ctrl: true, emptyOnly: true })],
  'app.redraw': [],
  'model.open': [binding('l', { ctrl: true })],
  // Some terminals expose macOS Command+V as the meta/alt variant.
  'image.paste': [binding('v', { ctrl: true }), binding('v', { alt: true })],
  'transcript.toggleVerbose': [binding('o', { ctrl: true })],
  'editor.open': [binding('g', { ctrl: true })],
  'help.toggle': [binding('?', { emptyOnly: true })],
  'history.prev': [binding('up')],
  'history.next': [binding('down')],
  'history.search': [binding('r', { ctrl: true })],
  'messages.select': [binding('up', { shift: true })],
  'command.palette': [binding('p', { ctrl: true })],
  'permission.toggle': [binding('y', { ctrl: true })],
}

function binding(
  key: string,
  options: { ctrl?: boolean; alt?: boolean; shift?: boolean; emptyOnly?: boolean } = {},
): KeyBinding {
  return {
    key,
    ctrl: options.ctrl === true,
    alt: options.alt === true,
    shift: options.shift === true,
    emptyOnly: options.emptyOnly,
  }
}

export function matchKey(
  input: KeymapInput,
  keymap: Keymap = DEFAULT_BINDINGS,
): KeyMatch | undefined {
  const order: CommandId[] = [
    'input.newline',
    'input.submit',
    'input.steer',
    'session.interruptOrQuit',
    'session.new',
    'session.open',
    'app.quit',
    'model.open',
    'image.paste',
    'app.redraw',
    'transcript.toggleVerbose',
    'editor.open',
    'help.toggle',
    'history.search',
    'file.open',
    'messages.select',
    'command.palette',
    'permission.toggle',
    'history.prev',
    'history.next',
  ]
  for (const id of order) {
    for (const current of keymap[id]) {
      if (current.emptyOnly === true && !input.empty) continue
      if (matchesBinding(input, current)) {
        return current.emptyOnly === true && id === 'app.quit' ? { id, emptyOnly: true } : { id }
      }
    }
  }
  return undefined
}

function matchesBinding(input: KeymapInput, binding: KeyBinding): boolean {
  if (Boolean(input.ctrl) !== binding.ctrl) return false
  if (Boolean(input.alt) !== binding.alt) return false
  const implicitShift = binding.key === '?' && input.raw === '?'
  if (!implicitShift && Boolean(input.shift) !== binding.shift) return false
  switch (binding.key) {
    case 'enter':
      return input.return === true
    case 'escape':
      return input.escape === true
    case 'up':
      return input.upArrow === true
    case 'down':
      return input.downArrow === true
    case 'left':
      return input.leftArrow === true
    case 'right':
      return input.rightArrow === true
    case 'tab':
      return input.tab === true || input.raw === '\t'
    case 'backspace':
      return input.backspace === true
    case 'delete':
      return input.delete === true
    default:
      return (
        input.raw.toLowerCase() === binding.key ||
        (binding.key === 'j' && input.return === true && input.raw === 'j')
      )
  }
}
