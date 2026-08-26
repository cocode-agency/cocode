import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runtimeSlotDirectory } from './paths.js'
import { hostKey, resolveCocodeHome, stableJson, type HostRuntimeEnv, type HostScope } from './protocol.js'
import { copyRuntimeDependencyClosure, resolveRuntimeDependencyClosure, restoreRuntimeNodePtyHelpers } from './runtime-closure.js'

export type RuntimeSlot = { root: string; entry: string; version: string; buildId?: string; patch: string; jsonRpcEndpoint: string }

export type RuntimePluginEntry = { name: string; entry: string }

const COCODE_PROFILE_PACKAGE = {
  name: 'cocode-profile',
  private: true,
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    },
  },
}

/**
 * Bootstrap the Cocode profile and runtime-owned directories. Settings,
 * credentials, sessions, and attachments deliberately remain in the shared
 * DSH home; the Cocode product home only owns its account and runtime state.
 * Existing user edits to the profile patch are preserved byte-for-byte.
 */
export function ensureCocodeProfile(dshHome: string, cocodeHome = resolveCocodeHome()): string {
  const profileRoot = join(resolve(dshHome), 'profiles', 'cocode')
  mkdirSync(profileRoot, { recursive: true, mode: 0o700 })
  mkdirSync(resolve(cocodeHome), { recursive: true, mode: 0o700 })
  for (const directory of ['sessions', 'storages', 'attachments']) {
    mkdirSync(join(resolve(dshHome), directory), { recursive: true, mode: 0o700 })
  }
  mkdirSync(join(resolve(cocodeHome), 'runtime'), { recursive: true, mode: 0o700 })
  const packagePath = join(profileRoot, 'package.json')
  if (!existsSync(packagePath)) writeFileSync(packagePath, `${JSON.stringify(COCODE_PROFILE_PACKAGE, null, 2)}\n`, { mode: 0o600 })
  else assertCocodeProfilePackage(packagePath)
  const workspacePath = join(profileRoot, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, [
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    'autoInstallPeers: false',
    '',
  ].join('\n'), { mode: 0o600 })
  const patchPath = join(profileRoot, 'cordis.patch.yml')
  const sharedHomePatch = '# Cocode uses the shared DSH settings and credentials paths.\n[]\n'
  if (!existsSync(patchPath)) {
    writeFileSync(patchPath, sharedHomePatch, { mode: 0o600 })
  } else {
    if (isLegacyGeneratedCocodeProfilePatch(readFileSync(patchPath, 'utf8'))) {
      writeFileSync(patchPath, sharedHomePatch, { mode: 0o600 })
    }
  }
  return profileRoot
}

function isLegacyGeneratedCocodeProfilePatch(content: string): boolean {
  const match = /^# Cocode-owned provider paths\. This profile is self-contained\.\n- id: settings\n  config:\n    path: (.+)\n- id: credentials\n  config:\n    path: (.+)\n$/.exec(content)
  if (match === null) return false
  try {
    const settings = JSON.parse(match[1]!)
    const credentials = JSON.parse(match[2]!)
    if (typeof settings !== 'string' || typeof credentials !== 'string') return false
    return basename(settings) === 'settings.yaml'
      && basename(dirname(settings)) === 'settings'
      && basename(credentials) === 'credentials.yaml'
      && basename(dirname(credentials)) === 'credentials'
      && dirname(dirname(settings)) === dirname(dirname(credentials))
  } catch {
    return false
  }
}

function assertCocodeProfilePackage(packagePath: string): void {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch (error) {
    throw new Error(`Cocode profile package is invalid: ${String(error)}`)
  }
  const record = manifest as { dsh?: { profile?: { bundles?: unknown } } } | null
  const bundles = record?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.length !== 2 || bundles[0] !== '@deepseek-ai/dsh-base' || bundles[1] !== '@deepseek-ai/dsh-web-app') {
    throw new Error('Cocode profile bundle composition is incompatible')
  }
}

export function mergeHostRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  runtimeEnv: HostRuntimeEnv | undefined,
  dshHome: string,
  profile?: string,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...(runtimeEnv ?? {}),
    DSH_HOME: dshHome,
    ...(profile === 'cocode' ? { DSH_SESSION_ROOT: join(resolve(dshHome), 'sessions') } : {}),
  }
}

type RuntimePackageManifest = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

export function resolveDshPackage(): { root: string; entry: string; version: string; buildId?: string } {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  let root = dirname(entry)
  while (root !== dirname(root) && !existsSync(join(root, 'package.json'))) root = dirname(root)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const buildId = typeof manifest.buildId === 'string'
    ? manifest.buildId
    : typeof manifest.gitHead === 'string'
      ? manifest.gitHead
      : process.env.COCODE_DSH_BUILD_ID?.trim() || undefined
  return { root, entry, version: String(manifest.version), ...(buildId === undefined ? {} : { buildId }) }
}

export function prepareRuntimeSlot(
  scope: HostScope,
  jsonRpcEndpoint: string,
  pluginPath: string,
  runtimeEnv?: HostRuntimeEnv,
): RuntimeSlot {
  if (scope.profile === 'cocode') ensureCocodeProfile(scope.dshHome, resolveCocodeHome())
  const dsh = resolveDshPackage()
  const slot = runtimeSlotDirectory(scope, dsh.version)
  const dshSlotRoot = join(slot, 'node_modules', '@deepseek-ai', 'dsh')
  const entry = join(dshSlotRoot, 'lib', 'bin.js')
  const pluginRoot = resolve(dirname(pluginPath), '../../../runtime/plugins')
  const pluginSources = existsSync(pluginRoot)
    ? readdirSync(pluginRoot, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => join(pluginRoot, item.name))
    : []
  if (!isRuntimePackageComplete(dsh.root, dshSlotRoot, pluginSources)) {
    rmSync(slot, { recursive: true, force: true })
    mkdirSync(join(slot, 'node_modules', '@deepseek-ai'), { recursive: true })
    copyPackageClosure(dsh.root, slot, pluginSources)
    mkdirSync(slot, { recursive: true })
    writeFileSync(join(slot, 'package.json'), JSON.stringify({ type: 'module', private: true }) + '\n')
  }
  const pluginTarget = join(slot, 'cocode-host-jsonrpc-plugin.mjs')
  cpSync(pluginPath, pluginTarget)
  const credentialsCompatTarget = join(slot, 'cocode-credentials-local-compat.mjs')
  cpSync(fileURLToPath(new URL('./credentials-local-compat.mjs', import.meta.url)), credentialsCompatTarget)
  const pluginEntries: RuntimePluginEntry[] = []
  if (existsSync(pluginRoot)) {
    for (const entry of readdirSync(pluginRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const source = join(pluginRoot, entry.name)
      const target = join(slot, 'node_modules', ...entry.name.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, {
        recursive: true,
        dereference: true,
        // Package-local node_modules are materialized by the shared
        // destination-aware closure above. Copying them here would reintroduce
        // pnpm links or silently flatten a second version of a dependency.
        filter: (candidate) => {
          const relativePath = relative(source, candidate)
          return relativePath === '' || !relativePath.split('/').includes('node_modules')
        },
      })
      pluginEntries.push({ name: entry.name, entry: join(target, 'lib', 'index.js') })
    }
  }
  registerRuntimePluginsInDshManifest(slot, pluginEntries)
  restoreNodePtyHelper(slot)
  const patch = join(slot, 'cocode-host.patch.yml')
  const rows = createRuntimePatch(pathToFileURL(pluginTarget).href, jsonRpcEndpoint, pluginEntries, runtimeEnv, pathToFileURL(credentialsCompatTarget).href, scope.dshHome)
  writeFileSync(patch, rows)
  writeFileSync(join(slot, 'active.json'), `${JSON.stringify({
    schemaVersion: 1,
    hostKey: hostKey(scope),
    runtimeVersion: dsh.version,
    ...(dsh.buildId === undefined ? {} : { buildId: dsh.buildId }),
    runtimeChannel: scope.runtimeChannel,
    hostConfigFingerprint: scope.hostConfigFingerprint,
    jsonRpcEndpoint,
    plugins: pluginEntries,
  }, null, 2)}\n`)
  return { root: slot, entry, version: dsh.version, ...(dsh.buildId === undefined ? {} : { buildId: dsh.buildId }), patch, jsonRpcEndpoint }
}

function isRuntimePackageComplete(sourceRoot: string, targetRoot: string, pluginSources: readonly string[]): boolean {
  if (!existsSync(targetRoot)) return false
  const sourceManifestPath = join(sourceRoot, 'package.json')
  const targetManifestPath = join(targetRoot, 'package.json')
  if (!existsSync(sourceManifestPath) || !existsSync(targetManifestPath)) return false
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8')) as { version?: string }
  const targetManifest = JSON.parse(readFileSync(targetManifestPath, 'utf8')) as { version?: string }
  if (sourceManifest.version !== targetManifest.version) return false
  if (!listPackageFiles(sourceRoot).every((sourcePath) => existsSync(join(targetRoot, relative(sourceRoot, sourcePath))))) return false

  // A slot can keep a complete DSH package while a newly copied plugin has a
  // dependency that the old flat node_modules tree never materialized.
  const targetModules = dirname(dirname(targetRoot))
  const records = resolveRuntimeDependencyClosure({
    roots: [
      { root: sourceRoot, destinationSegments: ['@deepseek-ai', 'dsh'], copy: false },
      ...pluginSources.map((root) => ({
        root,
        destinationSegments: readManifest(join(root, 'package.json')).name!.split('/'),
        copy: false,
      })),
    ],
    fallbackRoot: sourceRoot,
  })
  return records.every((record) => {
    const targetManifestPath = join(targetModules, ...record.destinationSegments, 'package.json')
    if (!existsSync(targetManifestPath)) return false
    return stableJson(readManifest(targetManifestPath)) === stableJson(readManifest(join(record.root, 'package.json')))
  })
}

function listPackageFiles(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const path = join(current, entry.name)
    return entry.isDirectory() ? listPackageFiles(root, path) : [path]
  })
}

/**
 * Make out-of-tree Cocode plugins part of DSH's installation dependency
 * closure. DSH uses that closure to populate DSH_HOME/profiles/node_modules;
 * without these declarations, bare plugin names in the patch are resolved
 * relative to the profile and cannot see the immutable runtime slot.
 */
function registerRuntimePluginsInDshManifest(slot: string, pluginEntries: readonly RuntimePluginEntry[]): void {
  const manifestPath = join(slot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimePackageManifest
  const pluginManifests = pluginEntries.map(({ name }) => {
    const pluginManifestPath = join(slot, 'node_modules', ...name.split('/'), 'package.json')
    return JSON.parse(readFileSync(pluginManifestPath, 'utf8')) as RuntimePackageManifest
  })
  const next = addRuntimePluginDependencies(manifest, pluginManifests)
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
}

export function addRuntimePluginDependencies(
  manifest: RuntimePackageManifest,
  pluginManifests: readonly RuntimePackageManifest[],
): RuntimePackageManifest {
  const dependencies = { ...(manifest.dependencies ?? {}) }
  for (const plugin of pluginManifests) {
    if (typeof plugin.name !== 'string' || plugin.name.length === 0) continue
    dependencies[plugin.name] = typeof plugin.version === 'string' && plugin.version.length > 0
      ? plugin.version
      : '*'
  }
  return { ...manifest, dependencies }
}

/**
 * Render the DSH overlay patch. Cocode plugins must be registered by their
 * package name so DSH can resolve each package manifest and its `dsh.client`
 * declaration while constructing the Web boot manifest.
 */
export function createRuntimePatch(
  jsonRpcPluginUrl: string,
  jsonRpcEndpoint: string,
  pluginEntries: readonly RuntimePluginEntry[],
  runtimeEnv?: HostRuntimeEnv,
  credentialsCompatUrl?: string,
  credentialsHome?: string,
): string {
  const providers = parseRuntimeProviders(runtimeEnv?.COCODE_LLM_PROVIDERS)
  return [
    '# Align transient model-request recovery with Codex (5 bounded backoff retries).',
    '- id: llm-deepseek',
    "  name: '@deepseek-ai/dsh-llm-deepseek'",
    '  config:',
    '    retryPolicy:',
    '      mode: normal',
    '      maxRetries: 5',
    ...(credentialsCompatUrl === undefined || credentialsHome === undefined ? [] : [
      '- id: credentials',
      "  name: '@deepseek-ai/dsh-credentials-local'",
      '  disabled: true',
    ]),
    ...(providers === undefined ? [] : llmPiAiPatchLines(providers)),
    '- insert:',
    ...(credentialsCompatUrl === undefined || credentialsHome === undefined ? [] : [
      '    - id: cocode-credentials',
      `      name: ${JSON.stringify(credentialsCompatUrl)}`,
      '      config:',
      `        path: ${JSON.stringify(join(credentialsHome, '.credentials.yaml'))}`,
      `        dshHome: ${JSON.stringify(credentialsHome)}`,
    ]),
    '    - id: cocode-host-jsonrpc',
    `      name: ${JSON.stringify(jsonRpcPluginUrl)}`,
    '      config:',
    `        endpoint: ${JSON.stringify(jsonRpcEndpoint)}`,
    `        protocolRevision: "1.0"`,
    ...pluginEntries.flatMap(({ name }) => [
      `    - id: ${name}`,
      `      name: ${JSON.stringify(name)}`,
    ]),
    '',
  ].join('\n')
}

function parseRuntimeProviders(value: string | undefined): Record<string, unknown> | undefined {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('COCODE_LLM_PROVIDERS must be a JSON object of provider routes')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('COCODE_LLM_PROVIDERS must be a JSON object of provider routes')
  }
  const record = parsed as Record<string, unknown>
  return Object.keys(record).length === 0 ? undefined : record
}

function llmPiAiPatchLines(providers: Record<string, unknown>): string[] {
  return [
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '  config:',
    `    providers: ${JSON.stringify(providers)}`,
  ]
}

function restoreNodePtyHelper(root: string): void {
	restoreRuntimeNodePtyHelpers(root, { platform: process.platform, arch: process.arch })
}

function copyPackageClosure(dshRoot: string, slot: string, additionalRoots: readonly string[] = []): void {
  /**
   * pnpm's isolated install is not a portable runtime tree: package links in
   * `node_modules` point back into `.pnpm`, and copying that directory leaves
   * a slot whose dependency resolution still depends on the source checkout.
   * Build a flat, self-contained closure instead. Each package is resolved
   * from the installed DSH package, copied without its package-local
   * `node_modules`, and then made available from slot/node_modules. This is
   * the same lookup shape an npm install provides and is also the shape used
   * by DSH's profile fallback healer.
   */
  const roots = [
    { root: dshRoot, destinationSegments: ['@deepseek-ai', 'dsh'], copy: true },
    ...additionalRoots.map((root) => ({
      root,
      destinationSegments: readManifest(join(root, 'package.json')).name!.split('/'),
      copy: true,
    })),
  ]
  const records = resolveRuntimeDependencyClosure({ roots, fallbackRoot: dshRoot })
  copyRuntimeDependencyClosure({ records, targetModules: join(slot, 'node_modules') })
}

function readManifest(path: string): RuntimePackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as RuntimePackageManifest
}
