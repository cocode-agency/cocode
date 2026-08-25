// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { prepareWorkbook, serializeExcelEditor } from "../src/client/excel-preview.tsx"

describe("Excel preview workbook chrome", () => {
  it("decorates every exported sheet with Excel-style coordinates and preserves sheet names", () => {
    const prepared = prepareWorkbook(`
      <p><center><h1>Overview</h1></center></p>
      <a name="table0"><h1>Sheet 1: <em>Summary</em></h1></a>
      <table><tr><td data-sheets-value="{ &quot;1&quot;: 2, &quot;2&quot;: &quot;Project&quot;}">Project</td><td>Status</td></tr><tr><td>GUI</td><td>Ready</td></tr></table>
      <a name="table1"><h1>Sheet 2: <em>Data 2026</em></h1></a>
      <table><tr><td>Month</td><td>Value</td></tr><tr><td>August</td><td sdval="42">42</td></tr></table>
    `)

    expect(prepared.sheets.map(sheet => sheet.name)).toEqual(["Summary", "Data 2026"])
    const root = document.createElement("div")
    root.innerHTML = prepared.html
    expect(root.querySelectorAll("table[data-cocode-excel-sheet]")).toHaveLength(2)
    expect(root.querySelector("[data-cocode-excel-sheet='0'] [data-excel-address='A1']")?.textContent).toBe("Project")
    expect(root.querySelector("[data-cocode-excel-sheet='0'] [data-excel-address='B2']")?.textContent).toBe("Ready")
    expect(root.querySelector("[data-cocode-excel-ui='column-header']")?.textContent).toBe("A")
    expect(root.querySelector("[data-cocode-excel-ui='row-header']")?.textContent).toBe("1")
  })

  it("strips only preview chrome before save and keeps formulas, formats, and images", () => {
    const prepared = prepareWorkbook(`<table><tr><td data-sheets-formula="=SUM(A1:A2)" style="font-weight:700"><img src="data:image/png;base64,AAAA" alt="Chart">3</td></tr></table>`)
    const root = document.createElement("div")
    root.innerHTML = prepared.html
    const saved = serializeExcelEditor(root)
    expect(saved).not.toContain("data-cocode-excel-ui")
    expect(saved).not.toContain("data-excel-address")
    expect(saved).toContain('data-sheets-formula="=SUM(A1:A2)"')
    expect(saved).toContain('style="font-weight:700"')
    expect(saved).toContain('src="data:image/png;base64,AAAA"')
  })
})
