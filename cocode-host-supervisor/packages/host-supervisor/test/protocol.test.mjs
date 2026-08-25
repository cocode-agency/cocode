import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  canReuseOlderSupervisor,
  canonicalizeScope,
  hostKey,
  isHostDescriptorCompatible,
  resolveHostRuntimeEnv,
  resolveHostScope,
  resolveCocodeHostScope,
  stableJson,
} from '../lib/index.js'

const scope = {
  dshHome: '/tmp/cocode-dsh',
  profile: 'web',
  hostConfigFingerprint: 'cocode-web-jsonrpc-v1',
  runtimeChannel: 'stable',
}

function descriptor(overrides = {}) {
  return {
    schemaVersion: 1,
    hostKey: hostKey(scope),
    supervisorProtocolRevision: '1.0',
    hostPid: 123,
    supervisorPid: 456,
    dshHome: scope.dshHome,
    profile: scope.profile,
    runtimeVersion: '0.1.1-rc.2',
    hostProtocolRevision: '1.0',
    hostConfigFingerprint: scope.hostConfigFingerprint,
    services: [
      { service: 'web', transport: 'tcp', endpoint: 'http://127.0.0.1:3080', protocolRevision: '1.0' },
      { service: 'jsonrpc', transport: 'unix', endpoint: '/tmp/cocode-jsonrpc.sock', protocolRevision: '1.0' },
    ],
    capabilities: ['web', 'jsonrpc', 'session'],
    startedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  }
}

test('canonicalizeScope normalizes paths, defaults, and channels', () => {
  assert.deepEqual(canonicalizeScope({
    dshHome: ' /tmp/cocode-dsh/../cocode-dsh ',
    profile: '  ',
    hostConfigFingerprint: '  ',
    runtimeChannel: 'unknown',
  }), {
    dshHome: '/tmp/cocode-dsh',
    profile: 'web',
    hostConfigFingerprint: 'default',
    runtimeChannel: 'stable',
  })
})

test('canonicalizeScope follows the official empty DSH_HOME fallback', () => {
  assert.equal(canonicalizeScope({
    dshHome: '',
    profile: 'web',
    hostConfigFingerprint: 'fingerprint',
    runtimeChannel: 'stable',
  }).dshHome.endsWith('/.dsh'), true)
})

test('resolveHostScope applies the same environment-derived scope for every client', () => {
  const env = {
    DSH_HOME: '/tmp/cocode-dsh',
    DSH_PROFILE: 'web',
    COCODE_HOST_CONFIG_FINGERPRINT: 'cocode-web-jsonrpc-v1',
    COCODE_RUNTIME_CHANNEL: 'stable',
    COCODE_LLM_PROVIDERS: ' {"cocode-nut":{"api":"openai-responses"}} ',
    COCODE_HOME: '/tmp/cocode-account',
    COCODE_DSH_HOME: '/tmp/cocode-dsh',
    COCODE_NUT_API_KEY: 'secret-is-not-part-of-the-scope',
  }
  const scope = resolveHostScope(env)
  assert.deepEqual(resolveHostRuntimeEnv(env), {
    COCODE_LLM_PROVIDERS: env.COCODE_LLM_PROVIDERS.trim(),
  })
  assert.equal(scope.dshHome, '/tmp/cocode-dsh')
  assert.equal(scope.profile, 'web')
  assert.equal(scope.runtimeChannel, 'stable')
  assert.match(scope.hostConfigFingerprint, /^cocode-web-jsonrpc-v1:[0-9a-f]{32}$/)
})

test('resolveHostScope expands a tilde-prefixed DSH_HOME', () => {
  assert.equal(
    resolveHostScope({ DSH_HOME: '~/.dsh' }).dshHome,
    join(homedir(), '.dsh'),
  )
})

test('resolveCocodeHostScope ignores ambient official DSH_HOME and fixes cocode profile', () => {
  const scope = resolveCocodeHostScope({ DSH_HOME: '/tmp/official', DSH_PROFILE: 'web', COCODE_HOME: '/tmp/cocode' })
  assert.equal(scope.dshHome, join(homedir(), '.dsh'))
  assert.equal(scope.profile, 'cocode')
  assert.equal(scope.hostConfigFingerprint, 'cocode-web-jsonrpc-v3')
  assert.equal(scope.runtimeChannel, 'stable')
})

test('resolveCocodeHostScope defaults to cocode when no profile is provided', () => {
  assert.equal(resolveCocodeHostScope({}).profile, 'cocode')
})

test('resolveHostRuntimeEnv ignores removed vision configuration', () => {
  assert.deepEqual(
    resolveHostRuntimeEnv({
      COCODE_DSH_HOME: '~/.dsh',
      COCODE_VISION_CONFIG: '~/.cocode/vision.yaml',
    }),
    {},
  )
})

test('resolveHostScope ignores blank routes and secrets', () => {
  const scope = resolveHostScope({
    DSH_HOME: '/tmp/cocode-dsh',
    COCODE_LLM_PROVIDERS: '  ',
    COCODE_HOME: '  ',
    COCODE_NUT_API_KEY: 'secret',
  })
  assert.equal(scope.hostConfigFingerprint, 'cocode-web-jsonrpc-v1')
  assert.deepEqual(resolveHostRuntimeEnv({ COCODE_NUT_API_KEY: 'secret' }), {})
})

test('account home does not split the Host scope when DSH configuration is shared', () => {
  const first = resolveHostScope({
    DSH_HOME: '/tmp/cocode-dsh',
    COCODE_DSH_HOME: '/tmp/cocode-dsh',
    COCODE_HOME: '/tmp/cocode-account-a',
  })
  const second = resolveHostScope({
    DSH_HOME: '/tmp/cocode-dsh',
    COCODE_DSH_HOME: '/tmp/cocode-dsh',
    COCODE_HOME: '/tmp/cocode-account-b',
  })

  assert.equal(first.hostConfigFingerprint, second.hostConfigFingerprint)
  assert.equal(hostKey(first), hostKey(second))
})

test('hostKey is stable for equivalent scopes', () => {
  assert.equal(hostKey(scope), hostKey({ ...scope, dshHome: '/tmp/./cocode-dsh' }))
  assert.notEqual(hostKey(scope), hostKey({ ...scope, profile: 'preview' }))
})

test('stableJson sorts object keys recursively', () => {
  assert.equal(stableJson({ b: { d: 2, c: 1 }, a: [3, { z: true, y: null }] }), '{"a":[3,{"y":null,"z":true}],"b":{"c":1,"d":2}}')
  assert.equal(stableJson(undefined), 'undefined')
})

test('descriptor compatibility accepts required services and capabilities', () => {
  assert.equal(isHostDescriptorCompatible(descriptor(), scope, {
    requiredServices: ['web', 'jsonrpc'],
    requiredCapabilities: ['session'],
    minProtocolRevision: '1.0',
  }), true)
})

test('descriptor compatibility rejects mismatched scope, protocol, service, and capability', () => {
  const request = {
    requiredServices: ['web', 'jsonrpc'],
    requiredCapabilities: ['session'],
    minProtocolRevision: '1.0',
  }
  assert.equal(isHostDescriptorCompatible(descriptor({ dshHome: '/tmp/other' }), scope, request), false)
  assert.equal(isHostDescriptorCompatible(descriptor({ hostProtocolRevision: '2.0' }), scope, request), false)
  assert.equal(isHostDescriptorCompatible(descriptor({ services: [{ service: 'web', transport: 'tcp', endpoint: 'http://127.0.0.1:3080', protocolRevision: '1.0' }] }), scope, request), false)
  assert.equal(isHostDescriptorCompatible(descriptor({ capabilities: ['web', 'jsonrpc'] }), scope, request), false)
})

test('older supervisor can be reused for an active compatible host', () => {
  assert.equal(
    canReuseOlderSupervisor(
      {
        scope,
        clientKind: 'standalone-tui',
        requiredServices: ['jsonrpc'],
        minProtocolRevision: '1.0',
      },
      { leaseCount: 1, descriptor: descriptor() },
    ),
    true,
  )
  assert.equal(
    canReuseOlderSupervisor(
      {
        scope,
        clientKind: 'standalone-tui',
        requiredServices: ['jsonrpc'],
        minProtocolRevision: '1.0',
        runtimeEnv: { COCODE_LLM_PROVIDERS: '{"cocode-nut":{}}' },
      },
      { leaseCount: 1, descriptor: descriptor() },
    ),
    true,
  )
})
