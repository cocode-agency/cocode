import { afterEach, describe, expect, it } from "vitest"
import { en, revealLabel, t, zh } from "../src/client/locales.ts"

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")

afterEach(() => {
  if (originalNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator
  else Object.defineProperty(globalThis, "navigator", originalNavigator)
})

describe("revealLabel", () => {
  it("uses Finder on macOS", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "MacIntel", language: "zh-CN" } })
    expect(revealLabel()).toBe("在 Finder 中显示")
  })

  it("uses the generic file manager label elsewhere", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "Linux x86_64", language: "zh-CN" } })
    expect(revealLabel()).toBe("在文件管理器中显示")
  })
})

describe("tab context menu translations", () => {
  it("provides every tab action in Chinese and English", () => {
    const keys = [
      "tabMenu.close",
      "tabMenu.closeOthers",
      "tabMenu.closeRight",
      "tabMenu.closeAll",
      "tabMenu.splitRight",
      "tabMenu.splitDown",
      "tabMenu.moveBottom",
      "tabMenu.moveRight",
    ] as const

    for (const key of keys) {
      expect(zh[key]).not.toBe(en[key])
      expect(zh[key]).not.toBe("")
      expect(en[key]).not.toBe("")
    }
  })

  it("uses the current fallback language for tab actions", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "MacIntel", language: "zh-CN" } })
    expect(t("tabMenu.closeOthers")).toBe("关闭其他标签页")

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: "MacIntel", language: "en-US" } })
    expect(t("tabMenu.closeOthers")).toBe("Close Others")
  })
})

describe("diagnostic translations", () => {
  it("uses desktop terminology for the memory metric in both locales", () => {
    expect(zh["diagnostics.electronMemory"]).toBe("桌面端内存")
    expect(en["diagnostics.electronMemory"]).toBe("Desktop memory")
    expect(zh["diagnostics.electronMemory"]).not.toContain("Electron")
    expect(en["diagnostics.electronMemory"]).not.toContain("Electron")
  })
})
