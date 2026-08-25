import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../lib/host-jsonrpc-plugin.js'

function createContext(options = {}) {
  const agents = new Map()
  const cleanups = []
  const hooks = Object.create(null)
  let questionProvider
  const userQuestions = {
    provider: undefined,
    registerProvider(provider) {
      if (this.provider !== undefined) {
        const error = new Error('duplicate provider')
        error.code = 'DUPLICATE_PROVIDER'
        throw error
      }
      this.provider = provider
      questionProvider = provider
      return () => {
        if (this.provider === provider) this.provider = undefined
        if (questionProvider === provider) questionProvider = undefined
      }
    },
    ask(request) {
      if (this.provider === undefined) throw new Error('no user-questions provider is registered')
      return this.provider.ask(request)
    },
  }
  if (options.webQuestionAsk !== undefined) {
    userQuestions.registerProvider({ ask: options.webQuestionAsk })
  }
  const ctx = {
    agents: {
      get(id) {
        return agents.get(id)
      },
      async create(options) {
        const agent = {
          id: `agent-${options.sessionId}`,
          ctx: {
            on() {
              return () => {}
            },
          },
          session: {
            id: options.sessionId,
            events: [],
            header: { id: options.sessionId, createdAt: 1, cwd: options.meta?.cwd },
          },
          status: 'idle',
          followup() {},
          steer() {},
          cancel() {},
          async whenIdle() {},
        }
        agents.set(agent.id, agent)
        return { agent, async dispose() {} }
      },
    },
    sessions: {
      forkSeed() {
        return []
      },
    },
    root: { fiber: { async dispose() {} } },
    get(name) {
      if (name === 'userQuestions') {
        return userQuestions
      }
      if (name === 'approval') {
        return options.approval === true ? {} : undefined
      }
      if (name === 'llm') {
        return {
          listProviders() {
            return [{ id: 'deepseek-official' }]
          },
        }
      }
      return undefined
    },
    on(name, listener, options) {
      const prepend = options === true || options?.prepend === true
      const list = (hooks[name] ??= [])
      if (prepend) list.unshift(listener)
      else list.push(listener)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    effect(factory) {
      cleanups.push(factory())
    },
  }
  if (options.webApprovalAsk !== undefined) {
    ctx.on('approval/request', (request, next) => options.webApprovalAsk(request, next))
  }
  return {
    ctx,
    agent(sessionId) {
      return agents.get(`agent-${sessionId}`)
    },
    questionProvider() {
      return questionProvider
    },
    askQuestion(request) {
      return userQuestions.ask(request)
    },
    askApproval(request) {
      const cbs = [...(hooks['approval/request'] ?? [])]
      const inner = () => Promise.resolve('unavailable')
      const next = () => (cbs.shift() ?? inner)(request, next)
      return next()
    },
    async cleanup() {
      for (const cleanup of cleanups.reverse()) await cleanup()
    },
  }
}

function createRpcClient(endpoint) {
  const socket = net.createConnection(endpoint)
  const frames = []
  const waiters = []
  let buffer = ''
  socket.on('data', chunk => {
    buffer += chunk.toString()
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line === '') continue
      const frame = JSON.parse(line)
      const waiterIndex = waiters.findIndex(waiter => waiter.predicate(frame))
      if (waiterIndex < 0) frames.push(frame)
      else waiters.splice(waiterIndex, 1)[0].resolve(frame)
    }
  })
  let nextId = 1
  function waitFor(predicate) {
    const existingIndex = frames.findIndex(predicate)
    if (existingIndex >= 0) return Promise.resolve(frames.splice(existingIndex, 1)[0])
    return new Promise(resolve => waiters.push({ predicate, resolve }))
  }
  async function request(method, params = {}) {
    const id = nextId++
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    const frame = await waitFor(candidate => candidate.id === id)
    if (frame.error !== undefined) throw new Error(frame.error.message)
    return frame.result
  }
  return {
    socket,
    request,
    notification(method, timeoutMs) {
      const notification = waitFor(frame => frame.method === method)
      if (timeoutMs === undefined) return notification
      return Promise.race([
        notification,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), timeoutMs)),
      ])
    },
    close() {
      socket.destroy()
    },
  }
}

async function connectAndInitialize(client) {
  await client.request('cocode/host/connect')
  await client.request('initialize', {
    cwd: '/tmp',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
}

test('routes questions to the client that owns the target session', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cocode-host-jsonrpc-'))
  const endpoint = join(directory, 'host.sock')
  const runtime = createContext()
  apply(runtime.ctx, { endpoint })
  const first = createRpcClient(endpoint)
  const second = createRpcClient(endpoint)
  t.after(async () => {
    first.close()
    second.close()
    await runtime.cleanup()
    rmSync(directory, { recursive: true, force: true })
  })

  await Promise.all([connectAndInitialize(first), connectAndInitialize(second)])
  await second.request('session/prompt', {
    sessionId: 'second-session',
    contentBlocks: [{ type: 'text', text: 'ask me a question' }],
  })

  const ask = runtime.questionProvider().ask({
    agent: runtime.agent('second-session'),
    questions: [{ id: 'experience', question: 'How experienced are you?' }],
  })
  const routed = await Promise.race([
    first.notification('cocode/question/request').then(frame => ({ client: first, name: 'first', frame })),
    second.notification('cocode/question/request').then(frame => ({ client: second, name: 'second', frame })),
  ])
  await routed.client.request('cocode/question/respond', {
    requestId: routed.frame.params.requestId,
    answer: { answers: [{ id: 'experience', selected: [], custom: 'advanced' }] },
  })
  await ask

  assert.equal(routed.name, 'second')
  assert.equal(routed.frame.params.sessionId, 'second-session')
  await assert.rejects(first.notification('cocode/question/request', 20), /timed out/)
})

test('rejects a question when no connected client owns its agent', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cocode-host-jsonrpc-'))
  const endpoint = join(directory, 'host.sock')
  const runtime = createContext()
  apply(runtime.ctx, { endpoint })
  const first = createRpcClient(endpoint)
  const second = createRpcClient(endpoint)
  t.after(async () => {
    first.close()
    second.close()
    await runtime.cleanup()
    rmSync(directory, { recursive: true, force: true })
  })

  await Promise.all([connectAndInitialize(first), connectAndInitialize(second)])

  await assert.rejects(
    runtime.questionProvider().ask({
      agent: { id: 'foreign', session: { id: 'foreign' } },
      questions: [{ id: 'experience', question: 'How experienced are you?' }],
    }),
    /no connected TUI owns the question request/,
  )
})

test('routes questions to the owning TUI when a web provider is already registered', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cocode-host-jsonrpc-'))
  const endpoint = join(directory, 'host.sock')
  const webAsks = []
  const runtime = createContext({
    webQuestionAsk(request) {
      webAsks.push(request)
      return new Promise(() => {})
    },
  })
  apply(runtime.ctx, { endpoint })
  const client = createRpcClient(endpoint)
  t.after(async () => {
    client.close()
    await runtime.cleanup()
    rmSync(directory, { recursive: true, force: true })
  })

  await connectAndInitialize(client)
  await client.request('session/prompt', {
    sessionId: 'tui-session',
    contentBlocks: [{ type: 'text', text: 'ask me a question' }],
  })

  const live = runtime.agent('tui-session')
  const ask = runtime.askQuestion({
    agent: live,
    questions: [{ id: 'next', question: 'What next?' }],
  })
  const frame = await client.notification('cocode/question/request', 200)
  await client.request('cocode/question/respond', {
    requestId: frame.params.requestId,
    answer: { answers: [{ id: 'next', selected: [], custom: 'ship the panel' }] },
  })
  await ask

  assert.equal(frame.params.sessionId, 'tui-session')
  assert.equal(webAsks.length, 0)
})

test('routes questions by session id when the agent object is not the stored instance', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cocode-host-jsonrpc-'))
  const endpoint = join(directory, 'host.sock')
  const runtime = createContext()
  apply(runtime.ctx, { endpoint })
  const client = createRpcClient(endpoint)
  t.after(async () => {
    client.close()
    await runtime.cleanup()
    rmSync(directory, { recursive: true, force: true })
  })

  await connectAndInitialize(client)
  await client.request('session/prompt', {
    sessionId: 'tui-session',
    contentBlocks: [{ type: 'text', text: 'ask me a question' }],
  })

  const live = runtime.agent('tui-session')
  const ask = runtime.askQuestion({
    agent: { ...live, session: { ...live.session } },
    questions: [{ id: 'next', question: 'What next?' }],
  })
  const frame = await client.notification('cocode/question/request', 200)
  await client.request('cocode/question/respond', {
    requestId: frame.params.requestId,
    answer: { answers: [{ id: 'next', selected: [], custom: 'ship the panel' }] },
  })
  await ask

  assert.equal(frame.params.sessionId, 'tui-session')
})

test('routes approvals to the TUI that owns the session before the web handler', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cocode-host-jsonrpc-'))
  const endpoint = join(directory, 'host.sock')
  const webAsks = []
  const runtime = createContext({
    approval: true,
    webApprovalAsk() {
      webAsks.push('web')
      return new Promise(() => {})
    },
  })
  apply(runtime.ctx, { endpoint })
  const client = createRpcClient(endpoint)
  t.after(async () => {
    client.close()
    await runtime.cleanup()
    rmSync(directory, { recursive: true, force: true })
  })

  await connectAndInitialize(client)
  await client.request('session/prompt', {
    sessionId: 'tui-session',
    contentBlocks: [{ type: 'text', text: 'escalate permissions' }],
  })

  const live = runtime.agent('tui-session')
  const ask = runtime.askApproval({
    agent: live,
    toolName: 'bash',
    reason: 'escalate to danger-full-access',
  })
  const frame = await client.notification('cocode/approval/request', 200)
  await client.request('cocode/approval/respond', {
    requestId: frame.params.requestId,
    outcome: 'allowed-once',
  })
  await ask

  assert.equal(frame.params.sessionId, 'tui-session')
  assert.equal(frame.params.toolName, 'bash')
  assert.equal(webAsks.length, 0)
})

test('falls through to the web approval handler when no TUI owns the session', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cocode-host-jsonrpc-'))
  const endpoint = join(directory, 'host.sock')
  const webAsks = []
  const runtime = createContext({
    approval: true,
    webApprovalAsk(request) {
      webAsks.push(request.agent.session.id)
      return Promise.resolve('rejected')
    },
  })
  apply(runtime.ctx, { endpoint })
  const client = createRpcClient(endpoint)
  t.after(async () => {
    client.close()
    await runtime.cleanup()
    rmSync(directory, { recursive: true, force: true })
  })

  await connectAndInitialize(client)

  const outcome = await runtime.askApproval({
    agent: { id: 'foreign', session: { id: 'foreign', events: [] } },
    toolName: 'bash',
  })

  assert.equal(outcome, 'rejected')
  assert.deepEqual(webAsks, ['foreign'])
  await assert.rejects(client.notification('cocode/approval/request', 20), /timed out/)
})
