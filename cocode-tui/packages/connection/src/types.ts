/**
 * Wire types the TUI runtime may see. Re-exported so src/ never
 * imports @deepseek-ai packages.
 */

export type ContentBlock = {
  type: string
  text?: string
  [key: string]: unknown
}

export type TuiImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export type TuiImageAttachmentRef = {
  attachmentId: string
  mediaType: TuiImageMediaType
  bytes: number
  width: number
  height: number
  originalDimensions?: {
    width: number
    height: number
  }
  name?: string
}

export type TuiImageInput = {
  data: Uint8Array
  mediaType: TuiImageMediaType
  name?: string
}

export type SessionEvent = {
  type: string
  seq: number
  time: number
  data: unknown
  ignorable?: true
}

export type SkillEntry = {
  name: string
  description: string
  whenToUse?: string
  /** Discovery source used to namespace command-palette entries when known. */
  source?: string
}

export type TuiCommandDescriptor = {
  name: string
  description: string
  input?: { hint: string }
}

export type TuiCommandResult =
  | { kind: 'success'; text?: string; sourceEventSeq?: number }
  | { kind: 'error'; text: string }

export type TuiCommandExecution = {
  commandId: string
  result: TuiCommandResult
}

export type TuiPluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

export type TuiPluginEntry = {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: TuiPluginFiberPhase
}

export type TuiQuestionOption = {
  label: string
  description?: string
}

export type TuiQuestionIntent = {
  kind: 'plan-review'
  approve: string
}

export type TuiQuestionItem = {
  id: string
  question: string
  detail?: string
  header?: string
  options?: TuiQuestionOption[]
  multiSelect?: boolean
  customInput?: boolean
  intent?: TuiQuestionIntent
}

export type TuiQuestionAnswerItem = {
  id: string
  selected: string[]
  custom?: string
}

export type TuiQuestionRequest = {
  sessionId: string
  questions: TuiQuestionItem[]
}

export type TuiQuestionAnswer = {
  answers: TuiQuestionAnswerItem[]
}

export type TuiPromptMode = 'normal' | 'queue' | 'steer'

export type TuiApprovalRequest = {
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
  target?: string
  risk?: string
  source?: string
}

/** Approval choices accepted by the harness bridge. */
export type TuiApprovalOutcome =
  | 'allowed-once'
  | 'allowed-for-turn'
  | 'rejected'
  | 'cancelled'
  | 'unavailable'

export type TuiApprovalAnswer = { outcome: TuiApprovalOutcome }

export type TuiSessionSummary = {
  sessionId: string
  createdAt: number
  updatedAt?: number
  running?: boolean
  blank?: boolean
  cwd?: string
  parentSessionId?: string
  origin?: 'subagent'
  agentPreset?: string
  seedLength?: number
  title?: string
  eventCount?: number
  projections?: TuiSessionProjectionBaseline
}

export type TuiSessionOpenResult = {
  opened: boolean
  seedLength?: number
  seed?: SessionEvent[]
}

export type TuiSessionSearchItem = {
  sessionId: string
  snippet: string
}

export type TuiSessionCreateResult = { sessionId: string }

export type TuiSubagentListEntry = {
  kind: 'child'
  id: string
  activity: 'running' | 'inactive'
  mode: 'one-shot' | 'continuable'
  label?: string
  hasChildren: boolean
}

export type TuiSubagentCatalog = {
  entries: TuiSubagentListEntry[]
  parentAvailable: boolean
}

export type TuiSessionHistoryResult = {
  events: SessionEvent[]
  hasMore: boolean
  entries?: TuiHistoryEntry[]
  projections?: TuiSessionProjectionBaseline
}

export type TuiHistoryEntry = {
  event: SessionEvent
  /** Host-computed render intent; kept opaque so TUI does not import DSH tool types. */
  view?: unknown
}

export type TuiSessionProjectionBaseline = {
  /** Last event reflected by the values; -1 means an empty history. */
  asOfSeq: number
  values: Record<string, unknown>
}

export type TuiSessionProjectionUpdate = {
  key: string
  seq: number
  value: unknown
}

export type TuiSessionModels = TuiModelCatalog & {
  current: TuiModelSelection
  routable: boolean
}

export type TuiQueueAction =
  | { kind: 'edit'; content: ContentBlock[] }
  | { kind: 'remove' }
  | { kind: 'steer' }

export type TuiRemoteQueueItem = {
  id: string
  placement: 'queued' | 'steering' | 'context'
  content: ContentBlock[]
}

export type TuiAttachmentReadResult = {
  attachment: TuiImageAttachmentRef
  data: Uint8Array
}

export type TuiWorkspaceEnsureResult =
  | {
      status: 'ready'
      workspaceId: string
      path: string
      title: string
      created: boolean
    }
  | {
      status: 'authorization-required'
      path: string
      title: string
    }
  | {
      status: 'unsupported'
      path: string
      reason: string
    }

export type TuiModelReasoningEffort = {
  id: string
  name: string
  description?: string
}

export type TuiModelReasoning = {
  efforts: TuiModelReasoningEffort[]
  defaultEffort?: string
}

export type TuiModel = {
  id: string
  name: string
  description?: string
  reasoning?: TuiModelReasoning
}

export type TuiModelProviderGroup = {
  id: string
  name: string
  models: TuiModel[]
}

export type TuiModelCatalogFailure = {
  id: string
  name: string
  message: string
}

export type TuiModelCatalog = {
  groups: TuiModelProviderGroup[]
  failures: TuiModelCatalogFailure[]
}

export type TuiModelSelection = {
  provider: string
  model: string
  reasoningEffort?: string
}

export type TuiLaunch = {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Runtime operations whose availability is negotiated after initialize.
 *
 * These names describe wire/client facts, not local UI configuration. A
 * consumer should use the snapshot returned by `TuiRuntime.getCapabilities`
 * when it needs to decide whether to send one of these requests.
 */
export type TuiRuntimeCapabilityName =
  | 'cancel'
  | 'open'
  | 'fork'
  | 'rewind'
  | 'skills'
  | 'onRequest'
  | 'approval'
  | 'permissionMode'
  | 'planMode'
  | 'sessionList'
  | 'promptMode'
  | 'queueMode'
  | 'modelList'
  | 'imageAttachments'
  | 'commands'
  | 'plugins'
  | 'pluginsMutate'
  | 'sessionSearch'
  | 'sessionHistory'
  | 'sessionModels'
  | 'sessionRename'
  | 'queueMutation'
  | 'attachmentRead'
  | 'sessionCreate'
  | 'subagentList'
  | 'subagentHistory'
  | 'subagentPrompt'
  | 'subagentInterrupt'

export type TuiRuntimeCapabilities = Record<Exclude<TuiRuntimeCapabilityName, TuiExtendedCapabilityName>, boolean>

export type TuiExtendedCapabilityName =
  | 'sessionSearch'
  | 'sessionHistory'
  | 'sessionModels'
  | 'sessionRename'
  | 'queueMutation'
  | 'attachmentRead'
  | 'sessionCreate'
  | 'subagentList'
  | 'subagentHistory'
  | 'subagentPrompt'
  | 'subagentInterrupt'

export type TuiExtendedRuntimeCapabilities = TuiRuntimeCapabilities & Partial<Record<TuiExtendedCapabilityName, boolean>>

export type TuiRuntimeAdvertisement = {
  promptModes: TuiPromptMode[]
  approval: boolean
  permissionMode: boolean
  planMode: boolean
  sessionList: boolean
  modelList: boolean
  imageAttachments: boolean
  checkpoint: false
  commands?: boolean
  plugins?: boolean
  pluginsMutate?: boolean
  sessionSearch?: boolean
  sessionHistory?: boolean
  sessionModels?: boolean
  sessionRename?: boolean
  sessionCreate?: boolean
  subagentList?: boolean
  subagentHistory?: boolean
  subagentPrompt?: boolean
  subagentInterrupt?: boolean
  queueMutation?: boolean
  attachmentRead?: boolean
}

/** Result of probing the live SDK runtime after its initialize handshake. */
export type TuiCapabilitySnapshot = {
  /** `runtime` means probes ran; `fallback` means no probe API was available. */
  source: 'runtime' | 'fallback'
  capabilities: TuiExtendedRuntimeCapabilities
  modes?: TuiRuntimeAdvertisement
  /** Human-readable probe failures, keyed by the capability they describe. */
  errors: Partial<Record<TuiRuntimeCapabilityName, string>>
}

export type TuiInitialize = {
  cwd: string
  provider: string
  model: string
  maxTokens?: number
}

export type SubagentFinished = {
  provider: string
  agentId: string
  parentSessionId: string
  childSessionId: string
  status: string
}

export type TuiNotification =
  | {
      method: 'session.event'
      params: { sessionId: string; event: SessionEvent }
    }
  | {
      method: 'session.status'
      params: { sessionId: string; status: 'idle' | 'running' }
    }
  | {
      method: 'session.queue'
      params: { sessionId: string; items: TuiRemoteQueueItem[] }
    }
  | {
      method: 'session.projection'
      params: { sessionId: string; key: string; seq: number; value: unknown }
    }
  | {
      method: 'subagent.started'
      params: { parentSessionId: string; childSessionId: string }
    }
  | { method: 'subagent.finished'; params: SubagentFinished }

export type TuiRuntime = {
  start(
    init: TuiInitialize,
  ): Promise<{ name: string; version: string; capabilities?: TuiRuntimeAdvertisement }>
  restart(
    init: TuiInitialize,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ name: string; version: string; capabilities?: TuiRuntimeAdvertisement }>
  prompt(sessionId: string, blocks: ContentBlock[], mode?: TuiPromptMode): Promise<string>
  cancel(sessionId: string, keepInbox?: boolean): Promise<boolean>
  open(sessionId: string, replaceSessionId?: string): Promise<boolean | TuiSessionOpenResult>
  fork(
    sourceSessionId: string,
    boundary?: number,
    replaceSessionId?: string,
    rewindToMessageSeq?: number,
  ): Promise<{ sessionId: string; seedLength: number; seed: SessionEvent[] }>
  rewind(
    sourceSessionId: string,
    messageSeq: number,
    replaceSessionId?: string,
  ): Promise<{ sessionId: string; seedLength: number; seed: SessionEvent[] }>
  listSkills?(sessionId: string): Promise<SkillEntry[]>
  listCommands?(sessionId: string): Promise<TuiCommandDescriptor[]>
  executeCommand?(sessionId: string, line: string): Promise<TuiCommandExecution | undefined>
  listPlugins?(): Promise<TuiPluginEntry[]>
  setPluginEnabled?(entryId: string, enabled: boolean): Promise<TuiPluginEntry>
  listSessions?(cwd?: string): Promise<TuiSessionSummary[]>
  createSession?(sessionId?: string, cwd?: string): Promise<TuiSessionCreateResult>
  listSubagents?(parentSessionId: string): Promise<TuiSubagentCatalog>
  subagentHistory?(parentSessionId: string, childSessionId: string, beforeSeq?: number, maxMessages?: number): Promise<TuiSessionHistoryResult>
  promptSubagent?(parentSessionId: string, childSessionId: string, blocks: ContentBlock[]): Promise<string>
  interruptSubagent?(parentSessionId: string, childSessionId: string): Promise<boolean>
  searchSessions?(query: string): Promise<{ items: TuiSessionSearchItem[]; hasMore: boolean }>
  history?(sessionId: string, beforeSeq?: number, maxMessages?: number): Promise<TuiSessionHistoryResult>
  sessionModels?(sessionId: string): Promise<TuiSessionModels>
  renameSession?(sessionId: string, title: string): Promise<{ title: string; seq: number }>
  updateQueue?(sessionId: string, itemId: string, action: TuiQueueAction): Promise<boolean>
  readAttachment?(sessionId: string, attachmentId: string): Promise<TuiAttachmentReadResult>
  ensureWorkspace?(sessionId: string, approved?: boolean): Promise<TuiWorkspaceEnsureResult>
  listModels?(): Promise<TuiModelCatalog>
  selectModel?(
    sessionId: string,
    provider: string,
    model: string,
    reasoningEffort?: string,
  ): Promise<TuiModelSelection | undefined>
  saveImages?(images: readonly TuiImageInput[]): Promise<TuiImageAttachmentRef[]>
  permissionMode?(
    sessionId: string,
    mode?: string,
  ): Promise<{ mode: string; supportedModes: string[] }>
  planMode?(sessionId: string, active?: boolean): Promise<{ active: boolean; pending?: boolean }>
  onQuestion?(handler: (request: TuiQuestionRequest) => Promise<TuiQuestionAnswer>): () => void
  onApproval?(handler: (request: TuiApprovalRequest) => Promise<TuiApprovalAnswer>): () => void
  /** Live capability snapshot; absent on legacy/fake runtimes. */
  getCapabilities?(): TuiCapabilitySnapshot
  subscribe(handler: (n: TuiNotification) => void): () => void
  onClose?: (handler: (error?: string) => void) => () => void
  close(): Promise<void>
}
