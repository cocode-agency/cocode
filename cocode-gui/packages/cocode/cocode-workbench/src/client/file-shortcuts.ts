export interface Combo {
  readonly key: string
  readonly primary?: boolean
  readonly alt?: boolean
  readonly shift?: boolean
  readonly control?: boolean
}

export const FILE_OPEN_COMMAND = "cocode.files.open"
export const FILE_ADD_TO_CHAT_COMMAND = "cocode.files.addToChat"
export const FILE_RENAME_COMMAND = "cocode.files.rename"
export const FILE_DELETE_COMMAND = "cocode.files.delete"
export const FILE_COPY_COMMAND = "cocode.files.copy"
export const FILE_CUT_COMMAND = "cocode.files.cut"
export const FILE_PASTE_COMMAND = "cocode.files.paste"
export const FILE_SELECT_NEXT_COMMAND = "cocode.files.selectNext"
export const FILE_SELECT_PREVIOUS_COMMAND = "cocode.files.selectPrevious"
export const FILE_EXPAND_COMMAND = "cocode.files.expand"
export const FILE_COLLAPSE_COMMAND = "cocode.files.collapse"
export const FILE_CONTEXT_MENU_COMMAND = "cocode.files.contextMenu"
export const FILE_CANCEL_COMMAND = "cocode.files.cancel"

export interface FileShortcutTarget {
  readonly isActive: () => boolean
  readonly run: (commandId: string) => boolean
}

// More than one session can render a file tree at once. Keep every mounted
// target and resolve the one whose tree currently owns focus instead of letting
// the last mounted panel shadow the active panel.
const activeTargets = new Set<FileShortcutTarget>()

export function setActiveFileShortcutTarget(target: FileShortcutTarget | undefined): void {
  if (target === undefined) {
    activeTargets.clear()
    return
  }
  activeTargets.add(target)
}

export function removeActiveFileShortcutTarget(target: FileShortcutTarget): void {
  activeTargets.delete(target)
}

export function activeFileShortcutTarget(): FileShortcutTarget | undefined {
  const targets = [...activeTargets].reverse()
  return targets.find(target => target.isActive())
}

export interface ShortcutCommandLike {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly defaultCombo?: Combo
  readonly run: () => boolean
}

export interface FileShortcutRegistryFace {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => {
    readonly bindings: readonly {
      readonly commandId: string
      readonly combo: Combo
    }[]
  }
}

const EMPTY_SHORTCUT_SNAPSHOT: ReturnType<FileShortcutRegistryFace["getSnapshot"]> = { bindings: [] }
const shortcutListeners = new Set<() => void>()
let shortcutRegistry: FileShortcutRegistryFace | undefined
let unsubscribeShortcutRegistry: (() => void) | undefined

function notifyShortcutListeners(): void {
  for (const listener of [...shortcutListeners]) listener()
}

/** Keep menu hints aligned with the user's effective, possibly customized bindings. */
export function bindFileShortcutRegistry(registry: FileShortcutRegistryFace): () => void {
  unsubscribeShortcutRegistry?.()
  shortcutRegistry = registry
  unsubscribeShortcutRegistry = registry.subscribe(notifyShortcutListeners)
  notifyShortcutListeners()
  return () => {
    if (shortcutRegistry !== registry) return
    unsubscribeShortcutRegistry?.()
    unsubscribeShortcutRegistry = undefined
    shortcutRegistry = undefined
    notifyShortcutListeners()
  }
}

export function subscribeFileShortcutBindings(listener: () => void): () => void {
  shortcutListeners.add(listener)
  return () => shortcutListeners.delete(listener)
}

export function fileShortcutBindingsSnapshot(): ReturnType<FileShortcutRegistryFace["getSnapshot"]> {
  return shortcutRegistry?.getSnapshot() ?? EMPTY_SHORTCUT_SNAPSHOT
}

function currentPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform
}

/** Compact menu rendering: macOS uses glyph modifiers, other platforms use words. */
export function formatFileShortcut(combo: Combo | undefined, platform = currentPlatform()): string | undefined {
  if (combo === undefined) return undefined
  const mac = platform.toLowerCase().includes("mac")
  const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key
  if (!mac) {
    const parts: string[] = []
    if (combo.primary || combo.control) parts.push("Ctrl")
    if (combo.alt) parts.push("Alt")
    if (combo.shift) parts.push("Shift")
    parts.push(key)
    return parts.join("+")
  }
  return [
    combo.control ? "⌃" : "",
    combo.alt ? "⌥" : "",
    combo.shift ? "⇧" : "",
    combo.primary ? "⌘" : "",
    key,
  ].join("")
}

export function fileShortcutLabel(commandId: string, snapshot = fileShortcutBindingsSnapshot()): string | undefined {
  return formatFileShortcut(snapshot.bindings.find(binding => binding.commandId === commandId)?.combo)
}

export function fileShortcutCommands(t: (key: string) => string = key => key): readonly ShortcutCommandLike[] {
  const command = (id: string, title: string, description: string, defaultCombo: Combo): ShortcutCommandLike => ({
    id,
    title,
    description,
    defaultCombo,
    run: () => {
      const target = activeFileShortcutTarget()
      return target !== undefined && target.isActive() && target.run(id)
    },
  })
  return [
    command(FILE_OPEN_COMMAND, t("files.shortcut.open"), t("files.shortcut.openHint"), { key: "Enter" }),
    command(FILE_ADD_TO_CHAT_COMMAND, t("files.shortcut.addToChat"), t("files.shortcut.addToChatHint"), { key: "l", primary: true }),
    command(FILE_RENAME_COMMAND, t("files.shortcut.rename"), t("files.shortcut.renameHint"), { key: "F2" }),
    command(FILE_DELETE_COMMAND, t("files.shortcut.delete"), t("files.shortcut.deleteHint"), { key: "Delete" }),
    command(FILE_COPY_COMMAND, t("files.shortcut.copy"), t("files.shortcut.copyHint"), { key: "c", primary: true }),
    command(FILE_CUT_COMMAND, t("files.shortcut.cut"), t("files.shortcut.cutHint"), { key: "x", primary: true }),
    command(FILE_PASTE_COMMAND, t("files.shortcut.paste"), t("files.shortcut.pasteHint"), { key: "v", primary: true }),
    command(FILE_SELECT_PREVIOUS_COMMAND, t("files.shortcut.previous"), t("files.shortcut.previousHint"), { key: "ArrowUp" }),
    command(FILE_SELECT_NEXT_COMMAND, t("files.shortcut.next"), t("files.shortcut.nextHint"), { key: "ArrowDown" }),
    command(FILE_EXPAND_COMMAND, t("files.shortcut.expand"), t("files.shortcut.expandHint"), { key: "ArrowRight" }),
    command(FILE_COLLAPSE_COMMAND, t("files.shortcut.collapse"), t("files.shortcut.collapseHint"), { key: "ArrowLeft" }),
    command(FILE_CONTEXT_MENU_COMMAND, t("files.shortcut.menu"), t("files.shortcut.menuHint"), { key: "F10", shift: true }),
    command(FILE_CANCEL_COMMAND, t("files.shortcut.cancel"), t("files.shortcut.cancelHint"), { key: "Escape" }),
  ]
}
