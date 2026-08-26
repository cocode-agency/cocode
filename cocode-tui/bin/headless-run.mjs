import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { finished } from 'node:stream/promises'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000
const CANCELLATION_GRACE_MS = 1_000
const CANCEL_REQUEST_TIMEOUT_MS = 500
const APPROVAL_POLICIES = new Set(['allow', 'reject'])

export function parseRunArgs(args, env = process.env) {
  const options = {
    approvalPolicy: 'reject',
    cwd: env.COCODE_CWD?.trim() || env.DSH_CWD?.trim() || process.cwd(),
    eventLog: undefined,
    json: false,
    maxTokens: undefined,
    model: env.COCODE_MODEL?.trim() || 'deepseek-v4-flash',
    prompt: undefined,
    promptFile: undefined,
    provider: env.COCODE_PROVIDER?.trim() || 'deepseek-official',
    reasoningEffort: undefined,
    sessionId: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
  const remaining = [...args]
  while (remaining.length > 0) {
    const value = remaining.shift()
    if (value === '--json') { options.json = true; continue }
    if (value === '--allow-tools') { options.approvalPolicy = 'allow'; continue }
    if (value === '--reject-tools') { options.approvalPolicy = 'reject'; continue }
    if (value === '--approval-policy') {
      options.approvalPolicy = requiredValue(value, remaining)
      continue
    }
    if (value === '--cwd') { options.cwd = requiredValue(value, remaining); continue }
    if (value === '--event-log') { options.eventLog = requiredValue(value, remaining); continue }
    if (value === '--max-tokens') {
      options.maxTokens = positiveInteger(requiredValue(value, remaining), value)
      continue
    }
    if (value === '--model') { options.model = requiredValue(value, remaining); continue }
    if (value === '--prompt') { options.prompt = requiredValue(value, remaining); continue }
    if (value === '--prompt-file') { options.promptFile = requiredValue(value, remaining); continue }
    if (value === '--provider') { options.provider = requiredValue(value, remaining); continue }
    if (value === '--reasoning-effort') {
      options.reasoningEffort = requiredValue(value, remaining)
      continue
    }
    if (value === '--session-id') { options.sessionId = requiredValue(value, remaining); continue }
    if (value === '--timeout') {
      options.timeoutMs = parseDuration(requiredValue(value, remaining))
      continue
    }
    if (value.startsWith('-')) throw new Error(`Unknown cocode run option: ${value}`)
    if (options.prompt !== undefined) throw new Error('cocode run accepts only one prompt')
    options.prompt = value
  }
  if (!APPROVAL_POLICIES.has(options.approvalPolicy)) {
    throw new Error('--approval-policy must be allow or reject')
  }
  if (options.prompt !== undefined && options.promptFile !== undefined) {
    throw new Error('Use either --prompt or --prompt-file, not both')
  }
  options.cwd = resolve(options.cwd)
  if (!existsSync(options.cwd) || !statSync(options.cwd).isDirectory()) {
    throw new Error(`Working directory does not exist: ${options.cwd}`)
  }
  if (options.eventLog !== undefined) options.eventLog = resolve(options.eventLog)
  return options
}

export async function readRunPrompt(options, input = process.stdin) {
  if (options.prompt !== undefined) return nonemptyPrompt(options.prompt)
  if (options.promptFile !== undefined && options.promptFile !== '-') {
    return nonemptyPrompt(await readFile(resolve(options.promptFile), 'utf8'))
  }
  if (options.promptFile === '-' || input.isTTY !== true) {
    const chunks = []
    for await (const chunk of input) chunks.push(Buffer.from(chunk))
    return nonemptyPrompt(Buffer.concat(chunks).toString('utf8'))
  }
  throw new Error('cocode run requires --prompt, --prompt-file, or piped stdin')
}

export async function runHeadless(options, dependencies) {
  const {
    connectJsonRpc,
    createHostSupervisorClient,
    resolveCocodeHostScope,
    resolveHostRuntimeEnv,
  } = dependencies.supervisor
  const env = dependencies.env ?? process.env
  const now = dependencies.now ?? Date.now
  const sessionId = options.sessionId ?? `benchmark-${randomUUID()}`
  const startedAt = now()
  const scope = resolveCocodeHostScope(env)
  const runtimeEnv = resolveHostRuntimeEnv(env)
  const supervisorClient = createHostSupervisorClient()
  let lease
  let peer
  let unsubscribe
  let eventStream
  let messageId
  let completed = false
  let sawRunning = false
  let eventCount = 0
  let approvalCount = 0
  let questionCount = 0
  let workspace
  let finishTurn
  let failTurn
  let finishTurnEnd
  const turnDone = new Promise((resolveTurn, rejectTurn) => {
    finishTurn = resolveTurn
    failTurn = rejectTurn
  })
  const turnEnded = new Promise((resolveTurnEnd) => {
    finishTurnEnd = resolveTurnEnd
  })

  try {
    if (options.eventLog !== undefined) {
      await mkdir(dirname(options.eventLog), { recursive: true })
      eventStream = createWriteStream(options.eventLog, { flags: 'w', mode: 0o600 })
    }
    lease = await supervisorClient.acquire({
      scope,
      clientKind: 'standalone-tui',
      requiredServices: ['jsonrpc'],
      requiredCapabilities: ['session', 'event', 'workspace'],
      minProtocolRevision: '1.0',
      runtimeEnv,
    })
    const endpoint = lease.descriptor.services.find((service) => service.service === 'jsonrpc')
    if (endpoint === undefined) throw new Error('Cocode Host did not advertise JSON-RPC')
    peer = await connectJsonRpc(endpoint)
    unsubscribe = peer.subscribe((notification) => {
      const params = notification.params ?? {}
      if (notification.method === 'session.event' && params.sessionId === sessionId) {
        eventCount += 1
        writeEvent(eventStream, { method: notification.method, params })
        if (params.event?.type === 'turn/end') finishTurnEnd()
        const turnError = readTurnError(params.event)
        if (turnError !== undefined && !completed) failTurn(turnError)
        return
      }
      if (notification.method === 'session.status' && params.sessionId === sessionId) {
        writeEvent(eventStream, { method: notification.method, params })
        if (params.status === 'running') sawRunning = true
        if (params.status === 'idle' && sawRunning && !completed) {
          completed = true
          finishTurn()
        }
        return
      }
      if (notification.method === 'cocode/approval/request' && params.sessionId === sessionId) {
        approvalCount += 1
        const outcome = options.approvalPolicy === 'allow' ? 'allowed-once' : 'rejected'
        void peer.request('cocode/approval/respond', { requestId: params.requestId, outcome })
          .catch(failTurn)
        return
      }
      if (notification.method === 'cocode/question/request' && params.sessionId === sessionId) {
        questionCount += 1
        void peer.request('cocode/question/respond', { requestId: params.requestId, cancelled: true })
          .catch(failTurn)
      }
    })
    peer.onClose((error) => {
      if (!completed) failTurn(new Error(error ?? 'Cocode Host JSON-RPC connection closed'))
    })
    await peer.request('initialize', {
      cwd: options.cwd,
      provider: options.provider,
      model: options.model,
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    })
    workspace = await peer.request('cocode/workspace/ensure', { sessionId, approved: false })
    if (workspace?.status === 'authorization-required') {
      if (options.approvalPolicy !== 'allow') {
        throw new Error(`Workspace authorization was rejected for ${workspace.path}`)
      }
      workspace = await peer.request('cocode/workspace/ensure', { sessionId, approved: true })
    }
    if (workspace?.status !== 'ready' && workspace?.status !== 'unsupported') {
      throw new Error(`Workspace initialization failed: ${JSON.stringify(workspace)}`)
    }
    // `session.selectModel` operates on a live companion session. Workspace
    // authorization/attachment is the first request that creates that session
    // in the Host gateway, so select the reasoning profile only afterward.
    if (options.reasoningEffort !== undefined) {
      await peer.request('session.selectModel', {
        sessionId,
        provider: options.provider,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
      })
    }
    const promptResult = await peer.request('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text: options.prompt }],
    })
    messageId = promptResult?.messageId
    if (typeof messageId !== 'string') {
      throw new Error(`session/prompt returned no message id: ${JSON.stringify(promptResult)}`)
    }
    await withTimeout(turnDone, options.timeoutMs, async () => {
      const cancelRequest = Promise.resolve()
        .then(() => peer.request('cocode/session/cancel', { sessionId }, CANCEL_REQUEST_TIMEOUT_MS))
        .catch(() => undefined)
      await waitForGrace(cancelRequest, CANCELLATION_GRACE_MS)
      await waitForGrace(turnEnded, CANCELLATION_GRACE_MS)
    })
    return {
      schemaVersion: 1,
      status: 'completed',
      sessionId,
      messageId,
      provider: options.provider,
      model: options.model,
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
      approvalPolicy: options.approvalPolicy,
      approvals: approvalCount,
      questionsCancelled: questionCount,
      eventCount,
      durationMs: Math.max(0, now() - startedAt),
      workspace: workspace?.path ?? options.cwd,
      host: {
        runtimeVersion: lease.descriptor.runtimeVersion,
        buildId: lease.descriptor.buildId ?? null,
      },
    }
  } finally {
    completed = true
    unsubscribe?.()
    peer?.close()
    await lease?.release().catch(() => undefined)
    if (eventStream !== undefined) {
      eventStream.end()
      await finished(eventStream).catch(() => undefined)
    }
  }
}

export function formatRunResult(result, json = false) {
  if (json) return `${JSON.stringify(result)}\n`
  return [
    `completed session ${result.sessionId}`,
    `  model: ${result.provider}/${result.model}`,
    `  duration: ${(result.durationMs / 1_000).toFixed(1)}s`,
    `  events: ${result.eventCount}`,
    `  approvals: ${result.approvals}`,
    `  questions cancelled: ${result.questionsCancelled}`,
  ].join('\n') + '\n'
}

export function runUsage() {
  return [
    'Usage: cocode run [options] [prompt]',
    '',
    'Run one Cocode agent turn without the interactive TUI.',
    '',
    'Options:',
    '      --prompt <text>              Prompt text',
    '      --prompt-file <path|->       Read the prompt from a file or stdin',
    '      --cwd <path>                 Agent workspace (default: current directory)',
    '      --provider <id>              Model provider',
    '      --model <id>                 Model id',
    '      --reasoning-effort <id>      Select a supported reasoning effort',
    '      --max-tokens <n>             Maximum model output tokens',
    '      --timeout <duration>         Turn timeout, e.g. 30m or 1800s',
    '      --approval-policy <policy>   allow or reject (default: reject)',
    '      --allow-tools                Alias for --approval-policy allow',
    '      --event-log <path>           Write session notifications as JSONL',
    '      --session-id <id>            Explicit session id',
    '      --json                       Print a machine-readable summary',
    '',
    'Questions are cancelled in headless mode. Tool approvals are rejected unless explicitly allowed.',
    '',
  ].join('\n')
}

function requiredValue(option, remaining) {
  const value = remaining.shift()
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`)
  return value
}

function positiveInteger(value, option) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer`)
  return parsed
}

function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(value)
  if (match === null) throw new Error('--timeout must be a positive duration such as 30m or 1800s')
  const amount = positiveInteger(match[1], '--timeout')
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2] ?? 'ms']
  const duration = amount * multiplier
  if (!Number.isSafeInteger(duration)) throw new Error('--timeout is too large')
  return duration
}

function nonemptyPrompt(value) {
  const prompt = value.trim()
  if (prompt === '') throw new Error('cocode run prompt must not be empty')
  return prompt
}

function writeEvent(stream, event) {
  stream?.write(`${JSON.stringify(event)}\n`)
}

function readTurnError(event) {
  if (event?.type !== 'turn/end' || event.data?.reason?.kind !== 'error') return undefined
  const message = event.data.reason.error?.message ?? 'Cocode turn failed'
  const error = new Error(String(message))
  if (typeof event.data.reason.error?.code === 'string') error.code = event.data.reason.error.code
  return error
}

async function withTimeout(promise, timeoutMs, onTimeout) {
  let timer
  const outcome = await Promise.race([
    promise.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', error }),
    ),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout({ status: 'timed-out' }), timeoutMs)
    }),
  ])
  clearTimeout(timer)
  if (outcome.status === 'fulfilled') return outcome.value
  if (outcome.status === 'rejected') throw outcome.error

  await onTimeout()
  const error = new Error(`Cocode agent turn timed out after ${timeoutMs}ms`)
  error.code = 'COCODE_RUN_TIMEOUT'
  throw error
}

async function waitForGrace(promise, timeoutMs) {
  let timer
  try {
    await Promise.race([
      promise,
      new Promise((resolveTimeout) => {
        timer = setTimeout(resolveTimeout, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
