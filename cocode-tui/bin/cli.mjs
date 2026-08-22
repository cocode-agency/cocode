import { existsSync, readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const DSH_COMMANDS = new Set(['plugin'])
const DSH_ROOT_OPTIONS = new Set(['--patch', '--dump-config', '--dump-default-config'])
const DEFAULT_PLUGIN_PROFILE = 'cocode'

export function parseCliArgs(args) {
  const options = { command: 'tui', commandArgs: [], force: false, json: false, help: false, version: false, versionCommand: false }
  const remaining = [...args]
  while (remaining.length > 0) {
    const value = remaining.shift()
    if (value === '--help' || value === '-h') { options.help = true; continue }
    if (value === '--version' || value === '-v') { options.version = true; continue }
    if (value === 'version') { options.version = true; options.versionCommand = true; continue }
    if (value === '--force' || value === '-f') { options.force = true; continue }
    if (value === '--json') { options.json = true; continue }
    if (value === '--dsh-home' || value === '--profile' || value === '--runtime-channel') {
      const next = remaining.shift()
      if (!next || next.startsWith('-')) throw new Error(`${value} requires a value.`)
      if (value === '--dsh-home') options.dshHome = next
      if (value === '--profile') options.profile = next
      if (value === '--runtime-channel') options.runtimeChannel = next
      continue
    }
    if (DSH_COMMANDS.has(value) || DSH_ROOT_OPTIONS.has(value)) {
      options.command = 'dsh'
      const hasDshProfile = hasProfileOption(remaining)
      const sharedProfile = options.profile && !hasDshProfile
        ? ['--profile', options.profile]
        : value === 'plugin' && !hasDshProfile
          ? ['--profile', DEFAULT_PLUGIN_PROFILE]
        : []
      options.commandArgs = value === 'plugin'
        ? [value, ...sharedProfile, ...remaining]
        : [...sharedProfile, value, ...remaining]
      break
    }
    if (value === '--gui' || value === 'gui') { options.command = 'gui'; options.commandArgs = remaining; break }
    if (value === '--tui' || value === 'tui') { options.command = 'tui'; options.commandArgs = remaining; break }
    if (value === 'web') throw new Error('The `cocode web` command is disabled. Use `cocode gui` or `cocode tui`.')
    if (value === 'dsh') throw new Error('The `cocode dsh ...` form is no longer supported. Use `cocode plugin ...`.')
    if (value === '--doctor' || value === 'doctor') { options.command = 'doctor'; options.commandArgs = remaining; break }
    if (value === '--stop-host' || value === 'stop-host') { options.command = 'host-stop'; options.commandArgs = remaining; break }
    if (value === 'status') { options.command = 'host-status'; options.commandArgs = remaining; break }
    if (value === 'host') {
      const hostCommand = remaining.shift()
      if (hostCommand === 'status') options.command = 'host-status'
      else if (hostCommand === 'stop') options.command = 'host-stop'
      else throw new Error('Usage: cocode host status | cocode host stop [--force]')
      options.commandArgs = remaining
      break
    }
    options.commandArgs.push(value, ...remaining)
    break
  }
  if (options.command === 'dsh') return options
  for (const value of options.commandArgs) {
    if (value === '--force' || value === '-f') options.force = true
    if (value === '--json') options.json = true
    if (value === '--help' || value === '-h') options.help = true
    if (value === '--version' || value === '-v') options.version = true
  }
  const scopedArgs = []
  for (let index = 0; index < options.commandArgs.length; index += 1) {
    const value = options.commandArgs[index]
    if (value === '--dsh-home' || value === '--profile' || value === '--runtime-channel') {
      const next = options.commandArgs[index + 1]
      if (!next || next.startsWith('-')) throw new Error(`${value} requires a value.`)
      if (value === '--dsh-home') options.dshHome = next
      if (value === '--profile') options.profile = next
      if (value === '--runtime-channel') options.runtimeChannel = next
      index += 1
      continue
    }
    scopedArgs.push(value)
  }
  options.commandArgs = scopedArgs
  options.commandArgs = options.commandArgs.filter((value) => !['--force', '-f', '--json', '--help', '-h', '--version', '-v'].includes(value))
  return options
}

function hasProfileOption(args) {
  return args.some((value) => value === '--profile' || value.startsWith('--profile='))
}

export function applyScopeOptions(options, env = process.env) {
  if (options.dshHome) {
    env.COCODE_DSH_HOME = options.dshHome
    env.DSH_HOME = options.dshHome
  }
  if (options.profile) env.DSH_PROFILE = options.profile
  if (options.runtimeChannel) {
    if (!['stable', 'preview', 'dev'].includes(options.runtimeChannel)) throw new Error('--runtime-channel must be stable, preview, or dev.')
    env.COCODE_RUNTIME_CHANNEL = options.runtimeChannel
  }
}

export function formatHostStatus(descriptor, json = false) {
  if (json) return `${JSON.stringify(descriptor === null ? { status: 'stopped' } : { status: 'running', ...descriptor }, null, 2)}\n`
  if (descriptor === null) return 'stopped Host\n'
  const services = descriptor.services.map((service) => `${service.service}=${service.endpoint}`).join(' ')
  return ['running Host', `  pid: ${descriptor.hostPid}`, `  profile: ${descriptor.profile}`, `  DSH_HOME: ${descriptor.dshHome}`, `  runtime: ${descriptor.runtimeVersion}`, `  services: ${services}`].join('\n') + '\n'
}

export function launchGui(args, env = process.env) {
  const launch = resolveGuiLaunch(env)
  if (launch.executable === '/usr/bin/open') {
    const result = spawnSync(launch.executable, [...launch.args, ...args], { cwd: process.cwd(), env, stdio: 'inherit', windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Unable to open Cocode GUI (exit code ${String(result.status ?? 1)}).`)
    return
  }
  const child = spawn(launch.executable, [...launch.args, ...args], { cwd: process.cwd(), env, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

export function launchDsh(args, runtimePaths, env = process.env, spawnSyncImpl = spawnSync) {
  const launch = resolveDshLaunch(runtimePaths, env)
  const result = spawnSyncImpl(launch.executable, [launch.entry, ...args], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

export function resolveDshLaunch(runtimePaths, env = process.env, requireImpl = require) {
  const explicit = env.COCODE_DSH_CLI_ENTRY?.trim()
  const candidates = explicit ? [resolve(explicit)] : []
  const serviceEntry = env.COCODE_SUPERVISOR_SERVICE_ENTRY?.trim()
  if (serviceEntry) {
    const runtimeRoot = resolve(dirname(serviceEntry), '..', '..', '..')
    candidates.push(...runtimeDshEntries(runtimeRoot))
  }
  if (runtimePaths.staged) {
    candidates.push(...runtimeDshEntries(resolve(runtimePaths.packageRoot, '..', 'dsh-runtime')))
  }
  try {
    candidates.push(requireImpl.resolve('@deepseek-ai/dsh/lib/bin.js'))
  } catch {
    // The bundled DSH is resolved from the Host Supervisor package below.
  }
  try {
    const supervisorPackage = requireImpl.resolve('@cocode-agency/host-supervisor/package.json')
    candidates.push(createRequire(supervisorPackage).resolve('@deepseek-ai/dsh/lib/bin.js'))
  } catch {
    // A packaged runtime does not expose Node's package resolution tree.
  }
  const entry = candidates.find((candidate) => existsSync(candidate))
  if (!entry) throw new Error('Bundled DSH CLI is missing from this Cocode installation.')
  return { executable: env.COCODE_NODE_EXECUTABLE?.trim() || process.execPath, entry }
}

export function resolveDshVersion(runtimePaths, env = process.env) {
  let directory = dirname(resolveDshLaunch(runtimePaths, env).entry)
  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.name === '@deepseek-ai/dsh') return String(manifest.version || 'unknown')
    }
    directory = dirname(directory)
  }
  throw new Error('Bundled DSH package metadata is missing.')
}

function runtimeDshEntries(root) {
  return [
    join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(root, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
}

export function resolveGuiLaunch(env = process.env, platform = process.platform) {
  const configured = env.COCODE_GUI_EXECUTABLE?.trim() || env.COCODE_GUI_PATH?.trim()
  if (configured) return { executable: resolve(configured), args: [] }
  if (platform === 'darwin') {
    const candidates = [join(env.COCODE_GUI_APP_HOME?.trim() || '/Applications', 'Cocode.app', 'Contents', 'MacOS', 'Cocode'), join(homedir(), 'Applications', 'Cocode.app', 'Contents', 'MacOS', 'Cocode')]
    const executable = candidates.find((candidate) => existsSync(candidate))
    return executable ? { executable, args: [] } : { executable: '/usr/bin/open', args: ['-a', 'Cocode', '--args'] }
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim()
    const programFiles = env.ProgramFiles?.trim()
    const candidates = [localAppData && join(localAppData, 'Programs', 'Cocode', 'Cocode.exe'), localAppData && join(localAppData, 'Cocode', 'Cocode.exe'), programFiles && join(programFiles, 'Cocode', 'Cocode.exe')].filter(Boolean)
    const executable = candidates.find((candidate) => existsSync(candidate)) || findOnPath('Cocode.exe', 'where.exe', env)
    if (executable) return { executable, args: [] }
    throw new Error('Cocode GUI was not found. Set COCODE_GUI_EXECUTABLE to its executable path.')
  }
  const candidates = [env.COCODE_GUI_APPIMAGE?.trim(), join(homedir(), '.local', 'bin', 'cocode-gui'), '/usr/local/bin/cocode-gui', '/usr/bin/cocode-gui', '/opt/Cocode/cocode-gui', '/opt/Cocode/cocode'].filter(Boolean)
  const executable = candidates.find((candidate) => existsSync(candidate)) || findOnPath('cocode-gui', 'sh', env)
  if (executable) return { executable, args: [] }
  throw new Error('Cocode GUI was not found. Set COCODE_GUI_EXECUTABLE to its executable path.')
}

function findOnPath(command, shell, env) {
  const result = spawnSync(shell, shell === 'where.exe' ? [command] : ['-lc', `command -v ${shellQuote(command)}`], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  if (result.status !== 0) return undefined
  return String(result.stdout).trim().split(/\r?\n/)[0] || undefined
}

function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'` }

export function stagedPaths(scriptUrl) {
  const scriptDirectory = dirname(fileURLToPath(scriptUrl))
  const packageRoot = resolve(scriptDirectory, '..')
  const packageJsonPath = join(packageRoot, 'package.json')
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    return { packageRoot, packageJson, tuiEntry: resolve(packageRoot, 'dist', 'cocode-tui.mjs'), staged: false }
  }
  const manifestPath = join(scriptDirectory, 'manifest.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  return { packageRoot: scriptDirectory, packageJson: { version: manifest.productVersion || manifest.tuiVersion || 'unknown' }, tuiEntry: join(scriptDirectory, 'cocode-tui.mjs'), staged: true }
}

export function usage(version) {
  return [
    `Cocode ${version}`,
    '',
    'Usage: cocode <command> [options]',
    '',
    'Commands:',
    '  gui [args...]              Open Cocode GUI',
    '  tui [args...]              Open Cocode TUI (default)',
    '  plugin [args...]           Manage bundled DSH profile plugins',
    '  host status [--json]       Show the shared Host status',
    '  host stop [--force]        Stop the Host and Supervisor',
    '  doctor                     Check TUI and Host prerequisites',
    '  version                    Show Cocode and bundled DSH versions',
    '',
    'DSH-compatible options:',
    '      --patch <path>         Apply an extra DSH patch overlay',
    '      --dump-config          Print the composed DSH profile tree',
    '      --dump-default-config  Print the default DSH profile tree',
    '',
    'Cocode options:',
    '  -h, --help                 Show this help',
    '  -v, --version              Show the installed Cocode version',
    '  -f, --force                Stop Host even when clients still hold leases',
    '      --json                 Print machine-readable status',
    '      --dsh-home <path>      Select the shared DSH home',
    '      --profile <name>       Select the DSH profile',
    '      --runtime-channel <c>  Select stable, preview, or dev runtime',
    '',
    'Environment:',
    '  COCODE_GUI_EXECUTABLE      Explicit GUI executable path',
    '  COCODE_GUI_PATH            Alias for COCODE_GUI_EXECUTABLE',
    '  COCODE_DSH_CLI_ENTRY       Explicit bundled DSH CLI entry path',
    '',
  ].join('\n')
}
