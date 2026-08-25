import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client"
import type { UserBinding } from "../settings.ts"
import {
  comboFromKeyboardEvent, comboId, isTextEntryTarget, matchesCombo,
  toElectronAccelerator, type Combo,
} from "./combo.ts"
import type { ShortcutSettingsController } from "./settings-controller.ts"

export const SIDEBAR_TOGGLE_COMMAND = "cocode.sidebar.toggle"
export const NEW_SESSION_COMMAND = "cocode.newSession"

type LayoutFace = { readonly toggleSidebar: () => void }

declare module "@deepseek-ai/cordis" {
  interface Context {
    layout: LayoutFace
  }
}

export type ShortcutScope = "app" | "global"

export type ShortcutCommand = {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly defaultCombo?: Combo
  readonly defaultScope?: ShortcutScope
  readonly globalCapable?: boolean
  readonly allowInTextEntry?: boolean
  readonly when?: () => boolean
  readonly run: (event?: KeyboardEvent) => void | boolean
}

export type EffectiveBinding = {
  readonly commandId: string
  readonly combo: Combo
  readonly scope: ShortcutScope
  readonly title: string
  readonly globalCapable: boolean
}

export type ShortcutConflict = {
  readonly combo: Combo
  readonly commandIds: readonly string[]
}

export type ShortcutSnapshot = {
  readonly commands: readonly ShortcutCommand[]
  readonly bindings: readonly EffectiveBinding[]
  readonly conflicts: readonly ShortcutConflict[]
  readonly orphaned: readonly string[]
  readonly settingsStatus: "loading" | "ready" | "memory"
  readonly writable: boolean
  readonly settingsError?: string
  readonly globalError?: string
}

type DesktopShortcutsApi = {
  sync(request: { readonly bindings: readonly { readonly commandId: string; readonly accelerator: string }[] }): Promise<{
    readonly ok: boolean
    readonly conflicts?: readonly { readonly accelerator: string; readonly reason: string }[]
  }>
  onTriggered(listener: (commandId: string) => void): () => void
}

declare global {
  interface Window {
    readonly desktopApi?: { readonly shortcuts?: DesktopShortcutsApi }
  }
}

/** Client-side command and keymap registry shared by Cocode feature plugins. */
export class ShortcutRegistry {
  private readonly commandsById = new Map<string, ShortcutCommand>()
  private readonly order: string[] = []
  private readonly listeners = new Set<() => void>()
  private userBindings: Record<string, UserBinding>
  private recording = false
  private snapshot: ShortcutSnapshot
  private globalSyncGeneration = 0
  private globalError: string | undefined
  private settingsWriteChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: ClientContext,
    private readonly settings: ShortcutSettingsController,
  ) {
    this.userBindings = structuredClone(settings.getSnapshot().value.bindings)
    this.snapshot = this.buildSnapshot()
  }

  getSnapshot = (): ShortcutSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  mount(): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if (!this.handle(event)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("keydown", onKeyDown, true)

    const offSettings = this.settings.subscribe(() => {
      this.userBindings = structuredClone(this.settings.getSnapshot().value.bindings)
      this.publish()
    })
    const offTriggered = window.desktopApi?.shortcuts?.onTriggered((commandId) => {
      this.execute(commandId)
    })
    this.publish()
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      offSettings()
      offTriggered?.()
    }
  }

  register(command: ShortcutCommand): () => void {
    const previous = this.commandsById.get(command.id)
    if (previous === undefined) this.order.push(command.id)
    this.commandsById.set(command.id, command)
    this.publish()
    return () => {
      if (this.commandsById.get(command.id) !== command) return
      this.commandsById.delete(command.id)
      const index = this.order.indexOf(command.id)
      if (index >= 0) this.order.splice(index, 1)
      this.publish()
    }
  }

  setRecording(active: boolean): void {
    this.recording = active
  }

  getUserBinding(commandId: string): UserBinding | undefined {
    return this.userBindings[commandId]
  }

  setBinding(commandId: string, binding: UserBinding): void {
    const previous = this.userBindings[commandId] ?? {}
    const nextBinding = {
      ...previous,
      ...binding,
      ...(binding.combo === undefined ? {} : { disabled: false }),
    }
    this.userBindings = {
      ...this.userBindings,
      [commandId]: nextBinding,
    }
    this.publish()
    this.queueSettingsWrite()
  }

  resetBinding(commandId: string): Promise<void> {
    const next = { ...this.userBindings }
    delete next[commandId]
    this.userBindings = next
    this.publish()
    return this.queueSettingsWrite()
  }

  resetAllBindings(): Promise<void> {
    this.userBindings = {}
    this.publish()
    return this.queueSettingsWrite()
  }

  clearOrphaned(): Promise<void> {
    const known = new Set(this.commandsById.keys())
    const next: Record<string, UserBinding> = {}
    let changed = false
    for (const [commandId, binding] of Object.entries(this.userBindings)) {
      if (known.has(commandId)) {
        next[commandId] = binding
        continue
      }
      changed = true
    }
    if (!changed) return Promise.resolve()
    this.userBindings = next
    this.publish()
    return this.queueSettingsWrite()
  }

  reloadSettings(): void {
    void this.settings.reload()
  }

  execute(commandId: string, event?: KeyboardEvent): boolean {
    const command = this.commandsById.get(commandId)
    if (command === undefined) return false
    const user = this.userBindings[commandId]
    if (user?.disabled === true) return false
    if (command.when !== undefined && !command.when()) return false
    try {
      return command.run(event) !== false
    } catch (error) {
      console.error(`[cocode-shortcuts] command ${commandId} failed`, error)
      return false
    }
  }

  handle(event: KeyboardEvent): boolean {
    if (this.recording || event.isComposing || event.keyCode === 229) return false
    // A browser build has no Electron globalShortcut transport. Treat a
    // global preference as local in that carrier so a shortcut never becomes
    // silently unusable when the preload bridge is unavailable.
    const globalRuntimeAvailable = window.desktopApi?.shortcuts !== undefined
    const candidates = this.snapshot.bindings.filter(
      binding => binding.scope === "app" || !globalRuntimeAvailable,
    )
    for (const binding of candidates) {
      const command = this.commandsById.get(binding.commandId)
      if (command === undefined) continue
      if (!command.allowInTextEntry && isTextEntryTarget(event.target)) continue
      if (!matchesCombo(binding.combo, event)) continue
      return this.execute(binding.commandId, event)
    }
    return false
  }

  private buildSnapshot(): ShortcutSnapshot {
    const commands = this.order.map(id => this.commandsById.get(id)).filter((command): command is ShortcutCommand => command !== undefined)
    const bindings: EffectiveBinding[] = []
    const byCombo = new Map<string, EffectiveBinding[]>()
    for (const command of commands) {
      const user = this.userBindings[command.id]
      if (user?.disabled === true) continue
      const combo = user?.combo ?? command.defaultCombo
      if (combo === undefined) continue
      // A persisted `global` value is not enough to make a command global.
      // Older settings (or a command that later lost global capability) must
      // fall back to the local app scope instead of becoming an inert binding:
      // app dispatch intentionally ignores global bindings.
      const requestedScope = user?.scope ?? command.defaultScope ?? "app"
      const scope: ShortcutScope = requestedScope === "global" && command.globalCapable === true
        ? "global"
        : "app"
      const binding: EffectiveBinding = {
        commandId: command.id,
        combo,
        scope,
        title: command.title,
        globalCapable: command.globalCapable === true,
      }
      bindings.push(binding)
      const key = comboId(combo)
      const peers = byCombo.get(key) ?? []
      peers.push(binding)
      byCombo.set(key, peers)
    }
    const conflicts = [...byCombo.values()]
      .filter(peers => peers.length > 1)
      .map(peers => ({
        combo: peers[0]!.combo,
        commandIds: peers
          .sort((left, right) => (left.scope === "global" ? -1 : 0) - (right.scope === "global" ? -1 : 0))
          .map(peer => peer.commandId),
      }))
    const known = new Set(commands.map(command => command.id))
    const settingsSnapshot = this.settings.getSnapshot()
    return {
      commands,
      bindings,
      conflicts,
      orphaned: Object.keys(this.userBindings).filter(id => !known.has(id)),
      settingsStatus: settingsSnapshot.status,
      writable: settingsSnapshot.writable,
      ...(settingsSnapshot.error === undefined ? {} : { settingsError: settingsSnapshot.error }),
      ...(this.globalError === undefined ? {} : { globalError: this.globalError }),
    }
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of [...this.listeners]) listener()
    void this.syncGlobalShortcuts(this.snapshot)
  }

  /** Serialize writes so rapid shortcut edits cannot race the revision fence. */
  private queueSettingsWrite(): Promise<void> {
    const bindings = structuredClone(this.userBindings)
    this.settingsWriteChain = this.settingsWriteChain.then(() => this.settings.setBindings(bindings))
    return this.settingsWriteChain
  }

  private async syncGlobalShortcuts(snapshot: ShortcutSnapshot): Promise<void> {
    const desktop = window.desktopApi?.shortcuts
    if (desktop === undefined) return
    const generation = ++this.globalSyncGeneration
    const bindings = snapshot.bindings
      .filter(binding => binding.scope === "global" && binding.globalCapable)
      .map(binding => ({ commandId: binding.commandId, accelerator: toElectronAccelerator(binding.combo) }))
    try {
      const result = await desktop.sync({ bindings })
      if (generation !== this.globalSyncGeneration) return
      this.globalError = result.ok
        ? undefined
        : (result.conflicts ?? []).map(conflict => `${conflict.accelerator}: ${conflict.reason}`).join(", ") || "全局快捷键注册失败"
      this.snapshot = this.buildSnapshot()
      for (const listener of [...this.listeners]) listener()
    } catch (error: unknown) {
      if (generation !== this.globalSyncGeneration) return
      this.globalError = error instanceof Error ? error.message : String(error)
      this.snapshot = this.buildSnapshot()
      for (const listener of [...this.listeners]) listener()
    }
  }
}

export function comboFromEvent(event: KeyboardEvent): Combo | undefined {
  return comboFromKeyboardEvent(event)
}
