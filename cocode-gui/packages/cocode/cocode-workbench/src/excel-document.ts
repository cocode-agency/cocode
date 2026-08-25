import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import { extname, join } from "pathe"
import { resolve as resolvePath, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { discoverOfficePath } from "./word-document.ts"

const MAX_EXCEL_BYTES = 32 * 1024 * 1024
const MAX_EXCEL_HTML_BYTES = 16 * 1024 * 1024
const OFFICE_TIMEOUT_MS = 45_000
const execFile = promisify(execFileCallback)
let officePathPromise: Promise<string | undefined> | undefined

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findOffice(): Promise<string | undefined> {
  if (officePathPromise !== undefined) return officePathPromise
  officePathPromise = discoverOfficePath({ canAccess })
  return officePathPromise
}

async function runOffice(args: readonly string[]): Promise<void> {
  const office = await findOffice()
  if (office === undefined) throw new Error("LibreOffice is not installed")
  const profile = await mkdtemp(join(tmpdir(), "cocode-libreoffice-profile-"))
  try {
    await execFile(office, [
      "--headless",
      "--invisible",
      "--nodefault",
      "--nologo",
      "--nolockcheck",
      "--norestore",
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      ...args,
    ], { timeout: OFFICE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
}

function assertExcel(path: string): void {
  if (!/\.(?:xlsx|xls)$/i.test(path)) throw new Error("only .xlsx and .xls Excel workbooks are supported")
}

function assertSize(bytes: number, limit: number): void {
  if (bytes > limit) throw new Error(`Excel workbook is too large (maximum ${String(Math.round(limit / 1024 / 1024))} MB)`)
}

function outputFilter(path: string): string {
  return path.toLowerCase().endsWith(".xls") ? "xls:MS Excel 97" : "xlsx:Calc MS Excel 2007 XML"
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Calc's HTML exporter annotates formulas, but its HTML importer only parses =… text. */
function materializeExcelFormulas(html: string): string {
  return html.replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (full, tag: string, rawAttributes: string, content: string) => {
    const formulaMatch = rawAttributes.match(/\sdata-sheets-formula\s*=\s*(["'])([\s\S]*?)\1/i)
    if (formulaMatch === null || formulaMatch[2] === undefined) return full
    const formula = decodeHtmlAttribute(formulaMatch[2])
    if (!formula.startsWith("=") || formula.length > 8192 || formula.includes("\0")) return full
    const attributes = rawAttributes
      .replace(/\sdata-sheets-formula\s*=\s*(["'])[^"']*\1/i, "")
      .replace(/\ssdval\s*=\s*(["'])[^"']*\1/i, "")
      .replace(/\ssdnum\s*=\s*(["'])[^"']*\1/i, "")
    return `<${tag}${attributes}>${escapeHtmlText(formula)}</${tag}>`
  })
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
      result = result.replace(match[0], `${match[1]}${match[3]}`)
    }
  }
  return result
}

/** Convert a local Excel workbook into self-contained Calc HTML. */
export async function readExcelDocument(path: string, writable: boolean) {
  assertExcel(path)
  const info = await stat(path)
  assertSize(info.size, MAX_EXCEL_BYTES)
  const directory = await mkdtemp(join(tmpdir(), "cocode-excel-read-"))
  try {
    await runOffice(["--convert-to", "html", "--outdir", directory, path])
    const output = (await readdir(directory)).find(file => extname(file).toLowerCase() === ".html")
    if (output === undefined) throw new Error("LibreOffice did not produce HTML")
    const documentHtml = await readFile(join(directory, output), "utf8")
    const html = await inlineOfficeImages(bodyHtml(documentHtml), directory)
    assertSize(Buffer.byteLength(html, "utf8"), MAX_EXCEL_HTML_BYTES)
    return {
      kind: "excel" as const,
      html,
      warnings: [] as string[],
      writable,
      engine: "libreoffice" as const,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Rebuild a native .xlsx/.xls workbook from the edited Calc HTML table. */
export async function writeExcelDocument(path: string, html: string) {
  assertExcel(path)
  assertSize(Buffer.byteLength(html, "utf8"), MAX_EXCEL_HTML_BYTES)
  const directory = await mkdtemp(join(tmpdir(), "cocode-excel-write-"))
  try {
    const input = join(directory, "edited.html")
    const output = join(directory, `edited${path.toLowerCase().endsWith(".xls") ? ".xls" : ".xlsx"}`)
    await writeFile(input, `<!doctype html><html><head><meta charset="utf-8"></head><body>${materializeExcelFormulas(html)}</body></html>`, "utf8")
    await runOffice([
      "--infilter=HTML (StarCalc)",
      "--convert-to",
      outputFilter(path),
      "--outdir",
      directory,
      input,
    ])
    const buffer = await readFile(output)
    assertSize(buffer.byteLength, MAX_EXCEL_BYTES)
    await writeFile(path, buffer)
    return { written: true, bytes: buffer.byteLength, engine: "libreoffice" as const }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
