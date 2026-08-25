import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeRuntimeCapabilities } from '../../packages/connection/src/capability.ts'
import {
  createTuiRuntime,
  parseModelCatalogResult,
  readTuiRpcError,
  resolveHostRuntimeEnv,
  resolveHostScope,
} from '../../packages/connection/src/client.ts'
import { fingerprintRuntimePlugins } from '../../packages/connection/src/runtime-plugins.ts'

type ProbeCall = { method: string; params: object; timeoutMs?: number }

describe('runtime capability negotiation', () => {
  it('reads stable Host business errors without matching message text', () => {
    const error = Object.assign(new Error('missing queue item'), {
      code: 'queue-item-not-found',
      details: { itemId: 'q1' },
    })

    expect(readTuiRpcError(error)).toEqual({
      code: 'queue-item-not-found',
      message: 'missing queue item',
      details: { itemId: 'q1' },
    })
    expect(readTuiRpcError(new Error('transport failed'))).toBeUndefined()
  })

  it('passes the cloud provider route to the Host without forwarding credentials', () => {
    const env = {
      COCODE_HOME: '/tmp/cocode-home',
      COCODE_DSH_HOME: '/tmp/cocode-dsh-home',
      COCODE_LLM_PROVIDERS: '{"cocode-nut":{"api":"openai-responses"}}',
      COCODE_NUT_API_KEY: 'ck_live_secret',
    }

    expect(resolveHostRuntimeEnv(env)).toEqual({
      COCODE_LLM_PROVIDERS: env.COCODE_LLM_PROVIDERS,
    })
  })

  it('changes the Host scope when the runtime provider route changes', () => {
    const base = {
      COCODE_HOME: '/tmp/cocode-home',
      COCODE_HOST_CONFIG_FINGERPRINT: 'cocode-web-jsonrpc-v1',
    }
    const first = resolveHostScope({
      cwd: '/tmp',
      env: {
        ...base,
        COCODE_LLM_PROVIDERS: '{"cocode-nut":{"models":[{"id":"cloud-1"}]}}',
      },
    })
    const second = resolveHostScope({
      cwd: '/tmp',
      env: {
        ...base,
        COCODE_LLM_PROVIDERS: '{"cocode-nut":{"models":[{"id":"cloud-2"}]}}',
      },
    })

    expect(first.dshHome).toBe(second.dshHome)
    expect(first.hostConfigFingerprint).not.toBe(second.hostConfigFingerprint)
  })

  it('versions the Host scope with the bundled runtime plugins', () => {
    const scope = resolveHostScope({
      cwd: '/tmp',
      env: { DSH_HOME: '/tmp/cocode-home' },
    })

    expect(scope.hostConfigFingerprint).toBe('cocode-web-jsonrpc-v3')
  })

  it('changes the plugin fingerprint when a bundled plugin changes', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'cocode-runtime-'))
    const pluginRoot = join(runtimeRoot, 'plugins', 'cocode-dsml')
    mkdirSync(join(pluginRoot, 'lib'), { recursive: true })
    writeFileSync(join(runtimeRoot, 'plugins.json'), '{"plugins":["cocode-dsml"]}\n')
    writeFileSync(join(pluginRoot, 'package.json'), '{"name":"cocode-dsml"}\n')
    writeFileSync(join(pluginRoot, 'lib', 'index.js'), 'export const version = 1\n')

    try {
      const first = fingerprintRuntimePlugins(runtimeRoot)
      writeFileSync(join(pluginRoot, 'lib', 'index.js'), 'export const version = 2\n')
      const second = fingerprintRuntimePlugins(runtimeRoot)

      expect(second).not.toBe(first)
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it('does not enable steer when the runtime advertises queue only', async () => {
    const snapshot = await probeRuntimeCapabilities(
      {
        async request() {
          throw new Error('session does not exist')
        },
      },
      {
        onRequest: true,
        advertised: {
          promptModes: ['normal', 'queue'],
          approval: false,
          permissionMode: false,
          planMode: false,
          sessionList: false,
          modelList: true,
          imageAttachments: false,
          checkpoint: false,
        },
      },
    )

    expect(snapshot.capabilities.promptMode).toBe(false)
    expect(snapshot.capabilities.queueMode).toBe(true)
    expect(snapshot.capabilities.modelList).toBe(true)
  })

  it('exposes a conservative snapshot before a runtime handshake', () => {
    const runtime = createTuiRuntime({ command: 'node', args: ['unused-runtime.js'] })

    expect(runtime.getCapabilities?.()).toEqual({
      source: 'fallback',
      capabilities: {
        cancel: false,
        open: false,
        fork: false,
        rewind: false,
        skills: false,
        onRequest: false,
        approval: false,
        permissionMode: false,
        planMode: false,
        sessionList: false,
        modelList: false,
        imageAttachments: false,
        commands: false,
        plugins: false,
        pluginsMutate: false,
        promptMode: false,
        queueMode: false,
      },
      errors: { onRequest: 'runtime capability probe has not run' },
    })
  })

  it('recognizes routed methods even when the probe uses an unknown session', async () => {
    const calls: ProbeCall[] = []
    const snapshot = await probeRuntimeCapabilities(
      {
        async request(method, params, timeoutMs) {
          calls.push({ method, params: params ?? {}, timeoutMs })
          throw new Error(`${method} rejected the probe session`)
        },
      },
      { onRequest: true, probeSessionId: 'probe-session' },
    )

    expect(snapshot).toEqual({
      source: 'runtime',
      capabilities: {
        cancel: true,
        open: true,
        fork: true,
        rewind: true,
        skills: true,
        onRequest: true,
        approval: false,
        permissionMode: true,
        planMode: true,
        sessionList: true,
        modelList: true,
        imageAttachments: false,
        commands: false,
        plugins: false,
        pluginsMutate: false,
        promptMode: false,
        queueMode: false,
      },
      errors: {},
    })
    expect(calls).toHaveLength(9)
    expect(calls.every((call) => call.timeoutMs === 1_000)).toBe(true)
    expect(calls[0]?.params).toEqual({ sessionId: 'probe-session', keepInbox: true })
    expect(calls[3]?.params).toEqual({
      sourceSessionId: 'probe-session',
      rewindToMessageSeq: 1,
    })
  })

  it('reports unknown protocol methods without enabling the corresponding capability', async () => {
    const snapshot = await probeRuntimeCapabilities(
      {
        async request(method) {
          throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`)
        },
      },
      { onRequest: false, probeSessionId: 'probe-session' },
    )

    expect(snapshot.capabilities).toEqual({
      cancel: false,
      open: false,
      fork: false,
      rewind: false,
      skills: false,
      onRequest: false,
      approval: false,
      permissionMode: false,
      planMode: false,
      sessionList: false,
      modelList: false,
      imageAttachments: false,
      commands: false,
      plugins: false,
      pluginsMutate: false,
      promptMode: false,
      queueMode: false,
    })
    expect(snapshot.errors).toEqual({
      cancel: 'protocol method is not supported by the runtime',
      open: 'protocol method is not supported by the runtime',
      fork: 'protocol method is not supported by the runtime',
      rewind: 'protocol method is not supported by the runtime',
      skills: 'protocol method is not supported by the runtime',
      sessionList: 'protocol method is not supported by the runtime',
      permissionMode: 'protocol method is not supported by the runtime',
      planMode: 'protocol method is not supported by the runtime',
      modelList: 'protocol method is not supported by the runtime',
      onRequest: 'SDK client does not expose onRequest',
    })
  })

  it('keeps skills disabled when the runtime has no skill registry', async () => {
    const snapshot = await probeRuntimeCapabilities(
      {
        async request(method) {
          if (method === 'skills/list') throw new Error('skills registry is not configured')
          throw new Error('session does not exist')
        },
      },
      { onRequest: true, probeSessionId: 'probe-session' },
    )

    expect(snapshot.capabilities).toMatchObject({
      cancel: true,
      open: true,
      fork: true,
      rewind: true,
      skills: false,
      onRequest: true,
    })
    expect(snapshot.errors.skills).toBe('skills registry is not configured')
  })

  it('does not treat malformed successful responses as support', async () => {
    const snapshot = await probeRuntimeCapabilities(
      {
        async request(method) {
          if (method === 'session/cancel') return {}
          if (method === 'session/open') return { opened: true }
          if (method === 'session/fork') return { sessionId: 'child', seedLength: 1, seed: [42] }
          return { skills: [] }
        },
      },
      { onRequest: true, probeSessionId: 'probe-session' },
    )

    expect(snapshot.capabilities).toMatchObject({
      cancel: false,
      open: true,
      fork: false,
      rewind: false,
      modelList: false,
      skills: true,
      onRequest: true,
    })
    expect(snapshot.errors.cancel).toContain('invalid capability probe result')
    expect(snapshot.errors.fork).toContain('invalid capability probe result')
    expect(snapshot.errors.rewind).toContain('invalid capability probe result')
  })

  it('rejects a malformed model catalog during capability probing', async () => {
    const snapshot = await probeRuntimeCapabilities(
      {
        async request(method) {
          if (method === 'model/list') return { groups: [{ id: 'provider' }], failures: [] }
          throw new Error('session does not exist')
        },
      },
      { onRequest: true },
    )

    expect(snapshot.capabilities.modelList).toBe(false)
    expect(snapshot.errors.modelList).toContain('invalid capability probe result')
  })

  it('treats a bounded probe timeout as unavailable', async () => {
    const timeout = Object.assign(new Error('probe timed out'), { name: 'RequestTimeoutError' })
    const snapshot = await probeRuntimeCapabilities(
      {
        async request() {
          throw timeout
        },
      },
      { onRequest: true, probeSessionId: 'probe-session' },
    )

    expect(snapshot.capabilities.cancel).toBe(false)
    expect(snapshot.errors.cancel).toBe('probe timed out')
  })

  it('does not infer rewind support when the fork endpoint rejects rewind parameters', async () => {
    const snapshot = await probeRuntimeCapabilities(
      {
        async request(method, params) {
          if (method === 'session/fork' && 'rewindToMessageSeq' in (params ?? {})) {
            throw new Error('unknown parameter rewindToMessageSeq')
          }
          throw new Error('unknown SDK session')
        },
      },
      { onRequest: true, probeSessionId: 'probe-session' },
    )

    expect(snapshot.capabilities.fork).toBe(true)
    expect(snapshot.capabilities.rewind).toBe(false)
    expect(snapshot.errors.rewind).toContain('capability-specific parameters')
  })

  it('strictly validates model catalog responses', () => {
    expect(
      parseModelCatalogResult({
        groups: [
          {
            id: 'provider-a',
            name: 'Provider A',
            models: [{
              id: 'model-a',
              name: 'Model A',
              description: 'Primary model',
              reasoning: {
                defaultEffort: 'high',
                efforts: [
                  { id: 'high', name: 'High' },
                  { id: 'max', name: 'Max', description: 'Slowest' },
                ],
              },
            }],
          },
        ],
        failures: [{ id: 'provider-b', name: 'Provider B', message: 'offline' }],
      }),
    ).toEqual({
      groups: [
        {
          id: 'provider-a',
          name: 'Provider A',
          models: [{
            id: 'model-a',
            name: 'Model A',
            description: 'Primary model',
            reasoning: {
              defaultEffort: 'high',
              efforts: [
                { id: 'high', name: 'High' },
                { id: 'max', name: 'Max', description: 'Slowest' },
              ],
            },
          }],
        },
      ],
      failures: [{ id: 'provider-b', name: 'Provider B', message: 'offline' }],
    })
    expect(() => parseModelCatalogResult({ groups: [{ id: 'p', name: 'P', models: [{}] }], failures: [] }))
      .toThrow('invalid model entry')
    expect(() => parseModelCatalogResult({ groups: [], failures: [{ id: 'p' }] }))
      .toThrow('invalid provider failure')
    expect(() =>
      parseModelCatalogResult({
        groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 42, endpoint: 'https://secret' }] }],
        failures: [],
      }),
    )
      .toThrow('invalid model entry')
  })
})
