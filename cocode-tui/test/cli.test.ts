import { describe, expect, it } from 'vitest'

import {
  applyScopeOptions,
  formatHostStatus,
  launchDsh,
  parseCliArgs,
  resolveDshLaunch,
  resolveDshVersion,
  resolveGuiLaunch,
} from '../bin/cli.mjs'

describe('cocode CLI', () => {
  it('keeps TUI as the default and exposes explicit GUI/TUI commands', () => {
    expect(parseCliArgs([])).toMatchObject({ command: 'tui', commandArgs: [] })
    expect(parseCliArgs(['gui', '--workspace', '/tmp/project'])).toMatchObject({
      command: 'gui',
      commandArgs: ['--workspace', '/tmp/project'],
    })
    expect(parseCliArgs(['--tui'])).toMatchObject({ command: 'tui', commandArgs: [] })
    expect(parseCliArgs(['run', '--model', 'm1', 'fix the test'])).toMatchObject({
      command: 'run',
      commandArgs: ['--model', 'm1', 'fix the test'],
    })
  })

  it('distinguishes the detailed version command from the script flag', () => {
    expect(parseCliArgs(['version'])).toMatchObject({ version: true, versionCommand: true })
    expect(parseCliArgs(['--version'])).toMatchObject({ version: true, versionCommand: false })
  })

  it('parses Host controls and scope options on either side of the command', () => {
    expect(parseCliArgs(['--profile', 'web', 'host', 'status', '--json'])).toMatchObject({
      command: 'host-status',
      profile: 'web',
      json: true,
    })
    expect(parseCliArgs(['host', 'stop', '--dsh-home', '/tmp/dsh', '--force'])).toMatchObject({
      command: 'host-stop',
      dshHome: '/tmp/dsh',
      force: true,
    })
  })

  it('rejects the removed dsh wrapper and preserves direct DSH commands', () => {
    expect(() => parseCliArgs(['dsh', 'plugin', '--profile', 'web', 'add', 'dshmarket'])).toThrow(
      'The `cocode dsh ...` form is no longer supported.',
    )
    expect(() => parseCliArgs(['web', '--help'])).toThrow(
      'The `cocode web` command is disabled.',
    )
    expect(parseCliArgs(['plugin', '--profile', 'web', 'add', 'dshmarket'])).toMatchObject({
      command: 'dsh',
      commandArgs: ['plugin', '--profile', 'web', 'add', 'dshmarket'],
    })
    expect(parseCliArgs(['plugin', 'add', 'dshmarket'])).toMatchObject({
      command: 'dsh',
      commandArgs: ['plugin', '--profile', 'cocode', 'add', 'dshmarket'],
    })
    expect(parseCliArgs(['plugin', '--profile=web', 'list'])).toMatchObject({
      command: 'dsh',
      commandArgs: ['plugin', '--profile=web', 'list'],
    })
    expect(parseCliArgs(['--profile', 'web', 'plugin', 'add', 'dshmarket'])).toMatchObject({
      command: 'dsh',
      profile: 'web',
      commandArgs: ['plugin', '--profile', 'web', 'add', 'dshmarket'],
    })
    expect(parseCliArgs(['--patch', './extra.yml', 'web'])).toMatchObject({
      command: 'dsh',
      commandArgs: ['--patch', './extra.yml', 'web'],
    })
    expect(parseCliArgs(['--profile', 'web', '--dump-config'])).toMatchObject({
      command: 'dsh',
      profile: 'web',
      commandArgs: ['--profile', 'web', '--dump-config'],
    })
  })

  it('validates runtime channels before changing the environment', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(() => applyScopeOptions({ runtimeChannel: 'nightly' }, env)).toThrow(
      '--runtime-channel must be stable, preview, or dev.',
    )
    applyScopeOptions({ runtimeChannel: 'preview', profile: 'web' }, env)
    expect(env).toMatchObject({ COCODE_RUNTIME_CHANNEL: 'preview', DSH_PROFILE: 'web' })
  })

  it('prints script-friendly Host status and honors an explicit GUI path', () => {
    expect(JSON.parse(formatHostStatus(null, true))).toEqual({ status: 'stopped' })
    expect(resolveGuiLaunch({ COCODE_GUI_EXECUTABLE: './Cocode' }, 'linux')).toEqual({
      executable: expect.stringMatching(/Cocode$/),
      args: [],
    })
  })

  it('resolves an explicit bundled DSH entry without consulting PATH', () => {
    expect(resolveDshLaunch(
      { staged: false },
      { COCODE_DSH_CLI_ENTRY: process.execPath, COCODE_NODE_EXECUTABLE: '/opt/Cocode/node' },
      { resolve: () => { throw new Error('unexpected package lookup') } },
    )).toEqual({ executable: '/opt/Cocode/node', entry: process.execPath })
  })

  it('reads the bundled DSH package version from its resolved entry', () => {
    expect(resolveDshVersion({ staged: false })).toBe('0.1.0-rc.6')
  })

  it('passes DSH arguments unchanged and returns its exit code', () => {
    let invocation
    const status = launchDsh(
      ['plugin', '--profile', 'web', 'add', 'dshmarket'],
      { staged: false },
      { COCODE_DSH_CLI_ENTRY: process.execPath, COCODE_NODE_EXECUTABLE: '/opt/Cocode/node' },
      (executable, args, options) => {
        invocation = { executable, args, options }
        return { status: 7 }
      },
    )
    expect(status).toBe(7)
    expect(invocation).toMatchObject({
      executable: '/opt/Cocode/node',
      args: [process.execPath, 'plugin', '--profile', 'web', 'add', 'dshmarket'],
      options: { stdio: 'inherit' },
    })
  })
})
