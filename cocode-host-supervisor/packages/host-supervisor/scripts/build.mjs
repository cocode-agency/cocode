import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { assertBuiltRuntimePlugin } from './runtime-plugins.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(packageRoot, '../..')
const compatSource = join(packageRoot, 'src/credentials-local-provider.ts')
const lib = join(packageRoot, 'lib')
rmSync(lib, { recursive: true, force: true })
mkdirSync(lib, { recursive: true })

execFileSync(process.execPath, [resolve(workspaceRoot, 'node_modules/typescript/bin/tsc'), '-p', join(packageRoot, 'tsconfig.build.json')], { cwd: workspaceRoot, stdio: 'inherit' })

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [join(packageRoot, 'src/index.ts')],
  outfile: join(lib, 'index.js'),
  bundle: true,
  // Pino is loaded as a normal runtime dependency. Its package uses Node
  // compatibility paths that should not be inlined into the ESM bundle.
  external: ['pino', 'yaml'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  tsconfig: join(packageRoot, 'tsconfig.json'),
})

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [compatSource],
  outfile: join(lib, 'credentials-local-compat.mjs'),
  bundle: true,
  external: ['@deepseek-ai/*', 'chokidar', 'yaml'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  tsconfig: join(packageRoot, 'tsconfig.json'),
})

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [join(packageRoot, 'src/bin.ts')],
  outfile: join(lib, 'bin.js'),
  bundle: true,
  // Keep Pino as a normal runtime dependency. Its package intentionally uses
  // Node's dynamic require path for platform helpers; bundling it into an ESM
  // file makes esbuild emit a runtime-incompatible `__require` shim. The
  // staging step materializes the Supervisor dependency closure, so the
  // external import remains self-contained in packaged Desktop builds.
  external: ['pino', 'yaml'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  tsconfig: join(packageRoot, 'tsconfig.json'),
})

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [join(packageRoot, 'src/host-jsonrpc-plugin/index.ts')],
  outfile: join(lib, 'host-jsonrpc-plugin.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  tsconfig: join(packageRoot, 'tsconfig.json'),
})

await build({
  absWorkingDir: workspaceRoot,
  entryPoints: [join(packageRoot, 'src/runtime-closure.ts')],
  outfile: join(lib, 'runtime-closure.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  tsconfig: join(packageRoot, 'tsconfig.json'),
})

const runtimeRoot = join(packageRoot, '..', '..', 'runtime')
mkdirSync(runtimeRoot, { recursive: true })
const runtimePluginRoot = join(runtimeRoot, 'plugins')
const runtimePluginStage = join(runtimeRoot, `.plugins-build-${process.pid}`)
const runtimePluginBackup = join(runtimeRoot, `.plugins-backup-${process.pid}`)
const pluginSourceRoot = resolve(packageRoot, '../../../cocode-gui/packages/cocode')
const includeGuiPlugins = process.argv.includes('--include-gui-plugins')
const plugins = []
const guiPlugins = []
if (includeGuiPlugins) {
  if (!existsSync(pluginSourceRoot)) {
    throw new Error(`Missing Cocode GUI plugin source: ${pluginSourceRoot}`)
  }
  for (const entry of readdirSync(pluginSourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(pluginSourceRoot, entry.name)
    const manifestPath = join(source, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!manifest.name || manifest.private !== true || !manifest.cocode) continue
    assertBuiltRuntimePlugin(source, manifest.name)
    guiPlugins.push({ source, manifest })
  }
}

rmSync(runtimePluginStage, { recursive: true, force: true })
rmSync(runtimePluginBackup, { recursive: true, force: true })
mkdirSync(runtimePluginStage, { recursive: true })

for (const { source, manifest } of guiPlugins) {
  const target = join(runtimePluginStage, manifest.name)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const item of ['lib', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README_EN.md']) {
    const from = join(source, item)
    if (existsSync(from)) cpSync(from, join(target, item), { recursive: true, dereference: true })
  }
  writeFileSync(join(target, 'package.json'), JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    type: manifest.type ?? 'module',
    main: manifest.main ?? 'lib/index.js',
    exports: manifest.exports,
    dsh: manifest.dsh,
    dependencies: Object.fromEntries((manifest.cocode.runtimeDependencies ?? []).map((name) => [name, manifest.dependencies?.[name] ?? '*'])),
  }, null, 2) + '\n')
  plugins.push(manifest.name)
}

const stagedManifest = join(runtimeRoot, `.plugins-${process.pid}.json`)
writeFileSync(stagedManifest, JSON.stringify({ plugins }, null, 2) + '\n')
if (existsSync(runtimePluginRoot)) renameSync(runtimePluginRoot, runtimePluginBackup)
renameSync(runtimePluginStage, runtimePluginRoot)
renameSync(stagedManifest, join(runtimeRoot, 'plugins.json'))
rmSync(runtimePluginBackup, { recursive: true, force: true })

const bin = join(packageRoot, 'bin')
mkdirSync(bin, { recursive: true })
writeFileSync(join(bin, 'cocode-host-supervisor.mjs'), '#!/usr/bin/env node\nimport "../lib/bin.js"\n')
console.log(`Built @cocode-agency/host-supervisor with ${plugins.length} bundled Cocode plugins`)
