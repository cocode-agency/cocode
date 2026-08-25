import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { addRuntimePluginDependencies, createRuntimePatch, hostKey, mergeHostRuntimeEnv, prepareRuntimeSlot } from '../lib/index.js'

const hostRequire = createRequire(fileURLToPath(new URL('../../../package.json', import.meta.url)))
const dshRoot = dirname(dirname(hostRequire.resolve('@deepseek-ai/dsh/lib/bin.js')))

test('repairs an incomplete DSH runtime slot before booting it', () => {
  const runtimeHome = mkdtempSync(join(tmpdir(), 'cocode-runtime-slot-test-'))
  const previousRuntimeHome = process.env.COCODE_HOST_RUNTIME_HOME
  process.env.COCODE_HOST_RUNTIME_HOME = runtimeHome
  const scope = {
    dshHome: '/tmp/cocode-incomplete-slot-dsh',
    profile: 'web',
    hostConfigFingerprint: 'test-incomplete-slot',
    runtimeChannel: 'stable',
  }
  try {
    const dshVersion = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8')).version
    const dshSlotRoot = join(runtimeHome, `${hostKey(scope)}-${dshVersion}`, 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(join(dshSlotRoot, 'lib'), { recursive: true })
    cpSync(join(dshRoot, 'package.json'), join(dshSlotRoot, 'package.json'))
    cpSync(join(dshRoot, 'lib', 'bin.js'), join(dshSlotRoot, 'lib', 'bin.js'))

    const pluginPath = fileURLToPath(new URL('../lib/host-jsonrpc-plugin.js', import.meta.url))
    const slot = prepareRuntimeSlot(scope, '/tmp/cocode-incomplete-slot-jsonrpc.sock', pluginPath)

    assert.equal(existsSync(join(slot.root, 'cocode-credentials-local-compat.mjs')), true)
    assert.match(readFileSync(join(slot.root, 'cocode-credentials-local-compat.mjs'), 'utf8'), /loadCredentials/)

    for (const file of readdirSync(join(dshRoot, 'lib'))) {
      assert.equal(existsSync(join(slot.root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', file)), true, file)
    }
  } finally {
    if (previousRuntimeHome === undefined) delete process.env.COCODE_HOST_RUNTIME_HOME
    else process.env.COCODE_HOST_RUNTIME_HOME = previousRuntimeHome
    rmSync(runtimeHome, { recursive: true, force: true })
  }
})

test('Supervisor host launch disables the Web app default-browser handoff', () => {
  const serviceSource = readFileSync(fileURLToPath(new URL('../src/service.ts', import.meta.url)), 'utf8')
  assert.match(serviceSource, /args\.push\('--patch', slot\.patch, '--no-open', '--port', '0'\)/)
})

test('repairs a complete slot when a registered plugin package is missing', () => {
  const runtimeHome = mkdtempSync(join(tmpdir(), 'cocode-runtime-dependency-slot-test-'))
  const pluginSource = fileURLToPath(new URL('../../../runtime/plugins/cocode-runtime-test-plugin', import.meta.url))
  const previousRuntimeHome = process.env.COCODE_HOST_RUNTIME_HOME
  process.env.COCODE_HOST_RUNTIME_HOME = runtimeHome
  const scope = {
    dshHome: '/tmp/cocode-missing-plugin-dependency-dsh',
    profile: 'web',
    hostConfigFingerprint: 'test-missing-plugin-dependency',
    runtimeChannel: 'stable',
  }
  try {
    mkdirSync(join(pluginSource, 'lib'), { recursive: true })
    writeFileSync(join(pluginSource, 'package.json'), `${JSON.stringify({
      name: 'cocode-runtime-test-plugin',
      version: '0.0.0',
      type: 'module',
    })}\n`)
    writeFileSync(join(pluginSource, 'lib', 'index.js'), 'export default {}\n')
    const pluginPath = fileURLToPath(new URL('../lib/host-jsonrpc-plugin.js', import.meta.url))
    const slot = prepareRuntimeSlot(scope, '/tmp/cocode-missing-plugin-dependency-jsonrpc.sock', pluginPath)
    const dependencyManifest = join(slot.root, 'node_modules', 'cocode-runtime-test-plugin', 'package.json')
    assert.equal(existsSync(dependencyManifest), true)

    rmSync(join(slot.root, 'node_modules', 'cocode-runtime-test-plugin'), { recursive: true, force: true })
    assert.equal(existsSync(dependencyManifest), false)

    const repaired = prepareRuntimeSlot(scope, '/tmp/cocode-missing-plugin-dependency-jsonrpc.sock', pluginPath)
    assert.equal(existsSync(join(repaired.root, 'node_modules', 'cocode-runtime-test-plugin', 'package.json')), true)
  } finally {
    if (previousRuntimeHome === undefined) delete process.env.COCODE_HOST_RUNTIME_HOME
    else process.env.COCODE_HOST_RUNTIME_HOME = previousRuntimeHome
    rmSync(pluginSource, { recursive: true, force: true })
    rmSync(runtimeHome, { recursive: true, force: true })
  }
})

test('addRuntimePluginDependencies extends the DSH install closure', () => {
  const manifest = addRuntimePluginDependencies(
    {
      name: '@deepseek-ai/dsh',
      dependencies: { existing: '1.0.0' },
    },
    [
      { name: 'cocode-sidebar', version: '0.12.1-cocode.0' },
      { name: 'cocode-account', version: '0.1.0-cocode.0' },
    ],
  )

  assert.deepEqual(manifest.dependencies, {
    existing: '1.0.0',
    'cocode-sidebar': '0.12.1-cocode.0',
    'cocode-account': '0.1.0-cocode.0',
  })
})

test('createRuntimePatch registers Cocode plugins by package name', () => {
  const patch = createRuntimePatch(
    'file:///tmp/cocode-host-jsonrpc-plugin.mjs',
    'http://127.0.0.1:43123',
    [
      { name: 'cocode-sidebar', entry: '/tmp/cocode-sidebar/lib/index.js' },
      { name: 'cocode-account', entry: '/tmp/cocode-account/lib/index.js' },
      { name: 'cocode-shortcuts', entry: '/tmp/cocode-shortcuts/lib/index.js' },
    ],
  )

  assert.match(patch, /id: llm-deepseek\n  name: '@deepseek-ai\/dsh-llm-deepseek'/)
  assert.match(patch, /maxRetries: 5/)
  assert.match(patch, /id: cocode-sidebar\n      name: "cocode-sidebar"/)
  assert.match(patch, /id: cocode-account\n      name: "cocode-account"/)
  assert.match(patch, /id: cocode-shortcuts\n      name: "cocode-shortcuts"/)
  assert.doesNotMatch(patch, /cocode-plugin-/)
  assert.doesNotMatch(patch, /file:\/\/.*cocode-(sidebar|account|shortcuts)/)
})

test('createRuntimePatch leaves shared DSH settings and credentials at their defaults', () => {
  const patch = createRuntimePatch(
    'file:///tmp/cocode-host-jsonrpc-plugin.mjs',
    'http://127.0.0.1:43123',
    [{ name: 'cocode-workbench', entry: '/tmp/cocode-workbench/lib/index.js' }],
  )
  const parsed = YAML.parse(patch)
  assert.equal(parsed[1].insert[1].id, 'cocode-workbench')
  assert.equal(parsed.some((entry) => entry?.id === 'settings'), false)
  assert.equal(parsed.some((entry) => entry?.id === 'credentials'), false)
  assert.equal(parsed.some((entry) => entry?.id === 'llm-pi-ai'), false)
})

test('createRuntimePatch disables the native credentials provider and inserts the Host provider', () => {
  const patch = createRuntimePatch('file:///host-jsonrpc.mjs', '/tmp/host.sock', [], undefined, 'file:///credentials-compat.mjs', '/tmp/shared-dsh')
  const parsed = YAML.parse(patch)
  const nativeCredentials = parsed.find((entry) => entry?.id === 'credentials')
  const hostCredentials = parsed.find((entry) => entry?.insert?.some((item) => item?.id === 'cocode-credentials'))?.insert
    ?.find((item) => item?.id === 'cocode-credentials')
  assert.equal(nativeCredentials?.name, '@deepseek-ai/dsh-credentials-local')
  assert.equal(nativeCredentials?.disabled, true)
  assert.equal(hostCredentials?.name, 'file:///credentials-compat.mjs')
  assert.equal(hostCredentials?.config.path, '/tmp/shared-dsh/.credentials.yaml')
  assert.equal(hostCredentials?.config.dshHome, '/tmp/shared-dsh')
})

test('createRuntimePatch keeps the native credentials name as a patch guard', () => {
  const patch = createRuntimePatch('file:///host-jsonrpc.mjs', '/tmp/host.sock', [], undefined, 'file:///credentials-compat.mjs', '/tmp/shared-dsh')
  assert.match(patch, /id: credentials\n  name: '@deepseek-ai\/dsh-credentials-local'\n  disabled: true/)
  assert.match(patch, /id: cocode-credentials\n      name: "file:\/\/\/credentials-compat\.mjs"/)
})

test('createRuntimePatch mounts COCODE_LLM_PROVIDERS on llm-pi-ai', () => {
  const patch = createRuntimePatch(
    'file:///tmp/cocode-host-jsonrpc-plugin.mjs',
    'http://127.0.0.1:43123',
    [{ name: 'cocode-workbench', entry: '/tmp/cocode-workbench/lib/index.js' }],
    {
      COCODE_LLM_PROVIDERS: JSON.stringify({
        'cocode-nut': {
          displayName: 'Cocode Nut',
          api: 'openai-responses',
          baseURL: 'https://cocode.agency/v1',
          apiKeyEnv: 'COCODE_NUT_API_KEY',
          retryPolicy: { mode: 'normal', maxRetries: 5 },
          models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' }],
        },
      }),
    },
  )
  const parsed = YAML.parse(patch)
  const piAi = parsed.find((entry) => entry?.id === 'llm-pi-ai')
  assert.equal(piAi.name, '@deepseek-ai/dsh-llm-pi-ai')
  assert.equal(piAi.config.providers['cocode-nut'].api, 'openai-responses')
  assert.equal(piAi.config.providers['cocode-nut'].apiKeyEnv, 'COCODE_NUT_API_KEY')
  assert.equal(parsed.find((entry) => entry?.insert !== undefined).insert[1].id, 'cocode-workbench')
})

test('mergeHostRuntimeEnv preserves base credentials while overlaying the route', () => {
  const env = mergeHostRuntimeEnv(
    { PATH: '/usr/bin', COCODE_NUT_API_KEY: 'ck_live_secret' },
    { COCODE_LLM_PROVIDERS: '{"cocode-nut":{}}' },
    '/tmp/shared-dsh-home',
  )

  assert.equal(env.DSH_HOME, '/tmp/shared-dsh-home')
  assert.equal(env.COCODE_LLM_PROVIDERS, '{"cocode-nut":{}}')
  assert.equal(env.COCODE_NUT_API_KEY, 'ck_live_secret')
})

test('mergeHostRuntimeEnv pins Cocode sessions inside the shared DSH home', () => {
  const env = mergeHostRuntimeEnv(
    { DSH_SESSION_ROOT: '/tmp/other-dsh/sessions' },
    undefined,
    '/tmp/shared-dsh-home',
    'cocode',
  )

  assert.equal(env.DSH_HOME, '/tmp/shared-dsh-home')
  assert.equal(env.DSH_SESSION_ROOT, '/tmp/shared-dsh-home/sessions')
})
