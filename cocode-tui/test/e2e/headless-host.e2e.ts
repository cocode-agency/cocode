import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TUI_ROOT = resolve(import.meta.dirname, '../..')
const REPO_ROOT = resolve(TUI_ROOT, '..')
const CLI_ENTRY = join(TUI_ROOT, 'bin', 'cocode-tui.mjs')
const SUPERVISOR_ENTRY = join(
  REPO_ROOT,
  'cocode-host-supervisor',
  'packages',
  'host-supervisor',
  'lib',
  'bin.js',
)
const PROVIDER = 'deepseek-official'
const MODEL = 'deepseek-v4-flash'
const SUCCESS_PROMPT = 'Return the exact marker COCODE_E2E_ASSISTANT_OK.'
const SUCCESS_REPLY = 'COCODE_E2E_ASSISTANT_OK'
const FAILURE_PROMPT = 'COCODE_E2E_FORCE_PROVIDER_ERROR'
const HTTP_FAILURE_PROMPT = 'COCODE_E2E_FORCE_PROVIDER_HTTP_ERROR'
const MALFORMED_SSE_PROMPT = 'COCODE_E2E_FORCE_MALFORMED_SSE'
const TRUNCATED_SSE_PROMPT = 'COCODE_E2E_FORCE_TRUNCATED_SSE'
const TOOL_PROMPT = 'COCODE_E2E_FORCE_BASH_TOOL'
const TOOL_FILE_NAME = 'cocode-e2e-tool-output.txt'
const TOOL_FILE_CONTENT = 'COCODE_E2E_TOOL_OK\n'
const TOOL_REPLY = 'COCODE_E2E_TOOL_COMPLETED'
const CONTINUATION_FIRST_PROMPT = 'COCODE_E2E_CONTINUATION_FIRST'
const CONTINUATION_SECOND_PROMPT = 'COCODE_E2E_CONTINUATION_SECOND'

type FixtureRequest = {
  body: Record<string, unknown>
  headers: IncomingMessage['headers']
  url: string
}

type ProcessResult = {
  code: number
  signal: NodeJS.Signals | null
  stderr: string
  stdout: string
}

type EventReason = {
  kind?: string
  error?: {
    code?: string
    message?: string
  }
}

type EventRecord = {
  method?: string
  params?: {
    event?: { type?: string; data?: { reason?: EventReason } }
    status?: string
  }
}

describe('cocode run with the real Host', () => {
  let root: string
  let workspace: string
  let eventRoot: string
  let fixture: Awaited<ReturnType<typeof startFixtureServer>>
  let env: NodeJS.ProcessEnv

  beforeAll(async () => {
    root = await mkdtemp(join(e2eTempRoot(), 'ct-e2e-'))
    workspace = join(root, 'workspace')
    eventRoot = join(root, 'events')
    await Promise.all([mkdir(workspace), mkdir(eventRoot)])
    fixture = await startFixtureServer()

    const dshHome = join(root, 'dsh-home')
    await mkdir(join(dshHome, 'profiles', 'cocode'), { recursive: true, mode: 0o700 })
    await chmod(dshHome, 0o700)
    await chmod(join(dshHome, 'profiles'), 0o700)
    await chmod(join(dshHome, 'profiles', 'cocode'), 0o700)
    await writeFile(
      join(dshHome, 'profiles', 'cocode', 'cordis.patch.yml'),
      '# TUI E2E uses the JSON-RPC gateway instead of the Web API gateway.\n' +
      '- id: api-gateway\n' +
      '  disabled: true\n' +
      '- id: session-persistence-jsonl\n' +
      '  config:\n' +
      '    root: !!js dshHomePath(\'sessions\')\n' +
      '    compression: none\n',
      { mode: 0o600 },
    )
    const inheritedEnv = { ...process.env }
    for (const key of ['COCODE_LLM_PROVIDERS', 'COCODE_MODEL', 'COCODE_PROVIDER', 'DSH_PROFILE']) {
      delete inheritedEnv[key]
    }
    env = {
      ...inheritedEnv,
      COCODE_DSH_HOME: dshHome,
      DEEPSEEK_API_KEY: 'fixture-key',
      DEEPSEEK_BASE_URL: fixture.baseUrl,
      COCODE_HOME: join(root, 'cocode-home'),
      COCODE_HOST_CONFIG_FINGERPRINT: 'cocode-tui-e2e-v1',
      COCODE_HOST_IDLE_TIMEOUT_MS: '30000',
      COCODE_HOST_RUNTIME_HOME: join(root, 'host-runtimes'),
      COCODE_LOG_ROOT: join(root, 'logs'),
      COCODE_NODE_EXECUTABLE: process.execPath,
      COCODE_SUPERVISOR_HOME: join(root, 'supervisor'),
      COCODE_SUPERVISOR_SERVICE_ENTRY: SUPERVISOR_ENTRY,
      DSH_HOME: dshHome,
      DSH_PROFILE: 'cocode',
      DSH_SESSION_ROOT: join(dshHome, 'sessions'),
      NO_PROXY: '127.0.0.1,localhost',
    }
  })

  afterAll(async () => {
    if (env !== undefined) {
      await runCli(['host', 'stop', '--force'], env, 30_000).catch(() => undefined)
    }
    await fixture?.close()
    if (root !== undefined && process.env.COCODE_E2E_KEEP_ARTIFACTS !== '1') {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('completes a prompt through the real CLI, Supervisor, Host, and provider wire', async () => {
    const sessionId = 'e2e-success'
    const eventLog = join(eventRoot, `${sessionId}.jsonl`)
    const result = await runHeadlessCli({ eventLog, prompt: SUCCESS_PROMPT, sessionId })

    expect(
      result.code,
      `${result.stderr}\n${await hostStatus()}\nfixture requests: ${JSON.stringify(fixture.requests)}`,
    ).toBe(0)
    expect(result.signal).toBeNull()
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'completed',
      sessionId,
      provider: PROVIDER,
      model: MODEL,
      host: { runtimeVersion: expect.any(String) },
    })

    const request = fixture.requests.find((entry) =>
      JSON.stringify(entry.body).includes(SUCCESS_PROMPT),
    )
    expect(request).toBeDefined()
    expect(request?.url).toBe('/chat/completions')
    expect(request?.headers.authorization).toBe('Bearer fixture-key')
    expect(request?.body).toMatchObject({ model: MODEL, stream: true })

    const events = await readEventLog(eventLog)
    expect(eventTypes(events)).toContain('turn/end')
    expect(JSON.stringify(events)).toContain(SUCCESS_REPLY)
    expectEventOrder(events, ['running', 'turn/end', 'idle'])

    const persisted = await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)
    expect(persisted).toContain(SUCCESS_PROMPT)
    expect(persisted).toContain(SUCCESS_REPLY)
    expect(persisted).toContain('turn/end')
  })

  it('reports a real provider terminal error instead of treating idle as success', async () => {
    const sessionId = 'e2e-provider-error'
    const eventLog = join(eventRoot, `${sessionId}.jsonl`)
    const result = await runHeadlessCli({ eventLog, prompt: FAILURE_PROMPT, sessionId })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('content_filter')

    const events = await readEventLog(eventLog)
    expect(eventTypes(events)).toContain('turn/end')
    expect(JSON.stringify(events)).toContain('content_filter')
    expectEventOrder(events, ['running', 'turn/end'])
    const terminal = events.find((entry) =>
      entry.method === 'session.event' && entry.params?.event?.type === 'turn/end',
    )
    expect(terminal?.params?.event?.data?.reason).toMatchObject({
      kind: 'error',
      error: {
        code: 'CONTENT_FILTER',
        message: 'model stopped: content_filter',
      },
    })
    const sequence = eventSequence(events)
    const terminalIndex = sequence.indexOf('turn/end')
    const idleIndex = sequence.indexOf('idle')
    expect(terminalIndex).toBeGreaterThanOrEqual(0)
    expect(idleIndex === -1 || idleIndex > terminalIndex).toBe(true)

    const persisted = await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)
    expect(persisted).toContain(FAILURE_PROMPT)
    expect(persisted).toContain('turn/end')
    expect(persisted).toContain('CONTENT_FILTER')
    expect(persisted).toContain('content_filter')
  })

  it('continues a persisted session through a second real CLI process', async () => {
    const sessionId = 'e2e-continuation'
    const firstEventLog = join(eventRoot, `${sessionId}-first.jsonl`)
    const secondEventLog = join(eventRoot, `${sessionId}-second.jsonl`)

    const firstRequestStart = fixture.requests.length
    const first = await runHeadlessCli({
      eventLog: firstEventLog,
      prompt: CONTINUATION_FIRST_PROMPT,
      sessionId,
    })
    expect(first.code).toBe(0)
    const firstRequests = fixture.requests.slice(firstRequestStart)
    expect(firstRequests.some((entry) => JSON.stringify(entry.body).includes(CONTINUATION_FIRST_PROMPT))).toBe(true)
    await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)

    const secondRequestStart = fixture.requests.length
    const second = await runHeadlessCli({
      eventLog: secondEventLog,
      prompt: CONTINUATION_SECOND_PROMPT,
      sessionId,
    })
    expect(second.code).toBe(0)
    expect(JSON.parse(second.stdout)).toMatchObject({
      status: 'completed',
      sessionId,
      provider: PROVIDER,
      model: MODEL,
    })
    const secondRequests = fixture.requests.slice(secondRequestStart)
    expect(secondRequests.some((entry) => JSON.stringify(entry.body).includes(CONTINUATION_SECOND_PROMPT))).toBe(true)

    const secondEvents = await readEventLog(secondEventLog)
    expect(JSON.stringify(secondEvents)).toContain(SUCCESS_REPLY)
    expectEventOrder(secondEvents, ['running', 'turn/end', 'idle'])

    const persisted = await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)
    expect(persisted).toContain(CONTINUATION_FIRST_PROMPT)
    expect(persisted).toContain(CONTINUATION_SECOND_PROMPT)
    expect((persisted.match(/"type":"turn\/end"/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('reports a provider HTTP failure as a terminal error', async () => {
    const sessionId = 'e2e-provider-http-error'
    const eventLog = join(eventRoot, `${sessionId}.jsonl`)
    const result = await runHeadlessCli({
      eventLog,
      prompt: HTTP_FAILURE_PROMPT,
      sessionId,
    })

    expect(result.code).toBe(1)
    const events = await readEventLog(eventLog)
    expect(eventTypes(events)).toContain('turn/end')
    expectEventOrder(events, ['running', 'turn/end'])
    const terminal = events.find((entry) =>
      entry.method === 'session.event' && entry.params?.event?.type === 'turn/end',
    )
    expect(terminal?.params?.event?.data?.reason?.kind).toBe('error')
    expect(JSON.stringify(terminal)).toContain('502')
    const sequence = eventSequence(events)
    const terminalIndex = sequence.indexOf('turn/end')
    const idleIndex = sequence.indexOf('idle')
    expect(terminalIndex).toBeGreaterThanOrEqual(0)
    expect(idleIndex === -1 || idleIndex > terminalIndex).toBe(true)

    const persisted = await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)
    expect(persisted).toContain(HTTP_FAILURE_PROMPT)
    expect(persisted).toContain('turn/end')
    expect(persisted).toContain('502')
  })

  it('reports malformed provider SSE as a terminal error', async () => {
    const sessionId = 'e2e-provider-malformed-sse'
    const eventLog = join(eventRoot, `${sessionId}.jsonl`)
    const result = await runHeadlessCli({
      eventLog,
      prompt: MALFORMED_SSE_PROMPT,
      sessionId,
    })

    expect(result.code).toBe(1)
    const events = await readEventLog(eventLog)
    expect(eventTypes(events)).toContain('turn/end')
    expectEventOrder(events, ['running', 'turn/end'])
    const terminal = events.find((entry) =>
      entry.method === 'session.event' && entry.params?.event?.type === 'turn/end',
    )
    expect(terminal?.params?.event?.data?.reason?.kind).toBe('error')
    const sequence = eventSequence(events)
    const terminalIndex = sequence.indexOf('turn/end')
    const idleIndex = sequence.indexOf('idle')
    expect(terminalIndex).toBeGreaterThanOrEqual(0)
    expect(idleIndex === -1 || idleIndex > terminalIndex).toBe(true)

    const persisted = await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)
    expect(persisted).toContain(MALFORMED_SSE_PROMPT)
    expect(persisted).toContain('turn/end')
  })

  it('reports a truncated provider SSE stream as a terminal error', async () => {
    const sessionId = 'e2e-provider-truncated-sse'
    const eventLog = join(eventRoot, `${sessionId}.jsonl`)
    const result = await runHeadlessCli({
      eventLog,
      prompt: TRUNCATED_SSE_PROMPT,
      sessionId,
    })

    expect(result.code).toBe(1)
    const events = await readEventLog(eventLog)
    expect(eventTypes(events)).toContain('turn/end')
    expectEventOrder(events, ['running', 'turn/end'])
    const terminal = events.find((entry) =>
      entry.method === 'session.event' && entry.params?.event?.type === 'turn/end',
    )
    expect(terminal?.params?.event?.data?.reason?.kind).toBe('error')
    const sequence = eventSequence(events)
    const terminalIndex = sequence.indexOf('turn/end')
    const idleIndex = sequence.indexOf('idle')
    expect(terminalIndex).toBeGreaterThanOrEqual(0)
    expect(idleIndex === -1 || idleIndex > terminalIndex).toBe(true)

    const persisted = await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)
    expect(persisted).toContain(TRUNCATED_SSE_PROMPT)
    expect(persisted).toContain('turn/end')
  })

  it('executes a real bash tool and persists its file side effect', async () => {
    const sessionId = 'e2e-bash-tool'
    const eventLog = join(eventRoot, `${sessionId}.jsonl`)
    const result = await runHeadlessCli({
      eventLog,
      prompt: TOOL_PROMPT,
      sessionId,
    })

    expect(result.code, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'completed',
      sessionId,
      provider: PROVIDER,
      model: MODEL,
    })

    expect(await readFile(join(workspace, TOOL_FILE_NAME), 'utf8')).toBe(TOOL_FILE_CONTENT)
    const request = fixture.requests.find((entry) =>
      JSON.stringify(entry.body).includes(TOOL_PROMPT) && Array.isArray(entry.body.tools),
    )
    expect(request?.body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: 'bash' }) }),
    ]))

    const events = await readEventLog(eventLog)
    expect(eventTypes(events)).toEqual(expect.arrayContaining(['tool/call', 'tool/result', 'turn/end']))
    expectEventOrder(events, ['running', 'tool/call', 'tool/result', 'turn/end', 'idle'])
    expect(JSON.stringify(events)).toContain(TOOL_FILE_NAME)
    expect(JSON.stringify(events)).toContain(TOOL_FILE_CONTENT.trim())
    expect(JSON.stringify(events)).toContain(TOOL_REPLY)

    const persisted = await waitForSessionText(env.DSH_SESSION_ROOT!, sessionId)
    expect(persisted).toContain(TOOL_PROMPT)
    expect(persisted).toContain('tool/call')
    expect(persisted).toContain('tool/result')
    expect(persisted).toContain(TOOL_REPLY)
  })

  function runHeadlessCli(options: {
    eventLog: string
    prompt: string
    sessionId: string
  }): Promise<ProcessResult> {
    return runCli([
      'run',
      '--allow-tools',
      '--cwd', workspace,
      '--event-log', options.eventLog,
      '--json',
      '--model', MODEL,
      '--provider', PROVIDER,
      '--session-id', options.sessionId,
      '--timeout', '60s',
      options.prompt,
    ], env, 90_000).catch((error) => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nfixture requests: ${JSON.stringify(fixture.requests)}`)
    })
  }

  async function hostStatus(): Promise<string> {
    const result = await runCli(['host', 'status', '--json'], env, 30_000)
    return result.stdout || result.stderr
  }
})

async function startFixtureServer(): Promise<{
  baseUrl: string
  close: () => Promise<void>
  requests: FixtureRequest[]
}> {
  const requests: FixtureRequest[] = []
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>
      requests.push({ body, headers: request.headers, url: request.url })
      const failure = JSON.stringify(body).includes(FAILURE_PROMPT)
      const hasBashTool = Array.isArray(body.tools)
        && body.tools.some((tool) => (
          typeof tool === 'object'
          && tool !== null
          && 'function' in tool
          && typeof tool.function === 'object'
          && tool.function !== null
          && 'name' in tool.function
          && tool.function.name === 'bash'
        ))
      const hasToolResult = Array.isArray(body.messages)
        && body.messages.some((message) => (
          typeof message === 'object'
          && message !== null
          && 'role' in message
          && message.role === 'tool'
        ))
      if (hasBashTool && JSON.stringify(body).includes(TOOL_PROMPT)) {
        if (hasToolResult) {
          writeCompletion(response, false, TOOL_REPLY)
        } else {
          writeBashToolCall(response)
        }
        return
      }
      if (JSON.stringify(body).includes(HTTP_FAILURE_PROMPT)) {
        response.writeHead(502, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          error: {
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'fixture upstream unavailable',
          },
        }))
        return
      }
      if (JSON.stringify(body).includes(MALFORMED_SSE_PROMPT)) {
        writeMalformedSse(response)
        return
      }
      if (JSON.stringify(body).includes(TRUNCATED_SSE_PROMPT)) {
        writeTruncatedSse(response)
        return
      }
      writeCompletion(response, failure)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('E2E fixture server did not expose a TCP address')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error === undefined ? resolveClose() : rejectClose(error))
    }),
  }
}

function e2eTempRoot(): string {
  const configured = process.env.COCODE_E2E_TMP_ROOT?.trim()
  if (configured !== undefined && configured !== '') return resolve(configured)
  // macOS resolves tmpdir() below /var/folders. Adding the Supervisor scope
  // and socket names can exceed the Unix-domain socket path limit.
  return process.platform === 'darwin' ? '/tmp' : tmpdir()
}

function writeCompletion(response: ServerResponse, failure: boolean, reply = SUCCESS_REPLY): void {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  })
  const chunk = (choices: unknown[], usage?: Record<string, number>) => {
    response.write(`data: ${JSON.stringify({
      id: failure ? 'chatcmpl-e2e-error' : 'chatcmpl-e2e-success',
      object: 'chat.completion.chunk',
      created: 1,
      model: MODEL,
      choices,
      ...(usage === undefined ? {} : { usage }),
    })}\n\n`)
  }
  chunk([{ index: 0, delta: { role: 'assistant' }, finish_reason: null }])
  if (!failure) {
    chunk([{ index: 0, delta: { content: reply }, finish_reason: null }])
  }
  chunk(
    [{ index: 0, delta: {}, finish_reason: failure ? 'content_filter' : 'stop' }],
    { prompt_tokens: 8, completion_tokens: failure ? 0 : 4, total_tokens: failure ? 8 : 12 },
  )
  response.end('data: [DONE]\n\n')
}

function writeMalformedSse(response: ServerResponse): void {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  })
  response.end('data: {"id":"chatcmpl-e2e-malformed"\n\n')
}

function writeTruncatedSse(response: ServerResponse): void {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  })
  response.write(`data: ${JSON.stringify({
    id: 'chatcmpl-e2e-truncated',
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }],
  })}\n\n`)
  response.destroy()
}

function writeBashToolCall(response: ServerResponse): void {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  })
  response.write(`data: ${JSON.stringify({
    id: 'chatcmpl-e2e-tool-call',
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL,
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: 'call-e2e-bash',
          type: 'function',
          function: {
            name: 'bash',
            arguments: JSON.stringify({
              command: `printf '${TOOL_FILE_CONTENT.replace('\n', '\\n')}' > ${TOOL_FILE_NAME}`,
              description: 'Create the E2E marker file',
            }),
          },
        }],
      },
      finish_reason: null,
    }],
  })}\n\n`)
  response.write(`data: ${JSON.stringify({
    id: 'chatcmpl-e2e-tool-call',
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  })}\n\n`)
  response.end('data: [DONE]\n\n')
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.once('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.once('error', rejectBody)
  })
}

function runCli(args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: TUI_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    let timedOut = false
    let forceKillTimer: NodeJS.Timeout | undefined
    let finalKillTimer: NodeJS.Timeout | undefined
    const timeoutError = () => new Error(
      `Cocode CLI timed out after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return
        child.kill('SIGKILL')
        finalKillTimer = setTimeout(() => {
          rejectRun(timeoutError())
        }, 2_000)
      }, 2_000)
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      if (finalKillTimer !== undefined) clearTimeout(finalKillTimer)
    }
    child.once('error', (error) => {
      cleanup()
      rejectRun(error)
    })
    child.once('close', (code, signal) => {
      cleanup()
      if (timedOut) {
        rejectRun(timeoutError())
        return
      }
      resolveRun({ code: code ?? 1, signal, stderr, stdout })
    })
  })
}

async function readEventLog(path: string): Promise<EventRecord[]> {
  const content = await readFile(path, 'utf8')
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventRecord)
}

function eventTypes(events: EventRecord[]): string[] {
  return events.flatMap((entry) =>
    entry.method === 'session.event' && entry.params?.event?.type !== undefined
      ? [entry.params.event.type]
      : [],
  )
}

function expectEventOrder(events: EventRecord[], expected: string[]): void {
  const sequence = eventSequence(events)
  let offset = -1
  for (const value of expected) {
    offset = sequence.indexOf(value, offset + 1)
    expect(offset, `Missing ordered event ${value} in ${sequence.join(' -> ')}`).toBeGreaterThanOrEqual(0)
  }
}

function eventSequence(events: EventRecord[]): string[] {
  return events.flatMap((entry) => {
    if (entry.method === 'session.status' && entry.params?.status !== undefined) {
      return [entry.params.status]
    }
    if (entry.method === 'session.event' && entry.params?.event?.type !== undefined) {
      return [entry.params.event.type]
    }
    return []
  })
}

async function waitForSessionText(sessionRoot: string, sessionId: string): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const content = await readSessionText(sessionRoot, sessionId)
    if (content !== '') return content
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`No persisted session log appeared under ${sessionRoot} for ${sessionId}`)
}

async function readSessionText(root: string, sessionId: string): Promise<string> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return ''
  }
  const content: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      content.push(await readSessionText(path, sessionId))
    } else if (entry.name === 'session.jsonl') {
      const text = await readFile(path, 'utf8')
      if (text.includes(sessionId)) content.push(text)
    }
  }
  return content.join('\n')
}
