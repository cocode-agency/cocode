import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TuiCapabilitySnapshot,
  TuiCommandDescriptor,
  SessionEvent,
  TuiNotification,
  TuiQuestionAnswer,
  TuiQuestionRequest,
  TuiRuntime,
  TuiPromptMode,
  TuiModelCatalog,
  TuiImageInput,
  TuiWorkspaceEnsureResult,
} from '@cocode/tui-connection'
import { createTuiApp } from '../../src/runtime/app.ts'
import { P0_CAPABILITIES } from '../../src/runtime/capabilities.ts'

function reasoningCatalog(): TuiModelCatalog {
  return {
    groups: [
      {
        id: 'p1',
        name: 'Provider 1',
        models: [
          {
            id: 'm1',
            name: 'Model 1',
            reasoning: {
              efforts: [
                { id: 'high', name: 'High' },
                { id: 'max', name: 'Max' },
              ],
              defaultEffort: 'high',
            },
          },
        ],
      },
    ],
    failures: [],
  }
}

function fakeRuntime(): TuiRuntime & {
  prompts: { sessionId: string; text: string }[]
  promptBlocks: { sessionId: string; blocks: { type: string; [key: string]: unknown }[]; mode: TuiPromptMode }[]
  savedImages: TuiImageInput[][]
  emit: (n: TuiNotification) => void
  emitClose: (error?: string) => void
  closeCount: number
  restarts: { provider: string; model: string }[]
  cancels: { sessionId: string; keepInbox: boolean }[]
  opens: { sessionId: string; replaceSessionId?: string }[]
  rewinds: { sourceSessionId: string; messageSeq: number; replaceSessionId?: string }[]
  rewindSeed?: SessionEvent[]
  askQuestion: (request: TuiQuestionRequest) => Promise<TuiQuestionAnswer>
  failStart?: Error
  cancelError?: Error
  failRestartModels: Set<string>
  modelCatalog: TuiModelCatalog
  selectModel?: (
    sessionId: string,
    provider: string,
    model: string,
    reasoningEffort?: string,
  ) => Promise<{ provider: string; model: string; reasoningEffort?: string } | undefined>
  modelListError?: Error
  commands: TuiCommandDescriptor[]
  executedCommands: { sessionId: string; line: string; images?: TuiImageInput[] }[]
  plugins: { entryId: string; moduleName: string; enabled: boolean; fiberPhase: 'active' | null }[]
  setPluginEnabled: (entryId: string, enabled: boolean) => Promise<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: 'active' | null }>
  workspaceEnsures: { sessionId: string; approved: boolean }[]
  workspaceEnsureResults: TuiWorkspaceEnsureResult[]
} {
  const handlers = new Set<(n: TuiNotification) => void>()
  const closeHandlers = new Set<(error?: string) => void>()
  let questionHandler: ((request: TuiQuestionRequest) => Promise<TuiQuestionAnswer>) | undefined
  const runtime: TuiRuntime & {
    prompts: { sessionId: string; text: string; mode?: TuiPromptMode }[]
    emit: (n: TuiNotification) => void
    failStart?: Error
  } = {
    prompts: [],
    promptBlocks: [],
    savedImages: [],
    closeCount: 0,
    restarts: [],
    cancels: [],
    opens: [],
    rewinds: [],
    failRestartModels: new Set(),
    modelCatalog: { groups: [], failures: [] },
    selectModel: undefined,
    commands: [],
    executedCommands: [],
    plugins: [],
    workspaceEnsures: [],
    workspaceEnsureResults: [{ status: 'unsupported', path: '/tmp', reason: 'test runtime' }],
    emit(n) {
      for (const handler of handlers) handler(n)
    },
    emitClose(error) {
      for (const handler of closeHandlers) handler(error)
    },
    async start() {
      if (runtime.failStart) throw runtime.failStart
      return { name: 'fake-runtime', version: '0' }
    },
    async restart(init) {
      runtime.restarts.push({
        provider: init.provider,
        model: init.model,
      })
      if (runtime.failRestartModels.delete(init.model)) {
        throw new Error(`failed to start ${init.model}`)
      }
      await runtime.close()
      return runtime.start()
    },
    async prompt(sessionId, blocks, mode = 'normal') {
      const text = typeof blocks[0]?.text === 'string' ? blocks[0].text : ''
      runtime.prompts.push({ sessionId, text, ...(mode === 'normal' ? {} : { mode }) })
      runtime.promptBlocks.push({ sessionId, blocks, mode })
      return 'mid-1'
    },
    async saveImages(images) {
      runtime.savedImages.push([...images])
      return images.map((image, index) => ({
        attachmentId: `fake-image-${index}`,
        mediaType: image.mediaType,
        bytes: image.data.byteLength,
        width: 1,
        height: 1,
        ...(image.name === undefined ? {} : { name: image.name }),
      }))
    },
    async listModels() {
      if (runtime.modelListError !== undefined) throw runtime.modelListError
      return runtime.modelCatalog
    },
    async listCommands() {
      return runtime.commands
    },
    async listPlugins() {
      return runtime.plugins
    },
    async setPluginEnabled(entryId, enabled) {
      const plugin = runtime.plugins.find((candidate) => candidate.entryId === entryId)
      if (plugin === undefined) throw new Error(`plugin entry not found: ${entryId}`)
      plugin.enabled = enabled
      plugin.fiberPhase = enabled ? 'active' : null
      return plugin
    },
    async executeCommand(sessionId, line, images = []) {
      runtime.executedCommands.push({
        sessionId,
        line,
        ...(images.length === 0 ? {} : { images: [...images] }),
      })
      return { commandId: 'cmd-1', result: { kind: 'success', text: 'goal updated' } }
    },
    async cancel(sessionId, keepInbox = false) {
      if (runtime.cancelError !== undefined) throw runtime.cancelError
      runtime.cancels.push({ sessionId, keepInbox })
      return true
    },
    async open(sessionId, replaceSessionId) {
      runtime.opens.push({
        sessionId,
        ...(replaceSessionId === undefined ? {} : { replaceSessionId }),
      })
      return true
    },
    async fork() {
      return { sessionId: 'forked-session', seedLength: 0, seed: [] }
    },
    async rewind(sourceSessionId, messageSeq, replaceSessionId) {
      runtime.rewinds.push({
        sourceSessionId,
        messageSeq,
        ...(replaceSessionId === undefined ? {} : { replaceSessionId }),
      })
      return {
        sessionId: 'rewound-session',
        seedLength: runtime.rewindSeed?.length ?? 1,
        seed:
          runtime.rewindSeed ??
          ([
            {
              type: 'user/message',
              seq: 2,
              time: 2,
              data: { id: 'u1', content: [{ type: 'text', text: 'retry this' }] },
            },
          ] satisfies SessionEvent[]),
      }
    },
    async askQuestion(request) {
      if (questionHandler === undefined) throw new Error('question handler is unavailable')
      return questionHandler(request)
    },
    onQuestion(handler) {
      questionHandler = handler
      return () => {
        if (questionHandler === handler) questionHandler = undefined
      }
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    onClose(handler) {
      closeHandlers.add(handler)
      return () => closeHandlers.delete(handler)
    },
    async close() {
      runtime.closeCount += 1
    },
  }
  return runtime
}

describe('TuiApp', () => {
  it('opens the file picker mention at the cursor', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    app.dispatch({ type: 'setDraft', text: 'review this' })
    app.dispatch({ type: 'file.open' })

    expect(app.snapshot().composer.text).toBe('review this @')
  })

  it('notifies when a question needs attention', async () => {
    const runtime = fakeRuntime()
    const values: string[] = []
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      terminalNotify: {
        mode: 'osc777',
        platform: 'darwin',
        env: {},
        write: (value) => values.push(value),
      },
    })
    await app.start()

    const answer = runtime.askQuestion({
      sessionId: 's1',
      questions: [{ id: 'choice', question: 'Choose?', options: [{ label: 'A' }] }],
    })
    const nextAnswer = runtime.askQuestion({
      sessionId: 's1',
      questions: [{ id: 'next', question: 'Next?', options: [{ label: 'B' }] }],
    })

    expect(values).toContain('\u001b]777;notify;Cocode;question ready for interaction\u0007')
    expect(values).toHaveLength(1)
    app.dispatch({ type: 'question.answer', selected: ['A'] })
    await answer
    expect(values).toHaveLength(2)
    app.dispatch({ type: 'question.answer', selected: ['B'] })
    await nextAnswer
  })

  it('prevents starting a new session while the current turn is running', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({ method: 'session.status', params: { sessionId: 's1', status: 'running' } })

    app.dispatch({ type: 'session.new' })

    expect(app.snapshot().header.sessionId).toBe('s1')
    expect(app.snapshot().notice?.message).toContain('Turn in progress')
    runtime.emit({ method: 'session.status', params: { sessionId: 's1', status: 'idle' } })
    app.dispatch({ type: 'session.new' })
    expect(app.snapshot().header.sessionId).not.toBe('s1')
  })

  it('toggles latest-turn focus without changing the assembled transcript', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      locale: 'zh',
    })
    await app.start()
    expect(app.snapshot().runtimeInfo).toMatchObject({
      name: 'fake-runtime',
      capabilitySource: 'unknown',
      mcp: { status: 'unknown' },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 1,
          time: 1,
          data: { id: 'u1', content: [{ type: 'text', text: 'first' }] },
        },
      },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 2,
          time: 2,
          data: { id: 'u2', content: [{ type: 'text', text: 'latest' }] },
        },
      },
    })

    app.dispatch({ type: 'command', line: '/focus' })
    expect(app.snapshot().status.focusMode).toBe(true)
    expect(app.snapshot().notice?.message).toBe('已开启聚焦模式：仅显示最近一轮。')
    expect(app.snapshot().nodes).toHaveLength(2)

    app.dispatch({ type: 'command', line: '/focus' })
    expect(app.snapshot().status.focusMode).toBe(false)
    expect(app.snapshot().notice?.message).toBe('已关闭聚焦模式：显示完整会话。')
  })

  it('uses live runtime capabilities and reports configured differences in /doctor', async () => {
    const runtime = fakeRuntime()
    const liveCapabilities: TuiCapabilitySnapshot = {
      source: 'runtime',
      capabilities: {
        cancel: false,
        open: false,
        fork: false,
        rewind: false,
        skills: true,
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
        queueMode: false,
        promptMode: false,
      },
      errors: {
        cancel: 'protocol method is not supported by the runtime',
      },
    }
    runtime.getCapabilities = () => liveCapabilities
    runtime.listSkills = async () => []
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    expect(app.snapshot().capabilities).toMatchObject({
      cancel: false,
      rewind: false,
      skills: true,
    })
    expect(
      app.snapshot().runtimeInfo.capabilities.find((capability) => capability.name === 'onRequest'),
    ).toEqual({ name: 'onRequest', enabled: false })
    expect(
      app.snapshot().runtimeInfo.capabilities.find((capability) => capability.name === 'skills'),
    ).toEqual({ name: 'skills', enabled: true })
    app.dispatch({ type: 'command', line: '/doctor' })
    expect(app.snapshot().notice?.message).toContain('caps-configured cancel=true')
    expect(app.snapshot().notice?.message).toContain('caps-runtime cancel=false')
    expect(app.snapshot().notice?.message).toContain(
      'caps-errors cancel=protocol method is not supported',
    )
  })

  it('presents a question batch and resolves answers in order', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    const answer = runtime.askQuestion({
      sessionId: 's1',
      questions: [
        {
          id: 'mode',
          header: 'Setup',
          question: 'How should cocode work?',
          options: [{ label: 'fast' }, { label: 'careful' }],
        },
        {
          id: 'note',
          question: 'Any extra note?',
        },
      ],
    })
    expect(app.snapshot().question).toMatchObject({
      position: 1,
      total: 2,
      question: { id: 'mode' },
    })
    app.dispatch({ type: 'question.answer', selected: ['careful'] })
    expect(app.snapshot().question).toMatchObject({
      position: 2,
      answered: 1,
      question: { id: 'note' },
    })
    app.dispatch({ type: 'question.answer', selected: [], custom: 'keep it short' })
    await expect(answer).resolves.toEqual({
      answers: [
        { id: 'mode', selected: ['careful'] },
        { id: 'note', selected: [], custom: 'keep it short' },
      ],
    })
    expect(app.snapshot().question).toBeUndefined()
  })

  it('authorizes a new workspace before sending the first prompt', async () => {
    const runtime = fakeRuntime()
    runtime.workspaceEnsureResults = [
      { status: 'authorization-required', path: '/tmp', title: 'tmp' },
      { status: 'ready', workspaceId: 'workspace-1', path: '/tmp', title: 'tmp', created: true },
    ]
    runtime.ensureWorkspace = async function (sessionId, approved = false) {
      expect(this).toBe(runtime)
      runtime.workspaceEnsures.push({ sessionId, approved })
      return runtime.workspaceEnsureResults.shift()!
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    app.dispatch({ type: 'submit', text: 'hello' })
    await vi.waitFor(() => expect(app.snapshot().question?.question).toMatchObject({
      id: 'workspace-authorization',
      customInput: false,
    }))
    expect(runtime.prompts).toEqual([])

    app.dispatch({ type: 'question.answer', selected: ['Allow'] })
    await vi.waitFor(() => expect(runtime.prompts.map((prompt) => prompt.text)).toEqual(['hello']))
    expect(runtime.workspaceEnsures).toEqual([
      { sessionId: 's1', approved: false },
      { sessionId: 's1', approved: true },
    ])
  })

  it('cancels workspace authorization without creating a session or losing the draft', async () => {
    const runtime = fakeRuntime()
    runtime.workspaceEnsureResults = [
      { status: 'authorization-required', path: '/tmp', title: 'tmp' },
    ]
    runtime.ensureWorkspace = async (sessionId, approved = false) => {
      runtime.workspaceEnsures.push({ sessionId, approved })
      return runtime.workspaceEnsureResults.shift()!
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    app.dispatch({ type: 'submit', text: 'hello' })
    await vi.waitFor(() => expect(app.snapshot().question?.question.id).toBe('workspace-authorization'))
    app.dispatch({ type: 'question.cancel' })

    await vi.waitFor(() => expect(app.snapshot().notice?.message).toContain('cancelled'))
    expect(runtime.prompts).toEqual([])
    expect(runtime.cancels).toEqual([])
    expect(runtime.workspaceEnsures).toEqual([{ sessionId: 's1', approved: false }])
    expect(app.snapshot().composer.text).toBe('hello')
  })

  it('keeps dispatch bound when a question panel invokes it as a callback', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    const answer = runtime.askQuestion({
      sessionId: 's1',
      questions: [{ id: 'choice', question: 'Choose?', options: [{ label: 'A' }] }],
    })
    const dispatch = app.dispatch

    expect(() => dispatch({ type: 'question.answer', selected: ['A'] })).not.toThrow()
    await expect(answer).resolves.toEqual({
      answers: [{ id: 'choice', selected: ['A'] }],
    })
  })

  it('queues question batches FIFO and rejects the active one on cancel', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    const first = runtime.askQuestion({
      sessionId: 's1',
      questions: [{ id: 'first', question: 'First?' }],
    })
    const second = runtime.askQuestion({
      sessionId: 's1',
      questions: [{ id: 'second', question: 'Second?' }],
    })
    expect(app.snapshot().question?.question.id).toBe('first')
    app.dispatch({ type: 'question.cancel' })
    await expect(first).rejects.toThrow('interrupted')
    expect(app.snapshot().question?.question.id).toBe('second')
    app.dispatch({ type: 'question.answer', selected: [], custom: 'done' })
    await expect(second).resolves.toEqual({
      answers: [{ id: 'second', selected: [], custom: 'done' }],
    })
  })

  it('keeps dispatch bound when passed to a question panel', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    const answer = runtime.askQuestion({
      sessionId: 's1',
      questions: [{ id: 'plan', question: 'Accept this plan?' }],
    })
    const panel = { dispatch: app.dispatch }

    panel.dispatch({ type: 'question.cancel' })

    await expect(answer).rejects.toThrow('interrupted')
    expect(app.snapshot().question).toBeUndefined()
  })

  it('loads a real skill catalog and inserts the selected invocation', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      listSkills(sessionId: string): Promise<{ name: string; description: string }[]>
    }
    runtime.listSkills = async (sessionId) => {
      expect(sessionId).toBe('s1')
      return [{ name: 'review', description: 'Review a change' }]
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    expect(app.snapshot().capabilities.skills).toBe(true)
    expect(app.snapshot().skills).toEqual([{ name: 'review', description: 'Review a change' }])
    app.dispatch({ type: 'command', line: '/skills' })
    expect(app.snapshot().skillsPicker?.open).toBe(true)
    app.dispatch({ type: 'skills.confirm' })
    expect(app.snapshot().composer.text).toBe('/review ')
    app.dispatch({ type: 'submit', text: app.snapshot().composer.text + 'security' })
    await expect.poll(() => runtime.prompts).toContainEqual({
      sessionId: 's1',
      text: '/review security',
    })
  })

  it('opens a searchable plugin picker and toggles the selected plugin', async () => {
    const runtime = fakeRuntime()
    runtime.plugins = [
      {
        entryId: 'sample',
        moduleName: '@cocode/sample-plugin',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: 'legacy',
        moduleName: '@deepseek-ai/dsh-legacy',
        enabled: false,
        fiberPhase: null,
      },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, plugins: true, pluginsMutate: true },
      locale: 'zh',
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/plugins status' })
    await expect.poll(() => app.snapshot().pluginPicker?.open).toBe(true)
    expect(app.snapshot().pluginPicker?.plugins).toHaveLength(2)

    app.dispatch({ type: 'plugins.setQuery', query: 'legacy' })
    app.dispatch({ type: 'plugins.confirm' })
    await expect.poll(() => runtime.plugins[1]?.enabled).toBe(true)
    expect(app.snapshot().pluginPicker?.open).toBe(true)
    expect(app.snapshot().pluginPicker?.status?.message).toContain(
      '@deepseek-ai/dsh-legacy（legacy）已启用（运行中）',
    )
  })

  it('preserves the entry id when parsing a plugin mutation command', async () => {
    const runtime = fakeRuntime()
    runtime.plugins = [
      {
        entryId: 'SamplePlugin',
        moduleName: '@cocode/sample-plugin',
        enabled: true,
        fiberPhase: 'active',
      },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, plugins: true, pluginsMutate: true },
      locale: 'zh',
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/plugins disable SamplePlugin' })
    await expect.poll(() => app.snapshot().notice?.message).toContain('@cocode/sample-plugin（SamplePlugin）已禁用（未加载）')
    expect(runtime.plugins[0]?.enabled).toBe(false)
  })

  it('exposes user-invocable skills in the slash menu and sends them as prompts', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      listSkills(sessionId: string): Promise<{ name: string; description: string }[]>
    }
    runtime.listSkills = async (sessionId) => {
      expect(sessionId).toBe('s1')
      return [{ name: 'audit', description: 'Inspect the current change' }]
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    expect(app.snapshot().commands).toContainEqual({
      name: 'audit',
      summary: 'Inspect the current change',
    })
    app.dispatch({ type: 'command', line: '/audit focus on security' })

    await expect.poll(() => runtime.prompts).toContainEqual({
      sessionId: 's1',
      text: '/audit focus on security',
    })
  })

  it('discovers and executes a runtime command without sending a model prompt', async () => {
    const runtime = fakeRuntime()
    runtime.commands = [{ name: 'goal', description: 'Manage the current goal' }]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    expect(app.snapshot().capabilities.commands).toBe(true)
    expect(app.snapshot().commands).toContainEqual({
      name: 'goal',
      summary: 'Manage the current goal',
    })
    app.dispatch({ type: 'command', line: '/goal ship the release' })

    await expect.poll(() => runtime.executedCommands).toEqual([
      { sessionId: 's1', line: '/goal ship the release' },
    ])
    expect(runtime.prompts).toEqual([])
    await expect.poll(() => app.snapshot().notice).toEqual({
      tone: 'info',
      message: 'goal updated',
    })
  })

  it('keeps image drafts when a runtime command does not accept images', async () => {
    const runtime = fakeRuntime()
    runtime.commands = [{ name: 'goal', description: 'Manage the current goal' }]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, imageAttachments: true },
      readClipboardImage: async () => ({ data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' }),
    })
    await app.start()

    app.dispatch({ type: 'image.paste' })
    await expect.poll(() => app.snapshot().composer.images).toHaveLength(1)
    const imageLine = `${app.snapshot().composer.text}run`
    app.dispatch({ type: 'submit', text: `/goal ${imageLine}` })

    expect(runtime.executedCommands).toEqual([])
    expect(app.snapshot().composer.images).toHaveLength(1)
    expect(app.snapshot().composer.text).toContain('[Image: clipboard-1.png]')
    expect(app.snapshot().notice).toMatchObject({ tone: 'info' })
  })

  it('passes image drafts to runtime commands that opt in to images', async () => {
    const runtime = fakeRuntime()
    runtime.commands = [{
      name: 'inspect',
      description: 'Inspect an image',
      input: { hint: '<text>', images: true },
    }]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, imageAttachments: true },
      readClipboardImage: async () => ({ data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' }),
    })
    await app.start()

    app.dispatch({ type: 'image.paste' })
    await expect.poll(() => app.snapshot().composer.images).toHaveLength(1)
    app.dispatch({ type: 'submit', text: `/inspect ${app.snapshot().composer.text}describe` })

    await expect.poll(() => runtime.executedCommands).toHaveLength(1)
    expect(runtime.executedCommands[0]).toMatchObject({
      sessionId: 's1',
      line: '/inspect describe',
      images: [{ data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', name: 'clipboard-1.png' }],
    })
    expect(app.snapshot().composer.images).toEqual([])
  })

  it('restores command image drafts when the runtime command fails', async () => {
    const runtime = fakeRuntime()
    runtime.commands = [{ name: 'inspect', description: 'Inspect an image', input: { images: true, hint: '<text>' } }]
    runtime.executeCommand = async (sessionId, line, images = []) => {
      runtime.executedCommands.push({ sessionId, line, images: [...images] })
      return { commandId: 'cmd-1', result: { kind: 'error', text: 'inspection failed' } }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, imageAttachments: true },
      readClipboardImage: async () => ({ data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' }),
    })
    await app.start()

    app.dispatch({ type: 'image.paste' })
    await expect.poll(() => app.snapshot().composer.images).toHaveLength(1)
    const commandLine = `/inspect ${app.snapshot().composer.text}describe`
    app.dispatch({ type: 'submit', text: commandLine })

    await expect.poll(() => app.snapshot().notice).toEqual({ tone: 'error', message: 'inspection failed' })
    expect(app.snapshot().composer.text).toBe(commandLine)
    expect(app.snapshot().composer.images).toHaveLength(1)
  })

  it('uses a runtime command input hint to keep the draft editable', async () => {
    const runtime = fakeRuntime()
    runtime.commands = [
      { name: 'feedback', description: 'Record feedback', input: { hint: '<text>' } },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/feedback' })

    expect(app.snapshot().composer.text).toBe('/feedback ')
    expect(runtime.executedCommands).toEqual([])
    app.dispatch({ type: 'submit', text: '/feedback useful feedback' })
    await expect.poll(() => runtime.executedCommands).toEqual([
      { sessionId: 's1', line: '/feedback useful feedback' },
    ])
  })

  it('opens an interactive permission preset picker', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      permissionMode(
        sessionId: string,
        mode?: string,
      ): Promise<{ mode: string; supportedModes: string[] }>
    }
    let currentMode = 'manual'
    runtime.permissionMode = async (_sessionId, mode) => {
      if (mode !== undefined) currentMode = mode
      return { mode: currentMode, supportedModes: ['manual', 'workspace-write', 'allow-all'] }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, permissionMode: true },
    })
    await app.start()

    expect(app.snapshot().commands).toContainEqual({
      name: 'permissions',
      summary: 'Cycle runtime permission mode',
    })

    app.dispatch({ type: 'command', line: '/permission' })
    await expect.poll(() => app.snapshot().permissionPicker?.open).toBe(true)
    expect(app.snapshot().permissionPicker).toMatchObject({
      modes: ['manual', 'workspace-write', 'allow-all'],
      current: 'manual',
      selected: 0,
    })
    expect(runtime.executedCommands).toEqual([])

    app.dispatch({ type: 'permission.move', delta: 1 })
    expect(app.snapshot().permissionPicker?.selected).toBe(1)
    app.dispatch({ type: 'permission.confirm' })
    await expect.poll(() => app.snapshot().permissionPicker?.open).toBe(false)
    expect(app.snapshot().status.permissionMode).toBe('workspace-write')
    expect(app.snapshot().notice?.message).toContain('workspace-write')
    expect(runtime.executedCommands).toEqual([])
  })

  it('keeps the remote permission command as a fallback without the local capability', async () => {
    const runtime = fakeRuntime()
    runtime.commands = [
      {
        name: 'permission',
        description: 'Switch the permission preset',
        input: { hint: '<preset>' },
      },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    expect(app.snapshot().commands).toContainEqual({
      name: 'permission',
      summary: 'Switch the permission preset',
      input: { hint: '<preset>' },
    })
    app.dispatch({ type: 'command', line: '/permission' })
    expect(app.snapshot().composer.text).toBe('/permission ')
    expect(runtime.executedCommands).toEqual([])
    app.dispatch({ type: 'submit', text: '/permission workspace-write' })
    await expect.poll(() => runtime.executedCommands).toEqual([
      { sessionId: 's1', line: '/permission workspace-write' },
    ])
  })

  it('keeps the permission picker open when applying a preset fails', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      permissionMode(
        sessionId: string,
        mode?: string,
      ): Promise<{ mode: string; supportedModes: string[] }>
    }
    runtime.permissionMode = async (_sessionId, mode) => {
      if (mode === 'allow-all') throw new Error('preset rejected')
      return { mode: 'manual', supportedModes: ['manual', 'allow-all'] }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, permissionMode: true },
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/permission' })
    await expect.poll(() => app.snapshot().permissionPicker?.open).toBe(true)
    app.dispatch({ type: 'permission.move', delta: 1 })
    app.dispatch({ type: 'permission.confirm' })

    await expect.poll(() => app.snapshot().permissionPicker?.pending).toBeUndefined()
    expect(app.snapshot().permissionPicker?.open).toBe(true)
    expect(app.snapshot().notice).toMatchObject({ tone: 'error' })
    expect(app.snapshot().notice?.message).toContain('preset rejected')
  })

  it('keeps a skill draft while another turn is running', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      listSkills(sessionId: string): Promise<{ name: string; description: string }[]>
    }
    runtime.listSkills = async () => [
      { name: 'audit', description: 'Inspect the current change' },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({ method: 'session.status', params: { sessionId: 's1', status: 'running' } })
    app.dispatch({ type: 'setDraft', text: '/audit keep this draft' })

    app.dispatch({ type: 'submit', text: app.snapshot().composer.text })

    expect(runtime.prompts).toEqual([])
    expect(app.snapshot().composer.text).toBe('/audit keep this draft')
    expect(app.snapshot().notice?.tone).toBe('info')
  })

  it('keeps command selection safe for ordinary text', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    expect(() => app.dispatch({ type: 'command.select', line: 'ordinary text' })).not.toThrow()
    expect(runtime.prompts).toEqual([])
    expect(app.snapshot().notice?.tone).toBe('error')
  })

  it('namespaces discovered skill commands and keeps the wire invocation unprefixed', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      listSkills(sessionId: string): Promise<{ name: string; description: string; source: string }[]>
    }
    runtime.listSkills = async () => [
      { name: 'review', description: 'Review a change', source: 'project-agents' },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    expect(app.snapshot().commands).toContainEqual({
      name: 'project:review',
      summary: 'Review a change',
    })
    app.dispatch({ type: 'command', line: '/project:review security' })

    await expect.poll(() => runtime.prompts).toContainEqual({
      sessionId: 's1',
      text: '/review security',
    })
  })

  it('keeps a namespaced skill selection editable before invoking it', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      listSkills(sessionId: string): Promise<{ name: string; description: string; source: string }[]>
    }
    runtime.listSkills = async () => [
      { name: 'review', description: 'Review a change', source: 'project-agents' },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    app.dispatch({ type: 'command.select', line: '/project:review' })

    expect(app.snapshot().composer.text).toBe('/project:review ')
    expect(runtime.prompts).toEqual([])

    app.dispatch({ type: 'submit', text: '/project:review security' })
    await expect.poll(() => runtime.prompts).toContainEqual({
      sessionId: 's1',
      text: '/review security',
    })
  })

  it('keeps pasted images in the draft until send and then sends attachment blocks', async () => {
    const runtime = fakeRuntime()
    const cwd = join(tmpdir(), 'cocode-image-only-prompt-missing-workspace')
    await rm(cwd, { recursive: true, force: true })
    const app = createTuiApp({
      runtime,
      cwd,
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, imageAttachments: true },
      readClipboardImage: async () => ({
        data: Uint8Array.of(1, 2, 3),
        mediaType: 'image/png',
      }),
    })
    await app.start()

    app.dispatch({ type: 'image.paste' })
    await expect.poll(() => app.snapshot().composer.images).toHaveLength(1)
    expect(app.snapshot().composer.text).toMatch(/^\[Image: clipboard-1\.png\] /)
    expect(runtime.savedImages).toEqual([])

    app.dispatch({ type: 'setDraft', text: 'ask about this' })
    expect(app.snapshot().composer.images).toEqual([])
    app.dispatch({ type: 'setDraft', text: '' })

    app.dispatch({ type: 'image.paste' })
    await expect.poll(() => app.snapshot().composer.images).toHaveLength(1)
    app.dispatch({ type: 'submit', text: `${app.snapshot().composer.text}describe it` })

    await expect.poll(() => runtime.savedImages).toHaveLength(1)
    await expect.poll(() => runtime.promptBlocks).toHaveLength(1)
    expect(runtime.promptBlocks[0]?.blocks).toEqual([
      { type: 'text', text: 'describe it' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'fake-image-0',
          mediaType: 'image/png',
          bytes: 3,
          width: 1,
          height: 1,
          name: 'clipboard-2.png',
        },
      },
    ])
    expect(app.snapshot().composer.images).toEqual([])
  })

  it('pastes a clipboard image through the /paste-image command', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, imageAttachments: true },
      readClipboardImage: async () => ({
        data: Uint8Array.of(1, 2, 3),
        mediaType: 'image/png',
      }),
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/paste-image' })

    await expect.poll(() => app.snapshot().composer.images).toHaveLength(1)
    expect(app.snapshot().composer.text).toBe('[Image: clipboard-1.png] ')
  })

  it('turns a pasted image path into an image draft', async () => {
    const runtime = fakeRuntime()
    const pastedPath = '/tmp/screenshot.png'
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, imageAttachments: true },
      readPastedImage: async (path) => {
        expect(path).toBe(pastedPath)
        return {
          data: Uint8Array.of(1, 2, 3),
          mediaType: 'image/png',
        }
      },
    })
    await app.start()

    app.dispatch({ type: 'insertPastedInput', text: pastedPath })

    await expect.poll(() => app.snapshot().composer.images).toHaveLength(1)
    expect(app.snapshot().composer.text).toBe('[Image: screenshot.png] ')
  })

  it('keeps non-image pasted text as ordinary draft input', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, imageAttachments: true },
      readPastedImage: async () => {
        throw new Error('should not read non-image input')
      },
    })
    await app.start()

    app.dispatch({ type: 'insertPastedInput', text: '/tmp/notes.txt' })

    await expect.poll(() => app.snapshot().composer.text).toBe('/tmp/notes.txt')
    expect(app.snapshot().composer.images).toEqual([])
  })

  it('switches interface language with /lang', async () => {
    const app = createTuiApp({
      runtime: fakeRuntime(),
      cwd: '/tmp',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionId: 's1',
      locale: 'en',
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/lang zh' })
    expect(app.snapshot().locale).toBe('zh')
    expect(app.snapshot().composer.placeholder).toContain('输入消息')
  })

  it('switches model through runtime restart and starts a new session', async () => {
    const runtime = fakeRuntime()
    runtime.open = async () => {
      throw new Error('session persistence is unavailable')
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'deepseek-official',
      model: 'm1',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model m2' })
    await expect.poll(() => app.snapshot().header.model).toBe('m2')
    expect(runtime.restarts).toEqual([{ provider: 'deepseek-official', model: 'm2' }])
    expect(app.snapshot().header.sessionId).not.toBe('s1')
    expect(app.snapshot().notice?.message).toContain(
      'This runtime cannot switch models in the current session',
    )
    expect(app.snapshot().agent).toBe('idle')
  })

  it('starts a fresh session when the restarted runtime supports durable session open', async () => {
    const runtime = fakeRuntime()
    runtime.getCapabilities = () => ({
      source: 'runtime',
      capabilities: {
        cancel: true,
        open: true,
        fork: true,
        rewind: true,
        skills: false,
        onRequest: false,
        approval: false,
        permissionMode: false,
        planMode: false,
        sessionList: false,
        modelList: false,
        promptMode: false,
        queueMode: false,
      },
      errors: {},
    })
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm1',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model m2' })

    await expect.poll(() => app.snapshot().header.model).toBe('m2')
    expect(app.snapshot().header.sessionId).not.toBe('s1')
    expect(runtime.opens).toEqual([])
    expect(app.snapshot().nodes).toEqual([])
    expect(app.snapshot().notice?.message).toContain('new session')
  })

  it('restores the previous model when switching fails', async () => {
    const runtime = fakeRuntime()
    runtime.failRestartModels.add('m2')
    runtime.open = async () => {
      throw new Error('session persistence is unavailable')
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'deepseek-official',
      model: 'm1',
      sessionId: 's1',
      locale: 'zh',
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model m2' })
    await expect.poll(() => app.snapshot().agent).toBe('idle')
    expect(runtime.restarts).toEqual([
      { provider: 'deepseek-official', model: 'm2' },
      { provider: 'deepseek-official', model: 'm1' },
    ])
    expect(app.snapshot().header.model).toBe('m1')
    expect(app.snapshot().header.sessionId).not.toBe('s1')
    expect(app.snapshot().nodes).toHaveLength(0)
    expect(app.snapshot().notice?.message).toContain('已在新会话中恢复为 m1')
  })

  it('opens a model picker from /model and switches provider and model', async () => {
    const runtime = fakeRuntime()
    const persistedModels: { provider: string; model: string }[] = []
    runtime.modelCatalog = {
      groups: [
        {
          id: 'p2',
          name: 'Provider 2',
          models: [{ id: 'm2', name: 'Model 2' }],
        },
      ],
      failures: [],
    }
    const listModels = vi.spyOn(runtime, 'listModels').mockImplementation(async function () {
      expect(this).toBe(runtime)
      return runtime.modelCatalog
    })
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
      auth: {
        mode: 'byok',
        envLocked: false,
        logout: async () => {},
        persistModel: async (provider, model) => {
          persistedModels.push({ provider, model })
        },
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model' })
    await expect.poll(() => app.snapshot().modelPicker?.open).toBe(true)
    expect(app.snapshot().modelPicker?.groups[0]?.id).toBe('p2')
    expect(listModels).toHaveBeenCalledOnce()
    app.dispatch({ type: 'model.confirm' })
    await expect.poll(() => app.snapshot().header.provider).toBe('p2')
    expect(runtime.restarts).toEqual([{ provider: 'p2', model: 'm2' }])
    expect(app.snapshot().header.model).toBe('m2')
    expect(app.snapshot().header.sessionId).not.toBe('s1')
    expect(runtime.opens).toEqual([])
    expect(persistedModels).toEqual([{ provider: 'p2', model: 'm2' }])
  })

  it('falls back to the host model catalog when a cold session has no session model record', async () => {
    const runtime = fakeRuntime()
    runtime.modelCatalog = {
      groups: [{ id: 'p2', name: 'Provider 2', models: [{ id: 'm2', name: 'Model 2' }] }],
      failures: [],
    }
    runtime.sessionModels = async function () {
      expect(this).toBe(runtime)
      throw new Error('session "s1" was not found')
    }
    const listModels = vi.spyOn(runtime, 'listModels').mockImplementation(async function () {
      expect(this).toBe(runtime)
      return runtime.modelCatalog
    })
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true, sessionModels: true },
    })

    await app.start()
    app.dispatch({ type: 'command', line: '/model' })

    await expect.poll(() => app.snapshot().modelPicker?.open).toBe(true)
    expect(app.snapshot().modelPicker?.groups[0]?.id).toBe('p2')
    expect(listModels).toHaveBeenCalledOnce()
    expect(app.snapshot().notice?.tone).not.toBe('error')
  })

  it('does not call the global model catalog when its capability is unavailable', async () => {
    const runtime = fakeRuntime()
    runtime.sessionModels = async () => {
      throw new Error('session "s1" was not found')
    }
    const listModels = vi.spyOn(runtime, 'listModels')
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, sessionModels: true, modelList: false },
    })

    await app.start()
    app.dispatch({ type: 'command', line: '/model' })

    await expect.poll(() => app.snapshot().modelInputOpen).toBe(true)
    expect(listModels).not.toHaveBeenCalled()
    expect(app.snapshot().notice?.message).toBe('Could not load model catalog')
  })

  it('blocks prompt submission when the current provider is not routable', async () => {
    const runtime = fakeRuntime()
    runtime.sessionModels = async () => ({
      current: { provider: 'missing-provider', model: 'missing-model' },
      routable: false,
      groups: [{
        id: 'available-provider',
        name: 'Available Provider',
        models: [{ id: 'available-model', name: 'Available Model' }],
      }],
      failures: [],
    })
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'missing-provider',
      model: 'missing-model',
      sessionId: 's1',
      locale: 'zh',
      capabilities: { ...P0_CAPABILITIES, sessionModels: true },
    })

    await app.start()
    expect(app.snapshot().composer.disabled).toBe(true)
    expect(app.snapshot().header.routable).toBe(false)
    app.dispatch({ type: 'model.open' })
    await expect.poll(() => app.snapshot().modelPicker?.open).toBe(true)
    expect(app.snapshot().modelPicker?.groups[0]?.models[0]?.id).toBe('available-model')
    expect(app.snapshot().notice?.message).toBe(
      '当前 provider 不可用，请先选择其他模型再发送消息。',
    )
    app.dispatch({ type: 'model.close' })
    app.dispatch({ type: 'submit', text: 'hello' })
    expect(runtime.prompts).toHaveLength(0)
    expect(app.snapshot().notice?.message).toBe(
      '当前 provider 不可用，请先选择其他模型再发送消息。',
    )
  })

  it('opens an effort picker from /effort when the model advertises levels', async () => {
    const runtime = fakeRuntime()
    runtime.modelCatalog = reasoningCatalog()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/effort' })
    await expect.poll(() => app.snapshot().effortPicker?.open).toBe(true)
    expect(app.snapshot().effortPicker?.items.map((item) => item.effort)).toEqual(['high', 'max'])
  })

  it('applies /effort through session.selectModel and shows the level on the header', async () => {
    const runtime = fakeRuntime()
    runtime.modelCatalog = reasoningCatalog()
    const selections: {
      sessionId: string
      provider: string
      model: string
      reasoningEffort?: string
    }[] = []
    runtime.selectModel = async (sessionId, provider, model, reasoningEffort) => {
      selections.push({ sessionId, provider, model, reasoningEffort })
      return {
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/effort max' })
    await expect.poll(() => app.snapshot().header.reasoningEffort).toBe('Max')
    expect(selections).toEqual([
      { sessionId: 's1', provider: 'p1', model: 'm1', reasoningEffort: 'max' },
    ])
    expect(runtime.restarts).toEqual([])
    expect(app.snapshot().header.sessionId).toBe('s1')
  })

  it('clears an inherited effort with /effort auto', async () => {
    const runtime = fakeRuntime()
    runtime.modelCatalog = reasoningCatalog()
    const selections: Array<string | undefined> = []
    runtime.selectModel = async (_sessionId, provider, model, reasoningEffort) => {
      selections.push(reasoningEffort)
      return { provider, model }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/effort auto' })
    await expect.poll(() => app.snapshot().agent).toBe('idle')
    expect(selections).toEqual([undefined])
    expect(app.snapshot().header.reasoningEffort).toBe('High')
  })

  it('asks for effort after /model confirms a model that advertises levels', async () => {
    const runtime = fakeRuntime()
    runtime.modelCatalog = {
      groups: [
        {
          id: 'p2',
          name: 'Provider 2',
          models: [
            {
              id: 'm2',
              name: 'Model 2',
              reasoning: {
                efforts: [
                  { id: 'high', name: 'High' },
                  { id: 'max', name: 'Max' },
                ],
                defaultEffort: 'high',
              },
            },
          ],
        },
      ],
      failures: [],
    }
    const selections: {
      provider: string
      model: string
      reasoningEffort?: string
    }[] = []
    runtime.selectModel = async (_sessionId, provider, model, reasoningEffort) => {
      selections.push({ provider, model, reasoningEffort })
      return {
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model' })
    await expect.poll(() => app.snapshot().modelPicker?.open).toBe(true)
    app.dispatch({ type: 'model.confirm' })
    await expect.poll(() => app.snapshot().effortPicker?.open).toBe(true)
    expect(app.snapshot().header.provider).toBe('p1')
    expect(app.snapshot().header.model).toBe('m1')
    expect(selections).toEqual([])
    app.dispatch({ type: 'effort.confirm' })
    await expect.poll(() => app.snapshot().header.provider).toBe('p2')
    expect(app.snapshot().header.model).toBe('m2')
    expect(app.snapshot().header.reasoningEffort).toBe('High')
    expect(selections).toEqual([{ provider: 'p2', model: 'm2', reasoningEffort: 'high' }])
    expect(app.snapshot().effortPicker?.open).not.toBe(true)
  })

  it('notices when /effort is used on a model without reasoning levels', async () => {
    const runtime = fakeRuntime()
    runtime.modelCatalog = {
      groups: [{ id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }] }],
      failures: [],
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/effort' })
    await expect.poll(() => app.snapshot().notice?.message).toMatch(/reasoning effort|推理强度/)
    expect(app.snapshot().effortPicker?.open).not.toBe(true)
  })

  it('ignores a second effort confirm while the first is applying', async () => {
    const runtime = fakeRuntime()
    runtime.modelCatalog = reasoningCatalog()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const selections: Array<string | undefined> = []
    runtime.selectModel = async (_sessionId, provider, model, reasoningEffort) => {
      await gate
      selections.push(reasoningEffort)
      return {
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/effort' })
    await expect.poll(() => app.snapshot().effortPicker?.open).toBe(true)
    app.dispatch({ type: 'effort.confirm' })
    app.dispatch({ type: 'effort.confirm' })
    release()
    await expect.poll(() => app.snapshot().agent).toBe('idle')
    expect(selections).toEqual(['high'])
  })

  it('selects a model in the current session when the runtime supports it', async () => {
    const runtime = fakeRuntime()
    const selections: { sessionId: string; provider: string; model: string }[] = []
    runtime.selectModel = async (sessionId, provider, model) => {
      selections.push({ sessionId, provider, model })
      return { provider, model }
    }
    const persistedModels: { provider: string; model: string }[] = []
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      auth: {
        mode: 'byok',
        envLocked: false,
        logout: async () => {},
        persistModel: async (provider, model) => {
          persistedModels.push({ provider, model })
        },
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model m2' })

    await expect.poll(() => app.snapshot().agent).toBe('idle')
    expect(selections).toEqual([{ sessionId: 's1', provider: 'p1', model: 'm2' }])
    expect(persistedModels).toEqual([])
    expect(runtime.restarts).toEqual([])
    expect(app.snapshot().header.sessionId).toBe('s1')
    expect(app.snapshot().notice?.message).toContain('current session continued')
  })

  it('keeps the switched model when default persistence fails', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      auth: {
        mode: 'byok',
        envLocked: false,
        logout: async () => {},
        persistModel: async () => {
          throw new Error('settings write failed')
        },
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model m2' })

    await expect.poll(() => app.snapshot().agent).toBe('idle')
    expect(runtime.restarts).toEqual([{ provider: 'p1', model: 'm2' }])
    expect(app.snapshot().header.model).toBe('m2')
  })

  it('opens the manual model input for /models when the runtime has no catalog', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm1',
      capabilities: P0_CAPABILITIES,
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/models' })
    expect(app.snapshot().modelInputOpen).toBe(true)
  })

  it('restores both provider and model when a cross-provider switch fails', async () => {
    const runtime = fakeRuntime()
    runtime.failRestartModels.add('m2')
    runtime.modelCatalog = {
      groups: [{ id: 'p2', name: 'Provider 2', models: [{ id: 'm2', name: 'Model 2' }] }],
      failures: [],
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p1',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, modelList: true },
      locale: 'zh',
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/model' })
    await expect.poll(() => app.snapshot().modelPicker?.open).toBe(true)
    app.dispatch({ type: 'model.confirm' })
    await expect.poll(() => app.snapshot().agent).toBe('idle')
    expect(runtime.restarts).toEqual([
      { provider: 'p2', model: 'm2' },
      { provider: 'p1', model: 'm1' },
    ])
    expect(app.snapshot().header.provider).toBe('p1')
    expect(app.snapshot().header.model).toBe('m1')
  })

  it('resumes a searchable local session from its event log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocode-resume-root-'))
    const cwd = await mkdtemp(join(tmpdir(), 'cocode-resume-cwd-'))
    try {
      const sessionDir = join(root, 'project', 'old-session')
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        join(sessionDir, 'session.jsonl'),
        `${JSON.stringify({
          type: 'session',
          id: 'old-session',
          createdAt: 1_700_000_000_000,
          cwd,
        })}\n${JSON.stringify({
          type: 'user/message',
          seq: 1,
          time: 1_700_000_000_001,
          data: {
            id: 'old-user',
            role: 'user',
            content: [{ type: 'text', text: 'continue this session' }],
            source: { kind: 'user' },
          },
        })}\n`,
      )
      const runtime = fakeRuntime()
      const app = createTuiApp({
        runtime,
        cwd,
        provider: 'p',
        model: 'm',
        sessionId: 'current-session',
        capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
        diagnostics: {
          tty: true,
          launchConfigured: true,
          argsConfigured: true,
          sessionRoot: root,
        },
        locale: 'zh',
      })
      await app.start()
      app.dispatch({ type: 'command', line: '/resume' })
      await expect.poll(() => app.snapshot().resumePicker?.open).toBe(true)
      expect(app.snapshot().resumePicker?.items.map((item) => item.id)).toEqual(['old-session'])
      app.dispatch({ type: 'resume.setQuery', query: 'old' })
      expect(app.snapshot().resumePicker?.query).toBe('old')
      app.dispatch({ type: 'resume.confirm' })
      expect(app.snapshot().resumePicker?.open).toBe(false)
      await expect.poll(() => app.snapshot().header.sessionId).toBe('old-session')
      expect(app.snapshot().nodes[0]).toMatchObject({
        kind: 'user',
        text: 'continue this session',
      })
      expect(runtime.opens).toEqual([
        { sessionId: 'old-session', replaceSessionId: 'current-session' },
      ])
      expect(app.snapshot().notice?.message).toBe('已恢复会话 old-sess。')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('shows a friendly notice when reopening the current /sessions item', async () => {
    const runtime = fakeRuntime()
    runtime.listSessions = async () => [
      { sessionId: 'other-session', createdAt: 2, updatedAt: 20, cwd: '/tmp', title: 'Other' },
      { sessionId: 's1', createdAt: 1, updatedAt: 10, cwd: '/tmp', title: 'Current' },
    ]
    runtime.open = async (sessionId, replaceSessionId) => {
      runtime.opens.push({
        sessionId,
        ...(replaceSessionId === undefined ? {} : { replaceSessionId }),
      })
      return { opened: false }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, sessionList: 'rpc' },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/sessions' })
    await expect.poll(() => app.snapshot().sessionTreePicker?.open).toBe(true)
    const picker = app.snapshot().sessionTreePicker
    const index = picker?.items.findIndex((item) => item.session.id === 's1') ?? -1
    expect(index).toBeGreaterThanOrEqual(0)
    app.dispatch({ type: 'sessionTree.move', delta: index - (picker?.selected ?? 0) })
    expect(app.snapshot().sessionTreePicker?.items[app.snapshot().sessionTreePicker.selected]?.session.id).toBe('s1')
    app.dispatch({ type: 'sessionTree.confirm' })
    await expect.poll(() => app.snapshot().notice?.message).toBe('Already in this session.')
    expect(app.snapshot().notice?.tone).toBe('info')
    expect(app.snapshot().header.sessionId).toBe('s1')
    expect(runtime.opens).toEqual([])

    app.dispatch({ type: 'command', line: '/sessions' })
    await expect.poll(() => app.snapshot().sessionTreePicker?.open).toBe(true)
    app.dispatch({ type: 'sessionTree.confirm' })
    await expect.poll(() => runtime.opens).toEqual([{ sessionId: 'other-session', replaceSessionId: 's1' }])
    expect(app.snapshot().notice?.message).not.toBe('Already in this session.')
  })

  it('shows a friendly notice when /resume selects the current session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocode-resume-current-'))
    const cwd = await mkdtemp(join(tmpdir(), 'cocode-resume-current-cwd-'))
    try {
      const sessionDir = join(root, 'project', 's1')
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        join(sessionDir, 'session.jsonl'),
        `${JSON.stringify({
          type: 'session',
          id: 's1',
          createdAt: 1_700_000_000_000,
          cwd,
        })}\n`,
      )
      const runtime = fakeRuntime()
      const app = createTuiApp({
        runtime,
        cwd,
        provider: 'p',
        model: 'm',
        sessionId: 's1',
        capabilities: { ...P0_CAPABILITIES, sessionList: 'jsonl' },
        diagnostics: {
          tty: true,
          launchConfigured: true,
          argsConfigured: true,
          sessionRoot: root,
        },
      })
      await app.start()
      app.dispatch({ type: 'command', line: '/resume' })
      await expect.poll(() => app.snapshot().resumePicker?.open).toBe(true)
      expect(app.snapshot().resumePicker?.items.map((item) => item.id)).toEqual(['s1'])
      app.dispatch({ type: 'resume.confirm' })
      await expect.poll(() => app.snapshot().notice?.message).toBe('Already in this session.')
      expect(app.snapshot().notice?.tone).toBe('info')
      expect(app.snapshot().header.sessionId).toBe('s1')
      expect(runtime.opens).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('rebuilds all projections when forking a session with a seed', async () => {
    const runtime = fakeRuntime()
    runtime.fork = async () => ({
      sessionId: 'forked-session',
      seedLength: 2,
      seed: [
        {
          type: 'session/title',
          seq: 1,
          time: 1,
          data: { title: 'Forked title' },
        },
        {
          type: 'user/message',
          seq: 2,
          time: 2,
          data: { id: 'fork-user', content: [{ type: 'text', text: 'Forked prompt' }] },
        },
      ],
    })
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 'source-session',
      capabilities: { ...P0_CAPABILITIES, fork: true },
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 'source-session',
        event: {
          type: 'user/message',
          seq: 1,
          time: 1,
          data: { id: 'source-user', content: [{ type: 'text', text: 'existing prompt' }] },
        },
      },
    })

    app.dispatch({ type: 'command', line: '/clone' })
    await expect.poll(() => app.snapshot().header.sessionId).toBe('forked-session')
    expect(app.snapshot().status.sessionTitle).toBe('Forked title')
    expect(
      app
        .snapshot()
        .nodes.some((node) => node.kind === 'user' && node.text.includes('Forked prompt')),
    ).toBe(true)
  })

  it('does not clone an empty session before the first prompt', async () => {
    const runtime = fakeRuntime()
    const fork = vi.fn(runtime.fork)
    runtime.fork = fork
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 'empty-session',
      capabilities: { ...P0_CAPABILITIES, fork: true },
      locale: 'zh',
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/clone' })
    await vi.waitFor(() => expect(app.snapshot().notice?.message).toBe('没有可用于创建分支边界的历史用户消息。'))

    expect(fork).not.toHaveBeenCalled()
    expect(app.snapshot().header.sessionId).toBe('empty-session')
  })

  it('forks from a selected user message and replaces the live session', async () => {
    const runtime = fakeRuntime()
    const forkCalls: unknown[][] = []
    runtime.fork = async (...args) => {
      forkCalls.push(args)
      return {
        sessionId: 'forked-at-message',
        seedLength: 0,
        seed: [],
      }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 'source-session',
      capabilities: { ...P0_CAPABILITIES, fork: true },
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 'source-session',
        event: {
          type: 'user/message',
          seq: 2,
          time: 2,
          data: { id: 'user-1', content: [{ type: 'text', text: 'first prompt' }] },
        },
      },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 'source-session',
        event: {
          type: 'user/message',
          seq: 5,
          time: 5,
          data: { id: 'user-2', content: [{ type: 'text', text: 'latest prompt' }] },
        },
      },
    })

    app.dispatch({ type: 'command', line: '/fork' })
    expect(app.snapshot().forkPicker?.open).toBe(true)
    app.dispatch({ type: 'fork.confirm' })
    app.dispatch({ type: 'fork.confirm' })
    await expect.poll(() => app.snapshot().header.sessionId).toBe('forked-at-message')
    expect(forkCalls).toEqual([['source-session', undefined, 'source-session', 5]])
    expect(app.snapshot().agent).toBe('idle')
  })

  it('queues Enter submissions while running and sends them after idle', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'submit', text: 'hello' })
    expect(runtime.prompts).toEqual([{ sessionId: 's1', text: 'hello' }])
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    app.dispatch({ type: 'submit', text: 'again' })
    expect(runtime.prompts).toHaveLength(1)
    expect(app.snapshot().status.queueCount).toBe(1)
    expect(app.snapshot().notice?.message).toMatch(/Queued prompt/)

    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'idle' },
    })
    await expect
      .poll(() => runtime.prompts)
      .toEqual([
        { sessionId: 's1', text: 'hello' },
        { sessionId: 's1', text: 'again' },
      ])
  })

  it('shows thinking while a turn is running before the first response chunk', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      locale: 'zh',
    })
    await app.start()
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })

    expect(app.snapshot().status.line).toBe('思考中…')
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'idle' },
    })
    expect(app.snapshot().status.line).toBe('就绪')
  })

  it('shows model failures and leaves the running state', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionId: 's1',
      locale: 'zh',
    })
    await app.start()
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })

    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'assistant/chunk',
          seq: 1,
          time: 1,
          data: {
            turn: 1,
            step: 1,
            chunk: {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: {
                  code: 'UNSUPPORTED_CONTENT',
                  message: 'The selected model does not support image content.',
                },
              },
            },
          },
        },
      },
    })

    expect(app.snapshot().agent).toBe('running')
    expect(app.snapshot().notice).toBeUndefined()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'turn/end',
          seq: 2,
          time: 2,
          data: {
            turn: 1,
            reason: {
              kind: 'error',
              error: {
                code: 'UNSUPPORTED_CONTENT',
                message: 'The selected model does not support image content.',
              },
            },
          },
        },
      },
    })

    expect(app.snapshot().agent).toBe('idle')
    expect(app.snapshot().notice).toEqual({
      tone: 'error',
      message: 'The selected model does not support image content.',
    })

    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'turn/end',
          seq: 3,
          time: 3,
          data: { turn: 2, reason: { kind: 'completed' } },
        },
      },
    })
    expect(app.snapshot().notice).toBeUndefined()
  })

  it('sends /compact through the prompt path', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/compact' })
    await vi.waitFor(() => expect(runtime.prompts).toHaveLength(1))
    expect(runtime.prompts[0]).toEqual({ sessionId: 's1', text: '/compact' })
  })

  it('uses the Host compact command when the rc2 command registry exposes it', async () => {
    const runtime = fakeRuntime()
    runtime.commands = [{ name: 'compact', description: 'Compact older conversation history' }]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/compact' })
    await vi.waitFor(() => expect(runtime.executedCommands).toHaveLength(1))
    expect(runtime.executedCommands[0]).toEqual({ sessionId: 's1', line: '/compact' })
    expect(runtime.prompts).toHaveLength(0)
  })

  it('queues a follow-up while running and sends it after idle', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'submit', text: 'first' })
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    app.dispatch({ type: 'setDraft', text: 'second' })
    app.dispatch({ type: 'queuePrompt' })
    expect(app.snapshot().status.queueCount).toBe(1)
    expect(runtime.prompts).toEqual([{ sessionId: 's1', text: 'first' }])
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'idle' },
    })
    await expect
      .poll(() => runtime.prompts)
      .toEqual([
        { sessionId: 's1', text: 'first' },
        { sessionId: 's1', text: 'second' },
      ])
    expect(app.snapshot().status.queueCount).toBe(0)
  })

  it('uses the advertised queue wire mode when flushing the local queue', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, queueMode: true },
    })
    await app.start()
    app.dispatch({ type: 'submit', text: 'first' })
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    app.dispatch({ type: 'setDraft', text: 'second' })
    app.dispatch({ type: 'queuePrompt' })
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'idle' },
    })
    await expect
      .poll(() => runtime.prompts)
      .toEqual([
        { sessionId: 's1', text: 'first' },
        { sessionId: 's1', text: 'second', mode: 'queue' },
      ])
  })

  it('projects visible Host queue items for the dock and picker', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, queueMutation: true },
    })
    await app.start()
    runtime.emit({
      method: 'session.queue',
      params: {
        sessionId: 's1',
        items: [
          { id: 'context-1', placement: 'context', content: [{ type: 'text', text: 'internal' }] },
          { id: 'queued-1', placement: 'queued', content: [{ type: 'text', text: 'Host follow-up' }] },
        ],
      },
    })
    expect(app.snapshot().status.remoteQueueCount).toBe(1)
    expect(app.snapshot().remoteQueue).toHaveLength(2)
    app.dispatch({ type: 'command', line: '/queue' })
    expect(app.snapshot().remoteQueuePicker?.items.map((item) => item.id)).toEqual(['queued-1'])
  })

  it('opens queue management and restores a queued prompt to the front', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'submit', text: 'first' })
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    app.dispatch({ type: 'setDraft', text: 'second' })
    app.dispatch({ type: 'queuePrompt' })
    app.dispatch({ type: 'setDraft', text: 'third' })
    app.dispatch({ type: 'queuePrompt' })

    app.dispatch({ type: 'command', line: '/queue' })
    expect(app.snapshot().queuePicker?.items.map((item) => item.text)).toEqual(['second', 'third'])
    app.dispatch({ type: 'queue.move', delta: 1 })
    app.dispatch({ type: 'queue.restore' })
    expect(app.snapshot().queuePicker?.items.map((item) => item.text)).toEqual(['third', 'second'])
    expect(app.snapshot().status.queueCount).toBe(2)

    app.dispatch({ type: 'queue.delete' })
    expect(app.snapshot().queuePicker?.items.map((item) => item.text)).toEqual(['second'])
    expect(app.snapshot().status.queueCount).toBe(1)
  })

  it('shows a notice instead of opening an empty queue picker', async () => {
    const app = createTuiApp({
      runtime: fakeRuntime(),
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      locale: 'en',
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/queue' })

    expect(app.snapshot().queuePicker).toBeUndefined()
    expect(app.snapshot().notice?.message).toBe('No queued prompts.')
  })

  it('restores a failed queued prompt and retries it from the picker', async () => {
    const runtime = fakeRuntime()
    const prompt = runtime.prompt.bind(runtime)
    let failOnce = true
    runtime.prompt = async (sessionId, blocks, mode) => {
      const value = typeof blocks[0]?.text === 'string' ? blocks[0].text : ''
      if (value === 'second' && failOnce) {
        failOnce = false
        runtime.prompts.push({ sessionId, text: value })
        throw new Error('send failed')
      }
      return prompt(sessionId, blocks, mode)
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'submit', text: 'first' })
    runtime.emit({ method: 'session.status', params: { sessionId: 's1', status: 'running' } })
    app.dispatch({ type: 'setDraft', text: 'second' })
    app.dispatch({ type: 'queuePrompt' })

    runtime.emit({ method: 'session.status', params: { sessionId: 's1', status: 'idle' } })
    await vi.waitFor(() => expect(app.snapshot().status.queueCount).toBe(1))
    expect(app.snapshot().agent).toBe('idle')

    app.dispatch({ type: 'command', line: '/queue' })
    app.dispatch({ type: 'queue.restore' })

    await vi.waitFor(() => expect(app.snapshot().status.queueCount).toBe(0))
    expect(runtime.prompts.map((item) => item.text)).toEqual(['first', 'second', 'second'])
    expect(app.snapshot().agent).toBe('running')
  })

  it('does not restore a failed prompt after switching sessions', async () => {
    const runtime = fakeRuntime()
    const prompt = runtime.prompt.bind(runtime)
    let rejectQueuedPrompt: ((error: Error) => void) | undefined
    runtime.prompt = async (sessionId, blocks, mode) => {
      const value = typeof blocks[0]?.text === 'string' ? blocks[0].text : ''
      if (value === 'second') {
        runtime.prompts.push({ sessionId, text: value })
        return new Promise<string>((_resolve, reject) => {
          rejectQueuedPrompt = reject
        })
      }
      return prompt(sessionId, blocks, mode)
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'submit', text: 'first' })
    runtime.emit({ method: 'session.status', params: { sessionId: 's1', status: 'running' } })
    app.dispatch({ type: 'setDraft', text: 'second' })
    app.dispatch({ type: 'queuePrompt' })
    runtime.emit({ method: 'session.status', params: { sessionId: 's1', status: 'idle' } })
    await vi.waitFor(() => expect(rejectQueuedPrompt).toBeTypeOf('function'))

    app.dispatch({ type: 'command', line: '/new' })
    rejectQueuedPrompt?.(new Error('late failure'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(app.snapshot().header.sessionId).not.toBe('s1')
    expect(app.snapshot().status.queueCount).toBe(0)
    expect(app.snapshot().agent).toBe('idle')
  })

  it('ingests session.event into nodes', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 1,
          time: 1,
          data: {
            id: 'u1',
            role: 'user',
            content: [{ type: 'text', text: 'hi' }],
            source: { kind: 'user' },
          },
        },
      },
    })
    expect(app.snapshot().nodes[0]).toMatchObject({ kind: 'user', text: 'hi' })
  })

  it('coalesces synchronous runtime notifications into one render wakeup', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    let wakeups = 0
    app.subscribe(() => {
      wakeups += 1
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'assistant/chunk',
          seq: 1,
          time: 1,
          data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: 'a' } },
        },
      },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'assistant/chunk',
          seq: 2,
          time: 2,
          data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: 'b' } },
        },
      },
    })
    expect(wakeups).toBe(0)
    await vi.waitFor(() => expect(wakeups).toBe(1))
    expect(app.snapshot().nodes[0]).toMatchObject({ text: 'ab' })
  })

  it('ignores events for other sessions', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 'other',
        event: {
          type: 'user/message',
          seq: 1,
          time: 1,
          data: {
            id: 'u1',
            content: [{ type: 'text', text: 'nope' }],
          },
        },
      },
    })
    expect(app.snapshot().nodes).toEqual([])
  })

  it('requests cancellation then quits on the second press', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(false)
    await expect.poll(() => runtime.cancels).toEqual([{ sessionId: 's1', keepInbox: true }])
    expect(app.snapshot().notice?.message).toMatch(/Cancel requested/)
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(true)
  })

  it('stops in-flight tool clocks when cancellation is accepted', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'tool/call',
          seq: 1,
          time: Date.now() - 5_000,
          data: {
            turn: 1,
            step: 0,
            callId: 'write-1',
            name: 'write',
            arguments: '{"file_path":"/tmp/notes.md"}',
          },
        },
      },
    })
    expect(app.snapshot().nodes[0]).toMatchObject({ kind: 'tool', status: 'running' })
    app.dispatch({ type: 'interruptOrQuit' })
    await expect.poll(() => runtime.cancels).toEqual([{ sessionId: 's1', keepInbox: true }])
    expect(app.snapshot().nodes[0]).toMatchObject({ kind: 'tool', status: 'cancelled' })
    expect(app.snapshot().notice?.message).toMatch(/Cancel requested/)
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'idle' },
    })
    expect(app.snapshot().notice).toBeUndefined()
  })

  it('settles in-flight tools when the session becomes idle', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'tool/call',
          seq: 1,
          time: 1,
          data: {
            turn: 1,
            step: 0,
            callId: 'write-1',
            name: 'write',
            arguments: '{}',
          },
        },
      },
    })
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'idle' },
    })
    expect(app.snapshot().nodes[0]).toMatchObject({ kind: 'tool', status: 'cancelled' })
    expect(app.snapshot().notice).toBeUndefined()
  })

  it('requires two idle interrupts to quit', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(false)
    expect(app.snapshot().quitConfirmation).toBe(true)
    expect(app.snapshot().notice).toBeUndefined()
    app.dispatch({ type: 'quit.cancel' })
    expect(app.snapshot().quitConfirmation).toBe(false)
    expect(app.snapshot().exiting).toBe(false)
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().quitConfirmation).toBe(true)
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(true)
  })

  it('confirms an idle Ctrl+C quit through the confirmation action', async () => {
    const app = createTuiApp({
      runtime: fakeRuntime(),
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()

    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().quitConfirmation).toBe(true)
    expect(app.snapshot().quitConfirmationSelection).toBe('confirm')
    app.dispatch({ type: 'quit.move', delta: 1 })
    expect(app.snapshot().quitConfirmationSelection).toBe('cancel')
    app.dispatch({ type: 'quit.confirm' })
    expect(app.snapshot().quitConfirmation).toBe(false)
    expect(app.snapshot().exiting).toBe(false)

    app.dispatch({ type: 'interruptOrQuit' })
    app.dispatch({ type: 'quit.move', delta: -1 })
    app.dispatch({ type: 'quit.confirm' })
    expect(app.snapshot().exiting).toBe(true)
  })

  it('clears the interrupt arm when the composer changes', async () => {
    const app = createTuiApp({
      runtime: fakeRuntime(),
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, rewind: true },
    })
    await app.start()
    app.dispatch({ type: 'interruptOrQuit' })
    app.dispatch({ type: 'insertDraft', text: 'draft' })
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(false)
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(true)
  })

  it('opens rewind on double Esc when the composer is empty', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, rewind: true },
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 2,
          time: 2,
          data: { id: 'u1', content: [{ type: 'text', text: 'retry this' }] },
        },
      },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 5,
          time: 5,
          data: { id: 'u2', content: [{ type: 'text', text: 'retry latest' }] },
        },
      },
    })
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(false)
    expect(app.snapshot().notice?.message).toContain('Press Esc again')
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().rewindPicker?.open).toBe(true)
    app.dispatch({ type: 'rewind.confirm' })
    expect(app.snapshot().rewindPicker?.confirming).toBe(true)
    app.dispatch({ type: 'rewind.confirm' })
    await expect.poll(() => app.snapshot().header.sessionId).toBe('rewound-session')
    expect(runtime.rewinds).toEqual([
      { sourceSessionId: 's1', messageSeq: 5, replaceSessionId: 's1' },
    ])
    expect(app.snapshot().nodes).toMatchObject([{ kind: 'user', text: 'retry this' }])
    expect(app.snapshot().composer.text).toBe('retry latest')
  })

  it('rebuilds telemetry and durable status from the rewind seed', async () => {
    const runtime = fakeRuntime()
    runtime.rewindSeed = [
      {
        type: 'user/message',
        seq: 1,
        time: 1,
        data: { id: 'seed-user', content: [{ type: 'text', text: 'keep this' }] },
      },
      {
        type: 'request/context',
        seq: 2,
        time: 2,
        data: { contextWindow: 1000 },
      },
      {
        type: 'assistant/message',
        seq: 3,
        time: 3,
        data: {
          turn: 1,
          step: 1,
          message: { content: [{ type: 'text', text: 'seed answer' }] },
          usage: { inputTokens: 120, outputTokens: 30 },
        },
      },
      {
        type: 'todo/write',
        seq: 4,
        time: 4,
        data: { todos: [{ content: 'review the result', status: 'in_progress' }] },
      },
    ]
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, rewind: true },
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 5,
          time: 5,
          data: { id: 'u1', content: [{ type: 'text', text: 'retry this' }] },
        },
      },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 6,
          time: 6,
          data: { id: 'u2', content: [{ type: 'text', text: 'retry again' }] },
        },
      },
    })
    app.dispatch({ type: 'interruptOrQuit' })
    app.dispatch({ type: 'interruptOrQuit' })
    app.dispatch({ type: 'rewind.confirm' })
    app.dispatch({ type: 'rewind.confirm' })

    await expect.poll(() => app.snapshot().header.sessionId).toBe('rewound-session')
    expect(app.snapshot().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'user', text: 'keep this' }),
        expect.objectContaining({
          kind: 'assistant',
          text: 'seed answer',
          usage: { input: 120, output: 30 },
        }),
      ]),
    )
    expect(app.snapshot().status.tokens).toEqual({ input: 120, output: 30 })
    expect(app.snapshot().status.telemetry.contextPercent).toBe(12)
    expect(app.snapshot().status.todos).toEqual([
      { content: 'review the result', status: 'in_progress' },
    ])
  })

  it('reports a failed cancellation request without claiming completion', async () => {
    const runtime = fakeRuntime()
    runtime.cancelError = new Error('wire unavailable')
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    app.dispatch({ type: 'interruptOrQuit' })
    await expect.poll(() => app.snapshot().notice?.message).toContain('Cancel request failed')
    expect(app.snapshot().exiting).toBe(false)
    app.dispatch({ type: 'interruptOrQuit' })
    expect(app.snapshot().exiting).toBe(true)
  })

  it('marks dead when initialize fails', async () => {
    const runtime = fakeRuntime()
    runtime.failStart = new Error('no lib/')
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
    })
    await app.start()
    expect(app.snapshot().agent).toBe('dead')
    expect(app.snapshot().notice?.tone).toBe('error')
  })

  it('/new changes session id and clears nodes', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'user/message',
          seq: 1,
          time: 1,
          data: { id: 'u1', content: [{ type: 'text', text: 'x' }] },
        },
      },
    })
    app.dispatch({ type: 'command', line: '/new' })
    const snap = app.snapshot()
    expect(snap.header.sessionId).not.toBe('s1')
    expect(snap.nodes).toEqual([])
  })

  it('/new resets session control state before the first prompt', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      permissionMode(
        sessionId: string,
        mode?: string,
      ): Promise<{ mode: string; supportedModes: string[] }>
      planMode(sessionId: string, active?: boolean): Promise<{ active: boolean }>
    }
    const planStates = new Map([['s1', true]])
    const permissionModes = new Map([['s1', 'allow-all']])
    runtime.planMode = async (sessionId, active) => {
      if (active !== undefined) planStates.set(sessionId, active)
      return { active: planStates.get(sessionId) ?? false }
    }
    runtime.permissionMode = async (sessionId, mode) => {
      if (mode !== undefined) permissionModes.set(sessionId, mode)
      return {
        mode: permissionModes.get(sessionId) ?? 'manual',
        supportedModes: ['manual', 'allow-all'],
      }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, permissionMode: true, planMode: true },
    })
    await app.start()
    expect(app.snapshot().status).toMatchObject({ permissionMode: 'allow-all', planMode: true })

    app.dispatch({ type: 'command', line: '/new' })

    expect(app.snapshot().status).toMatchObject({ permissionMode: 'manual', planMode: false })
  })

  it('does not change session controls while switching sessions', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      planMode(sessionId: string, active?: boolean): Promise<{ active: boolean }>
    }
    let releaseRestart!: () => void
    const restartReady = new Promise<void>((resolve) => {
      releaseRestart = resolve
    })
    const planCalls: string[] = []
    runtime.planMode = async (sessionId) => {
      planCalls.push(sessionId)
      return { active: false }
    }
    runtime.restart = async () => {
      await restartReady
      return { name: 'fake-runtime', version: '0' }
    }
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, planMode: true },
      locale: 'zh',
    })
    await app.start()
    planCalls.length = 0

    app.dispatch({ type: 'command', line: '/model m2' })
    app.dispatch({ type: 'command', line: '/plan' })

    expect(planCalls).toEqual([])
    expect(app.snapshot().notice?.message).toBe('正在切换会话，请等待当前操作完成。')
    releaseRestart()
    await expect.poll(() => app.snapshot().agent).toBe('idle')
  })

  it('edits the draft around a cursor', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
    })
    await app.start()
    app.dispatch({ type: 'setDraft', text: 'ac' })
    app.dispatch({ type: 'moveCursor', delta: -1 })
    app.dispatch({ type: 'insertDraft', text: 'b' })
    expect(app.snapshot().composer).toMatchObject({ text: 'abc', cursor: 2 })
    app.dispatch({ type: 'deleteBackward' })
    expect(app.snapshot().composer).toMatchObject({ text: 'ac', cursor: 1 })
  })

  it('selects and replaces draft text through app actions', async () => {
    const app = createTuiApp({
      runtime: fakeRuntime(),
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
    })
    await app.start()
    app.dispatch({ type: 'setDraft', text: 'hello' })
    app.dispatch({ type: 'selectAllDraft' })
    expect(app.snapshot().composer.selection).toEqual({ start: 0, end: 5 })
    app.dispatch({ type: 'insertDraft', text: 'hi' })
    expect(app.snapshot().composer).toMatchObject({ text: 'hi', cursor: 2 })
    expect(app.snapshot().composer.selection).toBeUndefined()
  })

  it('appends selected file content when submitting a prompt', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cocode-app-context-'))
    try {
      await writeFile(join(cwd, 'README.md'), '# Cocode\n')
      const runtime = fakeRuntime()
      const app = createTuiApp({
        runtime,
        cwd,
        provider: 'p',
        model: 'm',
        sessionId: 's1',
      })
      await app.start()
      app.dispatch({ type: 'setDraft', text: 'review @README.md' })
      app.dispatch({ type: 'attachFile', start: 7, end: 17, path: 'README.md' })
      expect(app.snapshot().composer.attachments).toEqual(['README.md'])
      app.dispatch({ type: 'submit', text: app.snapshot().composer.text })
      await vi.waitFor(() => expect(runtime.prompts).toHaveLength(1))
      expect(runtime.prompts[0]?.text).toContain('[Attached file: README.md]')
      expect(runtime.prompts[0]?.text).toContain('# Cocode')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('marks the app dead when the runtime transport closes', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
    })
    await app.start()
    runtime.emitClose('stderr tail')
    expect(app.snapshot().agent).toBe('dead')
    expect(app.snapshot().composer.disabled).toBe(true)
    expect(app.snapshot().notice?.message).toMatch(/stderr tail/)
  })

  it('closes the runtime once for repeated quit actions', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
    })
    await app.start()
    app.dispatch({ type: 'quit' })
    app.dispatch({ type: 'quit' })
    await app.close()
    expect(runtime.closeCount).toBe(1)
    expect(app.snapshot().exiting).toBe(true)
  })

  it('shows the latest assistant usage without inventing zeroes', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'assistant/message',
          seq: 1,
          time: 1,
          data: {
            turn: 1,
            step: 1,
            message: { content: [{ type: 'text', text: 'done' }] },
            usage: { inputTokens: 12, outputTokens: 4 },
          },
        },
      },
    })
    expect(app.snapshot().status.tokens).toEqual({ input: 12, output: 4 })
  })

  it('projects optional telemetry events into status and clears it for /new', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'request/context',
          seq: 1,
          time: 1,
          data: { contextWindow: 100 },
        },
      },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'assistant/message',
          seq: 2,
          time: 2,
          data: {
            message: { content: [{ type: 'text', text: 'done' }] },
            usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 30 },
          },
        },
      },
    })
    expect(app.snapshot().status.telemetry).toMatchObject({
      contextWindow: 100,
      contextPercent: 50,
      usage: { input: 20, output: 5, cacheRead: 30 },
    })
    app.dispatch({ type: 'command', line: '/new' })
    expect(app.snapshot().status.telemetry).toEqual({
      totals: { input: 0, output: 0 },
      tpsSamples: [],
      contextSegments: {
        system: 0,
        prompt: 0,
        assistant: 0,
        thinking: 0,
        tools: 0,
      },
    })
  })

  it('projects goal and todo events into status', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'todo/write',
          seq: 1,
          time: 1,
          data: {
            todos: [
              { content: 'one', status: 'completed' },
              { content: 'two', status: 'pending' },
            ],
          },
        },
      },
    })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'goal/change',
          seq: 2,
          time: 2,
          data: {
            operation: 'create',
            goal: {
              id: 'g1',
              revision: 1,
              objective: 'ship',
              phase: 'active',
              maxGoalRounds: 3,
              roundsStarted: 0,
            },
          },
        },
      },
    })
    expect(app.snapshot().status.todos).toEqual([
      { content: 'one', status: 'completed' },
      { content: 'two', status: 'pending' },
    ])
    expect(app.snapshot().status.goal?.phase).toBe('active')
  })

  it('opens and navigates the current checklist without mutating todos', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
    })
    await app.start()
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'todo/write',
          seq: 1,
          time: 1,
          data: {
            todos: [
              { content: 'done', status: 'completed' },
              { content: 'active', status: 'in_progress' },
              { content: 'next', status: 'pending' },
            ],
          },
        },
      },
    })

    app.dispatch({ type: 'command', line: '/todos' })
    expect(app.snapshot().checklist).toEqual({ open: true, selected: 1 })

    app.dispatch({ type: 'checklist.move', delta: 1 })
    expect(app.snapshot().checklist?.selected).toBe(2)
    expect(app.snapshot().status.todos.map((todo) => todo.content)).toEqual([
      'done',
      'active',
      'next',
    ])

    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: { type: 'turn/start', seq: 2, time: 2, data: {} },
      },
    })
    expect(app.snapshot().status.todos).toEqual([])
    expect(app.snapshot().checklist).toBeUndefined()

    app.dispatch({ type: 'checklist.close' })
    expect(app.snapshot().checklist).toBeUndefined()
  })

  it('projects subagent lifecycle into status without leaking other sessions', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      locale: 'zh',
    })
    await app.start()
    runtime.emit({
      method: 'subagent.started',
      params: { parentSessionId: 'other', childSessionId: 'ignored' },
    })
    expect(app.snapshot().status.subagents?.running).toBe(0)
    runtime.emit({
      method: 'subagent.started',
      params: { parentSessionId: 's1', childSessionId: 'child-1' },
    })
    expect(app.snapshot().status.subagents).toEqual({
      running: 1,
      last: { id: 'child-1', event: 'started' },
    })
    runtime.emit({
      method: 'subagent.finished',
      params: {
        parentSessionId: 's1',
        childSessionId: 'child-1',
        provider: 'p',
        agentId: 'a1',
        status: 'ok',
      },
    })
    expect(app.snapshot().status.subagents).toEqual({
      running: 0,
      last: { id: 'child-1', event: 'finished' },
    })
  })

  it('opens a direct-child picker and reads the selected child history', async () => {
    const runtime = fakeRuntime()
    runtime.listSubagents = async () => ({
      entries: [{ kind: 'child', id: 'child-1', label: 'worker', activity: 'inactive', mode: 'one-shot', hasChildren: false }],
      parentAvailable: true,
    })
    runtime.subagentHistory = async () => ({
      events: [{ type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'child task' }] } }],
      hasMore: false,
    })
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, subagentList: true, subagentHistory: true },
    })
    await app.start()

    app.dispatch({ type: 'command', line: '/subagents' })
    await vi.waitFor(() => expect(app.snapshot().subagentPicker?.open).toBe(true))
    expect(app.snapshot().subagentPicker?.entries[0]?.label).toBe('worker')
    app.dispatch({ type: 'subagents.confirm' })
    await vi.waitFor(() => expect(app.snapshot().header.sessionId).toBe('child-1'))
    expect(app.snapshot().header.readOnly).toBe(true)
  })

  it('doctor redacts credentials and reports launch state', async () => {
    const runtime = fakeRuntime()
    runtime.failStart = new Error('API_KEY=sk-secret')
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      diagnostics: {
        tty: true,
        launchConfigured: false,
        argsConfigured: true,
        sessionRoot: '/tmp/sessions',
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/doctor' })
    const message = app.snapshot().notice?.message ?? ''
    expect(message).toMatch(/tty yes/)
    expect(message).toMatch(/launch unset/)
    expect(message).toMatch(/initialize error/)
    expect(message).not.toMatch(/sk-|API_KEY=|ck_live_/)
  })

  it('/status mentions auth mode and never prints a key', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionId: 's1',
      auth: {
        mode: 'byok',
        envLocked: true,
        accountLabel: 'Ada',
        logout: async () => {},
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/status' })
    const message = app.snapshot().notice?.message ?? ''
    expect(message).toMatch(/auth: byok/)
    expect(message).toMatch(/env-locked/)
    expect(message).toMatch(/account: Ada/)
    expect(message).not.toMatch(/sk-|ck_live_|API_KEY=/)
  })

  it('/use byok restarts the runtime as a new session', async () => {
    const runtime = fakeRuntime() as TuiRuntime & {
      permissionMode(): Promise<{ mode: string; supportedModes: string[] }>
      planMode(): Promise<{ active: boolean }>
    }
    runtime.permissionMode = async () => ({
      mode: 'allow-all',
      supportedModes: ['manual', 'allow-all'],
    })
    runtime.planMode = async () => ({ active: true })
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'cocode-nut',
      model: 'cloud-1',
      sessionId: 's1',
      capabilities: { ...P0_CAPABILITIES, permissionMode: true, planMode: true },
      auth: {
        mode: 'cocode',
        envLocked: false,
        logout: async () => {},
        selectMode: async () => ({ status: 'ready' }),
        resolved: () => ({
          mode: 'byok',
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          cwd: '/tmp',
          origin: 'https://cocode.agency',
          home: '/tmp/home',
          env: { DEEPSEEK_API_KEY: 'sk-x', DSH_HOME: '/tmp/home' },
        }),
      },
    })
    await app.start()
    expect(app.snapshot().status).toMatchObject({ permissionMode: 'allow-all', planMode: true })
    runtime.emit({
      method: 'session.event',
      params: {
        sessionId: 's1',
        event: {
          type: 'assistant/message',
          seq: 1,
          time: 1,
          data: {
            turn: 1,
            step: 1,
            message: { content: [{ type: 'text', text: 'old' }] },
          },
        },
      },
    })
    expect(app.snapshot().nodes.length).toBeGreaterThan(0)
    app.dispatch({ type: 'command', line: '/use byok' })
    await expect.poll(() => app.snapshot().header.provider).toBe('deepseek-official')
    expect(runtime.restarts).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    ])
    expect(app.snapshot().header.sessionId).not.toBe('s1')
    expect(app.snapshot().nodes).toEqual([])
    expect(app.snapshot().status).toMatchObject({ permissionMode: 'manual', planMode: false })
    expect(app.snapshot().notice?.message).toMatch(/API Key/)
    expect(app.snapshot().notice?.message).toMatch(/新会话/)
    expect(app.snapshot().notice?.message).not.toMatch(/sk-|ck_/)
    expect(app.snapshot().agent).toBe('idle')
  })

  it('/use byok without a key captures a masked paste', async () => {
    const runtime = fakeRuntime()
    const keys: string[] = []
    let modeCalls = 0
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'cocode-nut',
      model: 'cloud-1',
      sessionId: 's1',
      auth: {
        mode: 'cocode',
        envLocked: false,
        logout: async () => {},
        selectMode: async () => {
          modeCalls += 1
          return modeCalls === 1 ? { status: 'need-byok' } : { status: 'ready' }
        },
        submitByok: async (key) => {
          keys.push(key)
        },
        resolved: () => ({
          mode: 'byok',
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          cwd: '/tmp',
          origin: 'https://cocode.agency',
          home: '/tmp/home',
          env: { DEEPSEEK_API_KEY: 'sk-new', DSH_HOME: '/tmp/home' },
        }),
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/use byok' })
    await expect.poll(() => app.snapshot().composer.mask).toBe(true)
    app.dispatch({ type: 'submit', text: '   ' })
    expect(app.snapshot().composer.mask).toBe(true)
    expect(runtime.restarts).toEqual([])
    app.dispatch({ type: 'submit', text: 'sk-new' })
    await expect.poll(() => app.snapshot().header.provider).toBe('deepseek-official')
    expect(keys).toEqual(['sk-new'])
    expect(app.snapshot().composer.mask).toBeUndefined()
    expect(app.snapshot().exiting).toBe(false)
  })

  it('/logout keeps the TUI when BYOK remains', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'cocode-nut',
      model: 'cloud-1',
      sessionId: 's1',
      auth: {
        mode: 'cocode',
        envLocked: false,
        logout: async () => {},
        snapshot: () => ({
          phase: 'ready',
          mode: 'byok',
          envLocked: false,
          channels: { byok: true, cocode: false },
        }),
        resolved: () => ({
          mode: 'byok',
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          cwd: '/tmp',
          origin: 'https://cocode.agency',
          home: '/tmp/home',
          env: { DEEPSEEK_API_KEY: 'sk-x', DSH_HOME: '/tmp/home' },
        }),
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/logout' })
    await expect.poll(() => app.snapshot().header.provider).toBe('deepseek-official')
    expect(app.snapshot().exiting).toBe(false)
    expect(app.snapshot().header.sessionId).not.toBe('s1')
  })

  it('refuses /use while a turn is running', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'p',
      model: 'm',
      sessionId: 's1',
      auth: {
        mode: 'byok',
        envLocked: false,
        logout: async () => {},
        selectMode: async () => ({ status: 'ready' }),
      },
    })
    await app.start()
    runtime.emit({
      method: 'session.status',
      params: { sessionId: 's1', status: 'running' },
    })
    app.dispatch({ type: 'command', line: '/use cocode' })
    expect(runtime.restarts).toEqual([])
    expect(app.snapshot().notice?.message).toMatch(/Turn in progress|先等|Esc/)
  })

  it('refuses /use when another TUI shares the home', async () => {
    const runtime = fakeRuntime()
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'cocode-nut',
      model: 'cloud-1',
      sessionId: 's1',
      auth: {
        mode: 'cocode',
        envLocked: false,
        logout: async () => {},
        exclusiveHome: async () => false,
        selectMode: async () => ({ status: 'ready' }),
        resolved: () => ({
          mode: 'byok',
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          cwd: '/tmp',
          origin: 'https://cocode.agency',
          home: '/tmp/home',
          env: { DEEPSEEK_API_KEY: 'sk-x', DSH_HOME: '/tmp/home' },
        }),
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/use byok' })
    await expect.poll(() => app.snapshot().notice?.message ?? '').toMatch(/AUTH_HOME_BUSY/)
    expect(runtime.restarts).toEqual([])
    expect(app.snapshot().header.provider).toBe('cocode-nut')
    expect(app.snapshot().header.sessionId).toBe('s1')
  })

  it('refuses /logout when another TUI shares the home', async () => {
    const runtime = fakeRuntime()
    let loggedOut = false
    const app = createTuiApp({
      runtime,
      cwd: '/tmp',
      provider: 'cocode-nut',
      model: 'cloud-1',
      sessionId: 's1',
      auth: {
        mode: 'cocode',
        envLocked: false,
        exclusiveHome: async () => false,
        logout: async () => {
          loggedOut = true
        },
        snapshot: () => ({
          phase: 'ready',
          mode: 'byok',
          envLocked: false,
          channels: { byok: true, cocode: false },
        }),
        resolved: () => ({
          mode: 'byok',
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          cwd: '/tmp',
          origin: 'https://cocode.agency',
          home: '/tmp/home',
          env: { DEEPSEEK_API_KEY: 'sk-x', DSH_HOME: '/tmp/home' },
        }),
      },
    })
    await app.start()
    app.dispatch({ type: 'command', line: '/logout' })
    await expect.poll(() => app.snapshot().notice?.message ?? '').toMatch(/AUTH_HOME_BUSY/)
    expect(loggedOut).toBe(false)
    expect(app.snapshot().exiting).toBe(false)
    expect(runtime.restarts).toEqual([])
  })
})
