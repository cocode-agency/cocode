import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { execFile as execFileCallback } from "node:child_process"
import htmlToDocx from "html-to-docx"
import mammoth from "mammoth"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import { resolve as resolvePath, sep, win32 } from "node:path"
import { extname, join } from "pathe"

const MAX_WORD_BYTES = 24 * 1024 * 1024
const MAX_WORD_HTML_BYTES = 8 * 1024 * 1024
const OFFICE_TIMEOUT_MS = 45_000
const execFile = promisify(execFileCallback)
let officePathPromise: Promise<string | undefined> | undefined

type OfficeDiscoveryOptions = {
  readonly platform?: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly canAccess?: (path: string) => Promise<boolean>
  readonly locateOnPath?: (locator: string, executable: string) => Promise<string | undefined>
}

/** Candidate paths in priority order; exported only for focused host tests. */
export function officeCandidates(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const candidates = [env.COCODE_SOFFICE_PATH, env.SOFFICE_PATH]
  if (platform === "win32") {
    candidates.push(
      ...[env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]]
        .filter((value): value is string => value !== undefined && value !== "")
        .map(base => win32.join(base, "LibreOffice", "program", "soffice.exe")),
      env.LOCALAPPDATA === undefined || env.LOCALAPPDATA === ""
        ? undefined
        : win32.join(env.LOCALAPPDATA, "Programs", "LibreOffice", "program", "soffice.exe"),
    )
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/Applications/LibreOfficeDev.app/Contents/MacOS/soffice",
      "/opt/homebrew/bin/soffice",
      "/usr/local/bin/soffice",
    )
  } else {
    candidates.push("/usr/local/bin/soffice")
  }
  candidates.push("soffice")
  return [...new Set(candidates.filter((value): value is string => value !== undefined && value !== ""))]
}

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function locateOfficeOnPath(locator: string, executable: string): Promise<string | undefined> {
  try {
    const result = await execFile(locator, [executable], { timeout: 2_000 })
    return result.stdout.trim().split(/\r?\n/, 1)[0] || undefined
  } catch {
    return undefined
  }
}

/** Resolve an installed LibreOffice executable without relying on shell syntax. */
export async function discoverOfficePath(options: OfficeDiscoveryOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform
  const candidates = officeCandidates(platform, options.env ?? process.env)
  const accessible = options.canAccess ?? canAccess
  const locate = options.locateOnPath ?? locateOfficeOnPath
  for (const candidate of candidates) {
    if (candidate === "soffice") return locate(platform === "win32" ? "where.exe" : "which", candidate)
    if (await accessible(candidate)) return candidate
  }
  return undefined
}

async function findOffice(): Promise<string | undefined> {
  if (officePathPromise !== undefined) return officePathPromise
  officePathPromise = discoverOfficePath()
  return officePathPromise
}

async function runOffice(args: readonly string[]): Promise<void> {
  const office = await findOffice()
  if (office === undefined) throw new Error("LibreOffice is not installed")
  await execFile(office, [
    "--headless",
    "--invisible",
    "--nodefault",
    "--nologo",
    "--nolockcheck",
    "--norestore",
    ...args,
  ], { timeout: OFFICE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
}

function bodyHtml(documentHtml: string): string {
  const match = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(documentHtml)
  return match?.[1] ?? documentHtml
}

async function inlineOfficeImages(html: string, directory: string): Promise<string> {
  const imagePattern = /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi
  const matches = [...html.matchAll(imagePattern)]
  let result = html
  for (const match of matches) {
    const source = match[2]
    if (source === undefined || /^(?:data:|https?:|mailto:|#)/i.test(source)) continue
    let imagePath: string
    try {
      imagePath = source.startsWith("file:") ? new URL(source).pathname : join(directory, decodeURIComponent(source))
      imagePath = resolvePath(imagePath)
    } catch {
      continue
    }
    const directoryRoot = resolvePath(directory) + sep
    if (!imagePath.startsWith(directoryRoot)) continue
    try {
      const image = await readFile(imagePath)
      const extension = extname(imagePath).toLowerCase()
      const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".svg" ? "image/svg+xml" : extension === ".gif" ? "image/gif" : "image/png"
      const replacement = `${match[1]}data:${mime};base64,${image.toString("base64")}${match[3]}`
      result = result.replace(match[0], replacement)
    } catch {
      // Keep the image reference out rather than leaking a local filesystem path.
      result = result.replace(match[0], `${match[1]}${match[3]}`)
    }
  }
  return result
}

async function officeRead(path: string, writable: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "cocode-word-read-"))
  try {
    await runOffice(["--convert-to", "html", "--outdir", directory, path])
    const output = (await readdir(directory)).find(file => extname(file).toLowerCase() === ".html")
    if (output === undefined) throw new Error("LibreOffice did not produce HTML")
    const documentHtml = await readFile(join(directory, output), "utf8")
    const html = await inlineOfficeImages(bodyHtml(documentHtml), directory)
    assertSize(Buffer.byteLength(html, "utf8"), MAX_WORD_HTML_BYTES)
    return { kind: "word" as const, html, warnings: [] as string[], writable, engine: "libreoffice" as const }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function isLegacyWord(path: string): boolean {
  return path.toLowerCase().endsWith(".doc")
}

async function officeWrite(path: string, html: string): Promise<{ written: true; bytes: number; engine: "libreoffice" }> {
  const directory = await mkdtemp(join(tmpdir(), "cocode-word-write-"))
  try {
    const input = join(directory, "edited.html")
    await writeFile(input, `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`, "utf8")
    const legacy = isLegacyWord(path)
    await runOffice(["--convert-to", legacy ? "doc:MS Word 97" : "docx:Office Open XML Text", "--outdir", directory, input])
    const output = join(directory, legacy ? "edited.doc" : "edited.docx")
    const buffer = await readFile(output)
    assertSize(buffer.byteLength, MAX_WORD_BYTES)
    await writeFile(path, buffer)
    return { written: true, bytes: buffer.byteLength, engine: "libreoffice" }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// Keep the conversion semantic rather than flattening named Word styles into
// plain paragraphs. Mammoth already understands the built-in styles, while
// these mappings cover the names commonly emitted by Word, WPS and
// LibreOffice documents.
const WORD_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Subtle Emphasis'] => blockquote:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "p[style-name='Caption'] => p.caption:fresh",
  "p[style-name='List Paragraph'] => p:fresh",
  "r[style-name='Emphasis'] => em",
  "r[style-name='Intense Emphasis'] => em",
  "r[style-name='Strong Emphasis'] => strong",
  "r[style-name='Intense Reference'] => strong",
  "r[style-name='Book Title'] => cite",
  "br[type='page'] => div.page-break",
].join("\n")

function assertWord(path: string): void {
  if (!/\.(?:docx|doc)$/i.test(path)) throw new Error("only .docx and .doc Word documents are supported")
}

function assertSize(bytes: number, limit: number): void {
  if (bytes > limit) throw new Error(`Word document is too large (maximum ${String(Math.round(limit / 1024 / 1024))} MB)`)
}

/** Convert a local DOCX into self-contained semantic HTML for the editor. */
export async function readWordDocument(path: string, writable: boolean) {
  assertWord(path)
  const info = await stat(path)
  assertSize(info.size, MAX_WORD_BYTES)
  const buffer = await readFile(path)
  try {
    return await officeRead(path, writable)
  } catch (officeError) {
    if (isLegacyWord(path)) {
      const detail = officeError instanceof Error ? `: ${officeError.message}` : ""
      throw new Error(`LibreOffice is required to preview legacy .doc files${detail}`)
    }
    // A packaged Cocode installation may not ship LibreOffice. Keep the
    // pure-JS path as a deterministic fallback, but surface the reduced
    // fidelity instead of silently claiming full Word compatibility.
    const officeMessage = officeError instanceof Error ? officeError.message : String(officeError)
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: WORD_STYLE_MAP,
        includeDefaultStyleMap: true,
        includeEmbeddedStyleMap: true,
        ignoreEmptyParagraphs: false,
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async image => ({
          src: `data:${image.contentType};base64,${await image.readAsBase64String()}`,
        })),
      },
    )
    assertSize(Buffer.byteLength(result.value, "utf8"), MAX_WORD_HTML_BYTES)
    return {
      kind: "word" as const,
      html: result.value,
      warnings: [`Full-fidelity Word conversion unavailable: ${officeMessage}`, ...result.messages.map(item => item.message)],
      writable,
      engine: "mammoth" as const,
    }
  }
}

/** Rebuild a native, editable DOCX from the semantic HTML edited in the UI. */
export async function writeWordDocument(path: string, html: string) {
  assertWord(path)
  assertSize(Buffer.byteLength(html, "utf8"), MAX_WORD_HTML_BYTES)
  try {
    return await officeWrite(path, html)
  } catch (officeError) {
    if (isLegacyWord(path)) {
      const detail = officeError instanceof Error ? `: ${officeError.message}` : ""
      throw new Error(`LibreOffice is required to edit legacy .doc files${detail}`)
    }
    const result = await htmlToDocx(html, null, {
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      font: "Arial",
      fontSize: 21,
      lang: "zh-CN",
      table: { row: { cantSplit: false } },
    })
    const buffer = Buffer.isBuffer(result) ? result : Buffer.from(await result.arrayBuffer())
    assertSize(buffer.byteLength, MAX_WORD_BYTES)
    await writeFile(path, buffer)
    return { written: true, bytes: buffer.byteLength, engine: "html-to-docx" as const }
  }
}
