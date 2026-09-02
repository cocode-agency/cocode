import { describe, expect, it } from "vitest"
import { fileMentionText, treeMentionPath } from "../src/client/file-mention.ts"
import { fileMenuEntries, isFileCommand } from "../src/client/files-menu.ts"

describe("file tree chat insertion", () => {
  it("offers add-to-chat for files, folders, and the workspace root", () => {
    const fileIds = fileMenuEntries({ isDir: false, isRoot: false, canPaste: false }).map(entry => entry.id)
    const folderIds = fileMenuEntries({ isDir: true, isRoot: false, canPaste: false }).map(entry => entry.id)
    const rootIds = fileMenuEntries({ isDir: true, isRoot: true, canPaste: false }).map(entry => entry.id)

    expect(fileIds).toContain("addToChat")
    expect(fileIds).not.toContain("openBottom")
    expect(folderIds).toContain("addToChat")
    expect(rootIds).toContain("addToChat")
    expect(isFileCommand("addToChat")).toBe(true)
  })

  it("adds effective shortcut hints only to commands that have bindings", () => {
    const entries = fileMenuEntries(
      { isDir: true, isRoot: false, canPaste: true },
      commandId => `key:${commandId}`,
    )

    expect(entries.find(entry => entry.id === "addToChat")).toMatchObject({ shortcut: "key:cocode.files.addToChat" })
    expect(entries.find(entry => entry.id === "copyPath")).toMatchObject({ shortcut: undefined })
  })

  it("uses the file mention projection for tree insertion", () => {
    expect(fileMentionText("src/main.ts")).toBe("@src/main.ts ")
    expect(fileMentionText("工作周报示例.docx")).toBe("@工作周报示例.docx ")
    expect(fileMentionText("docs/design note.md")).toBe('@"docs/design note.md" ')
    expect(treeMentionPath("/work/repo", "/work/repo/docs", true)).toBe("docs/")
    expect(treeMentionPath("/work/repo", "/work/repo", true)).toBe(".")
  })
})
