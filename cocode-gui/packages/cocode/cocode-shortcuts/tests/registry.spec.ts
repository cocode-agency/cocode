// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import type { ShortcutSettingsView } from "../src/settings.ts"
import { ShortcutRegistry } from "../src/client/registry.ts"
import { ShortcutSettingsController } from "../src/client/settings-controller.ts"

function view(
  bindings: ShortcutSettingsView["value"]["bindings"] = {},
  revision = 0,
): ShortcutSettingsView {
  return {
    value: { version: 1, bindings },
    revision,
    writable: true,
  }
}

async function setup(
  bindings: ShortcutSettingsView["value"]["bindings"] = {},
): Promise<{
  readonly controller: ShortcutSettingsController
  readonly registry: ShortcutRegistry
}> {
  const controller = new ShortcutSettingsController({
    get: async () => view(bindings),
    update: async patch => view(patch.bindings ?? {}, 1),
  })
  await controller.reload()
  return {
    controller,
    registry: new ShortcutRegistry({} as never, controller),
  }
}

describe("ShortcutRegistry", () => {
  it("merges user overrides, disabled commands, conflicts, scopes, and orphans", async () => {
    const { registry } = await setup({
      first: { combo: { key: "k", primary: true } },
      second: { combo: { key: "k", primary: true }, scope: "global" },
      disabled: { disabled: true },
      orphan: { combo: { key: "F2" } },
    })
    registry.register({
      id: "first",
      title: "First",
      defaultCombo: { key: "a", primary: true },
      run: () => true,
    })
    registry.register({
      id: "second",
      title: "Second",
      defaultCombo: { key: "b", primary: true },
      globalCapable: true,
      run: () => true,
    })
    registry.register({
      id: "disabled",
      title: "Disabled",
      defaultCombo: { key: "d", primary: true },
      run: () => true,
    })

    const snapshot = registry.getSnapshot()
    expect(snapshot.bindings.map(binding => [binding.commandId, binding.scope])).toEqual([
      ["first", "app"],
      ["second", "global"],
    ])
    expect(snapshot.conflicts).toHaveLength(1)
    expect(snapshot.orphaned).toEqual(["orphan"])
  })

  it("falls back to app scope when stale settings mark a local command global", async () => {
    const { registry } = await setup({
      local: { combo: { key: "l", primary: true }, scope: "global" },
    })
    const run = vi.fn(() => true)
    registry.register({
      id: "local",
      title: "Local",
      defaultCombo: { key: "a", primary: true },
      run,
    })

    expect(registry.getSnapshot().bindings).toEqual([
      expect.objectContaining({ commandId: "local", scope: "app" }),
    ])
    const dispose = registry.mount()
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "l",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
    expect(run).toHaveBeenCalledTimes(1)
    dispose()
  })

  it("keeps global-capable shortcuts usable in a browser without the desktop bridge", async () => {
    const { registry } = await setup({
      global: { combo: { key: "g", primary: true }, scope: "global" },
    })
    const run = vi.fn(() => true)
    registry.register({
      id: "global",
      title: "Global",
      defaultCombo: { key: "a", primary: true },
      globalCapable: true,
      run,
    })

    const dispose = registry.mount()
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "g",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
    expect(run).toHaveBeenCalledTimes(1)
    dispose()
  })

  it("serializes rapid edits instead of losing the later binding", async () => {
    let releaseFirst!: () => void
    const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve })
    const updates: ShortcutSettingsView["value"]["bindings"][] = []
    const controller = new ShortcutSettingsController({
      get: async () => view(),
      update: async patch => {
        updates.push(structuredClone(patch.bindings ?? {}))
        if (updates.length === 1) await firstWrite
        return view(patch.bindings ?? {}, updates.length)
      },
    })
    await controller.reload()
    const registry = new ShortcutRegistry({} as never, controller)
    registry.register({
      id: "first",
      title: "First",
      defaultCombo: { key: "a", primary: true },
      run: () => true,
    })
    registry.register({
      id: "second",
      title: "Second",
      defaultCombo: { key: "b", primary: true },
      run: () => true,
    })

    registry.setBinding("first", { combo: { key: "f", primary: true } })
    registry.setBinding("second", { combo: { key: "s", primary: true } })
    await Promise.resolve()
    expect(updates).toHaveLength(1)
    releaseFirst()
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(updates).toEqual([
      { first: { combo: { key: "f", primary: true }, disabled: false } },
      {
        first: { combo: { key: "f", primary: true }, disabled: false },
        second: { combo: { key: "s", primary: true }, disabled: false },
      },
    ])
  })

  it("does not consume unmatched, text-entry, IME, or false-returning commands", async () => {
    const { registry } = await setup()
    const run = vi.fn(() => false)
    registry.register({
      id: "test",
      title: "Test",
      defaultCombo: { key: "k", primary: true },
      run,
    })
    const dispose = registry.mount()

    const unmatched = new KeyboardEvent("keydown", {
      key: "x",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(unmatched)
    expect(unmatched.defaultPrevented).toBe(false)

    const input = document.createElement("input")
    document.body.append(input)
    const textEntry = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(textEntry)
    expect(run).not.toHaveBeenCalled()
    expect(textEntry.defaultPrevented).toBe(false)

    const composing = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(composing)
    expect(run).not.toHaveBeenCalled()

    const returnsFalse = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(returnsFalse)
    expect(run).toHaveBeenCalledTimes(1)
    expect(returnsFalse.defaultPrevented).toBe(false)

    dispose()
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("protects contentEditable and xterm targets", async () => {
    const { registry } = await setup()
    const run = vi.fn(() => true)
    registry.register({
      id: "test",
      title: "Test",
      defaultCombo: { key: "k", primary: true },
      run,
    })
    const dispose = registry.mount()

    const editable = document.createElement("div")
    editable.contentEditable = "true"
    document.body.append(editable)
    Object.defineProperty(editable, "isContentEditable", { value: true })
    editable.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))

    const terminal = document.createElement("div")
    terminal.className = "xterm"
    const terminalInput = document.createElement("textarea")
    terminal.append(terminalInput)
    document.body.append(terminal)
    terminalInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))

    expect(run).not.toHaveBeenCalled()
    dispose()
  })

  it("resets every user binding and drops orphaned keys", async () => {
    const { registry } = await setup({
      first: { combo: { key: "k", primary: true } },
      orphan: { combo: { key: "F2" } },
    })
    registry.register({
      id: "first",
      title: "First",
      defaultCombo: { key: "a", primary: true },
      run: () => true,
    })

    const dispose = registry.mount()
    try {
      await registry.clearOrphaned()
      expect(registry.getSnapshot().orphaned).toEqual([])
      expect(registry.getUserBinding("first")).toEqual({ combo: { key: "k", primary: true } })

      await registry.resetAllBindings()
      expect(registry.getUserBinding("first")).toBeUndefined()
      expect(registry.getSnapshot().bindings).toEqual([
        expect.objectContaining({ commandId: "first", combo: { key: "a", primary: true } }),
      ])
    } finally {
      dispose()
    }
  })
})
