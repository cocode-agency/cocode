import { DEFAULT_BINDINGS, type CommandId, type KeyBinding, type Keymap } from './keymap.ts'

const COMMAND_ALIASES: Readonly<Record<string, CommandId>> = {
  'input.submit': 'input.submit',
  inputSubmit: 'input.submit',
  'input.steer': 'input.steer',
  inputSteer: 'input.steer',
  'input.newline': 'input.newline',
  inputNewline: 'input.newline',
  'session.interruptOrQuit': 'session.interruptOrQuit',
  sessionInterruptOrQuit: 'session.interruptOrQuit',
  'session.new': 'session.new',
  sessionNew: 'session.new',
  'session.open': 'session.open',
  sessionOpen: 'session.open',
  'file.open': 'file.open',
  fileOpen: 'file.open',
  'app.quit': 'app.quit',
  appQuit: 'app.quit',
  'app.redraw': 'app.redraw',
  appRedraw: 'app.redraw',
  'model.open': 'model.open',
  modelOpen: 'model.open',
  'image.paste': 'image.paste',
  imagePaste: 'image.paste',
  'transcript.toggleVerbose': 'transcript.toggleVerbose',
  transcriptToggleVerbose: 'transcript.toggleVerbose',
  'editor.open': 'editor.open',
  editorOpen: 'editor.open',
  'help.toggle': 'help.toggle',
  helpToggle: 'help.toggle',
  'history.prev': 'history.prev',
  historyPrev: 'history.prev',
  'history.next': 'history.next',
  historyNext: 'history.next',
  'history.search': 'history.search',
  historySearch: 'history.search',
  'messages.select': 'messages.select',
  messagesSelect: 'messages.select',
  'command.palette': 'command.palette',
  commandPalette: 'command.palette',
  'permission.toggle': 'permission.toggle',
  permissionToggle: 'permission.toggle',
}

let defaultEnvRaw: string | undefined
let defaultEnvKeymap: Keymap | undefined

export function resolveKeymap(
  env: NodeJS.ProcessEnv = process.env,
  writeDiagnostic: (message: string) => void = (message) => {
    process.stderr.write(`${message}\n`)
  },
): Keymap {
  const isDefaultEnv = env === process.env
  const raw = env.COCODE_TUI_KEYMAP?.trim()
  if (isDefaultEnv && defaultEnvKeymap !== undefined && defaultEnvRaw === raw) {
    return defaultEnvKeymap
  }
  const finish = (keymap: Keymap): Keymap => {
    if (isDefaultEnv) {
      defaultEnvRaw = raw
      defaultEnvKeymap = keymap
    }
    return keymap
  }
  const resolved: Record<CommandId, readonly KeyBinding[]> = { ...DEFAULT_BINDINGS }
  if (raw === undefined || raw === '') return finish(resolved)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    writeDiagnostic('Cocode TUI: invalid COCODE_TUI_KEYMAP JSON; using default keymap.')
    return finish(resolved)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    writeDiagnostic('Cocode TUI: COCODE_TUI_KEYMAP must be a JSON object; using default keymap.')
    return finish(resolved)
  }

  for (const [name, value] of Object.entries(parsed)) {
    const id = COMMAND_ALIASES[name]
    if (id === undefined) {
      writeDiagnostic(`Cocode TUI: unknown keymap command "${name}"; using its default.`)
      continue
    }
    if (typeof value !== 'string') {
      writeDiagnostic(`Cocode TUI: invalid key for "${name}"; using its default.`)
      continue
    }
    const parsedBinding = parseBinding(value)
    if (parsedBinding === undefined) {
      writeDiagnostic(`Cocode TUI: invalid key "${value}" for "${name}"; using its default.`)
      continue
    }
    const emptyOnly = DEFAULT_BINDINGS[id][0]?.emptyOnly
    const resolvedBinding = { ...parsedBinding, emptyOnly }
    for (const otherId of Object.keys(resolved) as CommandId[]) {
      if (otherId === id) continue
      resolved[otherId] = resolved[otherId].filter(
        (binding) => !sameBinding(binding, resolvedBinding),
      )
    }
    resolved[id] = [resolvedBinding]
  }
  return finish(resolved)
}

function sameBinding(left: KeyBinding, right: KeyBinding): boolean {
  return (
    left.key === right.key &&
    left.ctrl === right.ctrl &&
    left.alt === right.alt &&
    left.shift === right.shift
  )
}

function parseBinding(value: string): Omit<KeyBinding, 'emptyOnly'> | undefined {
  const parts = value
    .trim()
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
  if (parts.length === 0 || parts.some((part) => part === '')) return undefined
  const key = parts.at(-1)
  if (key === undefined || !isSupportedKey(key)) return undefined
  const modifiers = new Set(parts.slice(0, -1))
  if (
    ![...modifiers].every(
      (part) =>
        part === 'ctrl' ||
        part === 'control' ||
        part === 'alt' ||
        part === 'option' ||
        part === 'meta' ||
        part === 'shift',
    )
  ) {
    return undefined
  }
  if (modifiers.has('ctrl') && modifiers.has('control')) return undefined
  if (modifiers.has('alt') && modifiers.has('option')) return undefined
  return {
    key: normalizeKey(key),
    ctrl: modifiers.has('ctrl') || modifiers.has('control'),
    alt: modifiers.has('alt') || modifiers.has('option') || modifiers.has('meta'),
    shift: modifiers.has('shift'),
  }
}

function isSupportedKey(key: string): boolean {
  return (
    [
      'enter',
      'return',
      'esc',
      'escape',
      'up',
      'arrowup',
      'down',
      'arrowdown',
      'left',
      'arrowleft',
      'right',
      'arrowright',
      'tab',
      'backspace',
      'delete',
    ].includes(key) ||
    (key.length === 1 && key !== '+')
  )
}

function normalizeKey(key: string): string {
  const aliases: Record<string, string> = {
    return: 'enter',
    esc: 'escape',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
  }
  return aliases[key] ?? key
}
