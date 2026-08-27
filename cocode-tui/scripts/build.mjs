import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(root, 'dist')
await mkdir(dist, { recursive: true })

const tuiBuild = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  outfile: resolve(dist, 'cocode-tui.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.19',
  alias: {
    'react-devtools-core': resolve(root, 'scripts/react-devtools-core-stub.mjs'),
  },
  define: { 'process.env.DEV': '"false"', 'process.env["DEV"]': '"false"' },
  // The bundle is emitted as ESM, but Ink's dependency tree still contains
  // CommonJS packages that use a runtime `require()` for Node built-ins (for
  // example signal-exit -> assert/events).  Give esbuild's dynamic-require
  // helper a real ESM-compatible require so the packaged CLI can start under
  // the bundled Node runtime.
  banner: {
    // Keep the banner binding private: bundled application code also imports
    // `createRequire`, and native ESM rejects duplicate top-level declarations.
    js: 'import { createRequire as __cocodeCreateRequire } from "node:module"; const require = __cocodeCreateRequire(import.meta.url);',
  },
  sourcemap: true,
  tsconfig: resolve(root, 'tsconfig.json'),
  metafile: true,
})
const outfile = resolve(dist, 'cocode-tui.mjs')
inlineRuntimePackageManifest(outfile)
await writeFile(
  resolve(dist, 'cocode-tui.meta.json'),
  JSON.stringify(tuiBuild.metafile, null, 2),
)

console.log(`Built Cocode TUI into ${dist}`)

// Host Supervisor re-exports dsh-llm, which reads ../package.json via
// createRequire(import.meta.url). After this bundle is flattened into
// resources/tui/, that relative path no longer exists. Inline it here.
function inlineRuntimePackageManifest(file) {
  const source = readFileSync(file, 'utf8')
  const pattern = /createRequire\w*\(\s*import\.meta\.url\s*\)\(\s*["']\.\.\/package\.json["']\s*\)/g
  if (!pattern.test(source)) return
  pattern.lastIndex = 0
  const manifest = resolveLlmPackageManifest()
  writeFileSync(file, source.replace(pattern, JSON.stringify({ version: manifest.version })))
}

function resolveLlmPackageManifest() {
  const candidates = [
    resolve(root, '../cocode-host-supervisor/node_modules/@deepseek-ai/dsh-llm/package.json'),
    resolve(root, '../cocode-host-supervisor/packages/host-supervisor/package.json'),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof manifest.version === 'string' && manifest.version.length > 0) return manifest
  }
  throw new Error('TUI build could not locate a DSH LLM package.json to inline')
}
