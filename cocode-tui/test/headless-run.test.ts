import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  formatRunResult,
  parseRunArgs,
  runHeadless,
} from '../bin/headless-run.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('headless Cocode run', () => {
  it('parses benchmark-safe defaults and explicit model settings', () => {
    const options = parseRunArgs([
      '--provider', 'custom',
      '--model', 'deepseek-v4-flash',
      '--reasoning-effort', 'max',
      '--timeout', '30m',
      '--allow-tools',
      '--json',
      'repair the project',
    ], {})

    expect(options).toMatchObject({
      provider: 'custom',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
      timeoutMs: 1_800_000,
      approvalPolicy: 'allow',
      json: true,
      prompt: 'repair the project',
    })
  })

  it('rejects ambiguous prompts and unsafe option values', () => {
    expect(() => parseRunArgs(['--prompt', 'one', '--prompt-file', 'two'])).toThrow(
      'Use either --prompt or --prompt-file',
    )
    expect(() => parseRunArgs(['--approval-policy', 'sometimes', 'task'])).toThrow(
      '--approval-policy must be allow or reject',
    )
    expect(() => parseRunArgs(['--timeout', 'soon', 'task'])).toThrow(
      '--timeout must be a positive duration',
    )
  })

  it('drives one JSON-RPC turn, handles interactions, and writes an event log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cocode-run-test-'))
    temporaryDirectories.push(directory)
    const eventLog = join(directory, 'events.jsonl')
    const harness = createHarness()
    const result = await runHeadless({
      ...parseRunArgs([
        '--cwd', directory,
        '--allow-tools',
        '--event-log', eventLog,
        '--reasoning-effort', 'max',
        'repair the project',
      ]),
      prompt: 'repair the project',
      sessionId: 'session-one',
    }, { supervisor: harness.supervisor, env: {}, now: harness.now })

    expect(result).toMatchObject({
      status: 'completed',
      sessionId: 'session-one',
      messageId: 'message-one',
      approvals: 1,
      questionsCancelled: 1,
      eventCount: 1,
      durationMs: 250,
    })
    expect(harness.requests).toContainEqual([
      'session.selectModel',
      expect.objectContaining({ reasoningEffort: 'max' }),
    ])
    expect(harness.requests).toContainEqual([
      'cocode/approval/respond',
      { requestId: 'approval-one', outcome: 'allowed-once' },
    ])
    expect(harness.requests).toContainEqual([
      'cocode/question/respond',
      { requestId: 'question-one', cancelled: true },
    ])
    expect(await readFile(eventLog, 'utf8')).toContain('"type":"turn/end"')
    expect(JSON.parse(formatRunResult(result, true))).toMatchObject({ status: 'completed' })
    expect(harness.released).toBe(true)
    expect(harness.closed).toBe(true)
  })

  it('cancels the session and exposes a timeout exit classification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cocode-run-timeout-'))
    temporaryDirectories.push(directory)
    const eventLog = join(directory, 'events.jsonl')
    const harness = createHarness({ cancelCompletes: true, complete: false })
    const error = await runHeadless({
      ...parseRunArgs([
        '--cwd', directory,
        '--allow-tools',
        '--event-log', eventLog,
        '--timeout', '5ms',
        'wait forever',
      ]),
      prompt: 'wait forever',
      sessionId: 'session-timeout',
    }, { supervisor: harness.supervisor, env: {} }).catch((caught) => caught)

    expect(error).toMatchObject({ code: 'COCODE_RUN_TIMEOUT' })
    expect(harness.requests).toContainEqual([
      'cocode/session/cancel',
      { sessionId: 'session-timeout' },
    ])
    expect(await readFile(eventLog, 'utf8')).toContain('"type":"turn/end"')
    expect(harness.closedAfterCancelCompleted).toBe(true)
    expect(harness.released).toBe(true)
  })

  it('fails when the completed turn reports a provider error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cocode-run-error-'))
    temporaryDirectories.push(directory)
    const harness = createHarness({ turnError: true })
    const error = await runHeadless({
      ...parseRunArgs(['--cwd', directory, '--allow-tools', 'fail']),
      prompt: 'fail',
      sessionId: 'session-one',
    }, { supervisor: harness.supervisor, env: {} }).catch((caught) => caught)

    expect(error).toMatchObject({
      message: 'provider rejected the requested reasoning effort',
      code: 'UNSUPPORTED_REASONING_EFFORT',
    })
    expect(harness.released).toBe(true)
  })
})

function createHarness(options: {
  cancelCompletes?: boolean
  complete?: boolean
  turnError?: boolean
} = {}) {
  const requests: [string, Record<string, unknown>][] = []
  const subscribers = new Set<(notification: { method: string; params: Record<string, unknown> }) => void>()
  let released = false
  let closed = false
  let cancelCompleted = false
  const notify = (method: string, params: Record<string, unknown>) => {
    for (const subscriber of subscribers) subscriber({ method, params })
  }
  const peer = {
    subscribe(handler) { subscribers.add(handler); return () => subscribers.delete(handler) },
    onClose(_handler) { return () => undefined },
    close() { closed = true },
    async request(method: string, params: Record<string, unknown> = {}) {
      requests.push([method, params])
      if (method === 'initialize') return { serverInfo: { name: 'test', version: '1' } }
      if (method === 'cocode/workspace/ensure') {
        return params.approved
          ? { status: 'ready', path: params.cwd ?? process.cwd(), workspaceId: 'w1', title: 'test', created: true }
          : { status: 'authorization-required', path: process.cwd(), title: 'test' }
      }
      if (method === 'session/prompt') {
        if (options.complete !== false) {
          queueMicrotask(() => {
            notify('session.status', { sessionId: 'session-one', status: 'running' })
            notify('session.event', {
              sessionId: 'session-one',
              event: {
                type: 'turn/end',
                seq: 1,
                time: 1,
                data: options.turnError
                  ? { reason: { kind: 'error', error: { message: 'provider rejected the requested reasoning effort', code: 'UNSUPPORTED_REASONING_EFFORT' } } }
                  : {},
              },
            })
            notify('cocode/approval/request', {
              sessionId: 'session-one',
              requestId: 'approval-one',
            })
            notify('cocode/question/request', {
              sessionId: 'session-one',
              requestId: 'question-one',
            })
            notify('session.status', { sessionId: 'session-one', status: 'idle' })
          })
        }
        return { messageId: 'message-one' }
      }
      if (method === 'cocode/session/cancel' && options.cancelCompletes === true) {
        setTimeout(() => {
          notify('session.event', {
            sessionId: String(params.sessionId),
            event: {
              type: 'turn/end',
              seq: 2,
              time: 2,
              data: { reason: { kind: 'cancelled' } },
            },
          })
          cancelCompleted = true
        }, 20)
      }
      return {}
    },
  }
  let tick = 0
  return {
    requests,
    get released() { return released },
    get closed() { return closed },
    get closedAfterCancelCompleted() { return closed && cancelCompleted },
    now() { tick += 250; return tick },
    supervisor: {
      resolveCocodeHostScope() {
        return { dshHome: '/tmp/dsh', profile: 'cocode', hostConfigFingerprint: 'test', runtimeChannel: 'stable' }
      },
      resolveHostRuntimeEnv() { return {} },
      createHostSupervisorClient() {
        return {
          async acquire() {
            return {
              descriptor: {
                runtimeVersion: 'test-runtime',
                services: [{ service: 'jsonrpc', endpoint: '/tmp/socket' }],
              },
              async release() { released = true },
            }
          },
        }
      },
      async connectJsonRpc() { return peer },
    },
  }
}
