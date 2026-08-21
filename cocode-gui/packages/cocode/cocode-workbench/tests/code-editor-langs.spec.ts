import { describe, expect, it } from "vitest"
import { codeLanguageForExtension } from "../src/client/code-editor-langs.ts"

describe("codeLanguageForExtension", () => {
  it("maps the JS family to the TypeScript-flavored grammar by extension", () => {
    expect(codeLanguageForExtension("ts")).toBeDefined()
    expect(codeLanguageForExtension("tsx")).toBeDefined()
    expect(codeLanguageForExtension("js")).toBeDefined()
    expect(codeLanguageForExtension("jsx")).toBeDefined()
  })

  it("maps common code extensions to a grammar", () => {
    for (const ext of ["py", "java", "rs", "cpp", "c", "css", "scss", "html", "md", "php", "sql", "xml", "json"]) {
      expect(codeLanguageForExtension(ext), ext).toBeDefined()
    }
  })

  it("is case-insensitive", () => {
    expect(codeLanguageForExtension("TS")).toBeDefined()
    expect(codeLanguageForExtension("Py")).toBeDefined()
  })

  it("returns undefined for extensions without a grammar", () => {
    expect(codeLanguageForExtension("vue")).toBeUndefined()
    expect(codeLanguageForExtension("svelte")).toBeUndefined()
    expect(codeLanguageForExtension("xyz")).toBeUndefined()
  })

  it("returns undefined for a missing extension", () => {
    expect(codeLanguageForExtension(undefined)).toBeUndefined()
  })
})
