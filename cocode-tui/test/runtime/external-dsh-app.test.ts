import { describe, expect, it, vi } from 'vitest'
import type {
  ExternalDshReadSource,
  ExternalSessionHistory,
  ExternalSessionSummary,
} from '@cocode-agency/host-supervisor'
import type { TuiRuntime } from '@cocode/tui-connection'
import type { TuiNotification } from '@cocode/tui-connection'
import { createTuiApp } from '../../src/runtime/app.ts'
import { P0_CAPABILITIES } from '../../src/runtime/capabilities.ts'

function runtime(): TuiRuntime & {
  opens: string[]
  prompts: string[]
  emit: (notification: Parameters<Parameters<TuiRuntime['subscribe']>[0]>[0]) => void
} {
  const handlers = new Set<(notification: TuiNotification) => void>()
  const value: TuiRuntime & {
    opens: string[]
    prompts: string[]
    emit: (notification: TuiNotification) => void
  } = {
    opens: [],
    prompts: [],
    emit(notification) {
      for (const handler of handlers) handler(notification)
    },
    async start() {
      return { name: 'test-runtime', version: '0' }
    },
    async restart() {
      return { name: 'test-runtime', version: '0' }
    },
    async prompt(sessionId) {
      value.prompts.push(sessionId)
      return 'message-1'
    },
    async cancel() {
      return false
    },
    async open(sessionId) {
      value.opens.push(sessionId)
      return { opened: true }
    },
    async fork() {
      return { sessionId: 'forked', seedLength: 0, seed: [] }
    },
    async rewind() {
      return { sessionId: 'rewound', seedLength: 0, seed: [] }
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    async close() {},
  }
  return value
}

function externalReader(summary: ExternalSessionSummary): ExternalDshReadSource & {
  disposed: boolean
  setRevision: (revision: string) => void
} {
  let _listener: ((change: { kind: 'sessions'; path: string }) => void) | undefined
  let revision = '1'
  const history: ExternalSessionHistory = {
    source: 'shared-dsh',
    canMutate: true,
    concurrency: 'no-concurrent-writes',
    session: summary,
    status: 'ok',
    tailIncomplete: false,
    events: [
      {
        type: 'user/message',
        seq: 1,
        time: 1,
        data: {
          id: 'external-user',
          content: [{ type: 'text', text: 'read this official history' }],
          source: { kind: 'user' },
        },
      },
    ],
  }
  const value: ExternalDshReadSource & { disposed: boolean; setRevision: (revision: string) => void } = {
    source: 'shared-dsh',
    sourceHome: '/tmp/official-dsh',
    disposed: false,
    setRevision(next) {
      revision = next
    },
    async getStatus() {
      return {
        source: 'shared-dsh',
        sourceHome: '/tmp/official-dsh',
        canMutate: true,
        concurrency: 'no-concurrent-writes',
        sharedWritePolicy: 'enabled',
        concurrentMutation: 'unsupported',
        homePatch: 'shared',
        homePatchIsolation: 'unavailable',
        profileFallback: 'shared',
        state: 'available',
        sessionCount: 1,
      }
    },
    async listSessions() {
      return [summary]
    },
    async readSessionHistory() {
      return history
    },
    async getSessionRevision() {
      return revision
    },
    async listWorkspaces() {
      return {
        source: 'shared-dsh',
        canMutate: true,
        concurrency: 'no-concurrent-writes',
        revision: '1',
        workspaces: [],
      }
    },
    subscribe(next) {
      _listener = next
      return () => {
        _listener = undefined
      }
    },
    async dispose() {
      value.disposed = true
      _listener = undefined
    },
  }
  return value
}

describe('TUI shared DSH sessions', () => {
  it('namespaces shared sessions, opens them through the Cocode Host, and writes when safe', async () => {
    const host = runtime()
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'same-id',
      createdAt: 1,
      cwd: '/official/project',
      title: 'Official history',
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true, sessionRoot: '/missing' },
    })

    await app.start()
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    const item = app.snapshot().sessionTreePicker?.items.find((candidate) => candidate.source === 'external')
    expect(item).toMatchObject({ source: 'external', externalSessionId: 'same-id' })
    expect(item?.session.id).toBe('shared-dsh:same-id')

    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('shared-dsh:same-id'))
    expect(app.snapshot().header.source).toBe('shared-dsh')
    expect(app.snapshot().header.readOnly).toBe(false)
    expect(app.snapshot().header.canMutate).toBe(true)
    expect(app.snapshot().composer.disabled).toBe(false)
    expect(app.snapshot().nodes[0]).toMatchObject({ kind: 'user', text: 'read this official history' })

    app.dispatch({ type: 'submit', text: 'write shared history' })
    await vi.waitFor(() => expect(host.prompts).toEqual(['same-id']))
    expect(host.opens).toEqual(['same-id'])

    app.dispatch({ type: 'command', line: '/new' })
    expect(app.snapshot().header.source).toBe('cocode')
    expect(app.snapshot().header.readOnly).toBe(false)
    expect(app.snapshot().header.sessionId).not.toBe('shared-dsh:same-id')
    await app.close()
    expect(reader.disposed).toBe(true)
  })

  it('blocks a shared write after the session revision changes elsewhere', async () => {
    const host = runtime()
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'conflict-id',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true, sessionRoot: '/missing' },
    })
    await app.start()
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('shared-dsh:conflict-id'))
    reader.setRevision('2')
    app.dispatch({ type: 'submit', text: 'must be blocked' })
    await vi.waitFor(() => expect(app.snapshot().notice?.message).toContain('SHARED_HOME_CONFLICT'))
    expect(host.prompts).toEqual([])
    expect(app.snapshot().header.canMutate).toBe(false)
    await app.close()
  })

  it('returns to the previous session from a read-only shared session', async () => {
    const host = runtime()
    host.open = async (sessionId) => {
      host.opens.push(sessionId)
      return { opened: sessionId === 'cocode-session' }
    }
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'readonly-id',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true, sessionRoot: '/missing' },
    })

    await app.start()
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.readOnly).toBe(true))

    app.dispatch({ type: 'session.back' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('cocode-session'))
    expect(app.snapshot().header.source).toBe('cocode')
    expect(app.snapshot().header.readOnly).toBe(false)
    expect(host.opens).toEqual(['readonly-id', 'cocode-session'])
    await app.close()
  })

  it('returns correctly after entering the same read-only session twice', async () => {
    const host = runtime()
    host.open = async (sessionId) => {
      host.opens.push(sessionId)
      return { opened: sessionId === 'cocode-session' }
    }
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'readonly-twice',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true, sessionRoot: '/missing' },
    })

    await app.start()
    for (let cycle = 0; cycle < 2; cycle += 1) {
      app.dispatch({ type: 'session.open' })
      await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
      app.dispatch({ type: 'sessionTree.confirm' })
      await vi.waitFor(() => expect(app.snapshot().header.readOnly).toBe(true))
      app.dispatch({ type: 'session.back' })
      await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('cocode-session'))
      expect(app.snapshot().header.readOnly).toBe(false)
    }
    expect(host.opens).toEqual([
      'readonly-twice',
      'cocode-session',
      'readonly-twice',
      'cocode-session',
    ])
    await app.close()
  })

  it('falls back to the session picker when the previous session cannot reopen', async () => {
    const host = runtime()
    host.open = async (sessionId) => {
      host.opens.push(sessionId)
      throw new Error('previous session is unavailable')
    }
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'readonly-fallback',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true, sessionRoot: '/missing' },
    })

    await app.start()
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.readOnly).toBe(true))

    app.dispatch({ type: 'session.back' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    expect(app.snapshot().notice?.tone).not.toBe('error')
    await app.close()
  })

  it('keeps the previous session when the runtime reports it is already open', async () => {
    const host = runtime()
    let previousOpenCount = 0
    host.open = async (sessionId) => {
      host.opens.push(sessionId)
      if (sessionId === 'cocode-session') {
        previousOpenCount += 1
        return { opened: previousOpenCount === 1 }
      }
      return { opened: false }
    }
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'readonly-already-open',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true, sessionRoot: '/missing' },
    })

    await app.start()
    for (let cycle = 0; cycle < 2; cycle += 1) {
      app.dispatch({ type: 'session.open' })
      await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
      app.dispatch({ type: 'sessionTree.confirm' })
      await vi.waitFor(() => expect(app.snapshot().header.readOnly).toBe(true))
      app.dispatch({ type: 'session.back' })
      await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('cocode-session'))
      expect(app.snapshot().header.readOnly).toBe(false)
    }
    await app.close()
  })

  it('opens a different Cocode session after a read-only return falls back', async () => {
    const host = runtime()
    host.listSessions = async () => [
      {
        sessionId: 'other-session',
        createdAt: 2,
        cwd: '/cocode/project',
        title: 'Other session',
      },
    ]
    host.open = async (sessionId, replaceSessionId) => {
      host.opens.push(sessionId)
      if (sessionId === 'cocode-session') {
        throw new Error('previous session is unavailable')
      }
      return {
        opened:
          sessionId === 'other-session' && replaceSessionId === undefined,
      }
    }
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'readonly-switch',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'rpc' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true },
    })

    await app.start()
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    const externalIndex = app
      .snapshot()
      .sessionTreePicker?.items.findIndex((candidate) => candidate.source === 'external')
    expect(externalIndex).toBe(1)
    app.dispatch({ type: 'sessionTree.move', delta: externalIndex ?? 0 })
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.readOnly).toBe(true))

    app.dispatch({ type: 'session.back' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('other-session'))
    expect(app.snapshot().header.source).toBe('cocode')
    expect(app.snapshot().notice?.tone).not.toBe('error')
    expect(host.opens).toEqual(['readonly-switch', 'cocode-session', 'other-session'])
    await app.close()
  })

  it('returns to the latest Cocode session after switching sessions between visits', async () => {
    const host = runtime()
    host.listSessions = async () => [
      {
        sessionId: 'other-session',
        createdAt: 2,
        cwd: '/cocode/project',
        title: 'Other session',
      },
    ]
    host.open = async (sessionId, replaceSessionId) => {
      host.opens.push(sessionId)
      return {
        opened:
          sessionId === 'cocode-session'
            ? replaceSessionId === undefined
            : sessionId === 'other-session' &&
              (replaceSessionId === 'cocode-session' || replaceSessionId === undefined),
      }
    }
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'readonly-latest',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'rpc' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true },
    })

    await app.start()
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    app.dispatch({ type: 'sessionTree.move', delta: 1 })
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.readOnly).toBe(true))
    app.dispatch({ type: 'session.back' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('cocode-session'))

    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('other-session'))

    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    app.dispatch({ type: 'sessionTree.move', delta: 1 })
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.readOnly).toBe(true))
    app.dispatch({ type: 'session.back' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('other-session'))
    expect(app.snapshot().header.readOnly).toBe(false)
    await app.close()
  })

  it('opens a Cocode session that shares a raw id with the active shared session', async () => {
    const host = runtime()
    host.listSessions = async () => [
      {
        sessionId: 'same-id',
        createdAt: 2,
        cwd: '/cocode/project',
        title: 'Cocode copy',
      },
    ]
    const reader = externalReader({
      source: 'shared-dsh',
      canMutate: true,
      concurrency: 'no-concurrent-writes',
      id: 'same-id',
      createdAt: 1,
      path: '/tmp/official-dsh/session.jsonl',
    })
    const app = createTuiApp({
      runtime: host,
      externalDsh: reader,
      cwd: '/cocode/project',
      provider: 'p',
      model: 'm',
      sessionId: 'cocode-session',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'rpc' },
      diagnostics: { tty: true, launchConfigured: true, argsConfigured: true },
    })

    await app.start()
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    const externalIndex = app
      .snapshot()
      .sessionTreePicker?.items.findIndex((candidate) => candidate.source === 'external')
    expect(externalIndex).toBeGreaterThanOrEqual(0)
    app.dispatch({ type: 'sessionTree.move', delta: externalIndex ?? 0 })
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('shared-dsh:same-id'))

    host.opens.length = 0
    app.dispatch({ type: 'session.open' })
    await vi.waitFor(() => expect(app.snapshot().sessionTreePicker?.open).toBe(true))
    const localIndex = app
      .snapshot()
      .sessionTreePicker?.items.findIndex(
        (candidate) => candidate.source === 'rpc' && candidate.session.id === 'same-id',
      )
    expect(localIndex).toBeGreaterThanOrEqual(0)
    app.dispatch({
      type: 'sessionTree.move',
      delta: (localIndex ?? 0) - (app.snapshot().sessionTreePicker?.selected ?? 0),
    })
    app.dispatch({ type: 'sessionTree.confirm' })
    await vi.waitFor(() => expect(host.opens).toEqual(['same-id']))
    expect(app.snapshot().notice?.message).not.toMatch(/Already in this session/)
    await app.close()
  })
})
