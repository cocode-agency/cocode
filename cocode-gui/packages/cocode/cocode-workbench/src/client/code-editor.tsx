// CodeEditor: the workbench's source-mode editor — a CodeMirror 6 view with
// line numbers, folding, bracket matching and shiki-token colors. It replaces
// the plain <textarea>: highlight + gutter + fold come from CodeMirror, while
// every color resolves through the same --shiki-*/--dsw-* custom properties
// the read card's highlighter uses, so light and dark themes keep working
// without editor-specific values. The component is controlled: external
// `value` changes replace the document, local edits fire `onChange`, and
// Cmd/Ctrl+S fires `onSave` (the caller decides whether anything is dirty).

import { useEffect, useRef } from "react"
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state"
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding,
} from "@codemirror/view"
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { tags } from "@lezer/highlight"
import { codeLanguageForExtension } from "./code-editor-langs.ts"
import css from "./code-editor.module.css"

export interface CodeEditorProps {
  /** The document text (controlled; an external change replaces the document). */
  readonly value: string
  /** Lower-cased file extension selecting the grammar; `undefined` renders plain text. */
  readonly lang?: string | undefined
  /** Edits disabled; the document stays selectable. */
  readonly readOnly?: boolean | undefined
  /** Fired with the full new text on every document change. */
  readonly onChange: (value: string) => void
  /** Fired on Cmd/Ctrl+S (also while read-only; the caller decides whether to save). */
  readonly onSave?: (() => void) | undefined
}

/** Editor facets for the two read-only states, swapped through a compartment. */
const READ_ONLY_EXTENSIONS = [EditorState.readOnly.of(true), EditorView.editable.of(false)]
const EDITABLE_EXTENSIONS = [EditorState.readOnly.of(false), EditorView.editable.of(true)]

/**
 * Tags the document replacement performed by an external `value` change. The
 * update listener skips transactions carrying this annotation, so a programmatic
 * sync (save re-read, refresh, another client's write) never surfaces as a local
 * edit through `onChange` — which would otherwise mark a just-saved file dirty.
 */
const EXTERNAL_CHANGE = Annotation.define<boolean>()

/** Fired by the Mod-s binding; the caller's latest `onSave` via ref. */
function saveBinding(onSave: { readonly current: (() => void) | undefined }): KeyBinding {
  return {
    key: "Mod-s",
    preventDefault: true,
    run: (): boolean => {
      onSave.current?.()
      return true
    },
  }
}

/**
 * Token colors for the editor: every rule resolves a `--shiki-*` custom
 * property, exactly the palette the read card's css-variables theme emits
 * (ui-theme styles/shiki.css). Light and dark come from the body cascade, so
 * the style itself never hardcodes a value.
 */
const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--shiki-token-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--shiki-token-string)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--shiki-token-comment)", fontStyle: "italic" },
  { tag: [tags.standard(tags.name), tags.constant(tags.name), tags.number, tags.bool, tags.null], color: "var(--shiki-token-constant)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName))], color: "var(--shiki-token-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--shiki-token-constant)" },
  { tag: tags.operator, color: "var(--shiki-token-keyword)" },
  { tag: tags.punctuation, color: "var(--shiki-token-punctuation)" },
  { tag: [tags.link, tags.url], color: "var(--shiki-token-link)" },
  { tag: tags.heading, color: "var(--shiki-token-function)", fontWeight: "600" },
])

/** Editor chrome: fonts and spacing from the panel, colors from app tokens. */
const editorBaseTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    color: "var(--shiki-foreground)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)",
    lineHeight: "1.65",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--shiki-foreground)",
  },
  ".cm-line": { padding: "0 16px 0 4px" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--shiki-token-comment)",
    borderRight: "none",
    paddingLeft: "8px",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--cocode-secondary) 45%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--shiki-token-keyword)" },
  ".cm-foldGutter .cm-gutterElement": { cursor: "pointer" },
  ".cm-foldPlaceholder": {
    backgroundColor: "color-mix(in srgb, var(--cocode-secondary) 60%, transparent)",
    border: "none",
    color: "var(--shiki-token-comment)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--shiki-token-function) 22%, transparent)",
    outline: "none",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--dsw-alias-bg-multi-select) 60%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--shiki-foreground)" },
  ".cm-placeholder": { color: "var(--shiki-token-comment)" },
}, { dark: false })

/** Empty theme whose only job is flipping CodeMirror's `dark` flag with the app theme. */
const DARK_THEME = EditorView.theme({}, { dark: true })

/**
 * The workbench source editor. One CodeMirror view per mount; language,
 * read-only and dark-flag changes reconfigure compartments, and external
 * `value` changes replace the document without touching the cursor while the
 * editor is being edited locally.
 */
export function CodeEditor({ value, lang, readOnly = false, onChange, onSave }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>()
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  valueRef.current = value
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  // Prop mirrors so the reconfigure effects only run when a prop changes.
  const appliedLangRef = useRef(lang)
  const appliedReadOnlyRef = useRef(readOnly)
  const langCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())
  const darkCompartment = useRef(new Compartment())

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const language = codeLanguageForExtension(appliedLangRef.current)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          rectangularSelection(),
          // Preserve the old textarea's soft-wrapping behavior for long lines.
          EditorView.lineWrapping,
          EditorState.allowMultipleSelections.of(true),
          // Two-column tab width preserves the workbench's 2-space code
          // convention (git-diff and the trajectory tables also use
          // `tab-size: 2`). CodeMirror computes tab columns from this facet and
          // emits it as the content's inline `tab-size` style, so the old
          // `<textarea>`'s `tab-size: 2` is re-expressed here rather than as a
          // hand-written CSS rule.
          EditorState.tabSize.of(2),
          syntaxHighlighting(editorHighlightStyle, { fallback: true }),
          editorBaseTheme,
          langCompartment.current.of(language === undefined ? [] : language),
          readOnlyCompartment.current.of(appliedReadOnlyRef.current ? READ_ONLY_EXTENSIONS : EDITABLE_EXTENSIONS),
          darkCompartment.current.of([]),
          keymap.of([...foldKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab, saveBinding(onSaveRef)]),
          EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off", autocomplete: "off" }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            // Only local (user) transactions reach `onChange`. External `value`
            // syncs are dispatched with the EXTERNAL_CHANGE annotation so a
            // save re-read or refresh never reads back as a fresh edit.
            if (update.transactions.some(transaction => transaction.annotation(EXTERNAL_CHANGE) === undefined)) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    // The app flips light/dark by toggling the body attribute; follow it so
    // CodeMirror's own `dark` flag (selection contrast, tooltips) tracks.
    const applyDark = (): void => {
      const dark = document.body.hasAttribute("data-ds-dark-theme")
      view.dispatch({ effects: darkCompartment.current.reconfigure(dark ? [DARK_THEME] : []) })
    }
    applyDark()
    const observer = new MutationObserver(applyDark)
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] })
    return () => {
      observer.disconnect()
      view.destroy()
      viewRef.current = undefined
    }
  }, [])

  // Controlled value: replace the document when it differs from the prop.
  // While the user types, the doc already equals `value`, so nothing fires and
  // the cursor/undo survive.
  useEffect(() => {
    const view = viewRef.current
    if (view === undefined) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: [
        EXTERNAL_CHANGE.of(true),
        // External refreshes replace the current document baseline. They must
        // not become undoable edits that can reintroduce stale content.
        Transaction.addToHistory.of(false),
      ],
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (view === undefined || lang === appliedLangRef.current) return
    appliedLangRef.current = lang
    const support = codeLanguageForExtension(lang)
    view.dispatch({ effects: langCompartment.current.reconfigure(support === undefined ? [] : support) })
  }, [lang])

  useEffect(() => {
    const view = viewRef.current
    if (view === undefined || readOnly === appliedReadOnlyRef.current) return
    appliedReadOnlyRef.current = readOnly
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(readOnly ? READ_ONLY_EXTENSIONS : EDITABLE_EXTENSIONS),
    })
  }, [readOnly])

  return <div ref={hostRef} className={css.host} data-readonly={readOnly || undefined} />
}
