/** Shared Host JSON-RPC adapter. The TUI never launches a DSH subprocess. */

import {
  connectJsonRpc,
  createHostSupervisorClient,
  resolveHostRuntimeEnv as resolveSharedHostRuntimeEnv,
  resolveCocodeHostScope as resolveSharedCocodeHostScope,
  type HostLease,
  type HostClientKind,
  type HostRuntimeEnv,
  type HostScope,
  type JsonRpcPeer,
} from '@cocode-agency/host-supervisor'

import type {
  TuiCapabilitySnapshot,
  ContentBlock,
  TuiApprovalAnswer,
  TuiApprovalRequest,
  SessionEvent,
  SkillEntry,
  TuiCommandDescriptor,
  TuiCommandExecution,
  TuiPluginEntry,
  TuiPromptMode,
  TuiSessionSummary,
  TuiRuntimeAdvertisement,
  TuiQuestionAnswer,
  TuiQuestionRequest,
  TuiInitialize,
  TuiLaunch,
  TuiNotification,
  TuiRuntime,
  TuiSessionOpenResult,
  TuiWorkspaceEnsureResult,
  TuiModelCatalog,
  TuiModelCatalogFailure,
  TuiModelProviderGroup,
  TuiModelReasoning,
  TuiModelReasoningEffort,
  TuiModelSelection,
  TuiImageAttachmentRef,
  TuiImageInput,
  TuiSessionSearchItem,
  TuiSessionHistoryResult,
  TuiSessionModels,
  TuiQueueAction,
  TuiAttachmentReadResult,
  TuiSessionCreateResult,
  TuiSubagentCatalog,
} from './types.ts'
import { fallbackCapabilitySnapshot, probeRuntimeCapabilities } from './capability.ts'

type HarnessClient = JsonRpcPeer

export interface TuiRuntimeLogSink {
  debug(eventName: string, attributes?: Readonly<Record<string, string | number | boolean | null>>): void
  info(eventName: string, attributes?: Readonly<Record<string, string | number | boolean | null>>): void
  warn(eventName: string, attributes?: Readonly<Record<string, string | number | boolean | null>>): void
  error(eventName: string, attributes?: Readonly<Record<string, string | number | boolean | null>>): void
}

export function createTuiRuntime(launch: TuiLaunch, logger?: TuiRuntimeLogSink): TuiRuntime {
  return new SdkTuiRuntime(launch, logger)
}

class SdkTuiRuntime implements TuiRuntime {
  private client: HarnessClient | undefined
  private lease: HostLease | undefined
  private launch: TuiLaunch
  private wire: 'unknown' | 'companion' | 'legacy' = 'unknown'
  private readonly handlers = new Set<(n: TuiNotification) => void>()
  private readonly closeHandlers = new Set<(error?: string) => void>()
  private unsubscribe: (() => void) | undefined
  private unsubscribeClose: (() => void) | undefined
  private closing = false
  private questionHandler: ((request: TuiQuestionRequest) => Promise<TuiQuestionAnswer>) | undefined
  private approvalHandler: ((request: TuiApprovalRequest) => Promise<TuiApprovalAnswer>) | undefined
  private capabilitySnapshot: TuiCapabilitySnapshot = fallbackCapabilitySnapshot()
  private cwd = process.cwd()
  private readonly logger: TuiRuntimeLogSink | undefined

  constructor(launch: TuiLaunch, logger?: TuiRuntimeLogSink) {
    this.launch = launch
    this.logger = logger
  }

  async start(init: TuiInitialize): Promise<{
    name: string
    version: string
    capabilities?: import('./types.ts').TuiRuntimeAdvertisement
  }> {
    this.closing = false
    this.wire = 'unknown'
    this.cwd = init.cwd
    this.capabilitySnapshot = fallbackCapabilitySnapshot()
    this.logger?.info('host.lease.acquire.started')
    try {
      const scope = resolveHostScope(this.launch)
      const lease = await createHostSupervisorClient().acquire({
        scope,
        clientKind: resolveTuiClientKind(this.launch.env ?? process.env),
        requiredServices: ['jsonrpc'],
        minProtocolRevision: '1.0',
        runtimeEnv: resolveHostRuntimeEnv(this.launch.env ?? process.env),
      })
      if (lease.descriptor.dshHome !== scope.dshHome || lease.descriptor.profile !== 'cocode') {
        await lease.release().catch(() => undefined)
        throw new Error('Cocode Host descriptor escaped the shared DSH home/profile boundary')
      }
      this.lease = lease
      this.logger?.info('host.lease.acquired', { leaseIdPresent: true })
      const endpoint = lease.descriptor.services.find((service) => service.service === 'jsonrpc')
      if (endpoint === undefined) throw new Error('shared Host did not advertise its JSON-RPC service')
      const client = await connectJsonRpc(endpoint)
      this.client = client
      this.logger?.info('jsonrpc.connect.completed')
      this.unsubscribe = client.subscribe((notification) => {
        void this.handleNotification(notification.method, notification.params)
      })
      this.unsubscribeClose = client.onClose((error) => {
        if (this.closing) return
        this.logger?.warn('jsonrpc.disconnected')
        for (const handler of this.closeHandlers) handler(error)
      })
      const result = await client.request<{ serverInfo: { name: string; version: string } }>('initialize', init as unknown as Record<string, unknown>)
      const advertised = await this.negotiateWire(client)
      this.logger?.info('runtime.initialize.completed', { runtimeName: result.serverInfo.name })
      return {
        ...result.serverInfo,
        ...(advertised === undefined ? {} : { capabilities: advertised }),
      }
    } catch (error) {
      this.logger?.error('host.runtime.start.failed')
      this.closing = true
      await this.close().catch(() => undefined)
      throw error
    }
  }

  async restart(
    init: TuiInitialize,
    env?: NodeJS.ProcessEnv,
  ): Promise<{
    name: string
    version: string
    capabilities?: import('./types.ts').TuiRuntimeAdvertisement
  }> {
    this.logger?.info('runtime.restart.started')
    await this.close()
    this.closing = false
    this.client = undefined
    this.lease = undefined
    this.unsubscribe = undefined
    const previousLaunch = this.launch
    if (env !== undefined) {
      const sessionRoot = this.launch.env?.DSH_SESSION_ROOT
      this.launch = {
        ...this.launch,
        env: {
          ...env,
          ...(sessionRoot === undefined ? {} : { DSH_SESSION_ROOT: sessionRoot }),
        },
      }
    }
    try {
      const result = await this.start(init)
      this.logger?.info('runtime.restart.completed')
      return result
    } catch (error) {
      this.logger?.error('runtime.restart.failed')
      this.launch = previousLaunch
      throw error
    }
  }

  async prompt(
    sessionId: string,
    blocks: { type: string; text?: string }[],
    mode: TuiPromptMode = 'normal',
  ): Promise<string> {
    const client = this.requireClient()
    this.logger?.debug('session.prompt.accepted', { mode, sessionIdPresent: sessionId !== '' })
    if (mode !== 'normal') {
      const modes = this.capabilitySnapshot.modes?.promptModes ?? []
      if (!modes.includes(mode))
        this.requireCapability(mode === 'queue' ? 'queueMode' : 'promptMode')
    }
    const result = await client.request('session/prompt', {
      sessionId,
      contentBlocks: blocks,
      ...(mode === 'normal' ? {} : { mode }),
    })
    if (!isRecord(result) || typeof result.messageId !== 'string') {
      throw new Error(`session/prompt returned no message id: ${JSON.stringify(result)}`)
    }
    return result.messageId
  }

  async cancel(sessionId: string, keepInbox = false): Promise<boolean> {
    const client = this.requireClient()
    this.requireCapability('cancel')
    const result = await client.request(
      this.wireMethod('cocode/session/cancel', 'session/cancel'),
      { sessionId, keepInbox },
    )
    if (!isRecord(result) || typeof result.cancelled !== 'boolean') {
      throw new Error(`session/cancel returned no cancellation result: ${JSON.stringify(result)}`)
    }
    return result.cancelled
  }

  async open(
    sessionId: string,
    replaceSessionId?: string,
  ): Promise<boolean | TuiSessionOpenResult> {
    const client = this.requireClient()
    this.logger?.debug('session.open.started', { replaceSession: replaceSessionId !== undefined })
    this.requireCapability('open')
    const params = {
      sessionId,
      ...(replaceSessionId === undefined ? {} : { replaceSessionId }),
    }
    const result = await client.request(
      this.wireMethod('cocode/session/open', 'session/open'),
      params,
    )
    if (!isRecord(result) || typeof result.opened !== 'boolean') {
      throw new Error(`session/open returned no open result: ${JSON.stringify(result)}`)
    }
    if (!Array.isArray(result.seed)) {
      this.logger?.debug('session.open.completed', { opened: result.opened })
      return result.opened
    }
    if (!result.seed.every(isSessionEvent)) {
      throw new Error(`session/open returned an invalid seed: ${JSON.stringify(result)}`)
    }
    this.logger?.debug('session.open.completed', { opened: result.opened, seedLength: result.seed.length })
    return {
      opened: result.opened,
      seed: result.seed,
      ...(typeof result.seedLength === 'number' ? { seedLength: result.seedLength } : {}),
    }
  }

  async fork(
    sourceSessionId: string,
    boundary?: number,
    replaceSessionId?: string,
    rewindToMessageSeq?: number,
  ): Promise<{ sessionId: string; seedLength: number; seed: SessionEvent[] }> {
    const client = this.requireClient()
    this.requireCapability('fork')
    const result = await client.request(this.wireMethod('cocode/session/fork', 'session/fork'), {
      sourceSessionId,
      ...(boundary === undefined ? {} : { boundary }),
      ...(replaceSessionId === undefined ? {} : { replaceSessionId }),
      ...(rewindToMessageSeq === undefined ? {} : { rewindToMessageSeq }),
    })
    return parseSessionForkResult(result, 'fork')
  }

  async rewind(
    sourceSessionId: string,
    messageSeq: number,
    replaceSessionId?: string,
  ): Promise<{ sessionId: string; seedLength: number; seed: SessionEvent[] }> {
    const client = this.requireClient()
    this.requireCapability('rewind')
    const result = await client.request(this.wireMethod('cocode/session/fork', 'session/fork'), {
      sourceSessionId,
      rewindToMessageSeq: messageSeq,
      ...(replaceSessionId === undefined ? {} : { replaceSessionId }),
    })
    return parseSessionForkResult(result, 'rewind')
  }

  async listSkills(sessionId: string): Promise<SkillEntry[]> {
    const client = this.requireClient()
    this.requireCapability('skills')
    const result = await client.request(this.wireMethod('cocode/skills/list', 'skills/list'), {
      sessionId,
    })
    if (!isRecord(result) || !Array.isArray(result.skills)) {
      throw new Error(`skills/list returned no skill catalog: ${JSON.stringify(result)}`)
    }
    return parseSkillEntries(result.skills)
  }

  async listCommands(sessionId: string): Promise<TuiCommandDescriptor[]> {
    const client = this.requireClient()
    this.requireCapability('commands')
    const result = await client.request(this.wireMethod('cocode/commands/list', 'commands/list'), {
      sessionId,
    })
    const rows = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.commands)
        ? result.commands
        : undefined
    if (rows === undefined) {
      throw new Error(`commands/list returned no command catalog: ${JSON.stringify(result)}`)
    }
    return rows.map(parseCommandDescriptor)
  }

  async executeCommand(sessionId: string, line: string): Promise<TuiCommandExecution | undefined> {
    const client = this.requireClient()
    this.requireCapability('commands')
    const result = await client.request(
      this.wireMethod('cocode/commands/execute', 'commands/execute'),
      { sessionId, line },
    )
    if (result === undefined || result === null) return undefined
    if (!isRecord(result) || typeof result.commandId !== 'string' || !isRecord(result.result)) {
      throw new Error(`commands/execute returned an invalid result: ${JSON.stringify(result)}`)
    }
    return {
      commandId: result.commandId,
      result: parseCommandResult(result.result),
    }
  }

  async listPlugins(): Promise<TuiPluginEntry[]> {
    const client = this.requireClient()
    this.requireCapability('plugins')
    const result = await client.request(this.wireMethod('cocode/plugins/list', 'plugins/list'))
    const rows = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.plugins)
        ? result.plugins
        : undefined
    if (rows === undefined) {
      throw new Error(`plugins/list returned no plugin list: ${JSON.stringify(result)}`)
    }
    return rows.map((value) => parsePluginEntry(value))
  }

  async setPluginEnabled(entryId: string, enabled: boolean): Promise<TuiPluginEntry> {
    const client = this.requireClient()
    this.requireCapability('pluginsMutate')
    const normalizedEntryId = entryId.trim()
    if (normalizedEntryId === '') throw new Error('plugins/set-enabled requires an entry id')
    const result = await client.request(this.wireMethod('cocode/plugins/set-enabled', 'plugins/set-enabled'), {
      entryId: normalizedEntryId,
      enabled,
    })
    return parsePluginEntry(result, 'plugins/set-enabled')
  }

  async listSessions(cwd?: string): Promise<TuiSessionSummary[]> {
    const client = this.requireClient()
    this.requireCapability('sessionList')
    const result = await client.request(
      this.wireMethod('cocode/session/list', 'session/list'),
      cwd === undefined ? {} : { cwd },
    )
    const rows = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.sessions)
      ? result.sessions
      : undefined
    if (rows === undefined)
      throw new Error(`session/list returned no session list: ${JSON.stringify(result)}`)
    return rows.map(parseSessionSummary)
  }

  async createSession(sessionId?: string, cwd?: string): Promise<TuiSessionCreateResult> {
    this.requireCapability('sessionCreate')
    const result = await this.requireClient().request(this.wireMethod('cocode/session/create', 'session.create'), {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(cwd === undefined ? {} : { cwd }),
    })
    if (!isRecord(result) || typeof result.sessionId !== 'string' || result.sessionId.trim() === '') {
      throw new Error(`session.create returned an invalid result: ${JSON.stringify(result)}`)
    }
    return { sessionId: result.sessionId }
  }

  async listSubagents(parentSessionId: string): Promise<TuiSubagentCatalog> {
    this.requireCapability('subagentList')
    const result = await this.requireClient().request(this.wireMethod('cocode/subagent/list', 'subagent.list'), { parentSessionId })
    if (!isRecord(result) || !Array.isArray(result.entries) || typeof result.parentAvailable !== 'boolean') {
      throw new Error(`subagent.list returned an invalid result: ${JSON.stringify(result)}`)
    }
    return {
      parentAvailable: result.parentAvailable,
      entries: result.entries.map((entry) => {
        if (!isRecord(entry) || entry.kind !== 'child' || typeof entry.id !== 'string' || (entry.activity !== 'running' && entry.activity !== 'inactive') || (entry.mode !== 'one-shot' && entry.mode !== 'continuable') || typeof entry.hasChildren !== 'boolean') {
          throw new Error(`subagent.list returned an invalid entry: ${JSON.stringify(entry)}`)
        }
        return {
          kind: 'child',
          id: entry.id,
          activity: entry.activity,
          mode: entry.mode,
          ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
          hasChildren: entry.hasChildren,
        }
      }),
    }
  }

  async subagentHistory(parentSessionId: string, childSessionId: string, beforeSeq?: number, maxMessages?: number): Promise<TuiSessionHistoryResult> {
    this.requireCapability('subagentHistory')
    const result = await this.requireClient().request(this.wireMethod('cocode/subagent/history', 'subagent.history'), {
      parentSessionId,
      childSessionId,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      ...(maxMessages === undefined ? {} : { maxMessages }),
    })
    if (!isRecord(result) || !Array.isArray(result.events) || !result.events.every(isSessionEvent) || typeof result.hasMore !== 'boolean') {
      throw new Error(`subagent.history returned an invalid result: ${JSON.stringify(result)}`)
    }
    const projections = parseProjectionBaseline(result.projections)
    return {
      events: result.events,
      hasMore: result.hasMore,
      ...(projections === undefined ? {} : { projections }),
    }
  }

  async promptSubagent(parentSessionId: string, childSessionId: string, blocks: ContentBlock[]): Promise<string> {
    this.requireCapability('subagentPrompt')
    const result = await this.requireClient().request(this.wireMethod('cocode/subagent/prompt', 'subagent.prompt'), { parentSessionId, childSessionId, content: blocks })
    if (!isRecord(result) || typeof result.messageId !== 'string') throw new Error(`subagent.prompt returned an invalid result: ${JSON.stringify(result)}`)
    return result.messageId
  }

  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<boolean> {
    this.requireCapability('subagentInterrupt')
    const result = await this.requireClient().request(this.wireMethod('cocode/subagent/interrupt', 'subagent.interrupt'), { parentSessionId, childSessionId })
    if (!isRecord(result) || result.accepted !== true) throw new Error(`subagent.interrupt returned an invalid result: ${JSON.stringify(result)}`)
    return true
  }

  async searchSessions(query: string): Promise<{ items: TuiSessionSearchItem[]; hasMore: boolean }> {
    this.requireCapability('sessionSearch')
    const result = await this.requireClient().request(this.wireMethod('cocode/session/search', 'session/search'), { query })
    if (!isRecord(result) || !Array.isArray(result.items) || typeof result.hasMore !== 'boolean') {
      throw new Error(`session.search returned an invalid result: ${JSON.stringify(result)}`)
    }
    return {
      items: result.items.map((item) => {
        if (!isRecord(item) || typeof item.sessionId !== 'string' || typeof item.snippet !== 'string') {
          throw new Error(`session.search returned an invalid item: ${JSON.stringify(item)}`)
        }
        return { sessionId: item.sessionId, snippet: item.snippet }
      }),
      hasMore: result.hasMore,
    }
  }

  async history(sessionId: string, beforeSeq?: number, maxMessages?: number): Promise<TuiSessionHistoryResult> {
    this.requireCapability('sessionHistory')
    const result = await this.requireClient().request(this.wireMethod('cocode/session/history', 'session/history'), {
      sessionId,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      ...(maxMessages === undefined ? {} : { maxMessages }),
    })
    if (!isRecord(result) || !Array.isArray(result.events) || !result.events.every(isSessionEvent) || typeof result.hasMore !== 'boolean') {
      throw new Error(`session.history returned an invalid result: ${JSON.stringify(result)}`)
    }
    const projections = parseProjectionBaseline(result.projections)
    return {
      events: result.events,
      hasMore: result.hasMore,
      ...(projections === undefined ? {} : { projections }),
    }
  }

  async sessionModels(sessionId: string): Promise<TuiSessionModels> {
    this.requireCapability('sessionModels')
    const result = await this.requireClient().request(this.wireMethod('cocode/session/models', 'session.models'), { sessionId })
    if (!isRecord(result) || !isRecord(result.current) || typeof result.routable !== 'boolean') {
      throw new Error(`session.models returned an invalid result: ${JSON.stringify(result)}`)
    }
    const catalog = parseModelCatalogResult(result)
    const current = result.current
    if (typeof current.provider !== 'string' || typeof current.model !== 'string' || (current.reasoningEffort !== undefined && typeof current.reasoningEffort !== 'string')) {
      throw new Error(`session.models returned an invalid selection: ${JSON.stringify(result)}`)
    }
    return {
      ...catalog,
      current: {
        provider: current.provider,
        model: current.model,
        ...(typeof current.reasoningEffort === 'string' ? { reasoningEffort: current.reasoningEffort } : {}),
      },
      routable: result.routable,
    }
  }

  async renameSession(sessionId: string, title: string): Promise<{ title: string; seq: number }> {
    this.requireCapability('sessionRename')
    const result = await this.requireClient().request(this.wireMethod('cocode/session/rename', 'session.rename'), { sessionId, title })
    if (!isRecord(result) || typeof result.title !== 'string' || !isNonnegativeInteger(result.seq)) {
      throw new Error(`session.rename returned an invalid result: ${JSON.stringify(result)}`)
    }
    return { title: result.title, seq: result.seq }
  }

  async updateQueue(sessionId: string, itemId: string, action: TuiQueueAction): Promise<boolean> {
    this.requireCapability('queueMutation')
    const result = await this.requireClient().request(this.wireMethod('cocode/session/updateQueue', 'session.updateQueue'), { sessionId, itemId, action })
    if (!isRecord(result) || result.accepted !== true) {
      throw new Error(`session.updateQueue returned an invalid result: ${JSON.stringify(result)}`)
    }
    return true
  }

  async readAttachment(sessionId: string, attachmentId: string): Promise<TuiAttachmentReadResult> {
    this.requireCapability('attachmentRead')
    const result = await this.requireClient().request(this.wireMethod('cocode/session/attachment', 'session.attachment'), { sessionId, attachmentId })
    if (!isRecord(result) || typeof result.data !== 'string') {
      throw new Error(`session.attachment returned an invalid result: ${JSON.stringify(result)}`)
    }
    return { attachment: parseImageAttachmentRef(result.attachment), data: Buffer.from(result.data, 'base64') }
  }

  async ensureWorkspace(
    sessionId: string,
    approved = false,
  ): Promise<TuiWorkspaceEnsureResult> {
    const path = this.cwd
    if (this.wire !== 'companion') {
      return {
        status: 'unsupported',
        path,
        reason: 'workspace authorization requires the Cocode companion runtime',
      }
    }
    const result = await this.requireClient().request('cocode/workspace/ensure', {
      sessionId,
      approved,
    })
    return parseWorkspaceEnsureResult(result)
  }

  async listModels(): Promise<TuiModelCatalog> {
    const client = this.requireClient()
    this.requireCapability('modelList')
    const result = await client.request(this.wireMethod('cocode/model/list', 'model/list'))
    return parseModelCatalogResult(result)
  }

  async selectModel(
    sessionId: string,
    provider: string,
    model: string,
    reasoningEffort?: string,
  ): Promise<TuiModelSelection | undefined> {
    const client = this.requireClient()
    try {
      const result = await client.request('session.selectModel', {
        sessionId,
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      })
      if (!isRecord(result) || !isRecord(result.selected)) {
        throw new Error(`session.selectModel returned an invalid result: ${JSON.stringify(result)}`)
      }
      const selected = result.selected
      if (typeof selected.provider !== 'string' || typeof selected.model !== 'string') {
        throw new Error(`session.selectModel returned an invalid selection: ${JSON.stringify(result)}`)
      }
      if (selected.reasoningEffort !== undefined && typeof selected.reasoningEffort !== 'string') {
        throw new Error(`session.selectModel returned an invalid selection: ${JSON.stringify(result)}`)
      }
      return {
        provider: selected.provider,
        model: selected.model,
        ...(typeof selected.reasoningEffort === 'string' ? { reasoningEffort: selected.reasoningEffort } : {}),
      }
    } catch (error) {
      if (isUnsupportedMethodError(error)) return undefined
      throw error
    }
  }

  async saveImages(images: readonly TuiImageInput[]): Promise<TuiImageAttachmentRef[]> {
    const client = this.requireClient()
    this.requireCapability('imageAttachments')
    const result = await client.request('cocode/attachment/saveImages', {
      images: images.map((image) => ({
        data: Buffer.from(image.data).toString('base64'),
        mediaType: image.mediaType,
        ...(image.name === undefined ? {} : { name: image.name }),
      })),
    })
    if (!isRecord(result) || !Array.isArray(result.attachments)) {
      throw new Error(`attachment/saveImages returned an invalid result: ${JSON.stringify(result)}`)
    }
    return result.attachments.map(parseImageAttachmentRef)
  }

  async permissionMode(
    sessionId: string,
    mode?: string,
  ): Promise<{ mode: string; supportedModes: string[] }> {
    const client = this.requireClient()
    this.requireCapability('permissionMode')
    const result = await client.request(
      this.wireMethod('cocode/permission/mode', 'permission/mode'),
      {
        sessionId,
        ...(mode === undefined ? {} : { mode }),
      },
    )
    if (
      !isRecord(result) ||
      typeof result.mode !== 'string' ||
      !Array.isArray(result.supportedModes)
    ) {
      throw new Error(`permission/mode returned an invalid result: ${JSON.stringify(result)}`)
    }
    return {
      mode: result.mode,
      supportedModes: result.supportedModes.filter(
        (value): value is string => typeof value === 'string',
      ),
    }
  }

  async planMode(
    sessionId: string,
    active?: boolean,
  ): Promise<{ active: boolean; pending?: boolean }> {
    const client = this.requireClient()
    this.requireCapability('planMode')
    const result = await client.request(this.wireMethod('cocode/plan/mode', 'plan/mode'), {
      sessionId,
      ...(active === undefined ? {} : { active }),
    })
    if (!isRecord(result) || typeof result.active !== 'boolean') {
      throw new Error(`plan/mode returned an invalid result: ${JSON.stringify(result)}`)
    }
    return {
      active: result.active,
      ...(typeof result.pending === 'boolean' ? { pending: result.pending } : {}),
    }
  }

  onQuestion(handler: (request: TuiQuestionRequest) => Promise<TuiQuestionAnswer>): () => void {
    this.questionHandler = handler
    return () => {
      if (this.questionHandler === handler) this.questionHandler = undefined
    }
  }

  onApproval(handler: (request: TuiApprovalRequest) => Promise<TuiApprovalAnswer>): () => void {
    this.approvalHandler = handler
    return () => {
      if (this.approvalHandler === handler) this.approvalHandler = undefined
    }
  }

  getCapabilities(): TuiCapabilitySnapshot {
    return this.capabilitySnapshot
  }

  subscribe(handler: (n: TuiNotification) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  onClose(handler: (error?: string) => void): () => void {
    this.closeHandlers.add(handler)
    return () => {
      this.closeHandlers.delete(handler)
    }
  }

  async close(): Promise<void> {
    this.logger?.info('runtime.close.started')
    this.closing = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.unsubscribeClose?.()
    this.unsubscribeClose = undefined
    this.client?.close()
    this.client = undefined
    await this.lease?.release().catch(() => undefined)
    this.lease = undefined
    this.logger?.info('host.lease.released')
    this.logger?.info('runtime.close.completed')
  }

  private requireClient(): HarnessClient {
    if (this.client === undefined) {
      throw new Error('TuiRuntime.start() has not run')
    }
    return this.client
  }

  private wireMethod(companion: string, legacy: string): string {
    return this.wire === 'companion' ? companion : legacy
  }

  private async negotiateWire(client: HarnessClient): Promise<TuiRuntimeAdvertisement | undefined> {
    try {
      const result = await client.request('cocode/capabilities', {}, 1_000)
      const companion = parseCompanionCapabilities(result)
      if (companion === undefined) throw new Error('invalid companion capability response')
      this.wire = 'companion'
      const advertised = parseRuntimeAdvertisement(companion)
      this.capabilitySnapshot = {
        source: 'runtime',
        capabilities: {
          cancel: true,
          open: true,
          fork: true,
          rewind: true,
          skills: companion.skills,
          onRequest: false,
          approval: companion.approval,
          permissionMode: companion.permissionMode,
          planMode: companion.planMode,
          sessionList: companion.sessionList,
          modelList: companion.modelList,
          imageAttachments: companion.imageAttachments,
          commands: companion.commands,
          plugins: companion.plugins,
          pluginsMutate: companion.pluginsMutate,
          sessionSearch: companion.sessionSearch,
          sessionHistory: companion.sessionHistory,
          sessionModels: companion.sessionModels,
          sessionRename: companion.sessionRename,
          queueMutation: companion.queueMutation,
          attachmentRead: companion.attachmentRead,
          sessionCreate: companion.sessionCreate,
          subagentList: companion.subagentList,
          subagentHistory: companion.subagentHistory,
          subagentPrompt: companion.subagentPrompt,
          subagentInterrupt: companion.subagentInterrupt,
          promptMode: companion.promptModes.includes('steer'),
          queueMode: companion.promptModes.includes('queue'),
        },
        modes: advertised,
        errors: {},
      }
      this.logger?.debug('capability.probe.completed', { wire: 'companion' })
      return advertised
    } catch (error) {
      if (!isUnsupportedCompanionError(error)) throw error
      this.wire = 'legacy'
      const request = (method: string, params: object, timeoutMs?: number) =>
        client.request(method, params as Record<string, unknown>, timeoutMs)
      const advertised = undefined
      this.capabilitySnapshot = await probeRuntimeCapabilities(
        { request },
        { onRequest: false, advertised },
      )
      this.logger?.debug('capability.probe.completed', { wire: 'legacy' })
      return advertised
    }
  }

  private requireCapability(name: keyof TuiCapabilitySnapshot['capabilities']): void {
    if (this.capabilitySnapshot.capabilities[name]) return
    const detail = this.capabilitySnapshot.errors[name]
    throw new Error(
      detail === undefined
        ? `runtime capability "${name}" is unavailable`
        : `runtime capability "${name}" is unavailable: ${detail}`,
    )
  }

  private async handleNotification(method: string, params: Record<string, unknown>): Promise<void> {
    if (method === 'cocode/question/request') {
      await this.respondToQuestion(params)
      return
    }
    if (method === 'cocode/approval/request') {
      await this.respondToApproval(params)
      return
    }
    const mapped = mapNotification({ method, params })
    if (mapped === undefined) return
    for (const handler of this.handlers) handler(mapped)
  }

  private async respondToQuestion(params: Record<string, unknown>): Promise<void> {
    const requestId = params.requestId
    if (typeof requestId !== 'string') return
    this.logger?.debug('question.received')
    let response: { answer: TuiQuestionAnswer } | { cancelled: true }
    try {
      const handler = this.questionHandler
      if (handler === undefined) throw new Error('TUI has no question handler')
      response = { answer: await handler(parseQuestionRequest(params)) }
    } catch {
      // A rejected UI handler means that the user cancelled the interaction.
      // Send that outcome explicitly instead of fabricating an empty answer,
      // which would fail normal question-batch validation.
      response = { cancelled: true }
    }
    await this.requireClient()
      .request('cocode/question/respond', { requestId, ...response })
      .catch(() => undefined)
    this.logger?.debug('question.responded', { cancelled: 'cancelled' in response })
  }

  private async respondToApproval(params: Record<string, unknown>): Promise<void> {
    const requestId = params.requestId
    if (typeof requestId !== 'string') return
    this.logger?.debug('approval.received')
    let outcome: TuiApprovalAnswer = { outcome: 'unavailable' }
    try {
      const handler = this.approvalHandler
      if (handler !== undefined) outcome = await handler(parseApprovalRequest(params))
    } catch {
      outcome = { outcome: 'unavailable' }
    }
    await this.requireClient()
      .request('cocode/approval/respond', { requestId, outcome: outcome.outcome })
      .catch(() => undefined)
    this.logger?.debug('approval.responded', { outcome: outcome.outcome })
  }
}

function resolveTuiClientKind(env: NodeJS.ProcessEnv): Extract<HostClientKind, 'desktop-tui' | 'standalone-tui'> {
  return env.COCODE_TUI_CLIENT_KIND?.trim() === 'desktop-tui'
    ? 'desktop-tui'
    : 'standalone-tui'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveHostRuntimeEnv(env: NodeJS.ProcessEnv): HostRuntimeEnv {
  return resolveSharedHostRuntimeEnv(env)
}

export function resolveHostScope(launch: TuiLaunch): HostScope {
  return resolveSharedCocodeHostScope(launch.env ?? process.env)
}

type CompanionCapabilities = {
  protocolVersion: number
  promptModes: TuiPromptMode[]
  approval: boolean
  permissionMode: boolean
  planMode: boolean
  sessionList: boolean
  modelList: boolean
  imageAttachments: boolean
  interactions: 'notification-response'
  checkpoint: false
  skills: boolean
  commands: boolean
  plugins: boolean
  pluginsMutate: boolean
  sessionSearch: boolean
  sessionHistory: boolean
  sessionModels: boolean
  sessionRename: boolean
  queueMutation: boolean
  attachmentRead: boolean
  sessionCreate: boolean
  subagentList: boolean
  subagentHistory: boolean
  subagentPrompt: boolean
  subagentInterrupt: boolean
}

function parseCompanionCapabilities(value: unknown): CompanionCapabilities | undefined {
  if (!isRecord(value) || value.protocolVersion !== 1) return undefined
  if (
    value.interactions !== 'notification-response' ||
    value.checkpoint !== false ||
    !Array.isArray(value.promptModes)
  ) {
    return undefined
  }
  const promptModes = value.promptModes.filter(
    (mode): mode is TuiPromptMode => mode === 'normal' || mode === 'queue' || mode === 'steer',
  )
  if (!promptModes.includes('normal')) return undefined
  if (
    typeof value.approval !== 'boolean' ||
    typeof value.permissionMode !== 'boolean' ||
    typeof value.planMode !== 'boolean' ||
    typeof value.sessionList !== 'boolean' ||
    (value.modelList !== undefined && typeof value.modelList !== 'boolean')
    || (value.imageAttachments !== undefined && typeof value.imageAttachments !== 'boolean')
    || (value.plugins !== undefined && typeof value.plugins !== 'boolean')
    || (value.pluginsMutate !== undefined && typeof value.pluginsMutate !== 'boolean')
    || (value.sessionSearch !== undefined && typeof value.sessionSearch !== 'boolean')
    || (value.sessionHistory !== undefined && typeof value.sessionHistory !== 'boolean')
    || (value.sessionModels !== undefined && typeof value.sessionModels !== 'boolean')
    || (value.sessionRename !== undefined && typeof value.sessionRename !== 'boolean')
    || (value.queueMutation !== undefined && typeof value.queueMutation !== 'boolean')
    || (value.attachmentRead !== undefined && typeof value.attachmentRead !== 'boolean')
    || (value.sessionCreate !== undefined && typeof value.sessionCreate !== 'boolean')
    || (value.subagentList !== undefined && typeof value.subagentList !== 'boolean')
    || (value.subagentHistory !== undefined && typeof value.subagentHistory !== 'boolean')
    || (value.subagentPrompt !== undefined && typeof value.subagentPrompt !== 'boolean')
    || (value.subagentInterrupt !== undefined && typeof value.subagentInterrupt !== 'boolean')
  ) {
    return undefined
  }
  return {
    protocolVersion: 1,
    promptModes,
    approval: value.approval,
    permissionMode: value.permissionMode,
    planMode: value.planMode,
    sessionList: value.sessionList,
    modelList: value.modelList === true,
    imageAttachments: value.imageAttachments === true,
    interactions: 'notification-response',
    checkpoint: false,
    skills: value.skills === true,
    commands: value.commands === true,
    plugins: value.plugins === true,
    pluginsMutate: value.pluginsMutate === true,
    sessionSearch: value.sessionSearch === true,
    sessionHistory: value.sessionHistory === true,
    sessionModels: value.sessionModels === true,
    sessionRename: value.sessionRename === true,
    queueMutation: value.queueMutation === true,
    attachmentRead: value.attachmentRead === true,
    sessionCreate: value.sessionCreate === true,
    subagentList: value.subagentList === true,
    subagentHistory: value.subagentHistory === true,
    subagentPrompt: value.subagentPrompt === true,
    subagentInterrupt: value.subagentInterrupt === true,
  }
}

function isUnsupportedCompanionError(error: unknown): boolean {
  if (isRecord(error) && error.code === -32601) return true
  const message = error instanceof Error ? error.message : String(error)
  return /unknown(?: [^\n]*)? method|method not found|unsupported method|not implemented/i.test(
    message,
  )
}

function isForkResult(
  value: unknown,
): value is { sessionId: string; seedLength: number; seed: SessionEvent[] } {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.seedLength === 'number' &&
    Number.isSafeInteger(value.seedLength) &&
    value.seedLength >= 0 &&
    Array.isArray(value.seed) &&
    value.seed.every(isSessionEvent)
  )
}

function parseSessionForkResult(
  value: unknown,
  operation: 'fork' | 'rewind',
): { sessionId: string; seedLength: number; seed: SessionEvent[] } {
  if (!isForkResult(value)) {
    throw new Error(`session/fork returned no ${operation} result: ${JSON.stringify(value)}`)
  }
  return {
    sessionId: value.sessionId,
    seedLength: value.seedLength,
    seed: value.seed,
  }
}

function parseSkillEntries(value: unknown[]): SkillEntry[] {
  const skills: SkillEntry[] = []
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.description !== 'string'
    ) {
      throw new Error(`skills/list returned an invalid skill entry: ${JSON.stringify(entry)}`)
    }
    skills.push({
      name: entry.name,
      description: entry.description,
      ...(typeof entry.whenToUse === 'string' ? { whenToUse: entry.whenToUse } : {}),
      ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
    })
  }
  return skills
}

function parseCommandDescriptor(value: unknown): TuiCommandDescriptor {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    (value.input !== undefined &&
      (!isRecord(value.input) || typeof value.input.hint !== 'string'))
  ) {
    throw new Error(`commands/list returned an invalid command entry: ${JSON.stringify(value)}`)
  }
  return {
    name: value.name,
    description: value.description,
    ...(value.input === undefined ? {} : { input: { hint: value.input.hint as string } }),
  }
}

function parsePluginEntry(value: unknown, operation = 'plugins/list'): TuiPluginEntry {
  if (
    !isRecord(value) ||
    typeof value.entryId !== 'string' ||
    value.entryId.trim() === '' ||
    typeof value.moduleName !== 'string' ||
    value.moduleName.trim() === '' ||
    typeof value.enabled !== 'boolean' ||
    (value.fiberPhase !== null &&
      value.fiberPhase !== 'pending' &&
      value.fiberPhase !== 'loading' &&
      value.fiberPhase !== 'active' &&
      value.fiberPhase !== 'failed' &&
      value.fiberPhase !== 'unloading')
  ) {
    throw new Error(`${operation} returned an invalid plugin entry: ${JSON.stringify(value)}`)
  }
  return {
    entryId: value.entryId,
    moduleName: value.moduleName,
    enabled: value.enabled,
    fiberPhase: value.fiberPhase,
  }
}

function parseCommandResult(value: Record<string, unknown>): TuiCommandExecution['result'] {
  if (value.kind === 'success') {
    if (
      (value.text !== undefined && typeof value.text !== 'string') ||
      (value.sourceEventSeq !== undefined &&
        (!Number.isSafeInteger(value.sourceEventSeq) || (value.sourceEventSeq as number) < 0))
    ) {
      throw new Error(`commands/execute returned an invalid success result: ${JSON.stringify(value)}`)
    }
    return {
      kind: 'success',
      ...(value.text === undefined ? {} : { text: value.text }),
      ...(value.sourceEventSeq === undefined ? {} : { sourceEventSeq: value.sourceEventSeq as number }),
    }
  }
  if (value.kind === 'error' && typeof value.text === 'string' && value.text.trim() !== '') {
    return { kind: 'error', text: value.text }
  }
  throw new Error(`commands/execute returned an invalid command result: ${JSON.stringify(value)}`)
}

function parseRuntimeAdvertisement(value: Record<string, unknown>): TuiRuntimeAdvertisement {
  const promptModes: TuiPromptMode[] = Array.isArray(value.promptModes)
    ? value.promptModes.filter(
        (mode): mode is TuiPromptMode => mode === 'normal' || mode === 'queue' || mode === 'steer',
      )
    : ['normal']
  return {
    promptModes,
    approval: value.approval === true,
    permissionMode: value.permissionMode === true,
    planMode: value.planMode === true,
    sessionList: value.sessionList === true,
    modelList: value.modelList === true,
    imageAttachments: value.imageAttachments === true,
    commands: value.commands === true,
    plugins: value.plugins === true,
    pluginsMutate: value.pluginsMutate === true,
    sessionSearch: value.sessionSearch === true,
    sessionHistory: value.sessionHistory === true,
    sessionModels: value.sessionModels === true,
    sessionRename: value.sessionRename === true,
    queueMutation: value.queueMutation === true,
    attachmentRead: value.attachmentRead === true,
    sessionCreate: value.sessionCreate === true,
    subagentList: value.subagentList === true,
    subagentHistory: value.subagentHistory === true,
    subagentPrompt: value.subagentPrompt === true,
    subagentInterrupt: value.subagentInterrupt === true,
    checkpoint: false,
  }
}

function parseImageAttachmentRef(value: unknown): TuiImageAttachmentRef {
  if (
    !isRecord(value) ||
    typeof value.attachmentId !== 'string' ||
    !isImageMediaType(value.mediaType) ||
    !isNonnegativeInteger(value.bytes) ||
    !isNonnegativeInteger(value.width) ||
    !isNonnegativeInteger(value.height) ||
    (value.name !== undefined && typeof value.name !== 'string') ||
    (value.originalDimensions !== undefined && !isImageDimensions(value.originalDimensions))
  ) {
    throw new Error(`attachment/saveImages returned an invalid attachment: ${JSON.stringify(value)}`)
  }
  return {
    attachmentId: value.attachmentId,
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...(value.originalDimensions === undefined ? {} : { originalDimensions: value.originalDimensions }),
    ...(value.name === undefined ? {} : { name: value.name }),
  }
}

function isImageDimensions(value: unknown): value is { width: number; height: number } {
  return isRecord(value)
    && isPositiveInteger(value.width)
    && isPositiveInteger(value.height)
}

function isImageMediaType(value: unknown): value is TuiImageAttachmentRef['mediaType'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function parseModelCatalogResult(value: unknown): TuiModelCatalog {
  if (!isRecord(value) || !Array.isArray(value.groups) || !Array.isArray(value.failures)) {
    throw new Error('model/list returned an invalid catalog')
  }
  const groups: TuiModelProviderGroup[] = value.groups.map((group) => {
    if (
      !isRecord(group) ||
      typeof group.id !== 'string' ||
      typeof group.name !== 'string' ||
      !Array.isArray(group.models)
    ) {
      throw new Error('model/list returned an invalid provider group')
    }
    return {
      id: group.id,
      name: group.name,
      models: group.models.map((model) => {
        if (
          !isRecord(model) ||
          typeof model.id !== 'string' ||
          typeof model.name !== 'string' ||
          (model.description !== undefined && typeof model.description !== 'string')
        ) {
          throw new Error('model/list returned an invalid model entry')
        }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...parseModelReasoning(model.reasoning),
        }
      }),
    }
  })
  const failures: TuiModelCatalogFailure[] = value.failures.map((failure) => {
    if (
      !isRecord(failure) ||
      typeof failure.id !== 'string' ||
      typeof failure.name !== 'string' ||
      typeof failure.message !== 'string'
    ) {
      throw new Error('model/list returned an invalid provider failure')
    }
    return { id: failure.id, name: failure.name, message: failure.message }
  })
  return { groups, failures }
}

function parseModelReasoning(value: unknown): { reasoning: TuiModelReasoning } | Record<string, never> {
  if (value === undefined) return {}
  if (!isRecord(value) || !Array.isArray(value.efforts)) {
    throw new Error('model/list returned an invalid model entry')
  }
  if (value.defaultEffort !== undefined && typeof value.defaultEffort !== 'string') {
    throw new Error('model/list returned an invalid model entry')
  }
  const efforts: TuiModelReasoningEffort[] = value.efforts.map((effort) => {
    if (
      !isRecord(effort) ||
      typeof effort.id !== 'string' ||
      typeof effort.name !== 'string' ||
      (effort.description !== undefined && typeof effort.description !== 'string')
    ) {
      throw new Error('model/list returned an invalid model entry')
    }
    return {
      id: effort.id,
      name: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    }
  })
  return {
    reasoning: {
      efforts,
      ...(value.defaultEffort === undefined ? {} : { defaultEffort: value.defaultEffort }),
    },
  }
}

function parseApprovalRequest(params: Record<string, unknown>): TuiApprovalRequest {
  if (typeof params.sessionId !== 'string' || typeof params.toolName !== 'string') {
    throw new Error('invalid approval/request')
  }
  return {
    sessionId: params.sessionId,
    toolName: params.toolName,
    ...(typeof params.callId === 'string' ? { callId: params.callId } : {}),
    ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
    ...(typeof params.target === 'string' ? { target: params.target } : {}),
    ...(typeof params.risk === 'string' ? { risk: params.risk } : {}),
    ...(typeof params.source === 'string' ? { source: params.source } : {}),
  }
}

function parseSessionSummary(value: unknown): TuiSessionSummary {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    typeof value.createdAt !== 'number'
  ) {
    throw new Error(`session/list returned an invalid session: ${JSON.stringify(value)}`)
  }
  return {
    sessionId: value.sessionId,
    createdAt: value.createdAt,
    ...(typeof value.updatedAt === 'number' ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.running === 'boolean' ? { running: value.running } : {}),
    ...(typeof value.blank === 'boolean' ? { blank: value.blank } : {}),
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    ...(typeof value.parentSessionId === 'string'
      ? { parentSessionId: value.parentSessionId }
      : {}),
    ...(value.origin === 'subagent' ? { origin: value.origin } : {}),
    ...(typeof value.agentPreset === 'string' ? { agentPreset: value.agentPreset } : {}),
    ...(typeof value.seedLength === 'number' ? { seedLength: value.seedLength } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(typeof value.eventCount === 'number' ? { eventCount: value.eventCount } : {}),
  }
}

function parseProjectionBaseline(value: unknown): import('./types.ts').TuiSessionProjectionBaseline | undefined {
  if (!isRecord(value) || typeof value.asOfSeq !== 'number' || !Number.isSafeInteger(value.asOfSeq) || value.asOfSeq < -1 || !isRecord(value.values)) return undefined
  return { asOfSeq: value.asOfSeq, values: { ...value.values } }
}

function parseWorkspaceEnsureResult(value: unknown): TuiWorkspaceEnsureResult {
  if (!isRecord(value) || typeof value.status !== 'string' || typeof value.path !== 'string') {
    throw new Error(`workspace/ensure returned an invalid result: ${JSON.stringify(value)}`)
  }
  if (value.status === 'authorization-required') {
    if (typeof value.title !== 'string') {
      throw new Error(`workspace/ensure returned an invalid authorization request: ${JSON.stringify(value)}`)
    }
    return { status: value.status, path: value.path, title: value.title }
  }
  if (value.status === 'unsupported') {
    if (typeof value.reason !== 'string') {
      throw new Error(`workspace/ensure returned an invalid unsupported result: ${JSON.stringify(value)}`)
    }
    return { status: value.status, path: value.path, reason: value.reason }
  }
  if (
    value.status !== 'ready' ||
    typeof value.workspaceId !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.created !== 'boolean'
  ) {
    throw new Error(`workspace/ensure returned an invalid ready result: ${JSON.stringify(value)}`)
  }
  return {
    status: value.status,
    workspaceId: value.workspaceId,
    path: value.path,
    title: value.title,
    created: value.created,
  }
}

function mapNotification(notification: {
  method: string
  params: Record<string, unknown>
}): TuiNotification | undefined {
  const params = notification.params
  if (notification.method === 'session.event') {
    const sessionId = params.sessionId
    const event = params.event
    if (typeof sessionId !== 'string' || !isSessionEvent(event)) return undefined
    return { method: 'session.event', params: { sessionId, event } }
  }
  if (notification.method === 'session.status') {
    const sessionId = params.sessionId
    const status = params.status
    if (typeof sessionId !== 'string') return undefined
    if (status !== 'idle' && status !== 'running') return undefined
    return { method: 'session.status', params: { sessionId, status } }
  }
  if (notification.method === 'session.queue') {
    const sessionId = params.sessionId
    if (typeof sessionId !== 'string' || !Array.isArray(params.items)) return undefined
    const items = params.items.flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.message) || !Array.isArray(value.message.content)) return []
      if (value.placement !== 'queued' && value.placement !== 'steering' && value.placement !== 'context') return []
      return [{ id: value.id, placement: value.placement as 'queued' | 'steering' | 'context', content: value.message.content as ContentBlock[] }]
    })
    if (items.length !== params.items.length) return undefined
    return { method: 'session.queue', params: { sessionId, items } }
  }
  if (notification.method === 'session.projection') {
    const sessionId = params.sessionId
    const key = params.key
    const seq = params.seq
    if (typeof sessionId !== 'string' || typeof key !== 'string' || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return undefined
    return { method: 'session.projection', params: { sessionId, key, seq, value: params.value } }
  }
  if (notification.method === 'subagent.started') {
    const parentSessionId = params.parentSessionId
    const childSessionId = params.childSessionId
    if (typeof parentSessionId !== 'string' || typeof childSessionId !== 'string') {
      return undefined
    }
    return {
      method: 'subagent.started',
      params: { parentSessionId, childSessionId },
    }
  }
  if (notification.method === 'subagent.finished') {
    const parentSessionId = params.parentSessionId
    const childSessionId = params.childSessionId
    const provider = params.provider
    const agentId = params.agentId
    const status = params.status
    if (
      typeof parentSessionId !== 'string' ||
      typeof childSessionId !== 'string' ||
      typeof provider !== 'string' ||
      typeof agentId !== 'string' ||
      typeof status !== 'string'
    ) {
      return undefined
    }
    return {
      method: 'subagent.finished',
      params: { provider, agentId, parentSessionId, childSessionId, status },
    }
  }
  return undefined
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  return (
    typeof event.type === 'string' &&
    typeof event.seq === 'number' &&
    typeof event.time === 'number'
  )
}

function parseQuestionRequest(params: Record<string, unknown>): TuiQuestionRequest {
  if (typeof params.sessionId !== 'string' || !Array.isArray(params.questions)) {
    throw new Error('invalid question/ask request')
  }
  const questions = params.questions.map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('invalid question item')
    }
    const item = value as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.question !== 'string') {
      throw new Error('invalid question item')
    }
    const options = item.options === undefined ? undefined : parseQuestionOptions(item.options)
    const intent = item.intent === undefined ? undefined : parseQuestionIntent(item.intent)
    return {
      id: item.id,
      question: item.question,
      ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
      ...(typeof item.header === 'string' ? { header: item.header } : {}),
      ...(options === undefined ? {} : { options }),
      ...(typeof item.multiSelect === 'boolean' ? { multiSelect: item.multiSelect } : {}),
      ...(intent === undefined ? {} : { intent }),
    }
  })
  if (questions.length === 0) throw new Error('question/ask requires at least one question')
  return { sessionId: params.sessionId, questions }
}

function parseQuestionIntent(value: unknown): { kind: 'plan-review'; approve: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid question intent')
  }
  const intent = value as Record<string, unknown>
  if (intent.kind !== 'plan-review' || typeof intent.approve !== 'string') {
    throw new Error('invalid question intent')
  }
  return { kind: intent.kind, approve: intent.approve }
}

function parseQuestionOptions(value: unknown): { label: string; description?: string }[] {
  if (!Array.isArray(value)) throw new Error('invalid question options')
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('invalid question option')
    }
    const option = entry as Record<string, unknown>
    if (typeof option.label !== 'string') throw new Error('invalid question option')
    return {
      label: option.label,
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
    }
  })
}

function isUnsupportedMethodError(error: unknown): boolean {
  if (isRecord(error) && (error.code === -32601 || error.code === 'METHOD_NOT_FOUND')) return true
  return /unknown(?: [^\n]*)? method|method not found|unsupported method|not implemented/i.test(
    error instanceof Error ? error.message : String(error),
  )
}
