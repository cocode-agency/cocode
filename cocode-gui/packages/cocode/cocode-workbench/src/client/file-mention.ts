import { relativeTo } from "../paths.ts"

// Keep every non-whitespace Unicode filename plain. Quotes are only needed
// when the mention parser would otherwise terminate or misread the path.
const PLAIN_PATH = /^[^\s"\\]+$/u

/** Exact plain-text projection used by both the `@` picker and file-tree insertion. */
export function fileMentionText(path: string): string {
  const mention = PLAIN_PATH.test(path)
    ? `@${path}`
    : `@"${path.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`
  return `${mention} `
}

/** Match the `@` picker's directory spelling when insertion starts from the file tree. */
export function treeMentionPath(root: string, path: string, isDir: boolean): string {
  const relative = path === root ? "." : relativeTo(root, path)
  return isDir && relative !== "." && !relative.endsWith("/") ? `${relative}/` : relative
}
