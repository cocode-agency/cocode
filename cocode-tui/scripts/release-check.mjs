import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isProtocolDependency,
  restorePublishableManifest,
  toPublishablePackageJson,
} from './publishable-manifest.mjs'
import {
  formatPackFailure,
  npmCommandForPlatform,
  npmSpawnOptionsForPlatform,
} from './release-check-utils.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const failures = []
const releaseFiles = [
  'bin/cocode-tui.mjs',
  'bin/cli.mjs',
  'bin/headless-run.mjs',
  'dist/cocode-tui.mjs',
  'dist/cocode-tui.meta.json',
]

if (packageJson.private === true) failures.push('package.json must not be private')
if (!packageJson.version) failures.push('package.json must declare a version')
if (!packageJson.bin?.cocode) failures.push('package.json must expose the cocode bin')
if (packageJson.bin?.['cocode-tui']) failures.push('package.json must not expose the cocode-tui compatibility bin')
if (!packageJson.dependencies?.tsx) failures.push('package.json must include tsx for the TUI entry')
const supervisorManifestPath = resolve(root, '../cocode-host-supervisor/package.json')
if (!existsSync(supervisorManifestPath)) {
  failures.push('missing sibling @cocode-agency/host-supervisor package.json')
} else {
  const supervisorVersion = JSON.parse(readFileSync(supervisorManifestPath, 'utf8')).version
  if (!supervisorVersion) failures.push('@cocode-agency/host-supervisor must declare a version')
  const publishable = toPublishablePackageJson(packageJson, supervisorVersion)
  const supervisorDependency = publishable.dependencies?.['@cocode-agency/host-supervisor']
  if (!supervisorDependency) failures.push('package.json must include @cocode-agency/host-supervisor')
  if (isProtocolDependency(supervisorDependency)) {
    failures.push('package.json must not publish a link: @cocode-agency/host-supervisor dependency')
  }
}
for (const file of releaseFiles) {
  if (!existsSync(resolve(root, file))) failures.push(`missing release file: ${file}`)
}

const runtimeSmoke = spawnSync(process.execPath, [resolve(root, 'dist/cocode-tui.mjs')], {
  cwd: root,
  encoding: 'utf8',
  ...npmSpawnOptionsForPlatform(),
})
if (runtimeSmoke.status !== 1 || !runtimeSmoke.stderr.includes('Cocode TUI requires a TTY.')) {
  failures.push(
    `bundled TUI runtime smoke failed: ${runtimeSmoke.stderr || runtimeSmoke.stdout || `exit ${runtimeSmoke.status}`}`,
  )
}

// GUI staging copies dist/cocode-tui.mjs next to the CLI, so ../package.json
// no longer resolves to this package. The flattened smoke catches that.
const flattenRoot = mkdtempSync(join(tmpdir(), 'cocode-tui-flatten-'))
try {
  const flattened = join(flattenRoot, 'cocode-tui.mjs')
  copyFileSync(resolve(root, 'dist/cocode-tui.mjs'), flattened)
  const flattenSmoke = spawnSync(process.execPath, [flattened], {
    cwd: flattenRoot,
    encoding: 'utf8',
    ...npmSpawnOptionsForPlatform(),
  })
  if (flattenSmoke.status !== 1 || !flattenSmoke.stderr.includes('Cocode TUI requires a TTY.')) {
    failures.push(
      `flattened TUI runtime smoke failed: ${flattenSmoke.stderr || flattenSmoke.stdout || `exit ${flattenSmoke.status}`}`,
    )
  }
} finally {
  rmSync(flattenRoot, { recursive: true, force: true })
}

let pack
try {
  pack = spawnSync(npmCommandForPlatform(), ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    ...npmSpawnOptionsForPlatform(),
  })
} finally {
  restorePublishableManifest(root)
}
if (!pack || pack.status !== 0) {
  failures.push(`npm pack failed: ${pack ? formatPackFailure(pack) : 'pack did not run'}`)
} else {
  try {
    const manifest = JSON.parse(pack.stdout)[0]
    const names = new Set(manifest.files.map(({ path }) => path))
    for (const file of releaseFiles) {
      if (!names.has(file)) failures.push(`release file is not included in npm pack: ${file}`)
    }
  } catch {
    failures.push('npm pack returned invalid JSON')
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`release-check: ${failure}`)
  process.exit(1)
}

console.log(`release-check: ${packageJson.name}@${packageJson.version} is packable`)
