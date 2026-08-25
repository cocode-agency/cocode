// Extension → CodeMirror language mapping for the workbench source editor.
// Only the official @codemirror/lang-* grammars are used; an extension
// without one renders plain text (still line-numbered, still editable). The
// read card's shiki highlighter keeps its own wider set — this table is the
// editor's, and the two deliberately do not need to agree.
//
// Why these grammars are statically imported (bundle-growth decision):
// - The thirteen @codemirror/lang-* entry files together weigh ~172 KiB raw
//   (~52 KiB gzip) before tree-shaking, so they are a modest, one-time cost
//   for always-available highlighting with no first-open flash.
// - Dynamic `import()` would split the workbench client into extra chunks,
//   but this plugin ships as exactly one `lib/client.js` (tsdown + the
//   `dshClientBundlePlugin`/`findDshClientBundles` pipeline in
//   vite.renderer.config.ts). Staging lazy chunks would mean reworking that
//   pipeline — a far larger change than the gzip saving it buys.
// - Lazy grammars also force async reconfigure + race handling when the user
//   switches files faster than a chunk resolves.
// Revisit only if the grammar set grows materially or the client-bundle
// pipeline learns to stage multiple chunks per plugin.

import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { python } from "@codemirror/lang-python"
import { java } from "@codemirror/lang-java"
import { cpp } from "@codemirror/lang-cpp"
import { css } from "@codemirror/lang-css"
import { sass } from "@codemirror/lang-sass"
import { html } from "@codemirror/lang-html"
import { markdown } from "@codemirror/lang-markdown"
import { php } from "@codemirror/lang-php"
import { rust } from "@codemirror/lang-rust"
import { sql } from "@codemirror/lang-sql"
import { xml } from "@codemirror/lang-xml"
import type { LanguageSupport } from "@codemirror/language"

/** JS-family extensions and the grammar they resolve to. */
const JAVASCRIPT = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"])

/** C/C++ family extensions sharing the cpp grammar. */
const CPP = new Set(["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx"])

/**
 * The CodeMirror language for a file extension, or `undefined` when the
 * editor has no grammar for it (plain text, no highlighting). Extension is
 * matched lower-cased, matching the caller's `path.split(".").at(-1)`.
 * @param extension - lower-cased file extension, or `undefined` for a pathless file.
 * @returns the language support to install, or `undefined` for plain text.
 */
export function codeLanguageForExtension(extension: string | undefined): LanguageSupport | undefined {
  if (extension === undefined) return undefined
  const ext = extension.toLowerCase()
  if (JAVASCRIPT.has(ext)) {
    return javascript({
      typescript: ext.startsWith("ts"),
      jsx: ext.endsWith("x") || ext === "jsx",
    })
  }
  if (ext === "json" || ext === "jsonc") return json()
  if (ext === "py" || ext === "python") return python()
  if (ext === "java") return java()
  if (CPP.has(ext)) return cpp()
  if (ext === "css") return css()
  if (ext === "scss" || ext === "sass") return sass({ indented: ext === "sass" })
  if (ext === "html" || ext === "htm") return html()
  if (ext === "md" || ext === "markdown" || ext === "mdx") return markdown()
  if (ext === "php") return php()
  if (ext === "rs" || ext === "rust") return rust()
  if (ext === "sql") return sql()
  if (ext === "xml") return xml()
  return undefined
}
