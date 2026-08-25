import { describe, expect, it, vi } from "vitest"
import {
  FILE_ADD_TO_CHAT_COMMAND,
  FILE_OPEN_COMMAND,
  formatFileShortcut,
  fileShortcutCommands,
  setActiveFileShortcutTarget,
} from "../src/client/file-shortcuts.ts"

describe("file list shortcuts", () => {
  it("exposes the VS Code/Cursor-aligned defaults", () => {
    const commands = Object.fromEntries(fileShortcutCommands().map(command => [command.id, command]))
    expect(commands[FILE_OPEN_COMMAND]?.defaultCombo).toEqual({ key: "Enter" })
    expect(commands[FILE_ADD_TO_CHAT_COMMAND]?.defaultCombo).toEqual({ key: "l", primary: true })
  })

  it("formats compact platform-aware menu hints", () => {
    expect(formatFileShortcut({ key: "l", primary: true }, "MacIntel")).toBe("⌘L")
    expect(formatFileShortcut({ key: "l", primary: true }, "Win32")).toBe("Ctrl+L")
    expect(formatFileShortcut({ key: "F2" }, "MacIntel")).toBe("F2")
  })

  it("only runs when the file list is active", () => {
    const run = vi.fn(() => true)
    setActiveFileShortcutTarget({ isActive: () => false, run })
    expect(fileShortcutCommands().find(command => command.id === FILE_OPEN_COMMAND)?.run()).toBe(false)
    expect(run).not.toHaveBeenCalled()
    setActiveFileShortcutTarget({ isActive: () => true, run })
    expect(fileShortcutCommands().find(command => command.id === FILE_OPEN_COMMAND)?.run()).toBe(true)
    expect(run).toHaveBeenCalledWith(FILE_OPEN_COMMAND)
    setActiveFileShortcutTarget(undefined)
  })

  it("selects the focused target when multiple file trees are mounted", () => {
    const firstRun = vi.fn(() => true)
    const secondRun = vi.fn(() => true)
    let firstActive = false
    let secondActive = false
    setActiveFileShortcutTarget({ isActive: () => firstActive, run: firstRun })
    setActiveFileShortcutTarget({ isActive: () => secondActive, run: secondRun })

    firstActive = true
    expect(fileShortcutCommands().find(command => command.id === FILE_OPEN_COMMAND)?.run()).toBe(true)
    expect(firstRun).toHaveBeenCalledWith(FILE_OPEN_COMMAND)
    expect(secondRun).not.toHaveBeenCalled()

    firstActive = false
    secondActive = true
    expect(fileShortcutCommands().find(command => command.id === FILE_OPEN_COMMAND)?.run()).toBe(true)
    expect(secondRun).toHaveBeenCalledWith(FILE_OPEN_COMMAND)
    setActiveFileShortcutTarget(undefined)
  })
})
