// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { EditorView } from "@codemirror/view"
import { undo } from "@codemirror/commands"
import { language } from "@codemirror/language"
import { CodeEditor, type CodeEditorProps } from "../src/client/code-editor.tsx"

// React 18's act() needs the test environment flag to avoid noisy warnings.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ""
})

interface MountedEditor {
  readonly host: HTMLDivElement
  readonly view: EditorView
  readonly rerender: (next: CodeEditorProps) => void
}

function mount(props: CodeEditorProps): MountedEditor {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  const render = (next: CodeEditorProps): void => {
    act(() => root.render(<CodeEditor {...next} />))
  }
  render(props)
  const content = host.querySelector(".cm-content")
  if (content === null) throw new Error("CodeMirror content element not found")
  const view = EditorView.findFromDOM(content as HTMLElement)
  if (view === null) throw new Error("CodeMirror view not found for content element")
  return { host, view, rerender: render }
}

describe("CodeEditor", () => {
  it("reports local edits through onChange", () => {
    const onChange = vi.fn()
    const { view } = mount({ value: "hello", onChange })

    // A bare dispatch (no EXTERNAL_CHANGE annotation) stands in for a user
    // keystroke at the transaction level; the component must surface it.
    act(() => view.dispatch({ changes: { from: 5, insert: " world" } }))

    expect(view.state.doc.toString()).toBe("hello world")
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("hello world")
  })

  it("wraps long lines and highlights the active content line", () => {
    const onChange = vi.fn()
    const { view } = mount({ value: "long line", onChange })

    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true)
    act(() => view.focus())
    expect(view.dom.querySelector(".cm-activeLine")).not.toBeNull()
  })

  it("replaces the document for an external value change without firing onChange", () => {
    const onChange = vi.fn()
    const { view, rerender } = mount({ value: "one", onChange })
    expect(view.state.doc.toString()).toBe("one")

    rerender({ value: "two", onChange })

    expect(view.state.doc.toString()).toBe("two")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("does not re-report a save re-read that round-trips the same content", () => {
    const onChange = vi.fn()
    const { view, rerender } = mount({ value: "a", onChange })

    act(() => view.dispatch({ changes: { from: 1, insert: "b" } }))
    expect(onChange).toHaveBeenLastCalledWith("ab")
    const callsAfterEdit = onChange.mock.calls.length

    // The caller persists and feeds the disk content back as the new value;
    // this must not read back as a fresh edit.
    rerender({ value: "ab", onChange })

    expect(view.state.doc.toString()).toBe("ab")
    expect(onChange.mock.calls.length).toBe(callsAfterEdit)
  })

  it("applies a refresh whose disk content differs without firing onChange", () => {
    const onChange = vi.fn()
    const { view, rerender } = mount({ value: "old", onChange })

    rerender({ value: "new content", onChange })

    expect(view.state.doc.toString()).toBe("new content")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("does not add an external refresh to the undo history", () => {
    const onChange = vi.fn()
    const { view, rerender } = mount({ value: "old", onChange })

    rerender({ value: "new content", onChange })

    act(() => undo(view))

    expect(view.state.doc.toString()).toBe("new content")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("disables editing and marks the surface read-only when readOnly is set", () => {
    const onChange = vi.fn()
    const { host, view, rerender } = mount({ value: "abc", onChange })

    rerender({ value: "abc", readOnly: true, onChange })

    expect(view.state.readOnly).toBe(true)
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false")
    expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true")
    expect(host.querySelector("[data-readonly]")).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    rerender({ value: "abc", readOnly: false, onChange })
    expect(view.state.readOnly).toBe(false)
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("true")
    expect(host.querySelector("[data-readonly]")).toBeNull()
  })

  it("reconfigures the grammar when lang changes and preserves the document", () => {
    const onChange = vi.fn()
    const { view, rerender } = mount({ value: "print('hi')", lang: "py", onChange })

    expect(view.state.facet(language)?.name).toBe("python")

    rerender({ value: "print('hi')", lang: "rs", onChange })
    expect(view.state.facet(language)?.name).toBe("rust")
    expect(view.state.doc.toString()).toBe("print('hi')")

    rerender({ value: "print('hi')", lang: undefined, onChange })
    expect(view.state.facet(language)).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
