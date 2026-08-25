import test from 'node:test'
import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { TuiCompanionGateway } from '../lib/host-jsonrpc-plugin.js'

function createContext(options = {}) {
  const followed = []
  const created = []
  let activeAgent
  const providers = options.providers ?? [{ id: 'deepseek-official', name: 'DeepSeek' }]
  const ctx = {
    agents: {
      get(id) {
        return activeAgent?.id === id || activeAgent?.session.id === id ? activeAgent : undefined
      },
      async create(agentOptions) {
        const listeners = new Map()
        const agentContext = {
          agent: undefined,
          on(event, handler) {
            listeners.set(event, handler)
            return () => listeners.delete(event)
          },
          listeners,
        }
        activeAgent = {
          id: 'agent-1',
          options: agentOptions,
          ctx: agentContext,
          session: {
            id: agentOptions.sessionId,
            events: [],
            header: {
              id: agentOptions.sessionId,
              createdAt: 1,
              cwd: agentOptions.meta?.cwd,
              ...(typeof agentOptions.meta?.agentPreset === 'string'
                ? { agentPreset: agentOptions.meta.agentPreset }
                : {}),
            },
          },
          status: 'idle',
          followup(message) {
            followed.push(message)
          },
          steer() {},
          cancel() {},
          async whenIdle() {},
        }
        agentContext.agent = activeAgent
        if (typeof agentOptions.setup === 'function') {
          await agentOptions.setup(agentContext)
        }
        created.push(activeAgent)
        return { agent: activeAgent, async dispose() {} }
      },
      async resume(agentOptions) {
        if (typeof options.resume === 'function') {
          const result = await options.resume(agentOptions)
          activeAgent = result.agent
          return result
        }
        throw new Error('resume is not used by this test')
      },
    },
    sessions: {
      forkSeed() {
        return []
      },
    },
    root: { fiber: { async dispose() {} } },
    get(name) {
      if (name === 'llm') {
        return {
          listProviders() {
            return typeof options.listProviders === 'function' ? options.listProviders() : providers
          },
          async listModels() {
            return options.listed === false ? [] : [{
              id: 'deepseek-v4-flash',
              name: 'DeepSeek V4 Flash',
              inputModalities: options.inputModalities ?? ['text'],
              ...options.listedModel,
            }]
          },
          async resolveModelInfo(_provider, model) {
            if (options.resolveModelInfo !== undefined) {
              return options.resolveModelInfo(_provider, model)
            }
            return {
              id: model,
              inputModalities: options.resolvedInputModalities ?? options.inputModalities ?? ['text'],
            }
          },
          async resolveCallConfig({ provider, model }) {
            if (options.resolveCallConfig !== undefined) {
              return options.resolveCallConfig({ provider, model })
            }
            if (provider !== 'deepseek-official') {
              throw new Error(`unknown provider: ${provider}`)
            }
            return { provider, model }
          },
        }
      }
      if (name === 'skills') return options.skills
      if (name === 'commands') return options.commands
      if (name === 'agentPresets') return options.agentPresets
      if (name === 'loader') {
        return options.loader ?? {
          entries() {
            return []
          },
        }
      }
      if (name === 'workspaceRegistry') return options.workspaceRegistry
      if (name === 'attachments') return options.attachments
      if (name === 'sessionPersistence') return options.sessionPersistence
      if (name === 'sessionTitle') return options.sessionTitle
      return undefined
    },
    on() {
      return () => undefined
    },
  }
  return { ctx, followed, created }
}

function createGateway(ctx) {
  return new TuiCompanionGateway(ctx, { notify() {} }, { registerQuestionProvider: false })
}

async function initialize(gateway) {
  await gateway.initialize({
    cwd: '/tmp',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
}

test('waits for a settings-backed provider that registers after initialize starts', async () => {
  const providers = []
  const { ctx } = createContext({
    listProviders() {
      return providers
    },
  })
  const gateway = createGateway(ctx)
  const pending = gateway.initialize({
    cwd: '/tmp',
    provider: 'cocode-nut',
    model: 'deepseek-v4-flash',
  })
  await new Promise((resolve) => setTimeout(resolve, 80))
  providers.push({ id: 'cocode-nut', name: 'Cocode Nut' })
  await pending
})

test('forwards canonical command images to the DSH command registry', async () => {
  let received
  const { ctx } = createContext({
    commands: {
      list() { return [{ name: 'inspect', description: 'Inspect an image', input: { hint: '<text>', images: true } }] },
      async execute(_agent, line, images) {
        received = { line, images }
        return { commandId: 'command-1', result: { kind: 'success', text: 'ok' } }
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  const result = await gateway.handleRequest('commands/execute', {
    sessionId: 'command-images',
    line: '/inspect describe',
    images: [{ data: 'AQID', mediaType: 'image/png', name: 'shot.png' }],
  })

  assert.deepEqual(result, {
    commandId: 'command-1',
    result: { kind: 'success', text: 'ok' },
  })
  assert.deepEqual(received, {
    line: '/inspect describe',
    images: [{ data: 'AQID', mediaType: 'image/png', name: 'shot.png' }],
  })
})

const imageBlock = {
  type: 'image',
  attachment: {
    attachmentId: 'image-1',
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
  },
}

test('keeps rc2 image metadata and uses the batch attachment store', async () => {
  const saved = []
  const attachments = {
    imageLimits: {
      maxImageBytes: 1024,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 2048,
      maxImagePixels: 1024 * 1024,
      maxImageDimension: 4096,
      mediaTypes: ['image/png'],
    },
    async saveImages(images) {
      saved.push(...images)
      return [{
        attachmentId: 'image-rc2',
        mediaType: 'image/png',
        bytes: 3,
        width: 1,
        height: 1,
        originalDimensions: { width: 2, height: 3 },
        name: 'sample.png',
      }]
    },
  }
  const { ctx } = createContext({ attachments })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  const result = await gateway.handleRequest('cocode/attachment/saveImages', {
    images: [{
      data: Buffer.from('abc').toString('base64'),
      mediaType: 'image/png',
      name: 'sample.png',
    }],
  })

  assert.deepEqual(saved, [{ data: Buffer.from('abc'), mediaType: 'image/png', name: 'sample.png' }])
  assert.deepEqual(result.attachments[0].originalDimensions, { width: 2, height: 3 })
})

test('exposes session create, history, and content search through the companion', async () => {
  const { ctx } = createContext({
    sessionPersistence: {
      async list() {
        return [{ id: 'persisted-1', createdAt: 1, cwd: '/tmp' }]
      },
      async inspect() {
        return {
          meta: { id: 'persisted-1', createdAt: 1, cwd: '/tmp' },
          events: [{ type: 'user/message', seq: 0, time: 2, data: { content: [{ type: 'text', text: 'find this phrase' }] } }],
        }
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual(await gateway.createSessionRpc({ sessionId: 'created-1' }), { sessionId: 'created-1' })
  assert.deepEqual(await gateway.history({ sessionId: 'created-1' }), { events: [], hasMore: false })
  assert.deepEqual(await gateway.searchSessions({ query: 'phrase' }), {
    items: [{ sessionId: 'persisted-1', snippet: 'find this phrase' }],
    hasMore: false,
  })
})

test('normalizes session and queue failures to stable business codes', async () => {
  const { ctx } = createContext()
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await assert.rejects(
    gateway.handleRequest('cocode/session/rename', { sessionId: 'missing', title: 'Renamed' }),
    (error) => {
      assert.equal(error.code, 'session-not-found')
      assert.deepEqual(error.details, { sessionId: 'missing' })
      return true
    },
  )

  await gateway.prompt({ sessionId: 'queue-session', contentBlocks: [{ type: 'text', text: 'hello' }] })
  ctx.agents.get('queue-session').inbox = { nextTurn: [], nextStep: [] }
  await assert.rejects(
    gateway.handleRequest('cocode/session/updateQueue', {
      sessionId: 'queue-session',
      itemId: 'missing-item',
      action: { kind: 'remove' },
    }),
    (error) => {
      assert.equal(error.code, 'queue-item-not-found')
      assert.deepEqual(error.details, { itemId: 'missing-item' })
      return true
    },
  )
})

test('renames a persisted cold session by resuming its recorded identity', async () => {
  const resumed = []
  const { ctx } = createContext({
    sessionPersistence: {
      async list() { return [{ id: 'cold-rename', createdAt: 1, cwd: '/tmp' }] },
      async inspect() {
        return { meta: { id: 'cold-rename', createdAt: 1, cwd: '/tmp' }, events: [] }
      },
    },
    sessionTitle: {
      rename(session, title) {
        return { title: title.trim(), eventSeq: session.events.length }
      },
    },
    async resume({ resumeSessionId }) {
      const agent = {
        id: 'resumed-agent',
        ctx: { on() { return () => undefined } },
        session: { id: resumeSessionId, events: [], header: { id: resumeSessionId, createdAt: 1, cwd: '/tmp' } },
        status: 'idle',
        followup() {},
        steer() {},
        cancel() {},
        async whenIdle() {},
      }
      resumed.push(resumeSessionId)
      return { agent, async dispose() {} }
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual(await gateway.handleRequest('cocode/session/rename', { sessionId: 'cold-rename', title: '  Renamed  ' }), {
    title: 'Renamed',
    seq: 0,
  })
  assert.deepEqual(resumed, ['cold-rename'])
})

test('rejects queue steering unless the item is a running next-turn message', async () => {
  const { ctx } = createContext()
  const gateway = createGateway(ctx)
  await initialize(gateway)
  await gateway.prompt({ sessionId: 'queue-steer', contentBlocks: [{ type: 'text', text: 'hello' }] })
  const agent = ctx.agents.get('queue-steer')
  agent.inbox = {
    nextTurn: [{ id: 'next-turn', role: 'user', content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } }],
    nextStep: [{ id: 'next-step', role: 'user', content: [{ type: 'text', text: 'steering' }], source: { kind: 'user' } }],
    replace() {},
    remove() {},
  }
  await assert.rejects(
    gateway.handleRequest('cocode/session/updateQueue', {
      sessionId: 'queue-steer', itemId: 'next-step', action: { kind: 'steer' },
    }),
    (error) => {
      assert.equal(error.code, 'steer-unavailable')
      assert.deepEqual(error.details, { itemId: 'next-step' })
      return true
    },
  )
  await assert.rejects(
    gateway.handleRequest('cocode/session/updateQueue', {
      sessionId: 'queue-steer', itemId: 'next-turn', action: { kind: 'steer' },
    }),
    (error) => {
      assert.equal(error.code, 'steer-unavailable')
      return true
    },
  )
  agent.status = 'running'
  await gateway.handleRequest('cocode/session/updateQueue', {
    sessionId: 'queue-steer', itemId: 'next-turn', action: { kind: 'steer' },
  })
})

test('returns history entries with message-aligned pagination for cold sessions', async () => {
  const events = [
    { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'first' }] } },
    { type: 'assistant/chunk', seq: 1, time: 2, data: { chunk: { text: 'partial first' } } },
    { type: 'assistant/message', seq: 2, time: 3, data: { content: [{ type: 'text', text: 'answer' }] } },
    { type: 'user/message', seq: 3, time: 4, data: { content: [{ type: 'text', text: 'second' }] } },
    { type: 'assistant/message', seq: 4, time: 5, data: { content: [{ type: 'text', text: 'second answer' }] } },
  ]
  const { ctx } = createContext({
    sessionPersistence: {
      async list() { return [{ id: 'cold-history', createdAt: 1, cwd: '/tmp' }] },
      async inspect() { return { meta: { id: 'cold-history', createdAt: 1, cwd: '/tmp' }, events } },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  const page = await gateway.history({ sessionId: 'cold-history', maxMessages: 2 })
  assert.equal(page.hasMore, true)
  assert.deepEqual(page.events.map((entry) => entry.event.seq), [3, 4])
  assert.deepEqual(page.events[0], { event: events[3] })
  const older = await gateway.history({ sessionId: 'cold-history', beforeSeq: 3, maxMessages: 2 })
  assert.deepEqual(older.events.map((entry) => entry.event.seq), [0, 1, 2])
})

test('rejects a subagent history request whose mode no longer matches the catalog', async () => {
  const { ctx } = createContext({
    sessionPersistence: {
      async list() {
        return [{ id: 'child-one-shot', createdAt: 1, cwd: '/tmp', origin: 'subagent', parentSession: 'parent-1', seedLength: 0 }]
      },
      async inspect() {
        return {
          meta: { id: 'child-one-shot', createdAt: 1, cwd: '/tmp', origin: 'subagent', parentSession: 'parent-1', seedLength: 0 },
          events: [{ type: 'subagent/descriptor', seq: 0, time: 1, data: { mode: 'one-shot' } }],
        }
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await assert.rejects(
    gateway.handleRequest('cocode/subagent/history', {
      parentSessionId: 'parent-1',
      childSessionId: 'child-one-shot',
      mode: 'continuable',
    }),
    (error) => {
      assert.equal(error.code, 'subagent-not-found')
      assert.deepEqual(error.details, { parentSessionId: 'parent-1', childSessionId: 'child-one-shot' })
      return true
    },
  )
})

test('reads cold session metadata and model selection without creating an Agent', async () => {
  const { ctx, created } = createContext({
    sessionPersistence: {
      async list() {
        return [{ id: 'cold-1', createdAt: 1, cwd: '/tmp', agentPreset: 'minimal' }]
      },
      async inspect() {
        return {
          meta: { id: 'cold-1', createdAt: 1, cwd: '/tmp', agentPreset: 'minimal' },
          events: [
            {
              type: 'request/header',
              seq: 1,
              time: 2,
              data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } } },
            },
          ],
        }
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual((await gateway.listSessions({ cwd: '/tmp' })).sessions[0], {
    sessionId: 'cold-1',
    createdAt: 1,
    updatedAt: 1,
    running: false,
    blank: true,
    cwd: '/tmp',
    agentPreset: 'minimal',
    eventCount: 1,
  })
  assert.deepEqual(await gateway.sessionModels({ sessionId: 'cold-1' }), {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
    }],
    failures: [],
  })
  assert.equal(created.length, 0)
})

test('reads an attachment referenced by a cold session', async () => {
  const attachments = {
    async readImage(ref) {
      return { ref, data: Buffer.from('image-bytes') }
    },
  }
  const { ctx } = createContext({
    attachments,
    sessionPersistence: {
      async list() {
        return [{ id: 'cold-image', createdAt: 1, cwd: '/tmp' }]
      },
      async inspect() {
        return {
          meta: { id: 'cold-image', createdAt: 1, cwd: '/tmp' },
          events: [{
            type: 'user/message',
            seq: 1,
            time: 2,
            data: {
              content: [{ type: 'image', attachment: {
                attachmentId: 'image-1', mediaType: 'image/png', bytes: 11, width: 2, height: 3,
              } }],
            },
          }],
        }
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)
  const result = await gateway.readAttachment({ sessionId: 'cold-image', attachmentId: 'image-1' })
  assert.equal(result.data, Buffer.from('image-bytes').toString('base64'))
  assert.equal(result.attachment.attachmentId, 'image-1')
})

test('rejects unsupported images before they enter the session', async () => {
  const { ctx, followed, created } = createContext()
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await assert.rejects(
    gateway.prompt({ sessionId: 's1', contentBlocks: [imageBlock] }),
    /does not support image content/i,
  )
  assert.equal(followed.length, 0)
  assert.equal(created.length, 0)
})

test('asks for workspace authorization before creating a session', async () => {
  let createdWorkspaces = 0
  const { ctx, created } = createContext({
    workspaceRegistry: {
      async resolveByPath() {
        return undefined
      },
      async create() {
        createdWorkspaces += 1
        throw new Error('workspace should not be created before approval')
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await assert.deepEqual(
    await gateway.handleRequest('cocode/workspace/ensure', { sessionId: 's1' }),
    {
      status: 'authorization-required',
      path: await realpath('/tmp'),
      title: 'tmp',
    },
  )
  assert.equal(created.length, 0)
  assert.equal(createdWorkspaces, 0)
})

test('creates and attaches a workspace only after approval', async () => {
  const attached = []
  const workspace = {
    id: 'workspace-1',
    path: '/tmp',
    title: 'tmp',
    async attachSession(sessionId) {
      attached.push(sessionId)
    },
  }
  let createdWorkspaces = 0
  const { ctx, created } = createContext({
    workspaceRegistry: {
      async resolveByPath() {
        return undefined
      },
      async create() {
        createdWorkspaces += 1
        return workspace
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual(
    await gateway.ensureWorkspace({ sessionId: 's1', approved: true }),
    {
      status: 'ready',
      workspaceId: 'workspace-1',
      path: '/tmp',
      title: 'tmp',
      created: true,
    },
  )
  assert.equal(created.length, 1)
  assert.equal(createdWorkspaces, 1)
  assert.deepEqual(attached, ['s1'])
})

test('reuses an existing workspace without asking for authorization', async () => {
  const attached = []
  const workspace = {
    id: 'workspace-1',
    path: '/tmp',
    title: 'tmp',
    async attachSession(sessionId) {
      attached.push(sessionId)
    },
  }
  let createdWorkspaces = 0
  const { ctx, created } = createContext({
    workspaceRegistry: {
      async resolveByPath() {
        return workspace
      },
      async create() {
        createdWorkspaces += 1
        return workspace
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual(
    await gateway.ensureWorkspace({ sessionId: 's1' }),
    {
      status: 'ready',
      workspaceId: 'workspace-1',
      path: '/tmp',
      title: 'tmp',
      created: false,
    },
  )
  assert.equal(created.length, 1)
  assert.equal(createdWorkspaces, 0)
  assert.deepEqual(attached, ['s1'])
})

test('passes images directly to models that declare native image input', async () => {
  const { ctx, followed } = createContext({ inputModalities: ['text', 'image'] })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await gateway.prompt({ sessionId: 's1', contentBlocks: [imageBlock] })

  assert.deepEqual(followed[0]?.content, [imageBlock])
})

test('mounts the default agent preset before creating a TUI session', async () => {
  const mounted = []
  const { ctx, followed } = createContext({
    agentPresets: {
      async resolve(id) {
        return { id: id ?? 'standard' }
      },
      async mount(_agentCtx, id) {
        mounted.push(id)
        return { id: id ?? 'standard' }
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await gateway.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })

  assert.deepEqual(mounted, ['standard'])
  assert.equal(followed.length, 1)
})

test('restores the latest preset selected in a persisted session log', async () => {
  const mounted = []
  const { ctx } = createContext({
    agentPresets: {
      async resolve(id) {
        return { id: id ?? 'standard' }
      },
      async mount(_agentCtx, id) {
        mounted.push(id)
      },
    },
  })
  const originalGet = ctx.get.bind(ctx)
  ctx.get = name => name === 'sessionPersistence'
    ? {
        async inspect() {
          return {
            meta: { id: 'persisted', createdAt: 1, cwd: '/tmp', agentPreset: 'standard' },
            events: [{
              type: 'agent-preset/selected',
              seq: 1,
              time: 1,
              data: { agentPreset: 'minimal' },
            }],
          }
        },
      }
    : originalGet(name)
  ctx.agents.resume = async agentOptions => ctx.agents.create({
    sessionId: 'persisted',
    meta: { cwd: '/tmp' },
    setup: agentOptions.setup,
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await gateway.open({ sessionId: 'persisted' })

  assert.deepEqual(mounted, ['minimal'])
})

test('inherits the source session preset when forking a TUI session', async () => {
  const mounted = []
  const { ctx, created } = createContext({
    agentPresets: {
      async resolve(id) {
        return { id: id ?? 'standard' }
      },
      async mount(_agentCtx, id) {
        mounted.push(id)
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await gateway.prompt({ sessionId: 'source', contentBlocks: [{ type: 'text', text: 'hello' }] })
  created[0].session.events.push({
    type: 'agent-preset/selected',
    seq: 1,
    time: 1,
    data: { agentPreset: 'minimal' },
  })

  await gateway.fork({ sourceSessionId: 'source', childSessionId: 'child' })

  assert.deepEqual(mounted, ['standard', 'minimal'])
  assert.equal(created[1].options.meta.agentPreset, 'minimal')
})

test('uses exact model capabilities when a native vision model is not listed', async () => {
  const { ctx, followed } = createContext({
    listed: false,
    resolvedInputModalities: ['text', 'image'],
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await gateway.prompt({ sessionId: 's1', contentBlocks: [imageBlock] })

  assert.deepEqual(followed[0]?.content, [imageBlock])
})

test('switches the live session model without creating a new agent', async () => {
  const { ctx, created } = createContext()
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await gateway.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })
  const agent = created[0]
  const selected = await gateway.handleRequest('session.selectModel', {
    sessionId: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
  })

  assert.deepEqual(selected, {
    selected: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-reasoner',
    },
  })
  assert.equal(created.length, 1)

  const assemble = agent.ctx.listeners.get('system-prompt/assemble')
  const request = agent.ctx.listeners.get('agent/request')
  assert.equal(typeof assemble, 'function')
  assert.equal(typeof request, 'function')
  await assemble({}, {}, async () => ({ variables: {} }))
  assert.deepEqual(await request({}, async () => ({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })), {
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
  })
})

test('keeps a selected model scoped to its session', async () => {
  const { ctx, created } = createContext()
  const gateway = createGateway(ctx)
  await initialize(gateway)

  await gateway.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })
  await gateway.handleRequest('session.selectModel', {
    sessionId: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
  })
  await gateway.prompt({ sessionId: 's2', contentBlocks: [{ type: 'text', text: 'new session' }] })

  assert.equal(created[1].options.agentOptions.provider, 'deepseek-official')
  assert.equal(created[1].options.agentOptions.model, 'deepseek-v4-flash')
})

test('keeps the model selection when a companion reconnects to the same agent', async () => {
  const { ctx, created } = createContext()
  const first = createGateway(ctx)
  await initialize(first)
  await first.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })
  await first.handleRequest('session.selectModel', {
    sessionId: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
  })
  await first.disconnect()

  const second = createGateway(ctx)
  await initialize(second)
  const opened = await second.open({ sessionId: 's1' })
  assert.equal(opened.opened, true)
  const assemble = created[0].ctx.listeners.get('system-prompt/assemble')
  const request = created[0].ctx.listeners.get('agent/request')
  await assemble({}, {}, async () => ({ variables: {} }))
  assert.deepEqual(await request({}, async () => ({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })), {
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
  })
  const selected = await second.handleRequest('session.selectModel', {
    sessionId: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })

  assert.deepEqual(selected, {
    selected: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    },
  })
  assert.equal(created.length, 1)
})

test('switches the model for the next step even if the agent is running', async () => {
  const { ctx, created } = createContext()
  const gateway = createGateway(ctx)
  await initialize(gateway)
  await gateway.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })
  created[0].status = 'running'

  assert.deepEqual(await gateway.handleRequest('session.selectModel', {
    sessionId: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
  }), {
    selected: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-reasoner',
    },
  })
})

test('reports invalid model selections without changing the live session', async () => {
  const { ctx, created } = createContext({
    resolveCallConfig: async ({ provider, model }) => {
      if (model === 'missing-model') throw new Error(`model unavailable: ${provider}/${model}`)
      return { provider, model }
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)
  await gateway.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })

  await assert.rejects(
    gateway.handleRequest('session.selectModel', {
      sessionId: 's1',
      provider: 'deepseek-official',
      model: 'missing-model',
    }),
    /model unavailable/i,
  )
  assert.equal(created.length, 1)
})

test('keeps the current model when the new model cannot handle session images', async () => {
  const { ctx, created } = createContext({
    resolveModelInfo: async (_provider, model) => ({
      inputModalities: model === 'text-only' ? ['text'] : ['text', 'image'],
    }),
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)
  await gateway.prompt({ sessionId: 's1', contentBlocks: [imageBlock] })
  created[0].session.deriveMessages = () => [{ content: [imageBlock] }]

  await assert.rejects(
    gateway.handleRequest('session.selectModel', {
      sessionId: 's1',
      provider: 'deepseek-official',
      model: 'text-only',
    }),
    /does not accept image input/i,
  )
  const request = created[0].ctx.listeners.get('agent/request')
  const assemble = created[0].ctx.listeners.get('system-prompt/assemble')
  await assemble({}, {}, async () => ({ variables: {} }))
  assert.deepEqual(await request({}, async () => ({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })), {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
})

test('includes adapter reasoning metadata in the model catalog', async () => {
  const reasoning = {
    defaultEffort: 'high',
    efforts: [
      { id: 'high', name: 'High' },
      { id: 'max', name: 'Max', description: 'Slowest' },
    ],
  }
  const { ctx } = createContext({
    listedModel: { reasoning },
    resolveModelInfo: async () => ({
      inputModalities: ['text'],
      reasoning,
    }),
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual(await gateway.handleRequest('model/list'), {
    groups: [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          {
            id: 'deepseek-v4-flash',
            name: 'DeepSeek V4 Flash',
            reasoning,
          },
        ],
      },
    ],
    failures: [],
  })
})

test('applies reasoning effort to the live session model selection', async () => {
  const { ctx, created } = createContext()
  const gateway = createGateway(ctx)
  await initialize(gateway)
  await gateway.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })

  assert.deepEqual(await gateway.handleRequest('session.selectModel', {
    sessionId: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
    reasoningEffort: 'max',
  }), {
    selected: {
      provider: 'deepseek-official',
      model: 'deepseek-v4-reasoner',
      reasoningEffort: 'max',
    },
  })

  const assemble = created[0].ctx.listeners.get('system-prompt/assemble')
  const request = created[0].ctx.listeners.get('agent/request')
  await assemble({}, {}, async () => ({ variables: {} }))
  assert.deepEqual(await request({}, async () => ({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
  })), {
    provider: 'deepseek-official',
    model: 'deepseek-v4-reasoner',
    reasoningEffort: 'max',
  })
})

test('lists skills from the current agent scope', async () => {
  const lookups = []
  const { ctx } = createContext({
    skills: {
      async list(lookup) {
        lookups.push(lookup)
        if (lookup.scope === undefined) return []
        return [
          {
            name: 'code-review',
            description: 'Review the current change',
            source: 'user-agents',
            invocation: { userInvocable: true },
          },
        ]
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual(await gateway.listSkills({ sessionId: 's1' }), {
    skills: [
      {
        name: 'code-review',
        description: 'Review the current change',
        source: 'user-agents',
      },
    ],
  })
  assert.equal(lookups.length, 1)
  assert.equal(lookups[0].cwd, '/tmp')
  assert.equal(lookups[0].scope.session.id, 's1')
})

test('lists non-group loader entries with enablement and fiber phase', async () => {
  const entries = [
    { id: 'active-plugin', options: { name: '@deepseek-ai/dsh-tools' }, fiber: { state: 2 } },
    { id: 'disabled-plugin', disabled: true, options: { name: '@deepseek-ai/dsh-web' }, fiber: { state: 4 } },
    { id: 'group', options: { name: 'group', group: true }, fiber: { state: 2 } },
  ]
  const { ctx } = createContext({
    loader: {
      * entries() {
        yield* entries
      },
    },
  })
  const gateway = createGateway(ctx)
  await initialize(gateway)

  assert.deepEqual(gateway.capabilities().plugins, true)
  assert.deepEqual(gateway.capabilities().pluginsMutate, true)
  assert.deepEqual(gateway.listPlugins(), {
    plugins: [
      {
        entryId: 'active-plugin',
        moduleName: '@deepseek-ai/dsh-tools',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: 'disabled-plugin',
        moduleName: '@deepseek-ai/dsh-web',
        enabled: false,
        fiberPhase: null,
      },
    ],
  })

  entries[0].update = async ({ disabled }) => {
    entries[0].disabled = disabled
    entries[0].fiber = disabled ? { state: 4 } : { state: 2 }
  }
  assert.deepEqual(
    await gateway.setPluginEnabled({ entryId: 'active-plugin', enabled: false }),
    {
      entryId: 'active-plugin',
      moduleName: '@deepseek-ai/dsh-tools',
      enabled: false,
      fiberPhase: null,
    },
  )
})
