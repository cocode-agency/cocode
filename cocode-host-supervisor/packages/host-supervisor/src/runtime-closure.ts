import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve as resolvePath, sep } from 'node:path'

export interface RuntimeClosureRoot {
  readonly root: string
  readonly destinationSegments: readonly string[]
  readonly copy: boolean
}

export interface RuntimePackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

export interface RuntimePackageRecord {
  readonly root: string
  readonly name: string
  readonly version: string
  readonly destinationSegments: readonly string[]
  readonly requestedName: string
  readonly lineage: readonly string[]
  readonly copy: boolean
}

type PendingDependency = {
  readonly dependency: string
  readonly fromRoot: string
  readonly optional: boolean
  readonly destinationParent: readonly string[]
  readonly lineage: readonly string[]
}

type PackageIdentity = {
  readonly root: string
  readonly name: string
  readonly version: string
}

export function resolveRuntimeDependencyClosure(options: {
  readonly roots: readonly RuntimeClosureRoot[]
  readonly fallbackRoot?: string
  readonly allowedRoot?: string
}): readonly RuntimePackageRecord[] {
  const records = new Map<string, RuntimePackageRecord>()
  const identities = new Map<string, PackageIdentity>()
  const pending: PendingDependency[] = []

  for (const input of options.roots) {
    const root = realpathSync(input.root)
    const manifest = readManifest(root)
    const record = createRecord({
      root,
      manifest,
      destinationSegments: input.destinationSegments,
      requestedName: manifest.name,
      lineage: [manifest.name],
      copy: input.copy,
    })
    reserveRecord(records, identities, record)
    enqueueDependencies(pending, record)
  }

  while (pending.length > 0) {
    const current = pending.shift()!
    let root: string
    try {
      root = resolvePackageRoot(current.fromRoot, current.dependency, options.fallbackRoot, options.allowedRoot)
    } catch (error) {
      if (current.optional) continue
      throw new Error(
        `Unable to resolve runtime dependency ${current.dependency} from ${current.fromRoot}: ${String(error)}`,
      )
    }

    const manifest = readManifest(root)
    if (current.lineage.includes(`${manifest.name}@${manifest.version}`)) {
      throw new Error(`Runtime dependency cycle detected: ${[...current.lineage, `${manifest.name}@${manifest.version}`].join(' -> ')}`)
    }
    if (isVisible(records, current.destinationParent, current.dependency, root)) continue

    const dependencySegments = current.dependency.split('/')
    const topLevelKey = dependencySegments.join('/')
    const topLevel = records.get(topLevelKey)
    let destinationSegments: readonly string[]
    if (!topLevel) {
      destinationSegments = dependencySegments
    } else if (topLevel.root === root) {
      continue
    } else {
      if (current.destinationParent.length === 0) {
        throw new Error(
          `Conflicting runtime closure destination ${topLevelKey}: ${describeRecord(topLevel)} vs ${root}`,
        )
      }
      destinationSegments = [
        ...current.destinationParent,
        'node_modules',
        ...dependencySegments,
      ]
    }

    const record = createRecord({
      root,
      manifest,
      destinationSegments,
      requestedName: current.dependency,
      lineage: [...current.lineage, `${manifest.name}@${manifest.version}`],
      copy: true,
    })
    reserveRecord(records, identities, record)
    enqueueDependencies(pending, record)
  }

  return [...records.values()]
}

export function copyRuntimeDependencyClosure(options: {
  readonly records: readonly RuntimePackageRecord[]
  readonly targetModules: string
  readonly filter?: (source: string) => boolean
}): void {
  for (const record of options.records) {
    if (!record.copy) continue
    const destination = join(options.targetModules, ...record.destinationSegments)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(record.root, destination, {
      recursive: true,
      dereference: true,
      filter: (source) => {
        if (source !== record.root && basename(source) === 'node_modules') return false
        return options.filter?.(source) ?? true
      },
    })
  }
}

export function restoreRuntimeNodePtyHelpers(root: string, options: {
  readonly platform?: string
  readonly arch?: string
} = {}): readonly string[] {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  if (platform === 'win32') return []
  const restored: string[] = []
  for (const packageRoot of discoverPackageRoots(root, 'node-pty')) {
    const nativeDirectory = [
      join(packageRoot, 'build', 'Release'),
      join(packageRoot, 'build', 'Debug'),
      join(packageRoot, 'prebuilds', `${platform}-${arch}`),
    ].find((directory) => existsSync(join(directory, 'pty.node')))
    if (!nativeDirectory) continue
    const helper = join(nativeDirectory, 'spawn-helper')
    if (!existsSync(helper))
      throw new Error(`node-pty spawn-helper is missing for ${platform}/${arch}: ${helper}`)
    chmodSync(helper, 0o755)
    if ((statSync(helper).mode & 0o111) === 0)
      throw new Error(`node-pty spawn-helper is not executable for ${platform}/${arch}: ${helper}`)
    assertRuntimeNativeBinaryArchitecture(join(nativeDirectory, 'pty.node'), { platform, arch })
    assertRuntimeNativeBinaryArchitecture(helper, { platform, arch })
    restored.push(helper)
  }
  return restored
}

function assertRuntimeNativeBinaryArchitecture(file: string, options: { platform: string; arch: string }): void {
  const inspected = inspectRuntimeNativeBinary(readFileSync(file))
  const expected = options.arch === 'x64' ? 'x86_64' : options.arch
  const expectedFormat = options.platform === 'darwin' ? 'macho' : options.platform === 'linux' ? 'elf' : undefined
  if (expectedFormat === undefined || inspected.format !== expectedFormat)
    throw new Error(
      `node-pty native format mismatch for ${options.platform}/${options.arch}: ${file} is ${inspected.format}`,
    )
  if (!inspected.architectures.includes(expected))
    throw new Error(
      `node-pty native architecture mismatch for ${options.platform}/${options.arch}: ${file} has ${inspected.architectures.join(', ') || 'none'}`,
    )
}

function inspectRuntimeNativeBinary(bytes: Buffer): { format: 'elf' | 'macho' | 'unknown'; architectures: readonly string[] } {
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === '\x7fELF') {
    const littleEndian = bytes[5] !== 2
    const machine = littleEndian ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
    return { format: 'elf', architectures: architectureNames(machine) }
  }
  if (bytes.length < 4) return { format: 'unknown', architectures: [] }
  const littleMagic = bytes.readUInt32LE(0)
  const bigMagic = bytes.readUInt32BE(0)
  if ([0xfeedface, 0xfeedfacf].includes(littleMagic))
    return { format: 'macho', architectures: architectureNames(bytes.readInt32LE(4)) }
  if ([0xfeedface, 0xfeedfacf].includes(bigMagic))
    return { format: 'macho', architectures: architectureNames(bytes.readInt32BE(4)) }
  if (bigMagic === 0xcafebabe || bigMagic === 0xcafebabf)
    return inspectFatRuntimeMacho(bytes, false, bigMagic === 0xcafebabf)
  if (littleMagic === 0xcafebabe || littleMagic === 0xcafebabf)
    return inspectFatRuntimeMacho(bytes, true, littleMagic === 0xcafebabf)
  return { format: 'unknown', architectures: [] }
}

function inspectFatRuntimeMacho(bytes: Buffer, littleEndian: boolean, is64: boolean): { format: 'macho'; architectures: readonly string[] } {
  const read = (offset: number) => littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset)
  const count = read(4)
  const entrySize = is64 ? 32 : 20
  const architectures: string[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * entrySize
    if (offset + 4 > bytes.length) break
    for (const architecture of architectureNames(littleEndian ? bytes.readInt32LE(offset) : bytes.readInt32BE(offset))) {
      if (!architectures.includes(architecture)) architectures.push(architecture)
    }
  }
  return { format: 'macho', architectures }
}

function architectureNames(machine: number): readonly string[] {
  if (machine === 0x3e || machine === 0x01000007) return ['x86_64']
  if (machine === 0xb7 || machine === 0x0100000c) return ['arm64']
  return []
}

function discoverPackageRoots(root: string, name: string): readonly string[] {
  const result: string[] = []
  const seen = new Set<string>()
  visitModules(join(root, 'node_modules'))
  return result

  function visitModules(modulesRoot: string): void {
    if (!existsSync(modulesRoot)) return
    for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const packageRoot = join(modulesRoot, entry.name)
      if (entry.name.startsWith('@')) {
        visitModules(packageRoot)
        continue
      }
      visitPackage(packageRoot)
    }
  }

  function visitPackage(packageRoot: string): void {
    let manifest: RuntimePackageManifest | undefined
    try {
      manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as RuntimePackageManifest
    } catch {
      manifest = undefined
    }
    if (manifest?.name === name) {
      const resolved = realpathSync(packageRoot)
      if (!seen.has(resolved)) {
        seen.add(resolved)
        result.push(resolved)
      }
    }
    visitModules(join(packageRoot, 'node_modules'))
  }
}

function createRecord(options: {
  readonly root: string
  readonly manifest: RuntimePackageManifest & { readonly name: string; readonly version: string }
  readonly destinationSegments: readonly string[]
  readonly requestedName: string
  readonly lineage: readonly string[]
  readonly copy: boolean
}): RuntimePackageRecord {
  return {
    root: options.root,
    name: options.manifest.name,
    version: options.manifest.version,
    destinationSegments: options.destinationSegments,
    requestedName: options.requestedName,
    lineage: options.lineage,
    copy: options.copy,
  }
}

function reserveRecord(
  records: Map<string, RuntimePackageRecord>,
  identities: Map<string, PackageIdentity>,
  record: RuntimePackageRecord,
): void {
  const destinationKey = record.destinationSegments.join('/')
  const identityKey = `${record.root}\0${record.name}\0${record.version}`
  const existing = records.get(destinationKey)
  if (existing) {
    if (existing.root === record.root && existing.version === record.version) return
    throw new Error(
      `Conflicting runtime closure destination ${destinationKey || '<root>'}: ${describeRecord(existing)} vs ${describeRecord(record)}`,
    )
  }
  const existingIdentity = identities.get(identityKey)
  if (existingIdentity && existingIdentity.root !== record.root) {
    throw new Error(`Runtime package identity resolved to multiple roots: ${identityKey}`)
  }
  records.set(destinationKey, record)
  identities.set(identityKey, {
    root: record.root,
    name: record.name,
    version: record.version,
  })
}

function enqueueDependencies(pending: PendingDependency[], record: RuntimePackageRecord): void {
  const manifest = readManifest(record.root)
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    pending.push({
      dependency,
      fromRoot: record.root,
      optional: false,
      destinationParent: record.destinationSegments,
      lineage: record.lineage,
    })
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    pending.push({
      dependency,
      fromRoot: record.root,
      optional: true,
      destinationParent: record.destinationSegments,
      lineage: record.lineage,
    })
  }
  for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
    pending.push({
      dependency,
      fromRoot: record.root,
      optional: manifest.peerDependenciesMeta?.[dependency]?.optional === true,
      destinationParent: record.destinationSegments,
      lineage: record.lineage,
    })
  }
}

function isVisible(
  records: ReadonlyMap<string, RuntimePackageRecord>,
  parentDestination: readonly string[],
  dependency: string,
  root: string,
): boolean {
  const dependencySegments = dependency.split('/')
  let ancestor = [...parentDestination]
  while (true) {
    const candidate = [...ancestor, 'node_modules', ...dependencySegments].join('/')
    if (records.get(candidate)?.root === root) return true
    if (ancestor.length === 0) break
    const nodeModulesIndex = ancestor.lastIndexOf('node_modules')
    if (nodeModulesIndex === -1) {
      ancestor = []
    } else {
      ancestor = ancestor.slice(0, nodeModulesIndex)
    }
  }
  return records.get(dependencySegments.join('/'))?.root === root
}

function resolvePackageRoot(fromRoot: string, dependency: string, fallbackRoot?: string, allowedRoot?: string): string {
  const require = createRequire(join(fromRoot, 'package.json'))
  for (const searchPath of require.resolve.paths(dependency) ?? []) {
    const candidate = join(searchPath, ...dependency.split('/'))
    if (allowedRoot && !isWithin(allowedRoot, candidate)) continue
    const manifestPath = join(candidate, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = readManifest(candidate)
    if (manifest.name === dependency) return realpathSync(candidate)
  }
  if (allowedRoot) {
    if (fallbackRoot && realpathSync(fallbackRoot) !== realpathSync(fromRoot)) {
      return resolvePackageRoot(fallbackRoot, dependency, undefined, allowedRoot)
    }
    throw new Error(`Package root not found for ${dependency}`)
  }
  try {
    const resolved = require.resolve(dependency)
    return findPackageRoot(dirname(resolved), dependency)
  } catch {
    if (fallbackRoot && realpathSync(fallbackRoot) !== realpathSync(fromRoot)) {
      return resolvePackageRoot(fallbackRoot, dependency, undefined, allowedRoot)
    }
    throw new Error(`Package root not found for ${dependency}`)
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rootPath = realpathSync(root)
  const candidatePath = resolvePath(candidate)
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${sep}`)
}

function findPackageRoot(start: string, dependency: string): string {
  let current = realpathSync(start)
  while (true) {
    const manifestPath = join(current, 'package.json')
    if (existsSync(manifestPath) && readManifest(current).name === dependency) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`Resolved ${dependency} but could not locate its package root`)
}

function readManifest(root: string): RuntimePackageManifest & { readonly name: string; readonly version: string } {
  const manifestPath = join(root, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimePackageManifest
  if (!manifest.name || !manifest.version) throw new Error(`Runtime package manifest is missing name/version: ${manifestPath}`)
  return manifest as RuntimePackageManifest & { readonly name: string; readonly version: string }
}

function describeRecord(record: { readonly root: string; readonly name: string; readonly version: string }): string {
  return `${record.name}@${record.version} (${record.root})`
}
