import type { TuiApp, TuiSnapshot } from '../runtime/app-contracts.ts'
import type { CommandArgumentCompletion } from './command-completion.ts'

/** Wrap a selection index while keeping empty menus at index zero. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((index + delta) % count) + count) % count
}

/** Map the stable keymap command ids to the app's action protocol. */
export function dispatchKeyCommand(app: TuiApp, id: string, draft: string): void {
  switch (id) {
    case 'input.submit':
      app.dispatch({ type: 'submit', text: draft })
      return
    case 'input.newline':
      app.dispatch({ type: 'insertDraft', text: '\n' })
      return
    case 'session.interruptOrQuit':
      app.dispatch({ type: 'interruptOrQuit' })
      return
    case 'session.new':
      app.dispatch({ type: 'session.new' })
      return
    case 'session.open':
      app.dispatch({ type: 'session.open' })
      return
    case 'file.open':
      app.dispatch({ type: 'file.open' })
      return
    case 'app.quit':
      app.dispatch({ type: 'quit' })
      return
    case 'app.redraw':
      app.dispatch({ type: 'redraw' })
      return
    case 'model.open':
      app.dispatch({ type: 'model.open' })
      return
    case 'image.paste':
      app.dispatch({ type: 'image.paste' })
      return
    case 'transcript.toggleVerbose':
      app.dispatch({ type: 'toggleVerbose' })
      return
    case 'help.toggle':
      app.dispatch({ type: 'toggleHelp' })
      return
    case 'history.prev':
      app.dispatch({ type: 'historyPrev' })
      return
    case 'history.next':
      app.dispatch({ type: 'historyNext' })
      return
    case 'permission.toggle':
      app.dispatch({ type: 'permission.toggle' })
      return
  }
}

type HelpKey = {
  escape?: boolean
  ctrl?: boolean
}

/** Close the help overlay before the general interrupt/quit policy runs. */
export function dispatchHelpInput(app: TuiApp, input: string, key: HelpKey): boolean {
  if (key.escape || (key.ctrl && input === 'c')) {
    app.dispatch({ type: 'interruptOrQuit' })
  }
  return true
}

/** Route the composer Tab key without stealing Tab from open completion panels. */
export function dispatchComposerTab(app: TuiApp, snapshot: TuiSnapshot): boolean {
  if (snapshot.agent === 'running' && snapshot.composer.text.trim() !== '') {
    app.dispatch({ type: 'queuePrompt' })
    return true
  }
  if (snapshot.agent === 'idle' && snapshot.capabilities.planMode) {
    app.dispatch({ type: 'plan.toggle' })
    return true
  }
  return false
}

/** Keep argument completions editable when they still require user input. */
export function dispatchCommandArgumentCompletion(
  app: TuiApp,
  item: CommandArgumentCompletion,
): void {
  if (item.insert.endsWith(' ')) {
    app.dispatch({ type: 'setDraft', text: item.insert })
    return
  }
  app.dispatch({ type: 'command', line: item.insert.trimEnd() })
}

type ComposerShortcutKey = {
  ctrl?: boolean
  meta?: boolean
  super?: boolean
  shift?: boolean
}

/** Bare C, or Ctrl/Meta/Super+C. Shift+C is not a copy chord. */
export function isCopyShortcut(input: string, key: ComposerShortcutKey): boolean {
  if (input.toLowerCase() !== 'c' || key.shift === true) return false
  return true
}

/** Handle standard text-selection shortcuts before global Ctrl+C routing. */
export function dispatchComposerShortcut(
  app: TuiApp,
  snapshot: TuiSnapshot,
  input: string,
  key: ComposerShortcutKey,
): boolean {
  if (!key.ctrl && !key.meta && !key.super) return false
  switch (input.toLowerCase()) {
    case 'a':
      app.dispatch({ type: 'selectAllDraft' })
      return true
    case 'c':
      if (snapshot.composer.selection === undefined) return key.super === true
      app.dispatch({ type: 'copyDraftSelection' })
      return true
    case 'x':
      if (snapshot.composer.selection !== undefined) {
        app.dispatch({ type: 'cutDraftSelection' })
      }
      return true
    default:
      return false
  }
}

type PickerKey = {
  escape?: boolean
  upArrow?: boolean
  downArrow?: boolean
  return?: boolean
}

/** Route common selection-picker keys without coupling Chat to picker state. */
export function dispatchPickerInput(
  app: TuiApp,
  picker: 'review' | 'rewind' | 'fork',
  key: PickerKey,
  confirming: boolean,
): boolean {
  if (key.escape) {
    if (picker === 'review') app.dispatch({ type: 'review.close' })
    else if (picker === 'rewind') app.dispatch({ type: 'rewind.close' })
    else app.dispatch({ type: 'fork.close' })
    return true
  }
  if (!confirming && (key.upArrow || key.downArrow)) {
    const delta = key.upArrow ? -1 : 1
    if (picker === 'review') app.dispatch({ type: 'review.move', delta })
    else if (picker === 'rewind') app.dispatch({ type: 'rewind.move', delta })
    else app.dispatch({ type: 'fork.move', delta })
    return true
  }
  if (key.return) {
    if (picker === 'review') app.dispatch({ type: 'review.confirm' })
    else if (picker === 'rewind') app.dispatch({ type: 'rewind.confirm' })
    else app.dispatch({ type: 'fork.confirm' })
    return true
  }
  return false
}
