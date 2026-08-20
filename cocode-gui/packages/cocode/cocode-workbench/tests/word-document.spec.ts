import { describe, expect, it, vi } from "vitest"
import { discoverOfficePath, officeCandidates } from "../src/word-document.ts"

describe("LibreOffice discovery", () => {
  it("checks standard Windows installation directories before PATH", async () => {
    const installed = "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
    const locateOnPath = vi.fn(async () => undefined)
    const result = await discoverOfficePath({
      platform: "win32",
      env: {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\coder\\AppData\\Local",
      },
      canAccess: async path => path === installed,
      locateOnPath,
    })

    expect(result).toBe(installed)
    expect(locateOnPath).not.toHaveBeenCalled()
  })

  it("uses where.exe-compatible PATH lookup semantics on Windows", async () => {
    const locateOnPath = vi.fn(async () => "C:\\Tools\\LibreOffice\\soffice.exe")
    const result = await discoverOfficePath({
      platform: "win32",
      env: {},
      canAccess: async () => false,
      locateOnPath,
    })

    expect(result).toBe("C:\\Tools\\LibreOffice\\soffice.exe")
    expect(locateOnPath).toHaveBeenCalledWith("where.exe", "soffice")
  })

  it("keeps explicit environment overrides ahead of platform defaults", () => {
    expect(officeCandidates("win32", {
      COCODE_SOFFICE_PATH: "D:\\Portable\\LibreOffice\\soffice.exe",
      ProgramFiles: "C:\\Program Files",
    })).toEqual([
      "D:\\Portable\\LibreOffice\\soffice.exe",
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "soffice",
    ])
  })
})
