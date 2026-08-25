/**
 * TuiApp owns session lifecycle, projection, and local queues.
 */

import type {
  SkillEntry,
  SessionEvent,
  TuiSessionOpenResult,
  TuiNotification,
  TuiCapabilitySnapshot,
  TuiCommandDescriptor,
  TuiRuntimeCapabilityName,
  TuiApprovalAnswer,
  TuiApprovalRequest,
  TuiRuntime,
  TuiImageInput,
  TuiPluginEntry,
  TuiWorkspaceEnsureResult,
  TuiModelCatalog,
  TuiRemoteQueueItem,
  TuiSessionProjectionUpdate,
} from '@cocode/tui-connection'
import type {
  ExternalDshReadSource,
  ExternalSessionEvent,
  ExternalSessionSummary,
} from '@cocode-agency/host-supervisor'
import type { SelectModeResult } from './auth/store.ts'
import type { AuthSnapshot, ResolvedAuth } from './auth/types.ts'
import type { Assembler } from './assembler.ts'
import { P0_CAPABILITIES, type TuiCapabilities } from './capabilities.ts'
import {
  type Command,
  CommandRegistry,
  commandSummary,
  createBuiltinCommands,
  helpText,
  parseSlash,
} from './commands.ts'
import { InputHistory } from './history.ts'
import type { ConversationNode } from './nodes/types.ts'
import {
  backspaceDraft,
  createDraft,
  deleteDraftSelection,
  insertDraft,
  moveDraftCursor,
  replaceDraftRange,
  replaceDraft,
  selectAllDraft,
  selectedDraftRange,
  selectedDraftText,
  type DraftState,
} from './draft.ts'
import { buildPromptBlocks, loadFileContext } from './file-context.ts'
import type { SessionStateProjector, SessionGoal, SessionTodo } from './session-state.ts'
import {
  createSessionId,
  createSessionProjection,
  loadSessionProjection,
} from './session-lifecycle.ts'
import { formatFileMention } from './file-mentions.ts'
import { resolveWorkspaceInfo } from './workspace.ts'
import { createAppCommandContext } from './command-context.ts'
import {
  composerPlaceholder,
  errorMessage,
  latestUsage,
  startErrorMessage,
  statusLine,
} from './app-view.ts'
import { handleInterrupt } from './interrupt.ts'
import { closeRuntime } from './lifecycle.ts'
import { handleNotification } from './notification.ts'
import { errorNotice } from './errors/index.ts'
import { redactSecrets } from './diagnostics.ts'
import { localeName, parseUiLocale, text, type UiLocale } from './ui-locale.ts'
import {
  closeResumePicker,
  createResumePicker,
  moveResumeSelection,
  selectedResumeItem,
  setResumeQuery,
  type ResumePickerState,
} from './resume-picker.ts'
import { createRewindPicker, type RewindPickerState } from './rewind-picker.ts'
import {
  closeSkillsPicker,
  createSkillsPicker,
  moveSkillsSelection,
  selectedSkill,
  setSkillsQuery,
  type SkillsPickerState,
} from './skills-picker.ts'
import {
  beginPluginMutation,
  closePluginPicker,
  completePluginMutation,
  createPluginPicker,
  failPluginMutation,
  movePluginSelection,
  pluginPhaseLabel,
  selectedPlugin,
  setPluginQuery,
  type PluginPickerState,
} from './plugin-picker.ts'
import {
  closeModelPicker,
  createModelPicker,
  findCatalogModel,
  moveModelSelection,
  selectedModel,
  setModelQuery,
  type ModelPickerState,
} from './model-picker.ts'
import {
  beginEffortChange,
  closeEffortPicker,
  createEffortPicker,
  moveEffortSelection,
  selectedEffort,
  type EffortPickerState,
} from './effort-picker.ts'
import {
  beginPermissionChange,
  closePermissionPicker,
  completePermissionChange,
  createPermissionPicker,
  failPermissionChange,
  movePermissionSelection,
  selectedPermissionMode,
  type PermissionPickerState,
} from './permission-picker.ts'
import {
  logoutChannel,
  requestChannelSwitch,
  submitCapturedByok,
  type ChannelSwitchHost,
} from './channel-switch.ts'
import type { TelemetryProjector, TelemetrySnapshot } from './telemetry.ts'
import { copyToClipboard, readableNodeText } from './clipboard.ts'
import { notifyTerminal, type TerminalNotifyMode } from './terminal-notify.ts'
import {
  collectGitReview,
  parseReviewScope,
  type GitReview,
  type ReviewScope,
} from './git-review.ts'
import {
  closeReviewPicker,
  createReviewPicker,
  moveReviewSelection,
  selectedReviewScope,
  setReviewLoading,
  setReviewPreview,
  type ReviewPickerState,
} from './review-picker.ts'
import { createApprovalState, type ApprovalState, type PendingApproval } from './approval.ts'
import {
  createQuestionCoordinator,
  type QuestionCoordinator,
  type TuiQuestionSnapshot,
} from './question-coordinator.ts'
import { refreshRuntimeCapabilities } from './capability-adapter.ts'
import { PromptQueueCoordinator } from './prompt-queue-coordinator.ts'
import { renameSession } from './session-rename.ts'
import { createSessionProjectionStore } from './session-projections.ts'
import type { DraftImage } from './prompt-queue.ts'
import type { PromptQueuePickerState } from './prompt-queue-picker.ts'
import {
  closeRemoteQueuePicker,
  createRemoteQueuePicker,
  moveRemoteQueueSelection,
  selectedRemoteQueueItem,
  setRemoteQueueItems,
  setRemoteQueueQuery,
  type RemoteQueuePickerState,
} from './remote-queue-picker.ts'
import { routeBoundaryPickerAction } from './action-router.ts'
import {
  closeSessionTreePicker,
  createSessionTreePicker,
  moveSessionTreeSelection,
  replaceSessionTreeItems,
  selectedSessionTreeItem,
  setSessionTreeActivity,
  setSessionTreeQuery,
  type SessionTreePickerItem,
  type SessionTreePickerState,
} from './session-tree-picker.ts'
import {
  closeSubagentPicker,
  createSubagentPicker,
  moveSubagentSelection,
  selectedSubagent,
  setSubagentQuery,
  type SubagentPickerState,
} from './subagent-picker.ts'
import { buildSessionTree, flattenSessionTree } from './session-tree.ts'
import { listSessionSummaries } from './sessions-fs.ts'
import { basename } from 'node:path'
import {
  clampChecklistSelection,
  closeChecklist,
  createChecklist,
  moveChecklistSelection,
  type ChecklistState,
} from './checklist.ts'
import {
  ClipboardImageError,
  pastedImagePath,
  readClipboardImage,
  readImageFile,
} from './image-clipboard.ts'
import type { Keymap } from './keymap.ts'
import { resolveKeymap } from './keymap-config.ts'
import type { TuiLogger } from './logging.ts'

export type TuiAction =
  | { type: 'submit'; text: string }
  | { type: 'compact' }
  | { type: 'command'; line: string }
  | { type: 'command.select'; line: string }
  | { type: 'setDraft'; text: string }
  | { type: 'insertDraft'; text: string }
  | { type: 'insertPastedInput'; text: string }
  | { type: 'deleteBackward' }
  | { type: 'moveCursor'; delta: number; extendSelection?: boolean }
  | { type: 'selectAllDraft' }
  | { type: 'copyDraftSelection' }
  | { type: 'cutDraftSelection' }
  | { type: 'attachFile'; start: number; end: number; path: string }
  | { type: 'historyPrev' }
  | { type: 'historyNext' }
  | { type: 'toggleVerbose' }
  | { type: 'toggleHelp' }
  | { type: 'interruptOrQuit' }
  | { type: 'session.new' }
  | { type: 'session.open' }
  | { type: 'session.back' }
  | { type: 'file.open' }
  | { type: 'quit' }
  | { type: 'quit.move'; delta: number }
  | { type: 'quit.confirm' }
  | { type: 'quit.cancel' }
  | { type: 'redraw' }
  | { type: 'resume.setQuery'; query: string }
  | { type: 'resume.move'; delta: number }
  | { type: 'resume.close' }
  | { type: 'resume.confirm' }
  | { type: 'sessionTree.setQuery'; query: string }
  | { type: 'sessionTree.move'; delta: number }
  | { type: 'sessionTree.close' }
  | { type: 'sessionTree.confirm' }
  | { type: 'subagents.setQuery'; query: string }
  | { type: 'subagents.move'; delta: number }
  | { type: 'subagents.close' }
  | { type: 'subagents.confirm' }
  | { type: 'rewind.open' }
  | { type: 'rewind.move'; delta: number }
  | { type: 'rewind.close' }
  | { type: 'rewind.confirm' }
  | { type: 'fork.open' }
  | { type: 'fork.move'; delta: number }
  | { type: 'fork.close' }
  | { type: 'fork.confirm' }
  | { type: 'skills.setQuery'; query: string }
  | { type: 'skills.move'; delta: number }
  | { type: 'skills.close' }
  | { type: 'skills.confirm' }
  | { type: 'plugins.setQuery'; query: string }
  | { type: 'plugins.move'; delta: number }
  | { type: 'plugins.close' }
  | { type: 'plugins.confirm' }
  | { type: 'model.open' }
  | { type: 'image.paste' }
  | { type: 'model.setQuery'; query: string }
  | { type: 'model.move'; delta: number }
  | { type: 'model.close' }
  | { type: 'model.confirm' }
  | { type: 'model.input.close' }
  | { type: 'model.input.submit'; model: string }
  | { type: 'effort.move'; delta: number }
  | { type: 'effort.close' }
  | { type: 'effort.confirm' }
  | { type: 'question.answer'; selected: string[]; custom?: string }
  | {
      type: 'question.navigate'
      direction: 'previous' | 'next'
      selected: string[]
      custom?: string
      dirty: boolean
    }
  | { type: 'question.cancel' }
  | { type: 'approval.answer'; outcome: TuiApprovalAnswer['outcome'] }
  | { type: 'approval.cancel' }
  | { type: 'permission.open' }
  | { type: 'permission.move'; delta: number }
  | { type: 'permission.close' }
  | { type: 'permission.confirm' }
  | { type: 'permission.toggle' }
  | { type: 'plan.toggle' }
  | { type: 'queuePrompt' }
  | { type: 'queue.open' }
  | { type: 'queue.setQuery'; query: string }
  | { type: 'queue.move'; delta: number }
  | { type: 'queue.close' }
  | { type: 'queue.delete' }
  | { type: 'queue.restore' }
  | { type: 'remoteQueue.open' }
  | { type: 'remoteQueue.setQuery'; query: string }
  | { type: 'remoteQueue.move'; delta: number }
  | { type: 'remoteQueue.close' }
  | { type: 'remoteQueue.delete' }
  | { type: 'remoteQueue.steer' }
  | { type: 'checklist.open' }
  | { type: 'checklist.move'; delta: number }
  | { type: 'checklist.close' }
  | { type: 'copyNode'; nodeKey: string }
  | { type: 'copyText'; text: string }
  | { type: 'review.move'; delta: number }
  | { type: 'review.close' }
  | { type: 'review.confirm' }

export type { TuiCapabilities }

type TuiDisplayedCapabilityName = TuiRuntimeCapabilityName

type ExternalSessionState = {
  id: string
  identity: string
  title?: string
  cwd?: string
  canMutate: boolean
  concurrency: 'no-concurrent-writes'
  revision?: string
}

type PreviousSessionView = {
  sessionId: string
  assembler: Assembler
  telemetry: TelemetryProjector
  sessionState: SessionStateProjector
  externalSession: ExternalSessionState | undefined
  sessionTitleOverride: string | undefined
  provider: string
  model: string
  capabilities: TuiCapabilities
  skills: SkillEntry[]
  remoteCommands: TuiCommandDescriptor[]
}

export type TuiSnapshot = {
  header: {
    product: 'Cocode'
    sessionId: string
    source: 'cocode' | 'shared-dsh'
    readOnly: boolean
    canMutate: boolean
    concurrency: 'single-writer' | 'no-concurrent-writes'
    model: string
    provider: string
    reasoningEffort?: string
    cwd: string
    branch?: string
  }
  agent: 'idle' | 'running' | 'starting' | 'dead'
  nodes: readonly ConversationNode[]
  history: readonly string[]
  locale: UiLocale
  composer: {
    text: string
    cursor: number
    selection?: { start: number; end: number }
    placeholder: string
    disabled: boolean
    mask?: boolean
    attachments: readonly string[]
    images: readonly { name: string; mediaType: string; bytes: number }[]
  }
  status: {
    line: string
    tokens?: { input: number; output: number }
    telemetry: TelemetrySnapshot
    todos: readonly SessionTodo[]
    goal?: SessionGoal
    sessionTitle?: string
    agentPreset?: string
    transcript?: { evicted: number }
    subagents?: TuiSubagentActivity
    queueCount: number
    remoteQueueCount: number
    focusMode: boolean
    permissionMode: string
    planMode: boolean
  }
  queuePicker?: PromptQueuePickerState
  remoteQueuePicker?: RemoteQueuePickerState
  checklist?: ChecklistState
  helpOpen: boolean
  verbose: boolean
  capabilities: TuiCapabilities
  runtimeInfo: {
    name: string
    capabilitySource: TuiCapabilitySnapshot['source'] | 'unknown'
    mcp: {
      status: 'connected' | 'unavailable' | 'unknown'
      name?: string
    }
    capabilities: readonly { name: TuiDisplayedCapabilityName; enabled: boolean }[]
  }
  notice?: { tone: 'info' | 'error'; message: string }
  quitConfirmation: boolean
  quitConfirmationSelection: 'confirm' | 'cancel'
  helpText: string
  commands: readonly {
    name: string
    summary: string
    input?: { hint: string }
  }[]
  resumePicker?: ResumePickerState
  sessionTreePicker?: SessionTreePickerState
  subagentPicker?: SubagentPickerState
  rewindPicker?: RewindPickerState
  forkPicker?: RewindPickerState
  skillsPicker?: SkillsPickerState
  pluginPicker?: PluginPickerState
  modelPicker?: ModelPickerState
  effortPicker?: EffortPickerState
  permissionPicker?: PermissionPickerState
  modelInputOpen: boolean
  skills: readonly SkillEntry[]
  question?: TuiQuestionSnapshot
  approval?: ApprovalState
  reviewPicker?: ReviewPickerState
  exiting: boolean
}

export type { TuiQuestionSnapshot }

export type TuiApprovalSnapshot = ApprovalState

export type TuiSubagentActivity = {
  running: number
  last?: { id: string; event: 'started' | 'finished' }
}

export type TuiAuthInfo = {
  mode: 'byok' | 'cocode'
  envLocked: boolean
  accountLabel?: string
  logout: () => Promise<void>
  persistModel?: (provider: string, model: string) => Promise<void>
  selectMode?: (mode: 'byok' | 'cocode') => Promise<SelectModeResult>
  exclusiveHome?: () => Promise<boolean>
  login?: () => void
  submitByok?: (key: string) => Promise<void>
  resolved?: () => ResolvedAuth
  snapshot?: () => AuthSnapshot
  subscribe?: (listener: () => void) => () => void
}

export type TuiCommandCtx = {
  dispatch: (action: TuiAction) => void
  newSession: () => void
  clearTranscript: () => void
  showStatus: () => void
  notice: (tone: 'info' | 'error', message: string) => void
  logout: () => Promise<void>
  useAuth?: (target: 'byok' | 'cocode' | 'login') => void
  showDoctor?: () => void
  exportTranscript?: () => Promise<void>
  initWorkspace?: () => Promise<void>
  setTheme?: (name: 'dark' | 'light') => void
  setLocale?: (value: string) => void
  setModel?: (value: string) => void
  renameSession?: (title: string) => void
  resumeSessions?: () => Promise<void>
  showSkillsPicker?: () => void
  showPlugins?: (args: string) => void
  showModelPicker?: () => void
  showEffortPicker?: () => void
  setEffort?: (value: string) => void
  showRewindPicker?: () => void
  showUsage?: () => void
  copyLatestAssistant?: () => void
  pasteImage?: () => void
  toggleFocus?: () => void
  review?: (args: string) => void
  forkSession?: () => void
  cloneSession?: () => void
  showSessionTree?: () => Promise<void>
  showForkPicker?: () => void
  showQueuePicker?: () => void
  showChecklist?: () => void
  showSubagents?: () => void
  showHistory?: (args?: string) => void
  editRemoteQueue?: (itemId: string, text: string) => void
  showSubagentHistory?: (childSessionId: string) => void
  promptSubagent?: (childSessionId: string, text: string) => void
  interruptSubagent?: (childSessionId: string) => void
}

export type TuiApp = {
  start(): Promise<void>
  close(): Promise<void>
  snapshot(): TuiSnapshot
  subscribe(listener: () => void): () => void
  dispatch(action: TuiAction): void
}

export type TuiAppOptions = {
  runtime: TuiRuntime
  externalDsh?: ExternalDshReadSource
  cwd: string
  provider: string
  model: string
  sessionId?: string
  capabilities?: TuiCapabilities
  commands?: CommandRegistry
  auth?: TuiAuthInfo
  diagnostics?: {
    tty: boolean
    launchConfigured: boolean
    argsConfigured: boolean
    sessionRoot?: string
    runtimeHome?: string
    sharedDshHome?: string
  }
  setTheme?: (name: 'dark' | 'light') => void
  locale?: UiLocale
  terminalNotify?: {
    mode?: TerminalNotifyMode
    write?: (value: string) => void
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
  }
  readClipboardImage?: () => Promise<TuiImageInput>
  readPastedImage?: (path: string) => Promise<TuiImageInput | undefined>
  logger?: TuiLogger
}

export function createTuiApp(options: TuiAppOptions): TuiApp {
  return new TuiAppImpl(options)
}

class TuiAppImpl implements TuiApp {
  private readonly runtime: TuiRuntime
  private readonly externalDsh: ExternalDshReadSource | undefined
  private readonly cwd: string
  private provider: string
  private model: string
  private readonly configuredCapabilities: TuiCapabilities
  private capabilities: TuiCapabilities
  private runtimeCapabilitySnapshot: TuiCapabilitySnapshot | undefined
  private readonly commands: CommandRegistry
  private assembler: Assembler
  private telemetry: TelemetryProjector
  private sessionState: SessionStateProjector
  private readonly history = new InputHistory()
  private readonly listeners = new Set<() => void>()
  private unsubscribeRuntime: (() => void) | undefined
  private unsubscribeRuntimeClose: (() => void) | undefined
  private unsubscribeQuestion: (() => void) | undefined
  private unsubscribeApproval: (() => void) | undefined
  private sessionId: string
  private agent: TuiSnapshot['agent'] = 'starting'
  private draft: DraftState = createDraft()
  private attachments: Array<{ path: string; token: string }> = []
  private images: DraftImage[] = []
  private helpOpen = false
  private verbose = false
  private focusMode = false
  private notice: TuiSnapshot['notice']
  private runtimeFailureNotice: string | undefined
  private interruptArmed = false
  private quitConfirmation = false
  private quitConfirmationSelection: TuiSnapshot['quitConfirmationSelection'] = 'confirm'
  private exiting = false
  private runtimeName = ''
  private initError: string | undefined
  private workspaceBranch: string | undefined
  private readonly diagnostics: NonNullable<TuiAppOptions['diagnostics']>
  private readonly themeSetter: TuiAppOptions['setTheme']
  private locale: UiLocale
  private readonly auth: TuiAuthInfo | undefined
  private readonly terminalNotify: NonNullable<TuiAppOptions['terminalNotify']>
  private readonly imageReader: () => Promise<TuiImageInput>
  private readonly pastedImageReader: (path: string) => Promise<TuiImageInput | undefined>
  private readonly logger: TuiLogger | undefined
  private unsubscribeExternalDsh: (() => void) | undefined
  private readonly keymap: Keymap
  private imageSerial = 0
  private readonly activeSubagents = new Set<string>()
  private highestSessionSeq = -1
  private historyEvents: SessionEvent[] = []
  private historyHasMore = false
  private lastSubagent: TuiSubagentActivity['last']
  private readonly promptQueue = new PromptQueueCoordinator()
  private remoteQueue: TuiRemoteQueueItem[] = []
  private remoteQueuePicker: RemoteQueuePickerState | undefined
  private readonly projectionStore = createSessionProjectionStore()
  private capturingByok = false
  private emitScheduled = false
  private closePromise: Promise<void> | undefined
  private resumePicker: ResumePickerState | undefined
  private sessionTreePicker: SessionTreePickerState | undefined
  private subagentPicker: SubagentPickerState | undefined
  private sessionTreeSourceItems: SessionTreePickerItem[] = []
  private sessionTreeSearchGeneration = 0
  private readonly sessionActivities = new Map<string, 'idle' | 'running'>()
  private sessionTitleOverride: string | undefined
  private rewindPicker: RewindPickerState | undefined
  private forkPicker: RewindPickerState | undefined
  private skillsPicker: SkillsPickerState | undefined
  private pluginPicker: PluginPickerState | undefined
  private modelPicker: ModelPickerState | undefined
  private effortPicker: EffortPickerState | undefined
  private modelCatalog: TuiModelCatalog | undefined
  private reasoningEffort: string | undefined
  private permissionPicker: PermissionPickerState | undefined
  private modelInputOpen = false
  private skills: SkillEntry[] = []
  private remoteCommands: TuiCommandDescriptor[] = []
  private pendingSkillInvocation: string | undefined
  private readonly questions: QuestionCoordinator
  private workspaceAuthorizationPending = false
  private readonly approvalQueue: PendingApproval[] = []
  private activeApproval: PendingApproval | undefined
  private permissionMode = 'manual'
  private supportedPermissionModes: string[] = ['manual']
  private planMode = false
  private reviewPicker: ReviewPickerState | undefined
  private checklist: ChecklistState | undefined
  private reviewRequest = 0
  private externalSession: ExternalSessionState | undefined
  private previousSessionView: PreviousSessionView | undefined

  constructor(options: TuiAppOptions) {
    const projection = createSessionProjection()
    this.runtime = options.runtime
    this.externalDsh = options.externalDsh
    this.cwd = options.cwd
    this.provider = options.provider
    this.model = options.model
    this.sessionId = options.sessionId ?? createSessionId()
    this.configuredCapabilities = options.capabilities ?? P0_CAPABILITIES
    this.capabilities = this.configuredCapabilities
    this.commands = options.commands ?? createBuiltinCommands()
    this.assembler = projection.assembler
    this.telemetry = projection.telemetry
    this.sessionState = projection.sessionState
    this.auth = options.auth
    this.diagnostics = options.diagnostics ?? {
      tty: true,
      launchConfigured: true,
      argsConfigured: true,
    }
    this.themeSetter = options.setTheme
    this.locale = options.locale ?? 'en'
    this.terminalNotify =
      options.terminalNotify ?? (process.stdout.isTTY === true ? {} : { mode: 'off' })
    this.imageReader = options.readClipboardImage ?? (() => readClipboardImage())
    this.pastedImageReader = options.readPastedImage ?? readImageFile
    this.logger = options.logger
    this.keymap = resolveKeymap()
    this.questions = createQuestionCoordinator({
      emit: () => this.emit(),
      onStart: () => {
        if (this.questions.snapshot() === undefined) return
        notifyTerminal({
          ...this.terminalNotify,
          title: 'Cocode',
          body: text(this.locale, 'questionReady'),
        })
      },
    })
  }

  async start(): Promise<void> {
    this.logger?.info('tui.runtime.start.started')
    this.agent = 'starting'
    this.emit()
    this.unsubscribeRuntime = this.runtime.subscribe((n) => this.onNotification(n))
    this.unsubscribeQuestion = this.runtime.onQuestion?.((request) => this.questions.ask(request))
    this.unsubscribeApproval = this.runtime.onApproval?.((request) => this.askApproval(request))
    this.unsubscribeRuntimeClose = this.runtime.onClose?.((error) => {
      if (this.exiting) return
      this.rejectApprovals(new Error(error ?? 'runtime disconnected'))
      this.agent = 'dead'
      this.notice = errorNotice(
        'RUNTIME_STOPPED',
        error === undefined ? {} : { detail: redactSecrets(error) },
      )
      this.emit()
    })
    this.unsubscribeExternalDsh = this.externalDsh?.subscribe(() => {
      if (this.sessionTreePicker?.open === true) void this.showSessionTree()
      else this.emit()
    })
    try {
      const info = await this.runtime.start({
        cwd: this.cwd,
        provider: this.provider,
        model: this.model,
      })
      if (this.exiting) return
      this.runtimeName = info.name
      this.refreshRuntimeCapabilities()
      this.agent = 'idle'
      this.sessionActivities.set(this.sessionId, 'idle')
      this.initError = undefined
      this.notice = undefined
      this.workspaceBranch = (await resolveWorkspaceInfo(this.cwd)).branch
      await this.refreshSessionControls()
      await this.loadSkills()
      await this.loadCommands()
      if (this.exiting) return
      this.logger?.info('tui.runtime.start.completed')
    } catch (error) {
      if (this.exiting) return
      this.agent = 'dead'
      this.initError = errorMessage(error)
      this.notice = {
        tone: 'error',
        message: startErrorMessage(error),
      }
      this.logger?.error('tui.runtime.start.failed')
    }
    this.emit()
  }

  async close(): Promise<void> {
    this.closePromise ??= this.closeRuntime()
    return this.closePromise
  }

  private async closeRuntime(): Promise<void> {
    this.logger?.info('tui.runtime.close.started')
    try {
      await closeRuntime({
        unsubscribe: () => {
          this.unsubscribeRuntime?.()
          this.unsubscribeRuntime = undefined
          this.unsubscribeQuestion?.()
          this.unsubscribeQuestion = undefined
          this.unsubscribeApproval?.()
          this.unsubscribeApproval = undefined
          this.unsubscribeExternalDsh?.()
          this.unsubscribeExternalDsh = undefined
          this.questions.rejectAll(new Error('TUI closed before the question was answered'))
          this.rejectApprovals(new Error('TUI closed before approval was answered'))
        },
        unsubscribeClose: () => {
          this.unsubscribeRuntimeClose?.()
          this.unsubscribeRuntimeClose = undefined
        },
        runtimeClose: () => this.runtime.close(),
        markDead: () => {
          this.agent = 'dead'
          this.emit()
        },
      })
    } finally {
      await this.externalDsh?.dispose().catch(() => undefined)
      this.logger?.info('tui.runtime.close.completed')
    }
  }

  snapshot(): TuiSnapshot {
    const disabled = this.agent === 'dead' || this.exiting || this.externalSession?.canMutate === false
    const telemetry = this.telemetry.snapshot()
    const sessionState = this.sessionState.snapshot()
    const assemblerStats = this.assembler.stats()
    const reasoningEffort = this.displayedReasoningEffort()
    return {
      header: {
        product: 'Cocode',
        sessionId: this.externalSession?.identity ?? this.sessionId,
        source: this.externalSession === undefined ? 'cocode' : 'shared-dsh',
        readOnly: this.externalSession?.canMutate === false,
        canMutate: this.externalSession?.canMutate ?? true,
        concurrency: this.externalSession?.concurrency ?? 'single-writer',
        model: this.model,
        provider: this.provider,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        cwd: this.externalSession?.cwd ?? this.cwd,
        branch: this.workspaceBranch,
      },
      agent: this.agent,
      nodes: this.assembler.snapshot(),
      history: this.history.entriesSnapshot(),
      locale: this.locale,
      composer: {
        text: this.capturingByok ? '*'.repeat(this.draft.text.length) : this.draft.text,
        cursor: this.draft.cursor,
        selection: selectedDraftRange(this.draft),
        placeholder: this.capturingByok
          ? '粘贴 API Key，回车确认'
          : composerPlaceholder(this.agent, this.locale),
        disabled,
        attachments: this.attachments.map((attachment) => attachment.path),
        images: this.images.map((image) => ({
          name: image.name,
          mediaType: image.mediaType,
          bytes: image.data.byteLength,
        })),
        ...(this.capturingByok ? { mask: true } : {}),
      },
      status: {
        line: statusLine(this.agent, this.runtimeName, this.locale),
        tokens:
          telemetry.usage === undefined
            ? latestUsage(this.assembler.snapshot())
            : {
                input: telemetry.usage.input,
                output: telemetry.usage.output,
              },
        telemetry,
        todos: sessionState.todos,
        ...(sessionState.goal === undefined ? {} : { goal: sessionState.goal }),
        ...((this.sessionTitleOverride ?? sessionState.title) === undefined
          ? {}
          : { sessionTitle: this.sessionTitleOverride ?? sessionState.title }),
        ...(sessionState.agentPreset === undefined
          ? {}
          : { agentPreset: sessionState.agentPreset }),
        ...(assemblerStats.evictedNodes === 0
          ? {}
          : { transcript: { evicted: assemblerStats.evictedNodes } }),
      subagents: {
          running: this.activeSubagents.size,
          ...(this.lastSubagent === undefined ? {} : { last: this.lastSubagent }),
      },
      queueCount: this.promptQueue.size,
      remoteQueueCount: this.remoteQueue.length,
        focusMode: this.focusMode,
        permissionMode: this.permissionMode,
        planMode: this.planMode,
      },
      queuePicker: this.promptQueue.picker,
      remoteQueuePicker: this.remoteQueuePicker,
      checklist:
        this.checklist === undefined
          ? undefined
          : clampChecklistSelection(this.checklist, sessionState.todos.length),
      helpOpen: this.helpOpen,
      verbose: this.verbose,
      capabilities: this.capabilities,
      runtimeInfo: {
        name: this.runtimeName,
        capabilitySource: this.runtimeCapabilitySnapshot?.source ?? 'unknown',
        mcp: {
          // MCP servers are not part of the current TUI wire snapshot. Keep
          // this explicitly unknown instead of treating the runtime name as
          // proof that an MCP server is mounted.
          status: 'unknown',
        },
        capabilities: runtimeCapabilityEntries(
          this.runtimeCapabilitySnapshot,
          this.capabilities,
        ),
      },
      notice: this.notice,
      quitConfirmation: this.quitConfirmation,
      quitConfirmationSelection: this.quitConfirmationSelection,
      helpText: helpText(
        this.capabilities,
        this.commands,
        this.locale,
        this.skillCommands(),
        this.keymap,
      ),
      commands: this.visibleCommands().map((command) => ({
        name: command.name,
        summary: commandSummary(command, this.locale),
        ...(command.input === undefined ? {} : { input: command.input }),
      })),
      resumePicker: this.resumePicker,
      sessionTreePicker: this.sessionTreePicker,
      subagentPicker: this.subagentPicker,
      rewindPicker: this.rewindPicker,
      forkPicker: this.forkPicker,
      skillsPicker: this.skillsPicker,
      pluginPicker: this.pluginPicker,
      modelPicker: this.modelPicker,
      effortPicker: this.effortPicker,
      permissionPicker: this.permissionPicker,
      modelInputOpen: this.modelInputOpen,
      skills: this.skills,
      question: this.questions.snapshot(),
      approval:
        this.activeApproval === undefined
          ? undefined
          : createApprovalState(this.activeApproval.request),
      reviewPicker: this.reviewPicker,
      exiting: this.exiting,
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispatch = (action: TuiAction): void => {
    if (
      action.type !== 'interruptOrQuit' &&
      action.type !== 'quit.move' &&
      action.type !== 'quit.confirm' &&
      action.type !== 'quit.cancel'
    ) {
      this.quitConfirmation = false
      this.quitConfirmationSelection = 'confirm'
    }
    switch (action.type) {
      case 'setDraft':
        this.draft = replaceDraft(this.draft, action.text)
        this.pendingSkillInvocation = undefined
        this.interruptArmed = false
        this.pruneAttachments()
        this.pruneImages()
        this.emit()
        return
      case 'insertDraft':
        this.draft = insertDraft(this.draft, action.text)
        this.pendingSkillInvocation = undefined
        this.interruptArmed = false
        this.pruneAttachments()
        this.pruneImages()
        this.emit()
        return
      case 'insertPastedInput':
        void this.insertPastedInput(action.text)
        return
      case 'deleteBackward':
        this.draft = backspaceDraft(this.draft)
        this.pendingSkillInvocation = undefined
        this.interruptArmed = false
        this.pruneAttachments()
        this.pruneImages()
        this.emit()
        return
      case 'moveCursor':
        this.draft = moveDraftCursor(this.draft, action.delta, action.extendSelection)
        this.emit()
        return
      case 'selectAllDraft':
        this.draft = selectAllDraft(this.draft)
        this.emit()
        return
      case 'copyDraftSelection': {
        if (this.capturingByok) return
        const value = selectedDraftText(this.draft)
        if (value !== '') this.copyText(value)
        return
      }
      case 'cutDraftSelection': {
        const value = selectedDraftText(this.draft)
        if (value === '') return
        if (!this.capturingByok) this.copyText(value)
        this.draft = deleteDraftSelection(this.draft)
        this.pendingSkillInvocation = undefined
        this.interruptArmed = false
        this.pruneAttachments()
        this.pruneImages()
        this.emit()
        return
      }
      case 'attachFile': {
        const token = formatFileMention(action.path)
        this.draft = replaceDraftRange(this.draft, action.start, action.end, `${token} `)
        this.pendingSkillInvocation = undefined
        this.attachments = [
          ...this.attachments.filter((attachment) => attachment.path !== action.path),
          { path: action.path, token },
        ]
        this.emit()
        return
      }
      case 'submit':
        this.submit(action.text)
        return
      case 'compact':
        this.requestCompact()
        return
      case 'command':
        this.runCommand(action.line)
        return
      case 'command.select':
        this.selectCommand(action.line)
        return
      case 'historyPrev': {
        const next = this.history.prev(this.draft.text)
        if (next !== undefined) {
          this.draft = replaceDraft(this.draft, next)
          this.interruptArmed = false
        }
        this.emit()
        return
      }
      case 'historyNext': {
        const next = this.history.next(this.draft.text)
        if (next !== undefined) {
          this.draft = replaceDraft(this.draft, next)
          this.interruptArmed = false
        }
        this.emit()
        return
      }
      case 'toggleVerbose':
        this.verbose = !this.verbose
        this.emit()
        return
      case 'toggleHelp':
        this.helpOpen = !this.helpOpen
        this.emit()
        return
      case 'interruptOrQuit':
        this.interruptOrQuit()
        return
      case 'session.new':
        this.requestNewSession()
        return
      case 'session.open':
        void this.showSessionTree()
        return
      case 'session.back':
        void this.returnToPreviousSession()
        return
      case 'file.open':
        this.openFileMention()
        return
      case 'quit':
        this.beginQuit()
        return
      case 'quit.move':
        if (!this.quitConfirmation) return
        this.quitConfirmationSelection = action.delta < 0 ? 'confirm' : 'cancel'
        this.emit()
        return
      case 'quit.confirm':
        if (!this.quitConfirmation) return
        if (this.quitConfirmationSelection === 'confirm') this.beginQuit()
        else this.cancelQuitConfirmation()
        return
      case 'quit.cancel':
        this.cancelQuitConfirmation()
        return
      case 'redraw':
        this.emit()
        return
      case 'resume.setQuery':
        if (this.resumePicker !== undefined) {
          this.resumePicker = setResumeQuery(this.resumePicker, action.query)
          this.emit()
        }
        return
      case 'resume.move':
        if (this.resumePicker !== undefined) {
          this.resumePicker = moveResumeSelection(this.resumePicker, action.delta)
          this.emit()
        }
        return
      case 'resume.close':
        if (this.resumePicker !== undefined) {
          this.resumePicker = closeResumePicker(this.resumePicker)
          this.emit()
        }
        return
      case 'resume.confirm': {
        if (this.resumePicker === undefined) return
        const selected = selectedResumeItem(this.resumePicker)
        this.resumePicker = closeResumePicker(this.resumePicker)
        if (selected !== undefined) {
          void this.resumeSession(selected.id, selected.path)
        }
        this.emit()
        return
      }
      case 'sessionTree.setQuery':
        if (this.sessionTreePicker !== undefined) {
          this.sessionTreePicker = setSessionTreeQuery(this.sessionTreePicker, action.query)
          void this.refreshSessionTreeSearch(action.query)
          this.emit()
        }
        return
      case 'sessionTree.move':
        if (this.sessionTreePicker !== undefined) {
          this.sessionTreePicker = moveSessionTreeSelection(this.sessionTreePicker, action.delta)
          this.emit()
        }
        return
      case 'sessionTree.close':
        if (this.sessionTreePicker !== undefined) {
          this.sessionTreePicker = closeSessionTreePicker(this.sessionTreePicker)
          this.emit()
        }
        return
      case 'sessionTree.confirm': {
        if (this.sessionTreePicker === undefined) return
        const selected = selectedSessionTreeItem(this.sessionTreePicker)
        this.sessionTreePicker = closeSessionTreePicker(this.sessionTreePicker)
        if (selected !== undefined) void this.openSessionTreeItem(selected)
        this.emit()
        return
      }
      case 'subagents.setQuery':
        if (this.subagentPicker !== undefined) {
          this.subagentPicker = setSubagentQuery(this.subagentPicker, action.query)
          this.emit()
        }
        return
      case 'subagents.move':
        if (this.subagentPicker !== undefined) {
          this.subagentPicker = moveSubagentSelection(this.subagentPicker, action.delta)
          this.emit()
        }
        return
      case 'subagents.close':
        if (this.subagentPicker !== undefined) {
          this.subagentPicker = closeSubagentPicker(this.subagentPicker)
          this.emit()
        }
        return
      case 'subagents.confirm': {
        if (this.subagentPicker === undefined) return
        const selected = selectedSubagent(this.subagentPicker)
        this.subagentPicker = closeSubagentPicker(this.subagentPicker)
        if (selected !== undefined) void this.showSubagentHistory(selected.id)
        this.emit()
        return
      }
      case 'rewind.open':
        this.openRewindPicker()
        return
      case 'rewind.move':
        if (this.rewindPicker !== undefined) {
          this.rewindPicker = routeBoundaryPickerAction(this.rewindPicker, {
            type: 'move',
            delta: action.delta,
          }).state
          this.emit()
        }
        return
      case 'rewind.close':
        if (this.rewindPicker !== undefined) {
          this.rewindPicker = routeBoundaryPickerAction(this.rewindPicker, { type: 'close' }).state
          this.emit()
        }
        return
      case 'rewind.confirm':
        if (this.rewindPicker === undefined) return
        {
          const transition = routeBoundaryPickerAction(this.rewindPicker, { type: 'confirm' })
          this.rewindPicker = transition.state
          if (transition.selected !== undefined) void this.rewindSession(transition.selected)
          this.emit()
        }
        return
      case 'fork.open':
        this.openForkPicker()
        return
      case 'fork.move':
        if (this.forkPicker !== undefined) {
          this.forkPicker = routeBoundaryPickerAction(this.forkPicker, {
            type: 'move',
            delta: action.delta,
          }).state
          this.emit()
        }
        return
      case 'fork.close':
        if (this.forkPicker !== undefined) {
          this.forkPicker = routeBoundaryPickerAction(this.forkPicker, { type: 'close' }).state
          this.emit()
        }
        return
      case 'fork.confirm':
        if (this.forkPicker === undefined) return
        {
          const transition = routeBoundaryPickerAction(this.forkPicker, { type: 'confirm' })
          this.forkPicker = transition.state
          if (transition.selected !== undefined) void this.forkSession(transition.selected.seq)
          this.emit()
        }
        return
      case 'skills.setQuery':
        if (this.skillsPicker !== undefined) {
          this.skillsPicker = setSkillsQuery(this.skillsPicker, action.query)
          this.emit()
        }
        return
      case 'skills.move':
        if (this.skillsPicker !== undefined) {
          this.skillsPicker = moveSkillsSelection(this.skillsPicker, action.delta)
          this.emit()
        }
        return
      case 'skills.close':
        if (this.skillsPicker !== undefined) {
          this.skillsPicker = closeSkillsPicker(this.skillsPicker)
          this.emit()
        }
        return
      case 'skills.confirm': {
        if (this.skillsPicker === undefined) return
        const skill = selectedSkill(this.skillsPicker)
        this.skillsPicker = closeSkillsPicker(this.skillsPicker)
        if (skill !== undefined) {
          this.pendingSkillInvocation = skill.name
          this.draft = replaceDraft(this.draft, `/${skill.name} `)
          this.attachments = []
          this.images = []
          this.notice = {
            tone: 'info',
            message: text(this.locale, 'skillReady', { name: skill.name }),
          }
        }
        this.emit()
        return
      }
      case 'plugins.setQuery':
        if (this.pluginPicker !== undefined) {
          this.pluginPicker = setPluginQuery(this.pluginPicker, action.query)
          this.emit()
        }
        return
      case 'plugins.move':
        if (this.pluginPicker !== undefined) {
          this.pluginPicker = movePluginSelection(this.pluginPicker, action.delta)
          this.emit()
        }
        return
      case 'plugins.close':
        if (this.pluginPicker !== undefined) {
          this.pluginPicker = closePluginPicker(this.pluginPicker)
          this.emit()
        }
        return
      case 'plugins.confirm':
        this.toggleSelectedPlugin()
        return
      case 'model.open':
        void this.openModelPicker()
        return
      case 'image.paste':
        void this.pasteImage()
        return
      case 'model.setQuery':
        if (this.modelPicker !== undefined) {
          this.modelPicker = setModelQuery(this.modelPicker, action.query)
          this.emit()
        }
        return
      case 'model.move':
        if (this.modelPicker !== undefined) {
          this.modelPicker = moveModelSelection(this.modelPicker, action.delta)
          this.emit()
        }
        return
      case 'model.close':
        if (this.modelPicker !== undefined) {
          this.modelPicker = closeModelPicker(this.modelPicker)
          this.emit()
        }
        return
      case 'model.confirm': {
        if (this.modelPicker === undefined) return
        const selected = selectedModel(this.modelPicker)
        this.modelPicker = closeModelPicker(this.modelPicker)
        if (selected === undefined) {
          this.emit()
          return
        }
        const reasoning = selected.model.reasoning
        if (reasoning !== undefined && reasoning.efforts.length > 0) {
          this.effortPicker = createEffortPicker({
            providerId: selected.providerId,
            modelId: selected.model.id,
            efforts: reasoning.efforts,
            ...(reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
            ...(selected.providerId === this.provider && selected.model.id === this.model
              ? { current: this.reasoningEffort ?? reasoning.defaultEffort }
              : { current: reasoning.defaultEffort }),
          })
          this.emit()
          return
        }
        void this.switchModel(selected.providerId, selected.model.id)
        this.emit()
        return
      }
      case 'model.input.close':
        this.modelInputOpen = false
        this.emit()
        return
      case 'model.input.submit':
        this.modelInputOpen = false
        this.setModel(action.model)
        return
      case 'effort.move':
        if (this.effortPicker !== undefined) {
          this.effortPicker = moveEffortSelection(this.effortPicker, action.delta)
          this.emit()
        }
        return
      case 'effort.close':
        if (this.effortPicker !== undefined) {
          this.effortPicker = closeEffortPicker(this.effortPicker)
          this.emit()
        }
        return
      case 'effort.confirm':
        void this.confirmEffortPicker()
        return
      case 'question.answer':
        this.questions.answer(action.selected, action.custom)
        return
      case 'question.navigate':
        this.questions.navigate(action.direction, action.selected, action.custom, action.dirty)
        return
      case 'question.cancel':
        this.cancelQuestion()
        return
      case 'approval.answer':
        this.answerApproval(action.outcome)
        return
      case 'approval.cancel':
        this.answerApproval('cancelled')
        return
      case 'permission.open':
        void this.openPermissionPicker()
        return
      case 'permission.move':
        if (this.permissionPicker !== undefined) {
          this.permissionPicker = movePermissionSelection(this.permissionPicker, action.delta)
          this.emit()
        }
        return
      case 'permission.close':
        if (this.permissionPicker !== undefined) {
          this.permissionPicker = closePermissionPicker(this.permissionPicker)
          this.emit()
        }
        return
      case 'permission.confirm':
        void this.confirmPermissionPicker()
        return
      case 'permission.toggle':
        void this.togglePermissionMode()
        return
      case 'plan.toggle':
        void this.togglePlanMode()
        return
      case 'queuePrompt':
        this.queueCurrentPrompt()
        return
      case 'queue.open':
        this.openQueuePicker()
        return
      case 'queue.move':
        this.promptQueue.move(action.delta)
        this.emit()
        return
      case 'queue.setQuery':
        this.promptQueue.setQuery(action.query)
        this.emit()
        return
      case 'queue.close':
        this.promptQueue.close()
        this.emit()
        return
      case 'queue.delete':
        this.deleteSelectedQueuedPrompt()
        return
      case 'queue.restore':
        this.restoreSelectedQueuedPrompt()
        return
      case 'remoteQueue.open':
        if (!this.capabilities.queueMutation || this.remoteQueue.length === 0) {
          this.notice = { tone: 'info', message: this.locale === 'zh' ? 'Host 队列为空或当前运行时不支持。' : 'The Host queue is empty or unavailable.' }
        } else {
          this.remoteQueuePicker = createRemoteQueuePicker(this.remoteQueue)
          this.notice = undefined
        }
        this.emit()
        return
      case 'remoteQueue.setQuery':
        if (this.remoteQueuePicker !== undefined) {
          this.remoteQueuePicker = setRemoteQueueQuery(this.remoteQueuePicker, action.query)
          this.emit()
        }
        return
      case 'remoteQueue.move':
        if (this.remoteQueuePicker !== undefined) {
          this.remoteQueuePicker = moveRemoteQueueSelection(this.remoteQueuePicker, action.delta)
          this.emit()
        }
        return
      case 'remoteQueue.close':
        if (this.remoteQueuePicker !== undefined) {
          this.remoteQueuePicker = closeRemoteQueuePicker(this.remoteQueuePicker)
          this.emit()
        }
        return
      case 'remoteQueue.delete':
        void this.mutateRemoteQueue('remove')
        return
      case 'remoteQueue.steer':
        void this.mutateRemoteQueue('steer')
        return
      case 'checklist.open':
        this.openChecklist()
        return
      case 'checklist.move':
        if (this.checklist !== undefined) {
          this.checklist = moveChecklistSelection(
            this.checklist,
            action.delta,
            this.sessionState.snapshot().todos.length,
          )
          this.emit()
        }
        return
      case 'checklist.close':
        if (this.checklist !== undefined) {
          this.checklist = closeChecklist(this.checklist)
          this.emit()
        }
        return
      case 'copyNode':
        this.copyNode(action.nodeKey)
        return
      case 'copyText':
        this.copyText(action.text)
        return
      case 'review.move':
        if (this.reviewPicker !== undefined) {
          this.reviewPicker = moveReviewSelection(this.reviewPicker, action.delta)
          this.emit()
        }
        return
      case 'review.close':
        if (this.reviewPicker !== undefined) {
          this.reviewRequest += 1
          this.reviewPicker = closeReviewPicker()
          this.emit()
        }
        return
      case 'review.confirm':
        this.confirmReview()
        return
    }
  }

  private interruptOrQuit(): void {
    if (this.quitConfirmation) {
      this.beginQuit()
      return
    }
    handleInterrupt({
      helpOpen: this.helpOpen,
      agentRunning: this.agent === 'running',
      canCancel: this.capabilities.cancel,
      armed: this.interruptArmed,
      close: () => this.beginQuit(),
      setHelpOpen: (open) => {
        this.helpOpen = open
      },
      setArmed: (armed) => {
        this.interruptArmed = armed
      },
      armQuit: () => {
        this.quitConfirmation = true
        this.quitConfirmationSelection = 'confirm'
        this.notice = undefined
      },
      notice: (message) => {
        this.notice = { tone: 'info', message }
      },
      cancel: () => this.runtime.cancel(this.sessionId),
      cancelAccepted: (wasRunning) => {
        if (wasRunning) this.assembler.settleOpen()
        this.notice = {
          tone: 'info',
          message: wasRunning
            ? text(this.locale, 'cancelRequested')
            : text(this.locale, 'cancelNotRunning'),
        }
        if (!wasRunning) this.interruptArmed = false
      },
      cancelFailed: (error) => {
        this.notice = {
          tone: 'error',
          message: `${text(this.locale, 'cancelFailed')}: ${errorMessage(error)}`,
        }
      },
      emptyComposer: this.draft.text.trim() === '',
      canRewind:
        this.capabilities.rewind &&
        this.assembler.snapshot().filter((node) => node.kind === 'user').length > 1,
      rewind: () => this.dispatch({ type: 'rewind.open' }),
      rewindNotice: text(this.locale, 'rewindArm'),
      rewindUnavailable: text(this.locale, 'rewindUnavailable'),
      emit: () => this.emit(),
    })
  }

  private cancelQuestion(): void {
    if (this.workspaceAuthorizationPending) {
      this.questions.cancel()
      return
    }
    // Start cancelling the agent turn before rejecting the question promise.
    // Otherwise the model can receive a normal tool error and immediately
    // issue the same question again.
    const cancelRequest = this.capabilities.cancel
      ? this.runtime.cancel(this.sessionId, false)
      : undefined
    this.questions.cancel()
    if (cancelRequest === undefined) return
    void cancelRequest.then(
      (wasRunning) => {
        if (wasRunning) this.assembler.settleOpen()
        this.notice = {
          tone: 'info',
          message: wasRunning
            ? text(this.locale, 'cancelRequested')
            : text(this.locale, 'cancelNotRunning'),
        }
        if (!wasRunning) this.interruptArmed = false
        this.emit()
      },
      (error: unknown) => {
        this.notice = {
          tone: 'error',
          message: `${text(this.locale, 'cancelFailed')}: ${errorMessage(error)}`,
        }
        this.emit()
      },
    )
  }

  private commandCtx(): TuiCommandCtx {
    return createAppCommandContext({
      dispatch: (action) => this.dispatch(action),
      newSession: () => this.startNewSession(),
      clearTranscript: () => {
        this.assembler.reset()
        this.telemetry.reset()
        this.sessionState.reset()
        this.resetHistoryState()
        this.checklist = undefined
        this.sessionTitleOverride = undefined
        this.attachments = []
        this.images = []
        this.notice = { tone: 'info', message: 'Transcript cleared' }
        this.emit()
      },
      showStatus: () => {
        const authBits =
          this.auth === undefined
            ? []
            : [
                `auth: ${this.auth.mode}`,
                this.auth.envLocked ? 'env-locked' : undefined,
                this.auth.accountLabel === undefined
                  ? undefined
                  : `account: ${this.auth.accountLabel}`,
                this.auth.snapshot?.()?.channels?.byok === true ? 'byok-configured' : undefined,
                this.auth.snapshot?.()?.channels?.cocode === true ? 'cocode-configured' : undefined,
              ].filter((bit): bit is string => bit !== undefined)
        this.notice = {
          tone: 'info',
          message: [
            `session ${this.sessionId}`,
            `${this.provider}/${this.model}`,
            this.agent,
            this.runtimeName === '' ? 'runtime offline' : this.runtimeName,
            ...authBits,
          ].join(' · '),
        }
        this.emit()
      },
      notice: (tone, message) => {
        this.notice = { tone, message }
        this.emit()
      },
      logout: () => logoutChannel(this.switchHost()),
      useAuth: (target) => requestChannelSwitch(this.switchHost(), target),
      initError: this.initError,
      capabilities: this.capabilities,
      configuredCapabilities: this.configuredCapabilities,
      runtimeCapabilities: this.runtimeCapabilitySnapshot,
      cwd: this.cwd,
      provider: this.provider,
      model: this.model,
      runtimeName: this.runtimeName,
      diagnostics: this.diagnostics,
      auth: this.auth,
      sessionId: () => this.sessionId,
      nodes: this.assembler.snapshot(),
      setTheme: (name) => {
        this.themeSetter?.(name)
        this.notice = {
          tone: 'info',
          message:
            this.themeSetter === undefined ? 'Theme switching is unavailable.' : `Theme: ${name}`,
        }
        this.emit()
      },
      setLocale: (value) => {
        const locale = parseUiLocale(value)
        if (locale === undefined) {
          this.notice = { tone: 'info', message: text(this.locale, 'langUsage') }
          this.emit()
          return
        }
        this.locale = locale
        this.notice = {
          tone: 'info',
          message: text(this.locale, 'langChanged', { lang: localeName(locale) }),
        }
        this.emit()
      },
      setModel: (value) => {
        this.setModel(value)
      },
      renameSession: (title) => {
        if (this.externalSession !== undefined) {
          this.notice = { tone: 'info', message: 'Session rename is unavailable for this session.' }
          this.emit()
          return
        }
        void this.ensureRemoteSession()
          .then(() => renameSession(this.runtime, this.capabilities, this.sessionId, title))
          .then(
          (outcome) => {
            if (outcome.kind === 'unavailable' || outcome.result === undefined) {
              this.notice = { tone: 'info', message: 'Session rename is unavailable for this session.' }
              this.emit()
              return
            }
            this.sessionTitleOverride = outcome.result.title
            this.notice = { tone: 'info', message: `Session renamed to ${outcome.result.title}` }
            this.emit()
          },
          (error: unknown) => {
            this.notice = { tone: 'error', message: errorMessage(error) }
            this.emit()
          },
        )
      },
      showModelPicker: () => {
        void this.openModelPicker()
      },
      showEffortPicker: () => {
        void this.openEffortPicker()
      },
      setEffort: (value) => {
        this.setEffort(value)
      },
      showRewindPicker: () => {
        this.openRewindPicker()
      },
      showUsage: () => {
        const telemetry = this.telemetry.snapshot()
        const latest = latestUsage(this.assembler.snapshot())
        const usage = telemetry.usage ?? (latest === undefined
          ? undefined
          : { ...latest, cacheRead: 0, cacheWrite: 0 })
        if (usage === undefined) {
          this.notice = {
            tone: 'info',
            message: text(this.locale, 'usageEmpty'),
          }
          this.emit()
          return
        }
        const parts = [
          `${text(this.locale, 'tokensIn')} ${usage.input} · ${text(this.locale, 'tokensOut')} ${usage.output}`,
          ...(telemetry.usage === undefined
            ? []
            : [
                text(this.locale, 'usageCache', {
                  read: String(telemetry.usage.cacheRead),
                  write: String(telemetry.usage.cacheWrite),
                }),
              ]),
          text(this.locale, 'usageTotals', {
            input: String(telemetry.totals.input),
            output: String(telemetry.totals.output),
          }),
        ]
        if (telemetry.contextWindow !== undefined && telemetry.contextPercent !== undefined) {
          parts.push(text(this.locale, 'usageContext', {
            percent: String(telemetry.contextPercent),
            window: String(telemetry.contextWindow),
          }))
        }
        this.notice = { tone: 'info', message: parts.join(' · ') }
        this.emit()
      },
      locale: this.locale,
      ...(this.capabilities.sessionList === 'rpc'
        ? { resumeSessions: async () => await this.showSessionTree() }
        : {}),
      showResumePicker: (sessions) => {
        this.helpOpen = false
        this.notice = undefined
        this.resumePicker = createResumePicker(
          sessions.map((session) => ({
            id: session.id,
            createdAt: session.createdAt,
            preview: session.preview ?? session.cwd,
            path: session.path,
          })),
        )
        this.emit()
      },
      showSkillsPicker: () => {
        if (!this.capabilities.skills) {
          this.notice = { tone: 'info', message: text(this.locale, 'skillsUnavailable') }
          this.emit()
          return
        }
        this.helpOpen = false
        this.notice = undefined
        this.skillsPicker = createSkillsPicker(this.skills)
        this.emit()
      },
      showPlugins: (args) => {
        void this.showPlugins(args)
      },
      copyLatestAssistant: () => {
        const node = [...this.assembler.snapshot()]
          .reverse()
          .find((candidate) => candidate.kind === 'assistant' && candidate.text !== '')
        if (node === undefined) {
          this.notice = { tone: 'info', message: text(this.locale, 'copyEmpty') }
          this.emit()
          return
        }
        this.copyText(readableNodeText(node))
      },
      pasteImage: () => this.dispatch({ type: 'image.paste' }),
      toggleFocus: () => {
        this.focusMode = !this.focusMode
        this.notice = {
          tone: 'info',
          message: text(this.locale, this.focusMode ? 'focusEnabled' : 'focusDisabled'),
        }
        this.emit()
      },
      review: (args) => this.openReview(args),
      forkSession: () => {
        void this.forkSession()
      },
      cloneSession: () => {
        void this.cloneSession()
      },
      showSessionTree: () => this.showSessionTree(),
      showForkPicker: () => this.openForkPicker(),
      showQueuePicker: () => this.openQueuePicker(),
      showChecklist: () => this.openChecklist(),
      showSubagents: () => { void this.showSubagents() },
      showHistory: (args) => { void this.showSessionHistory(args) },
      editRemoteQueue: (itemId, content) => { void this.editRemoteQueue(itemId, content) },
      showSubagentHistory: (childSessionId) => { void this.showSubagentHistory(childSessionId) },
      promptSubagent: (childSessionId, content) => { void this.promptSubagent(childSessionId, content) },
      interruptSubagent: (childSessionId) => { void this.interruptSubagent(childSessionId) },
    })
  }

  private async forkSession(rewindToMessageSeq?: number): Promise<void> {
    if (this.rejectExternalWrite()) return
    if (!this.capabilities.fork || this.agent !== 'idle') {
      this.notice = { tone: 'info', message: text(this.locale, 'forkUnavailable') }
      this.emit()
      return
    }
    if (!this.assembler.snapshot().some((node) => node.kind === 'user')) {
      this.notice = { tone: 'info', message: text(this.locale, 'forkEmpty') }
      this.emit()
      return
    }
    const previousSessionId = this.sessionId
    this.agent = 'starting'
    this.notice = { tone: 'info', message: text(this.locale, 'forkLoading') }
    this.emit()
    try {
      const result =
        rewindToMessageSeq === undefined
          ? await this.runtime.fork(previousSessionId, undefined, previousSessionId)
          : await this.runtime.fork(
              previousSessionId,
              undefined,
              previousSessionId,
              rewindToMessageSeq,
            )
      this.sessionId = result.sessionId
      this.sessionTitleOverride = undefined
      this.replaceSessionProjection(result.seed)
      this.clearQueuedPrompts()
      await this.refreshSessionControls()
      this.agent = 'idle'
      this.notice = { tone: 'info', message: text(this.locale, 'forkCreated') }
    } catch (error) {
      this.agent = 'idle'
      this.notice = {
        tone: 'error',
        message: `${text(this.locale, 'forkUnavailable')}: ${errorMessage(error)}`,
      }
    }
    this.emit()
  }

  private async cloneSession(): Promise<void> {
    await this.forkSession()
  }

  private openForkPicker(): void {
    if (!this.capabilities.fork || this.agent !== 'idle') {
      this.notice = { tone: 'info', message: text(this.locale, 'forkUnavailable') }
      this.emit()
      return
    }
    const users = this.assembler
      .snapshot()
      .filter((node): node is Extract<ConversationNode, { kind: 'user' }> => node.kind === 'user')
    const items = users.reverse().map((node) => ({ id: node.id, seq: node.seq, text: node.text }))
    if (items.length === 0) {
      this.notice = { tone: 'info', message: text(this.locale, 'forkEmpty') }
      this.emit()
      return
    }
    this.forkPicker = createRewindPicker(items)
    this.helpOpen = false
    this.notice = undefined
    this.emit()
  }

  private async showSessionTree(): Promise<void> {
    this.helpOpen = false
    this.notice = { tone: 'info', message: text(this.locale, 'sessionTreeLoading') }
    this.emit()
    try {
      const ownItems =
        this.capabilities.sessionList === 'rpc' && this.runtime.listSessions !== undefined
          ? await this.loadRpcSessionTree()
          : await this.loadJsonlSessionTree()
      const externalItems = await this.loadExternalSessionTree()
      const items = [...ownItems, ...externalItems]
      if (items.length === 0) {
        this.sessionTreePicker = undefined
        this.sessionTreeSourceItems = []
        this.notice = { tone: 'info', message: text(this.locale, 'sessionTreeEmpty') }
      } else {
        this.sessionTreeSourceItems = items
        this.sessionTreePicker = createSessionTreePicker(items)
        this.notice = undefined
      }
    } catch (error) {
      this.sessionTreePicker = undefined
      this.notice = {
        tone: 'error',
        message: `${text(this.locale, 'sessionTreeUnavailable')}: ${errorMessage(error)}`,
      }
    }
    this.emit()
  }

  private async showSubagents(): Promise<void> {
    if (!this.capabilities.subagentList || this.runtime.listSubagents === undefined) {
      this.notice = { tone: 'info', message: this.locale === 'zh' ? '当前运行时不支持子代理列表。' : 'Subagent listing is unavailable.' }
      this.emit()
      return
    }
    try {
      const catalog = await this.runtime.listSubagents(this.sessionId)
      if (catalog.entries.length === 0) {
        this.notice = { tone: 'info', message: this.locale === 'zh' ? '当前会话没有 direct child。' : 'This session has no direct children.' }
      } else {
        this.helpOpen = false
        this.notice = undefined
        this.subagentPicker = createSubagentPicker(catalog.entries)
      }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async showSessionHistory(args = ''): Promise<void> {
    if (!this.capabilities.sessionHistory || this.runtime.history === undefined) {
      this.notice = { tone: 'info', message: this.locale === 'zh' ? '当前运行时不支持会话历史读取。' : 'Session history is unavailable.' }
      this.emit()
      return
    }
    try {
      const older = args.trim().toLocaleLowerCase() === 'older'
      const beforeSeq = older ? this.historyEvents[0]?.seq : undefined
      if (older && beforeSeq === undefined) {
        this.notice = { tone: 'info', message: this.locale === 'zh' ? '当前没有可加载的更早历史。' : 'There is no older history to load.' }
        this.emit()
        return
      }
      if (older && !this.historyHasMore) {
        this.notice = { tone: 'info', message: this.locale === 'zh' ? '已经到达历史开头。' : 'The beginning of history is already loaded.' }
        this.emit()
        return
      }
      const result = await this.runtime.history(this.sessionId, beforeSeq, 100)
      const events = older
        ? [...result.events, ...this.historyEvents]
        : result.events
      this.replaceSessionProjection(events, result.projections)
      this.historyHasMore = result.hasMore
      this.assembler.settleOpen()
      this.notice = {
        tone: 'info',
        message: result.hasMore
          ? this.locale === 'zh' ? (older ? '已加载更早的历史；继续使用 /history older。' : '已加载最近 100 条消息；继续使用 /history older。') : (older ? 'Older history loaded; use /history older again.' : 'Loaded the latest 100 messages; use /history older for more.')
          : this.locale === 'zh' ? '会话历史已加载完整。' : 'Session history is fully loaded.',
      }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async showSubagentHistory(childSessionId: string): Promise<void> {
    const childId = childSessionId.trim()
    if (childId === '' || this.runtime.subagentHistory === undefined) {
      this.notice = { tone: 'info', message: this.locale === 'zh' ? '需要提供子代理 session id。' : 'A child session id is required.' }
      this.emit()
      return
    }
    const parentSessionId = this.sessionId
    try {
      const history = await this.runtime.subagentHistory(parentSessionId, childId)
      this.previousSessionView = {
        sessionId: this.sessionId,
        assembler: this.assembler,
        telemetry: this.telemetry,
        sessionState: this.sessionState,
        externalSession: this.externalSession,
        sessionTitleOverride: this.sessionTitleOverride,
        provider: this.provider,
        model: this.model,
        capabilities: this.capabilities,
        skills: this.skills,
        remoteCommands: this.remoteCommands,
      }
      this.replaceSessionProjection(history.events)
      this.sessionId = childId
      this.externalSession = {
        id: childId,
        identity: childId,
        canMutate: false,
        concurrency: 'no-concurrent-writes',
      }
      this.sessionTitleOverride = `subagent ${childId.slice(0, 8)}`
      this.resetSubagentActivity()
      this.clearQueuedPrompts()
      this.remoteQueue = []
      this.agent = 'idle'
      this.notice = {
        tone: 'info',
        message: history.hasMore
          ? `${childId.slice(0, 8)} · ${this.locale === 'zh' ? '子代理历史（部分）' : 'subagent history (partial)'}`
          : `${childId.slice(0, 8)} · ${this.locale === 'zh' ? '子代理历史' : 'subagent history'}`,
      }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async promptSubagent(childSessionId: string, content: string): Promise<void> {
    if (this.rejectExternalWrite() || this.runtime.promptSubagent === undefined || content.trim() === '') return
    try {
      const entry = await this.findSubagent(childSessionId)
      if (entry?.mode === 'one-shot') {
        this.notice = { tone: 'info', message: this.locale === 'zh' ? 'one-shot 子代理只支持读取历史，不能继续发送输入。' : 'One-shot subagents are read-only and cannot receive prompts.' }
        this.emit()
        return
      }
      const messageId = await this.runtime.promptSubagent(this.sessionId, childSessionId.trim(), [{ type: 'text', text: content }])
      this.notice = { tone: 'info', message: `${this.locale === 'zh' ? '子代理输入已接收' : 'Subagent prompt accepted'} · ${messageId.slice(0, 8)}` }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async interruptSubagent(childSessionId: string): Promise<void> {
    if (this.rejectExternalWrite() || this.runtime.interruptSubagent === undefined) return
    try {
      const entry = await this.findSubagent(childSessionId)
      if (entry?.mode === 'one-shot') {
        this.notice = { tone: 'info', message: this.locale === 'zh' ? 'one-shot 子代理不支持中断。' : 'One-shot subagents cannot be interrupted.' }
        this.emit()
        return
      }
      await this.runtime.interruptSubagent(this.sessionId, childSessionId.trim())
      this.notice = { tone: 'info', message: this.locale === 'zh' ? '子代理中断请求已发送。' : 'Subagent interrupt requested.' }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async findSubagent(childSessionId: string): Promise<import('@cocode/tui-connection').TuiSubagentListEntry | undefined> {
    if (this.runtime.listSubagents === undefined) return undefined
    const id = childSessionId.trim()
    if (id === '') return undefined
    try {
      return (await this.runtime.listSubagents(this.sessionId)).entries.find((entry) => entry.id === id)
    } catch {
      return undefined
    }
  }

  private startNewSession(): void {
    const wasExternal = this.externalSession !== undefined
    this.externalSession = undefined
    this.sessionId = createSessionId()
    this.assembler.reset()
    this.telemetry.reset()
    this.sessionState.reset()
    this.resetHistoryState()
    this.sessionTitleOverride = undefined
    this.resetSubagentActivity()
    this.clearQueuedPrompts()
    this.agent = 'idle'
    this.interruptArmed = false
    this.resetSessionControls()
    this.attachments = []
    this.images = []
    this.notice = {
      tone: 'info',
      message: `New session ${this.sessionId}`,
    }
    if (wasExternal) {
      this.refreshRuntimeControls()
      void this.refreshSessionControls()
    }
    this.emit()
  }

  private openFileMention(): void {
    const beforeCursor = this.draft.text.slice(0, this.draft.cursor)
    const previous = beforeCursor.at(-1)
    const prefix = previous === undefined || /\s/u.test(previous) ? '@' : ' @'
    this.draft = insertDraft(this.draft, prefix)
    this.pendingSkillInvocation = undefined
    this.interruptArmed = false
    this.emit()
  }

  private requestNewSession(): void {
    if (this.agent !== 'idle') {
      this.notice = { tone: 'info', message: text(this.locale, 'turnBusy') }
      this.emit()
      return
    }
    this.startNewSession()
  }

  private async loadRpcSessionTree(): Promise<SessionTreePickerItem[]> {
    const summaries = await this.runtime.listSessions?.(this.cwd)
    if (summaries === undefined) return []
    return makeSessionTreeItems(
      summaries.map((summary) => ({
        id: summary.sessionId,
        createdAt: summary.createdAt,
        cwd: summary.cwd,
        title: summary.title,
        parentSession: summary.parentSessionId,
        seedLength: summary.seedLength,
        path: '',
        preview: undefined,
        updatedAt: summary.updatedAt,
        running: summary.running,
        blank: summary.blank,
        origin: summary.origin,
        agentPreset: summary.agentPreset,
      })),
      'rpc',
      this.currentSessionIdentity(),
      this.sessionActivities,
    )
  }

  private async loadJsonlSessionTree(): Promise<SessionTreePickerItem[]> {
    const root = this.diagnostics.sessionRoot
    if (root === undefined) return []
    const result = await listSessionSummaries({ root, cwd: this.cwd, limit: 50 })
    return makeSessionTreeItems(result.sessions, 'jsonl', this.currentSessionIdentity(), this.sessionActivities)
  }

  private async loadExternalSessionTree(): Promise<SessionTreePickerItem[]> {
    if (this.externalDsh === undefined) return []
    try {
      const status = await this.externalDsh.getStatus()
      if (status.state !== 'available') return []
      const summaries = await this.externalDsh.listSessions()
      return makeExternalSessionTreeItems(
        summaries,
        this.currentSessionIdentity(),
      )
    } catch {
      // The shared home is an optional catalog source. A missing, unreadable,
      // or incompatible source must not prevent Cocode sessions
      // from being listed or opened.
      return []
    }
  }

  private currentSessionIdentity(): string {
    return this.externalSession?.identity ?? this.sessionId
  }

  /** A read-only shared session is only a local history projection, not an open Host session. */
  private runtimeReplaceSessionId(): string | undefined {
    return this.externalSession?.canMutate === false ? undefined : this.sessionId
  }

  private refreshRuntimeControls(): void {
    this.refreshRuntimeCapabilities()
    this.skills = []
    this.remoteCommands = []
  }

  private async openSessionTreeItem(item: SessionTreePickerItem): Promise<void> {
    if (item.source === 'external') {
      await this.openExternalSession(item)
      return
    }
    if (item.source === 'jsonl' && item.path !== undefined) {
      await this.resumeSession(item.session.id, item.path)
      return
    }
    const hostCanOpen =
      this.runtime.open !== undefined &&
      (this.runtimeCapabilitySnapshot?.capabilities.open === true || this.configuredCapabilities.open)
    if (!hostCanOpen) {
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'resumeUnavailable', { session: item.session.id.slice(0, 8) }),
      }
      this.emit()
      return
    }
    this.agent = 'starting'
    this.notice = { tone: 'info', message: text(this.locale, 'resumeLoading') }
    this.emit()
    const previousSessionId = this.runtimeReplaceSessionId()
    try {
      const opened = await this.runtime.open(item.session.id, previousSessionId)
      const openResult = normalizeOpenResult(opened)
      if (!openResult.opened) throw new Error(text(this.locale, 'sessionTreeOpenFailed'))
      this.sessionId = item.session.id
      this.externalSession = undefined
      if (openResult.seed === undefined) {
        this.assembler.reset()
        this.telemetry.reset()
        this.sessionState.reset()
        this.resetHistoryState()
      } else {
        this.replaceSessionProjection(openResult.seed)
      }
      this.sessionTitleOverride = item.session.title
      this.resetSubagentActivity()
      this.clearQueuedPrompts()
      this.attachments = []
      this.images = []
      this.refreshRuntimeControls()
      await this.refreshSessionControls()
      this.agent = 'idle'
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'resumeLoaded', { session: item.session.id.slice(0, 8) }),
      }
    } catch (error) {
      this.agent = 'idle'
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async refreshSessionTreeSearch(query: string): Promise<void> {
    const generation = ++this.sessionTreeSearchGeneration
    const normalized = query.trim()
    if (normalized === '' || !this.capabilities.sessionSearch || this.runtime.searchSessions === undefined) {
      if (this.sessionTreePicker !== undefined && generation === this.sessionTreeSearchGeneration) {
        this.sessionTreePicker = replaceSessionTreeItems(this.sessionTreePicker, this.sessionTreeSourceItems)
        this.sessionTreePicker = setSessionTreeQuery(this.sessionTreePicker, query)
      }
      return
    }
    try {
      const result = await this.runtime.searchSessions(normalized)
      if (generation !== this.sessionTreeSearchGeneration || this.sessionTreePicker === undefined) return
      const snippets = new Map(result.items.map((item) => [item.sessionId, item.snippet]))
      const items = this.sessionTreeSourceItems
        .filter((item) =>
          item.source === 'rpc'
            ? snippets.has(item.session.id)
            : `${item.session.id} ${item.session.title ?? ''} ${item.session.preview ?? ''} ${item.session.cwd ?? ''}`
                .toLocaleLowerCase()
                .includes(normalized.toLocaleLowerCase()),
        )
        .map((item) => ({
          ...item,
          session: {
            ...item.session,
            ...(snippets.get(item.session.id) === undefined
              ? {}
              : { preview: snippets.get(item.session.id) }),
          },
      }))
      this.sessionTreePicker = replaceSessionTreeItems(this.sessionTreePicker, items)
      this.sessionTreePicker = setSessionTreeQuery(this.sessionTreePicker, query)
      this.notice = result.hasMore
        ? { tone: 'info', message: this.locale === 'zh' ? '匹配结果超过 20 条，请继续缩小搜索条件。' : 'More than 20 sessions match; refine the search.' }
        : undefined
      this.emit()
    } catch {
      // Local filtering remains available when a runtime search provider is
      // absent or fails; the visible picker must not disappear on a search
      // backend error.
    }
  }

  private async openExternalSession(item: SessionTreePickerItem): Promise<void> {
    const reader = this.externalDsh
    const externalId = item.externalSessionId
    if (reader === undefined || externalId === undefined) {
      this.notice = { tone: 'error', message: 'Shared DSH data is unavailable.' }
      this.emit()
      return
    }
    this.agent = 'starting'
    this.notice = { tone: 'info', message: text(this.locale, 'resumeLoading') }
    this.emit()
    try {
      const history = await reader.readSessionHistory(externalId)
      const previousSessionId = this.sessionId
      const replaceSessionId = this.runtimeReplaceSessionId()
      let hostOpened = false
      if (history.status === 'ok' && this.runtime.open !== undefined) {
        try {
          hostOpened = normalizeOpenResult(
            await this.runtime.open(externalId, replaceSessionId),
          ).opened
        } catch {
          hostOpened = false
        }
      }
      this.previousSessionView = {
        sessionId: previousSessionId,
        assembler: this.assembler,
        telemetry: this.telemetry,
        sessionState: this.sessionState,
        externalSession: this.externalSession,
        sessionTitleOverride: this.sessionTitleOverride,
        provider: this.provider,
        model: this.model,
        capabilities: this.capabilities,
        skills: this.skills,
        remoteCommands: this.remoteCommands,
      }
      this.replaceSessionProjection(history.events.map(toSessionEvent))
      this.sessionId = externalId
      const canMutate = history.status === 'ok' && hostOpened
      const revision = await reader.getSessionRevision?.(externalId)
      this.externalSession = {
        id: externalId,
        identity: externalSessionIdentity(externalId),
        canMutate,
        concurrency: 'no-concurrent-writes',
        ...(revision === undefined ? {} : { revision }),
        ...(history.session.title === undefined ? {} : { title: history.session.title }),
        ...(history.session.cwd === undefined ? {} : { cwd: history.session.cwd }),
      }
      this.sessionTitleOverride = history.session.title
      this.resetSubagentActivity()
      this.clearQueuedPrompts()
      this.attachments = []
      this.images = []
      this.skills = []
      this.remoteCommands = []
      this.refreshRuntimeControls()
      await this.refreshSessionControls()
      this.agent = 'idle'
      const suffix =
        history.status === 'incomplete'
          ? ' · incomplete tail'
          : history.status === 'incompatible'
            ? ' · incompatible'
            : ''
      const writeSuffix = canMutate ? '' : ' · read-only in Cocode'
      this.notice = {
        tone: 'info',
        message: `${text(this.locale, 'resumeLoaded', { session: externalSessionIdentity(externalId).slice(0, 17) })} · shared DSH${writeSuffix}${suffix}`,
      }
    } catch (error) {
      this.agent = 'idle'
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async returnToPreviousSession(): Promise<void> {
    const previous = this.previousSessionView
    if (previous === undefined || this.externalSession === undefined) {
      void this.showSessionTree()
      return
    }
    this.agent = 'starting'
    this.notice = { tone: 'info', message: text(this.locale, 'returningPreviousSession') }
    this.emit()
    const currentIsReadOnly = this.externalSession.canMutate === false
    try {
      if (this.runtime.open !== undefined) {
        const opened = normalizeOpenResult(
          await this.runtime.open(previous.sessionId, this.runtimeReplaceSessionId()),
        )
        // A read-only shared projection may leave the previous Cocode session
        // attached in the runtime, so `opened: false` is an idempotent result.
        if (!opened.opened && !currentIsReadOnly) {
          throw new Error(text(this.locale, 'sessionTreeOpenFailed'))
        }
      }
      this.sessionId = previous.sessionId
      this.assembler = previous.assembler
      this.telemetry = previous.telemetry
      this.sessionState = previous.sessionState
      this.externalSession = previous.externalSession
      this.sessionTitleOverride = previous.sessionTitleOverride
      this.provider = previous.provider
      this.model = previous.model
      this.capabilities = previous.capabilities
      this.skills = previous.skills
      this.remoteCommands = previous.remoteCommands
      this.previousSessionView = undefined
      this.agent = 'idle'
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'returnedToPreviousSession'),
      }
    } catch {
      this.agent = 'idle'
      this.previousSessionView = undefined
      await this.showSessionTree()
      return
    }
    this.emit()
  }

  private openReview(args: string): void {
    if (this.rejectExternalWrite()) return
    if (this.agent !== 'idle') {
      this.notice = { tone: 'info', message: text(this.locale, 'turnBusy') }
      this.emit()
      return
    }
    if (args.trim() === '') {
      this.reviewRequest += 1
      this.helpOpen = false
      this.notice = undefined
      this.reviewPicker = createReviewPicker()
      this.emit()
      return
    }
    const parsed = parseReviewScope(args)
    if (parsed === undefined) {
      this.notice = { tone: 'info', message: text(this.locale, 'reviewUsage') }
      this.emit()
      return
    }
    void this.loadReview(parsed.scope, parsed.base)
  }

  private async loadReview(scope: ReviewScope, base?: string): Promise<void> {
    const request = ++this.reviewRequest
    this.helpOpen = false
    this.notice = undefined
    this.reviewPicker = setReviewLoading(scope, base)
    this.emit()
    try {
      const review = await collectGitReview(this.cwd, scope, base)
      if (request !== this.reviewRequest) return
      if (review.files.length === 0) {
        this.reviewPicker = undefined
        this.notice = { tone: 'info', message: text(this.locale, 'reviewEmpty') }
      } else {
        this.reviewPicker = setReviewPreview(review)
      }
    } catch (error) {
      if (request !== this.reviewRequest) return
      this.reviewPicker = undefined
      this.notice = {
        tone: 'error',
        message: `${text(this.locale, 'reviewFailed')}: ${errorMessage(error)}`,
      }
    }
    this.emit()
  }

  private confirmReview(): void {
    const picker = this.reviewPicker
    if (picker === undefined || !picker.open) return
    if (picker.phase === 'scope') {
      const scope = selectedReviewScope(picker)
      if (scope !== undefined) void this.loadReview(scope)
      return
    }
    if (picker.phase !== 'preview') return
    const review: GitReview = picker.review
    this.reviewRequest += 1
    this.reviewPicker = undefined
    this.history.push(`/review ${review.scope}`)
    this.draft = createDraft()
    this.attachments = []
    this.images = []
    this.notice = { tone: 'info', message: text(this.locale, 'reviewSending') }
    void this.promptWithAttachments(review.prompt, []).catch((error: unknown) => {
      this.notice = { tone: 'error', message: errorMessage(error) }
      this.emit()
    })
    this.emit()
  }

  private copyNode(key: string): void {
    const node = this.assembler
      .snapshot()
      .find((candidate) => `${candidate.kind}:${candidate.id}` === key)
    const value = node === undefined ? '' : readableNodeText(node)
    if (value === '') {
      this.notice = { tone: 'info', message: text(this.locale, 'copyEmpty') }
      this.emit()
      return
    }
    this.copyText(value)
  }

  private copyText(value: string): void {
    void copyToClipboard(value).then((result) => {
      this.notice = result.ok
        ? { tone: 'info', message: text(this.locale, 'copySuccess') }
        : { tone: 'error', message: text(this.locale, 'copyUnavailable') }
      this.emit()
    })
  }

  private async showPlugins(args: string): Promise<void> {
    const rawOperation = args.trim()
    const operation = rawOperation.toLowerCase()
    const mutation = /^(enable|disable)\s+(\S+)$/i.exec(rawOperation)
    if (mutation !== null) {
      await this.setPluginEnabled(mutation[2] ?? '', mutation[1]?.toLowerCase() === 'enable')
      return
    }
    if (operation !== '' && operation !== 'list' && operation !== 'status') {
      this.notice = {
        tone: 'info',
        message:
          this.locale === 'zh'
            ? '用法：/plugins、/plugins list、/plugins status、/plugins enable <entryId> 或 /plugins disable <entryId>。安装和卸载尚未开放。'
            : 'Usage: /plugins, /plugins list, /plugins status, /plugins enable <entryId>, or /plugins disable <entryId>. Install and uninstall are not available yet.',
      }
      this.emit()
      return
    }
    const listPlugins = this.runtime.listPlugins
    if (!this.capabilities.plugins || listPlugins === undefined) {
      this.notice = {
        tone: 'info',
        message:
          this.locale === 'zh'
            ? '当前运行时未提供插件清单能力。'
            : 'The current runtime does not provide a plugin inventory.',
      }
      this.emit()
      return
    }
    this.notice = {
      tone: 'info',
      message: this.locale === 'zh' ? '正在读取插件状态…' : 'Reading plugin status…',
    }
    this.emit()
    try {
      const plugins = await listPlugins.call(this.runtime)
      this.pluginPicker = createPluginPicker(plugins)
      this.notice = undefined
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async setPluginEnabled(entryId: string, enabled: boolean): Promise<void> {
    if (!this.capabilities.pluginsMutate || this.runtime.setPluginEnabled === undefined) {
      this.notice = {
        tone: 'info',
        message:
          this.locale === 'zh'
            ? '当前运行时不允许修改插件状态。'
            : 'The current runtime does not allow changing plugin state.',
      }
      this.emit()
      return
    }
    this.notice = {
      tone: 'info',
      message: this.locale === 'zh' ? '正在更新插件状态…' : 'Updating plugin state…',
    }
    this.emit()
    try {
      const plugin = await this.runtime.setPluginEnabled(entryId, enabled)
      this.notice = {
        tone: 'info',
        message: formatPluginMutationResult(plugin, this.locale),
      }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private toggleSelectedPlugin(): void {
    const picker = this.pluginPicker
    if (picker === undefined || picker.pendingEntryId !== undefined) return
    const plugin = selectedPlugin(picker)
    if (plugin === undefined) return
    if (!this.capabilities.pluginsMutate || this.runtime.setPluginEnabled === undefined) {
      this.pluginPicker = failPluginMutation(
        picker,
        this.locale === 'zh'
          ? '当前运行时不允许修改插件状态。'
          : 'The current runtime does not allow changing plugin state.',
      )
      this.emit()
      return
    }
    this.pluginPicker = beginPluginMutation(picker, plugin.entryId)
    this.emit()
    void this.runtime
      .setPluginEnabled(plugin.entryId, !plugin.enabled)
      .then((updated) => {
        if (this.pluginPicker === undefined) return
        this.pluginPicker = completePluginMutation(
          this.pluginPicker,
          updated,
          formatPluginMutationResult(updated, this.locale),
        )
        this.emit()
      })
      .catch((error: unknown) => {
        if (this.pluginPicker === undefined) return
        this.pluginPicker = failPluginMutation(this.pluginPicker, errorMessage(error))
        this.emit()
      })
  }

  private async loadSkills(): Promise<void> {
    const advertisedSkills =
      this.runtimeCapabilitySnapshot?.source === 'runtime'
        ? this.runtimeCapabilitySnapshot.capabilities.skills
        : undefined
    if (advertisedSkills === false) {
      this.capabilities = { ...this.capabilities, skills: false }
      this.skills = []
      return
    }
    const listSkills = this.runtime.listSkills
    if (listSkills === undefined) {
      this.capabilities = { ...this.capabilities, skills: false }
      this.skills = []
      return
    }
    try {
      this.skills = await listSkills.call(this.runtime, this.sessionId)
      this.capabilities = {
        ...this.capabilities,
        skills: advertisedSkills ?? this.skills.length > 0,
      }
    } catch {
      this.skills = []
      this.capabilities = { ...this.capabilities, skills: false }
    }
  }

  private async loadCommands(): Promise<void> {
    const advertisedCommands =
      this.runtimeCapabilitySnapshot?.source === 'runtime'
        ? this.runtimeCapabilitySnapshot.capabilities.commands
        : undefined
    if (advertisedCommands === false) {
      this.capabilities = { ...this.capabilities, commands: false }
      this.remoteCommands = []
      return
    }
    const listCommands = this.runtime.listCommands
    if (listCommands === undefined || this.runtime.executeCommand === undefined) {
      this.capabilities = { ...this.capabilities, commands: false }
      this.remoteCommands = []
      return
    }
    try {
      this.remoteCommands = await listCommands.call(this.runtime, this.sessionId)
      this.capabilities = {
        ...this.capabilities,
        commands: advertisedCommands ?? this.remoteCommands.length > 0,
      }
    } catch {
      this.remoteCommands = []
      this.capabilities = { ...this.capabilities, commands: false }
    }
  }

  private refreshRuntimeCapabilities(): void {
    const state = refreshRuntimeCapabilities(this.runtime, this.configuredCapabilities)
    this.runtimeCapabilitySnapshot = state.snapshot
    this.capabilities = state.capabilities
  }

  private askApproval(request: TuiApprovalRequest): Promise<TuiApprovalAnswer> {
    if (!this.capabilities.approval) return Promise.resolve({ outcome: 'unavailable' })
    return new Promise<TuiApprovalAnswer>((resolve, reject) => {
      const pending: PendingApproval = { request, resolve, reject }
      this.approvalQueue.push(pending)
      this.startNextApproval()
    })
  }

  private startNextApproval(): void {
    if (this.activeApproval !== undefined || this.approvalQueue.length === 0) return
    this.activeApproval = this.approvalQueue.shift()
    const active = this.activeApproval
    if (active !== undefined) {
      notifyTerminal({
        ...this.terminalNotify,
        title: 'Cocode',
        body: `${text(this.locale, 'approvalTitle')}: ${active.request.toolName}`,
      })
      active.timeout = setTimeout(() => {
        if (this.activeApproval !== active) return
        this.activeApproval = undefined
        active.resolve({ outcome: 'cancelled' })
        this.notice = { tone: 'info', message: text(this.locale, 'approvalTimedOut') }
        this.startNextApproval()
        this.emit()
      }, 120_000)
    }
    this.emit()
  }

  private answerApproval(outcome: TuiApprovalAnswer['outcome']): void {
    const active = this.activeApproval
    if (active === undefined) return
    this.activeApproval = undefined
    if (active.timeout !== undefined) clearTimeout(active.timeout)
    active.resolve({ outcome })
    this.notice = {
      tone: 'info',
      message: text(
        this.locale,
        outcome === 'allowed-once'
          ? 'approvalAllowed'
          : outcome === 'allowed-for-turn'
          ? 'approvalAllowedForTurn'
          : 'approvalRejected',
      ),
    }
    this.startNextApproval()
    this.emit()
  }

  private rejectApprovals(error: Error): void {
    const active = this.activeApproval
    this.activeApproval = undefined
    if (active !== undefined) {
      if (active.timeout !== undefined) clearTimeout(active.timeout)
      active.resolve({ outcome: 'unavailable' })
    }
    for (const pending of this.approvalQueue.splice(0)) {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout)
      pending.resolve({ outcome: 'unavailable' })
    }
    if (error.message !== '')
      this.notice = { tone: 'info', message: text(this.locale, 'approvalUnavailable') }
    this.emit()
  }

  private async togglePermissionMode(): Promise<void> {
    if (this.rejectExternalWrite()) return
    if (!this.capabilities.permissionMode || this.runtime.permissionMode === undefined) {
      this.notice = { tone: 'info', message: text(this.locale, 'permissionUnavailable') }
      this.emit()
      return
    }
    if (this.agent === 'starting') {
      this.notice = { tone: 'info', message: text(this.locale, 'sessionChanging') }
      this.emit()
      return
    }
    try {
      const current = await this.runtime.permissionMode(this.sessionId)
      this.permissionMode = current.mode
      this.supportedPermissionModes =
        current.supportedModes.length > 0 ? current.supportedModes : ['manual']
      const index = this.supportedPermissionModes.indexOf(this.permissionMode)
      const next =
        this.supportedPermissionModes[(index + 1) % this.supportedPermissionModes.length] ??
        'manual'
      const result = await this.runtime.permissionMode(this.sessionId, next)
      this.permissionMode = result.mode
      this.supportedPermissionModes =
        result.supportedModes.length > 0 ? result.supportedModes : this.supportedPermissionModes
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'permissionChanged', { mode: this.permissionMode }),
      }
    } catch (error) {
      this.notice = {
        tone: 'error',
        message: `${text(this.locale, 'permissionUnavailable')}: ${errorMessage(error)}`,
      }
    }
    this.emit()
  }

  private async openPermissionPicker(): Promise<void> {
    if (this.rejectExternalWrite()) return
    if (!this.capabilities.permissionMode || this.runtime.permissionMode === undefined) {
      this.notice = { tone: 'info', message: text(this.locale, 'permissionUnavailable') }
      this.emit()
      return
    }
    if (this.agent === 'starting') {
      this.notice = { tone: 'info', message: text(this.locale, 'sessionChanging') }
      this.emit()
      return
    }
    try {
      const result = await this.runtime.permissionMode(this.sessionId)
      this.permissionMode = result.mode
      this.supportedPermissionModes = result.supportedModes
      this.permissionPicker = createPermissionPicker(result.supportedModes, result.mode)
      this.notice = undefined
    } catch (error) {
      this.notice = {
        tone: 'error',
        message: `${text(this.locale, 'permissionUnavailable')}: ${errorMessage(error)}`,
      }
    }
    this.emit()
  }

  private async confirmPermissionPicker(): Promise<void> {
    if (this.rejectExternalWrite()) return
    const picker = this.permissionPicker
    if (picker === undefined || picker.pending !== undefined) return
    const mode = selectedPermissionMode(picker)
    if (mode === undefined || this.runtime.permissionMode === undefined) return
    if (mode === picker.current) {
      this.permissionPicker = closePermissionPicker(picker)
      this.emit()
      return
    }
    this.permissionPicker = beginPermissionChange(picker, mode)
    this.emit()
    try {
      const result = await this.runtime.permissionMode(this.sessionId, mode)
      this.permissionMode = result.mode
      this.supportedPermissionModes =
        result.supportedModes.length > 0 ? result.supportedModes : this.supportedPermissionModes
      this.permissionPicker = closePermissionPicker(
        completePermissionChange(this.permissionPicker ?? picker, result.mode),
      )
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'permissionChanged', { mode: this.permissionMode }),
      }
    } catch (error) {
      this.permissionPicker = failPermissionChange(this.permissionPicker ?? picker)
      this.notice = {
        tone: 'error',
        message: `${text(this.locale, 'permissionUnavailable')}: ${errorMessage(error)}`,
      }
    }
    this.emit()
  }

  private async refreshPermissionMode(): Promise<void> {
    if (!this.capabilities.permissionMode || this.runtime.permissionMode === undefined) return
    try {
      const result = await this.runtime.permissionMode(this.sessionId)
      this.permissionMode = result.mode
      this.supportedPermissionModes =
        result.supportedModes.length > 0 ? result.supportedModes : ['manual']
    } catch {
      this.permissionMode = 'manual'
      this.supportedPermissionModes = ['manual']
    }
  }

  private async refreshPlanMode(): Promise<void> {
    if (!this.capabilities.planMode || this.runtime.planMode === undefined) {
      this.planMode = false
      return
    }
    try {
      const result = await this.runtime.planMode(this.sessionId)
      this.planMode = result.active
    } catch {
      this.planMode = false
    }
  }

  private async refreshSessionControls(): Promise<void> {
    this.resetSessionControls()
    await Promise.all([
      this.refreshPermissionMode(),
      this.refreshPlanMode(),
      this.refreshSessionModels(),
    ])
  }

  private async refreshSessionModels(): Promise<void> {
    if (!this.capabilities.sessionModels || this.runtime.sessionModels === undefined) return
    try {
      const result = await this.runtime.sessionModels(this.sessionId)
      this.modelCatalog = { groups: result.groups, failures: result.failures }
      this.provider = result.current.provider
      this.model = result.current.model
      this.reasoningEffort = result.current.reasoningEffort
    } catch {
      // Legacy runtimes and sessions that have not been materialized yet keep
      // the launch selection until the ordinary model catalog is opened.
    }
  }

  private async togglePlanMode(): Promise<void> {
    if (this.rejectExternalWrite()) return
    if (!this.capabilities.planMode || this.runtime.planMode === undefined) {
      this.notice = { tone: 'info', message: text(this.locale, 'planUnavailable') }
      this.emit()
      return
    }
    if (this.agent === 'starting') {
      this.notice = { tone: 'info', message: text(this.locale, 'sessionChanging') }
      this.emit()
      return
    }
    try {
      const result = await this.runtime.planMode(this.sessionId, !this.planMode)
      this.planMode = result.active
      this.notice = {
        tone: 'info',
        message: text(this.locale, result.active ? 'planEnabled' : 'planDisabled'),
      }
    } catch (error) {
      this.notice = {
        tone: 'error',
        message: `${text(this.locale, 'planUnavailable')}: ${errorMessage(error)}`,
      }
    }
    this.emit()
  }

  private setModel(value: string): void {
    if (this.rejectExternalWrite()) return
    const model = value.trim()
    if (model === '') {
      this.notice = { tone: 'info', message: text(this.locale, 'modelUsage') }
      this.emit()
      return
    }
    if (this.agent === 'running' || this.agent === 'starting') {
      this.notice = { tone: 'info', message: text(this.locale, 'modelBusy') }
      this.emit()
      return
    }
    void this.switchModel(this.provider, model)
  }

  private async openModelPicker(): Promise<void> {
    if (this.rejectExternalWrite()) return
    if (this.agent === 'running' || this.agent === 'starting') {
      this.notice = { tone: 'info', message: text(this.locale, 'modelBusy') }
      this.emit()
      return
    }
    const sessionModelsReader = this.capabilities.sessionModels ? this.runtime.sessionModels : undefined
    const canReadSessionModels = sessionModelsReader !== undefined
    if (!canReadSessionModels && (!this.capabilities.modelList || this.runtime.listModels === undefined)) {
      this.modelInputOpen = true
      this.notice = { tone: 'info', message: text(this.locale, 'modelCatalogUnavailable') }
      this.emit()
      return
    }
    this.notice = { tone: 'info', message: text(this.locale, 'modelCatalogLoading') }
    this.emit()
    try {
      let catalog: TuiModelCatalog
      if (canReadSessionModels) {
        const sessionModels = await sessionModelsReader(this.sessionId)
        catalog = { groups: sessionModels.groups, failures: sessionModels.failures }
        this.provider = sessionModels.current.provider
        this.model = sessionModels.current.model
        this.reasoningEffort = sessionModels.current.reasoningEffort
        if (!sessionModels.routable) {
          this.notice = { tone: 'info', message: text(this.locale, 'modelCatalogUnavailable') }
        }
      } else {
        catalog = await this.runtime.listModels!()
      }
      if (catalog.groups.every((group) => group.models.length === 0)) {
        this.modelInputOpen = true
        this.notice = { tone: 'info', message: text(this.locale, 'modelCatalogEmpty') }
      } else {
        this.modelInputOpen = false
        this.modelPicker = createModelPicker(catalog, this.provider, this.model)
        this.modelCatalog = catalog
        this.notice =
          catalog.failures.length === 0
            ? undefined
            : { tone: 'info', message: text(this.locale, 'modelCatalogPartial') }
      }
    } catch {
      this.modelInputOpen = true
      this.notice = { tone: 'error', message: text(this.locale, 'modelCatalogFailed') }
    }
    this.emit()
  }

  private async switchModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
    if (this.rejectExternalWrite()) return
    const previousProvider = this.provider
    const previous = this.model
    const previousEffort = this.reasoningEffort
    this.clearQueuedPrompts()
    this.agent = 'starting'
    this.notice = {
      tone: 'info',
      message: text(this.locale, 'modelSwitching', { model }),
    }
    this.emit()
    try {
      await this.ensureRemoteSession()
      const selected = await this.runtime.selectModel?.(
        this.sessionId,
        provider,
        model,
        reasoningEffort,
      )
      if (selected !== undefined) {
        // The Host's session.selectModel implementation saves the accepted
        // selection as the deployment default. Do not write settings again here.
        this.provider = selected.provider
        this.model = selected.model
        this.reasoningEffort = selected.reasoningEffort
          ?? this.catalogModel(selected.provider, selected.model)?.reasoning?.defaultEffort
        await this.refreshSessionControls()
        await this.loadSkills()
        await this.loadCommands()
        this.resetSubagentActivity()
        this.agent = 'idle'
        this.notice = {
          tone: 'info',
          message: this.effortChangeNotice(previousProvider, previous, previousEffort),
        }
        this.emit()
        return
      }
      const info = await this.runtime.restart({ cwd: this.cwd, provider, model })
      await this.persistModelBestEffort(provider, model)
      this.provider = provider
      this.model = model
      this.reasoningEffort = reasoningEffort
        ?? this.catalogModel(provider, model)?.reasoning?.defaultEffort
      this.runtimeName = info.name
      this.refreshRuntimeCapabilities()
      // A session agent captures its provider/model when it is created. Reopening
      // the previous durable session here would therefore keep routing requests
      // through the old provider even though the picker and runtime handshake now
      // show the newly selected pair. Always create a fresh session after a
      // successful model-route switch so the next agent is built from that pair.
      this.resetToFreshSession()
      await this.refreshSessionControls()
      await this.loadSkills()
      await this.loadCommands()
      this.resetSubagentActivity()
      this.agent = 'idle'
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'modelChangedFresh', { model }),
      }
    } catch (error) {
      this.agent = 'dead'
      this.notice = { tone: 'error', message: errorMessage(error) }
      try {
        const info = await this.runtime.restart({
          cwd: this.cwd,
          provider: previousProvider,
          model: previous,
        })
        this.provider = previousProvider
        this.model = previous
        this.reasoningEffort = previousEffort
        this.runtimeName = info.name
        this.refreshRuntimeCapabilities()
        const resumed = await this.resumeSessionAfterRestart(this.sessionId)
        if (!resumed) this.resetToFreshSession()
        await this.refreshSessionControls()
        await this.loadSkills()
        await this.loadCommands()
        this.agent = 'idle'
        this.notice = {
          tone: 'error',
          message: text(
            this.locale,
            resumed ? 'modelRestored' : 'modelRestoredFresh',
            { model: previous },
          ),
        }
      } catch (restoreError) {
        this.notice = { tone: 'error', message: startErrorMessage(restoreError) }
      }
    }
    this.emit()
  }

  private catalogModel(provider: string, model: string) {
    return this.modelCatalog === undefined
      ? undefined
      : findCatalogModel(this.modelCatalog, provider, model)
  }

  private effortDisplayName(provider: string, model: string, effort: string): string {
    return this.catalogModel(provider, model)?.reasoning?.efforts.find((item) => item.id === effort)?.name
      ?? effort
  }

  private displayedReasoningEffort(): string | undefined {
    const effort = this.reasoningEffort ?? this.telemetry.snapshot().reasoningEffort
    if (effort === undefined || effort === '') return undefined
    return this.effortDisplayName(this.provider, this.model, effort)
  }

  private effortChangeNotice(
    previousProvider: string,
    previousModel: string,
    previousEffort: string | undefined,
  ): string {
    const effort = this.displayedReasoningEffort()
    if (
      this.provider === previousProvider
      && this.model === previousModel
      && effort !== undefined
      && this.reasoningEffort !== previousEffort
    ) {
      return text(this.locale, 'effortChanged', { effort })
    }
    return text(this.locale, 'modelChanged', { model: this.model })
  }

  private async loadModelCatalog(): Promise<TuiModelCatalog | undefined> {
    if (!this.capabilities.modelList || this.runtime.listModels === undefined) return undefined
    try {
      const catalog = await this.runtime.listModels()
      this.modelCatalog = catalog
      return catalog
    } catch {
      return undefined
    }
  }

  private async openEffortPicker(): Promise<void> {
    if (this.rejectExternalWrite()) return
    if (this.agent === 'running' || this.agent === 'starting') {
      this.notice = { tone: 'info', message: text(this.locale, 'modelBusy') }
      this.emit()
      return
    }
    const catalog = await this.loadModelCatalog()
    const model = catalog === undefined
      ? undefined
      : findCatalogModel(catalog, this.provider, this.model)
    const reasoning = model?.reasoning
    if (reasoning === undefined || reasoning.efforts.length === 0) {
      this.notice = { tone: 'info', message: text(this.locale, 'effortEmpty') }
      this.emit()
      return
    }
    this.effortPicker = createEffortPicker({
      providerId: this.provider,
      modelId: this.model,
      efforts: reasoning.efforts,
      ...(reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
      current: this.reasoningEffort ?? reasoning.defaultEffort,
    })
    this.emit()
  }

  private setEffort(value: string): void {
    if (this.rejectExternalWrite()) return
    if (this.agent === 'running' || this.agent === 'starting') {
      this.notice = { tone: 'info', message: text(this.locale, 'modelBusy') }
      this.emit()
      return
    }
    const level = value.trim().toLowerCase()
    if (level === '') {
      void this.openEffortPicker()
      return
    }
    void this.applyEffort(level)
  }

  private async applyEffort(level: string): Promise<void> {
    await this.loadModelCatalog()
    if (level === 'auto' || level === 'default') {
      await this.switchModel(this.provider, this.model)
      return
    }
    const model = this.catalogModel(this.provider, this.model)
    const reasoning = model?.reasoning
    if (reasoning !== undefined && reasoning.efforts.length === 0) {
      this.notice = { tone: 'info', message: text(this.locale, 'effortEmpty') }
      this.emit()
      return
    }
    const effort = reasoning?.efforts.find(
      (item) => item.id.toLowerCase() === level || item.name.toLowerCase() === level,
    )?.id
    if (reasoning !== undefined && effort === undefined) {
      this.notice = { tone: 'info', message: text(this.locale, 'effortUsage') }
      this.emit()
      return
    }
    await this.switchModel(this.provider, this.model, effort ?? level)
  }

  private async confirmEffortPicker(): Promise<void> {
    if (this.rejectExternalWrite()) return
    const picker = this.effortPicker
    if (picker === undefined || picker.open !== true || picker.pending !== undefined) return
    const choice = selectedEffort(picker)
    if (choice === undefined) {
      this.effortPicker = closeEffortPicker(picker)
      this.emit()
      return
    }
    this.effortPicker = beginEffortChange(picker, choice.effort)
    this.emit()
    await this.switchModel(picker.providerId, picker.modelId, choice.effort)
    this.effortPicker = closeEffortPicker(this.effortPicker ?? picker)
    this.emit()
  }

  private async persistModelBestEffort(provider: string, model: string): Promise<void> {
    try {
      await this.auth?.persistModel?.(provider, model)
    } catch {
      // The selected model is already active for this session. Match the GUI
      // Host behavior and keep the switch when writing the default fails.
    }
  }

  private async resumeSessionAfterRestart(sessionId: string): Promise<boolean> {
    if (
      !this.capabilities.open ||
      this.runtime.open === undefined
    ) {
      return false
    }
    try {
      const opened = normalizeOpenResult(await this.runtime.open(sessionId))
      if (!opened.opened) return false
      if (opened.seed !== undefined) this.replaceSessionProjection(opened.seed)
      this.sessionId = sessionId
      return true
    } catch {
      return false
    }
  }

  private resetToFreshSession(): void {
    this.sessionId = createSessionId()
    this.assembler.reset()
    this.telemetry.reset()
    this.sessionState.reset()
    this.resetHistoryState()
    this.sessionTitleOverride = undefined
    this.pendingSkillInvocation = undefined
    this.attachments = []
    this.images = []
  }

  private async ensureRemoteSession(): Promise<void> {
    if (this.externalSession !== undefined) return
    if (!this.capabilities.sessionCreate || this.runtime.createSession === undefined) return
    await this.runtime.createSession(this.sessionId, this.cwd)
  }

  private async resumeSession(sessionId: string, path: string | undefined): Promise<void> {
    if (path === undefined) {
      this.notice = {
        tone: 'error',
        message: text(this.locale, 'resumeUnavailable', { session: sessionId.slice(0, 8) }),
      }
      this.emit()
      return
    }
    this.agent = 'starting'
    this.notice = { tone: 'info', message: text(this.locale, 'resumeLoading') }
    this.emit()
    try {
      const previousSessionId = this.runtimeReplaceSessionId()
      const nextProjection = await loadSessionProjection(path)
      const opened = await this.runtime.open(sessionId, previousSessionId)
      if (!normalizeOpenResult(opened).opened) {
        throw new Error(text(this.locale, 'sessionTreeOpenFailed'))
      }
      this.sessionId = sessionId
      this.externalSession = undefined
      this.assembler = nextProjection.assembler
      this.telemetry = nextProjection.telemetry
      this.sessionState = nextProjection.sessionState
      this.sessionTitleOverride = undefined
      this.resetSubagentActivity()
      this.clearQueuedPrompts()
      this.attachments = []
      this.images = []
      this.refreshRuntimeControls()
      await this.refreshSessionControls()
      await this.loadSkills()
      await this.loadCommands()
      this.agent = 'idle'
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'resumeLoaded', { session: sessionId.slice(0, 8) }),
      }
    } catch (error) {
      this.agent = 'idle'
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private openRewindPicker(): void {
    if (this.rejectExternalWrite()) return
    const users = this.assembler
      .snapshot()
      .filter((node): node is Extract<ConversationNode, { kind: 'user' }> => node.kind === 'user')
    const items = users
      .slice(1)
      .reverse()
      .map((node) => ({ id: node.id, seq: node.seq, text: node.text }))
    if (items.length === 0) {
      this.notice = { tone: 'info', message: text(this.locale, 'rewindEmpty') }
      this.emit()
      return
    }
    this.rewindPicker = createRewindPicker(items)
    this.helpOpen = false
    this.notice = undefined
    this.emit()
  }

  private async rewindSession(item: { seq: number; text: string }): Promise<void> {
    if (this.rejectExternalWrite()) return
    const previousSessionId = this.sessionId
    this.agent = 'starting'
    this.notice = { tone: 'info', message: text(this.locale, 'rewindLoading') }
    this.emit()
    try {
      const result = await this.runtime.rewind(previousSessionId, item.seq, previousSessionId)
      this.sessionId = result.sessionId
      this.replaceSessionProjection(result.seed)
      this.resetSubagentActivity()
      this.clearQueuedPrompts()
      this.attachments = []
      this.images = []
      this.draft = replaceDraft(this.draft, item.text)
      await this.refreshSessionControls()
      this.agent = 'idle'
      this.notice = { tone: 'info', message: text(this.locale, 'rewindLoaded') }
    } catch (error) {
      this.agent = 'idle'
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private submit(inputText: string): void {
    const trimmed = inputText.trim()
    if (trimmed === '') return
    if (this.capturingByok) {
      void submitCapturedByok(this.switchHost(), trimmed)
      return
    }
    if (this.externalSession?.canMutate === false && !trimmed.startsWith('/')) {
      this.rejectExternalWrite()
      return
    }
    const pendingSkill = this.pendingSkillInvocation
    this.pendingSkillInvocation = undefined
    if (pendingSkill !== undefined) {
      const parsed = parseSlash(trimmed)
      const skill = this.skills.find((entry) => entry.name === pendingSkill)
      if (parsed?.name === pendingSkill && skill !== undefined) {
        this.sendSkill(trimmed)
        return
      }
    }
    if (trimmed.startsWith('/')) {
      this.runCommand(trimmed)
      return
    }
    if (this.agent === 'running' && this.capabilities.promptMode) {
      const attachments = this.attachments.slice()
      const images = this.images.slice()
      this.history.push(trimmed)
      this.draft = createDraft()
      this.attachments = []
      this.images = []
      this.notice = { tone: 'info', message: text(this.locale, 'steerSending') }
      void this.promptWithAttachments(trimmed, attachments, 'steer', images).catch((error: unknown) => {
        this.restoreFailedPrompt(trimmed, attachments, images)
        this.notice = { tone: 'error', message: errorMessage(error) }
        this.emit()
      })
      this.emit()
      return
    }
    if (this.agent !== 'idle') {
      this.notice = {
        tone: 'info',
        message: text(this.locale, 'turnBusy'),
      }
      this.emit()
      return
    }
    const attachments = this.attachments.slice()
    const images = this.images.slice()
    this.history.push(trimmed)
    this.draft = createDraft()
    this.attachments = []
    this.images = []
    this.notice = undefined
    this.interruptArmed = false
    void this.promptWithAttachments(trimmed, attachments, 'normal', images).catch((error: unknown) => {
      this.restoreFailedPrompt(trimmed, attachments, images)
      this.notice = { tone: 'error', message: errorMessage(error) }
      if (this.agent === 'running') this.agent = 'idle'
      this.emit()
    })
    this.emit()
  }

  private sendSkill(line: string): void {
    if (this.rejectExternalWrite()) return
    if (this.agent !== 'idle') {
      this.notice = { tone: 'info', message: text(this.locale, 'turnBusy') }
      this.emit()
      return
    }
    const attachments = this.attachments.slice()
    const images = this.images.slice()
    this.history.push(line)
    this.draft = createDraft()
    this.attachments = []
    this.images = []
    this.invokeSkill(line, attachments, images)
  }

  private requestCompact(): void {
    if (this.rejectExternalWrite()) return
    if (this.agent !== 'idle') {
      this.notice = { tone: 'info', message: text(this.locale, 'turnBusy') }
      this.emit()
      return
    }
    this.notice = undefined
    this.interruptArmed = false
    void this.promptWithAttachments('/compact', []).catch((error: unknown) => {
      this.notice = { tone: 'error', message: errorMessage(error) }
      this.emit()
    })
    this.emit()
  }

  private promptWithAttachments(
    promptText: string,
    attachments: readonly { path: string; token: string }[],
    mode: 'normal' | 'queue' | 'steer' = 'normal',
    images: readonly DraftImage[] = [],
  ): Promise<string> {
    if (this.runtime.ensureWorkspace === undefined) {
      return this.sendPromptBlocks(promptText, attachments, mode, images)
    }
    return this.sendPromptWithAttachments(promptText, attachments, mode, images)
  }

  private async sendPromptWithAttachments(
    promptText: string,
    attachments: readonly { path: string; token: string }[],
    mode: 'normal' | 'queue' | 'steer',
    images: readonly DraftImage[],
  ): Promise<string> {
    await this.ensureWorkspaceAuthorization()
    return this.sendPromptBlocks(promptText, attachments, mode, images)
  }

  private sendPromptBlocks(
    promptText: string,
    attachments: readonly { path: string; token: string }[],
    mode: 'normal' | 'queue' | 'steer',
    images: readonly DraftImage[],
  ): Promise<string> {
    this.logger?.debug('session.prompt.accepted', {
      mode,
      attachmentCount: attachments.length,
      imageCount: images.length,
    })
    if (this.externalSession?.canMutate === false) {
      return Promise.reject(new Error('shared DSH session is read-only in Cocode'))
    }
    const visiblePromptText = images.reduce(
      (value, image) => value.split(image.token).join(''),
      promptText,
    ).trim()
    const prompt = (): Promise<string> => {
      if (attachments.length === 0 && images.length === 0) {
        return this.runtime.prompt(this.sessionId, [{ type: 'text', text: visiblePromptText }], mode)
      }
    const fileContext = attachments.length === 0
      ? Promise.resolve([])
      : loadFileContext({
        cwd: this.cwd,
        paths: attachments.map((attachment) => attachment.path),
      })
    const storedImages = images.length === 0
      ? Promise.resolve([])
      : this.runtime.saveImages === undefined
      ? Promise.reject(new Error(text(this.locale, 'imageRuntimeUnavailable')))
      : this.runtime.saveImages(images)
      return Promise.all([fileContext, storedImages]).then(([files, imageRefs]) =>
        this.runtime.prompt(
        this.sessionId,
        [
          ...buildPromptBlocks(visiblePromptText, files),
          ...imageRefs.map((attachment) => ({ type: 'image', attachment })),
        ],
          mode,
        ),
      )
    }
    if (this.externalSession === undefined) return prompt()
    return this.guardSharedSessionMutation().then(prompt).then(async (result) => {
      await this.refreshSharedSessionRevision()
      return result
    })
  }

  private async guardSharedSessionMutation(): Promise<void> {
    const session = this.externalSession
    if (session === undefined || !session.canMutate) return
    const current = await this.externalDsh?.getSessionRevision?.(session.id)
    if (session.revision !== undefined && current !== undefined && current !== session.revision) {
      session.canMutate = false
      this.notice = { tone: 'error', message: 'SHARED_HOME_CONFLICT: shared Session changed outside Cocode. Refresh before writing.' }
      this.emit()
      throw new Error('SHARED_HOME_CONFLICT')
    }
  }

  private async refreshSharedSessionRevision(): Promise<void> {
    const session = this.externalSession
    if (session === undefined || !session.canMutate) return
    const revision = await this.externalDsh?.getSessionRevision?.(session.id)
    if (revision !== undefined) session.revision = revision
  }

  private async ensureWorkspaceAuthorization(): Promise<void> {
    if (this.runtime.ensureWorkspace === undefined) return

    const initial = await this.runtime.ensureWorkspace(this.sessionId, false)
    if (initial.status === 'unsupported' || initial.status === 'ready') return

    const allowLabel = text(this.locale, 'workspaceAuthorizationAllow')
    this.workspaceAuthorizationPending = true
    try {
      const answer = await this.questions.ask({
        sessionId: this.sessionId,
        questions: [{
          id: 'workspace-authorization',
          header: text(this.locale, 'workspaceAuthorizationTitle'),
          question: text(this.locale, 'workspaceAuthorizationQuestion'),
          detail: initial.path,
          customInput: false,
          options: [
            {
              label: allowLabel,
              description: text(this.locale, 'workspaceAuthorizationAllowDescription'),
            },
            {
              label: text(this.locale, 'workspaceAuthorizationCancel'),
              description: text(this.locale, 'workspaceAuthorizationCancelDescription'),
            },
          ],
        }],
      })
      if (!answer.answers[0]?.selected.includes(allowLabel)) {
        throw new Error(text(this.locale, 'workspaceAuthorizationCancelled'))
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('interrupted')) {
        throw new Error(text(this.locale, 'workspaceAuthorizationCancelled'))
      }
      throw error
    } finally {
      this.workspaceAuthorizationPending = false
    }

    const result: TuiWorkspaceEnsureResult = await this.runtime.ensureWorkspace(this.sessionId, true)
    if (result.status === 'unsupported' || result.status === 'ready') return
    throw new Error(text(this.locale, 'workspaceAuthorizationUnavailable'))
  }

  private restoreFailedPrompt(
    promptText: string,
    attachments: readonly { path: string; token: string }[],
    images: readonly DraftImage[],
  ): void {
    if (this.draft.text.trim() !== '' || this.attachments.length > 0 || this.images.length > 0) return
    this.draft = insertDraft(createDraft(), promptText)
    this.attachments = [...attachments]
    this.images = [...images]
    if (this.history.at(-1) === promptText) this.history.pop()
  }

  private queueCurrentPrompt(): void {
    const trimmed = this.draft.text.trim()
    if (trimmed === '' || this.agent !== 'running') return
    if (!this.promptQueue.add(trimmed, this.attachments.slice(), this.images.slice())) {
      this.notice = { tone: 'info', message: text(this.locale, 'queueFull') }
      this.emit()
      return
    }
    this.history.push(trimmed)
    this.draft = createDraft()
    this.attachments = []
    this.images = []
    this.notice = {
      tone: 'info',
      message: text(this.locale, 'queueAdded', {
        count: String(this.promptQueue.size),
      }),
    }
    this.emit()
  }

  private flushQueuedPrompt(): void {
    if (this.agent !== 'idle') return
    const ticket = this.promptQueue.take()
    if (ticket === undefined) return
    const sessionId = this.sessionId
    this.agent = 'running'
    this.notice = { tone: 'info', message: text(this.locale, 'queueSending') }
    this.emit()
    const mode = this.capabilities.queueMode ? 'queue' : 'normal'
    void this.promptWithAttachments(
      ticket.prompt.text,
      ticket.prompt.attachments,
      mode,
      ticket.prompt.images,
    ).catch(
      (error: unknown) => {
        if (sessionId !== this.sessionId || !this.promptQueue.restore(ticket)) return
        this.notice = { tone: 'error', message: errorMessage(error) }
        this.agent = 'idle'
        this.emit()
      },
    )
  }

  private clearQueuedPrompts(): void {
    this.promptQueue.clear()
  }

  private resetPromptQueue(): void {
    this.clearQueuedPrompts()
  }

  private openQueuePicker(): void {
    if (this.promptQueue.open()) {
      this.helpOpen = false
      this.notice = undefined
      this.emit()
      return
    }
    if (this.capabilities.queueMutation && this.remoteQueue.length > 0) {
      this.remoteQueuePicker = createRemoteQueuePicker(this.remoteQueue)
      this.helpOpen = false
      this.notice = undefined
      this.emit()
      return
    }
    this.notice = { tone: 'info', message: text(this.locale, 'queueEmpty') }
    this.helpOpen = false
    this.emit()
  }

  private openChecklist(): void {
    this.helpOpen = false
    this.notice = undefined
    this.checklist = createChecklist(this.sessionState.snapshot().todos)
    this.emit()
  }

  private deleteSelectedQueuedPrompt(): void {
    if (!this.promptQueue.deleteSelected()) return
    this.notice = { tone: 'info', message: text(this.locale, 'queueDeleted') }
    this.emit()
  }

  private restoreSelectedQueuedPrompt(): void {
    if (!this.promptQueue.prioritizeSelected()) return
    if (this.agent === 'idle') {
      this.promptQueue.dismissPicker()
      this.flushQueuedPrompt()
      return
    }
    this.notice = { tone: 'info', message: text(this.locale, 'queueRestored') }
    this.emit()
  }

  private async mutateRemoteQueue(action: 'remove' | 'steer'): Promise<void> {
    const selected = this.remoteQueuePicker === undefined
      ? undefined
      : selectedRemoteQueueItem(this.remoteQueuePicker)
    if (selected === undefined || this.runtime.updateQueue === undefined || !this.capabilities.queueMutation) return
    try {
      await this.runtime.updateQueue(this.sessionId, selected.id, { kind: action })
      this.notice = {
        tone: 'info',
        message: action === 'remove'
          ? text(this.locale, 'queueDeleted')
          : this.locale === 'zh' ? 'Host 队列项已 steer。' : 'Host queue item steered.',
      }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private async editRemoteQueue(itemId: string, content: string): Promise<void> {
    if (this.runtime.updateQueue === undefined || !this.capabilities.queueMutation) return
    const normalizedId = itemId.trim()
    const normalizedContent = content.trim()
    if (normalizedId === '' || normalizedContent === '') {
      this.notice = { tone: 'info', message: this.locale === 'zh' ? '用法：/queue-edit <item-id> <文本>' : 'Use /queue-edit <item-id> <text>.' }
      this.emit()
      return
    }
    try {
      await this.runtime.updateQueue(this.sessionId, normalizedId, { kind: 'edit', content: [{ type: 'text', text: normalizedContent }] })
      this.notice = { tone: 'info', message: this.locale === 'zh' ? 'Host 队列项已更新。' : 'Host queue item updated.' }
    } catch (error) {
      this.notice = { tone: 'error', message: errorMessage(error) }
    }
    this.emit()
  }

  private pruneAttachments(): void {
    this.attachments = this.attachments.filter((attachment) =>
      this.draft.text.includes(attachment.token),
    )
  }

  private pruneImages(): void {
    this.images = this.images.filter((image) => this.draft.text.includes(image.token))
  }

  private async pasteImage(): Promise<void> {
    if (!this.canAttachImages()) {
      this.notice = { tone: 'error', message: text(this.locale, 'imageRuntimeUnavailable') }
      this.emit()
      return
    }
    if (this.images.length >= MAX_DRAFT_IMAGES) {
      this.notice = { tone: 'error', message: text(this.locale, 'imageCountLimit') }
      this.emit()
      return
    }
    this.notice = { tone: 'info', message: text(this.locale, 'imageReading') }
    this.emit()
    try {
      const input = await this.imageReader()
      this.attachDraftImage(input)
    } catch (error) {
      this.notice = { tone: 'error', message: clipboardImageError(this.locale, error) }
    }
    this.emit()
  }

  private async insertPastedInput(input: string): Promise<void> {
    const path = pastedImagePath(input, this.cwd)
    if (path === undefined) {
      this.insertPlainInput(input)
      return
    }
    if (!this.canAttachImages()) {
      this.insertPlainInput(input)
      return
    }
    if (this.images.length >= MAX_DRAFT_IMAGES) {
      this.notice = { tone: 'error', message: text(this.locale, 'imageCountLimit') }
      this.emit()
      return
    }
    try {
      const image = await this.pastedImageReader(path)
      if (image === undefined) {
        this.insertPlainInput(input)
        return
      }
      this.attachDraftImage(image, basename(path))
    } catch {
      this.insertPlainInput(input)
      return
    }
    this.emit()
  }

  private insertPlainInput(input: string): void {
    this.draft = insertDraft(this.draft, input)
    this.pendingSkillInvocation = undefined
    this.interruptArmed = false
    this.pruneAttachments()
    this.pruneImages()
    this.emit()
  }

  private attachDraftImage(input: TuiImageInput, preferredName?: string): void {
    const serial = ++this.imageSerial
    const name = preferredName === undefined || preferredName === ''
      ? `clipboard-${serial}.${imageExtension(input.mediaType)}`
      : preferredName
    const token = `[Image: ${name}]`
    this.images = [...this.images, { ...input, id: `image-${serial}`, name, token }]
    this.draft = insertDraft(this.draft, `${token} `)
    this.pendingSkillInvocation = undefined
    this.notice = { tone: 'info', message: text(this.locale, 'imageAttached', { name }) }
  }

  private canAttachImages(): boolean {
    return (
      !this.capturingByok &&
      this.agent !== 'dead' &&
      !this.exiting &&
      this.capabilities.imageAttachments &&
      this.runtime.saveImages !== undefined
    )
  }

  private runCommand(line: string): void {
    const parsed = parseSlash(line)
    if (parsed === null) {
      this.notice = errorNotice('COMMAND_INVALID')
      this.emit()
      return
    }
    if (this.externalSession?.canMutate === false && !externalCommandAllowed(parsed.name)) {
      this.rejectExternalWrite()
      return
    }
    const command = this.commands.find(parsed.name, this.capabilities)
    if (command !== undefined) {
      this.draft = createDraft()
      this.attachments = []
      this.images = []
      this.history.push(line)
      command.run(this.commandCtx(), parsed.args)
      return
    }
    const selectedSkill = this.findSkillCommand(parsed.name)
    const remoteName = parsed.name.toLowerCase()
    const remoteCommand = this.remoteCommands.find((entry) => entry.name === remoteName)
    if (this.capabilities.commands && remoteCommand !== undefined) {
      if (remoteCommand.input !== undefined && parsed.args === '') {
        this.draft = replaceDraft(this.draft, `/${remoteName} `)
        this.attachments = []
        this.images = []
        this.pendingSkillInvocation = undefined
        this.notice = undefined
        this.emit()
        return
      }
      this.draft = createDraft()
      this.attachments = []
      this.images = []
      this.history.push(line)
      const commandLine =
        remoteName === parsed.name ? line : line.replace(/^\/\S+/u, `/${remoteName}`)
      this.executeRemoteCommand(commandLine)
      return
    }
    if (this.capabilities.skills && selectedSkill !== undefined) {
      const invocation =
        selectedSkill.name === parsed.name ? line : formatSkillInvocation(selectedSkill, parsed.args)
      this.sendSkill(invocation)
      return
    }
    {
      this.notice = errorNotice('COMMAND_UNKNOWN', { name: parsed.name })
      this.emit()
      return
    }
  }

  private selectCommand(line: string): void {
    const parsed = parseSlash(line)
    if (parsed === null) {
      this.runCommand(line)
      return
    }
    const skill = this.findSkillCommand(parsed.name)
    if (skill === undefined) {
      this.runCommand(line)
      return
    }
    this.pendingSkillInvocation = undefined
    this.draft = replaceDraft(this.draft, `/${parsed.name} `)
    this.attachments = []
    this.images = []
    this.notice = {
      tone: 'info',
      message: text(this.locale, 'skillReady', { name: skill.name }),
    }
    this.emit()
  }

  private findSkillCommand(name: string): SkillEntry | undefined {
    return this.skills.find(
      (skill) => skill.name === name || skillCommandName(skill) === name,
    )
  }

  private executeRemoteCommand(line: string): void {
    if (this.rejectExternalWrite()) return
    const execute = this.runtime.executeCommand
    if (execute === undefined) {
      this.notice = errorNotice('COMMAND_UNKNOWN', { name: parseSlash(line)?.name ?? line })
      this.emit()
      return
    }
    this.notice = undefined
    void execute.call(this.runtime, this.sessionId, line).then(
      (execution) => {
        if (execution === undefined) {
          this.notice = errorNotice('COMMAND_UNKNOWN', { name: parseSlash(line)?.name ?? line })
        } else if (execution.result.kind === 'error') {
          this.notice = { tone: 'error', message: execution.result.text }
        } else if (execution.result.text !== undefined && execution.result.text !== '') {
          this.notice = { tone: 'info', message: execution.result.text }
        } else {
          this.notice = undefined
        }
        this.emit()
      },
      (error: unknown) => {
        this.notice = { tone: 'error', message: errorMessage(error) }
        this.emit()
      },
    )
    this.emit()
  }

  private rejectExternalWrite(): boolean {
    if (this.externalSession?.canMutate !== false) return false
    this.notice = {
      tone: 'info',
      message: 'This shared DSH session is read-only in Cocode. Start a new session to continue.',
    }
    this.emit()
    return true
  }

  private invokeSkill(
    line: string,
    attachments: readonly { path: string; token: string }[],
    images: readonly DraftImage[],
  ): void {
    this.notice = undefined
    void this.promptWithAttachments(line, attachments, 'normal', images).catch((error: unknown) => {
      this.restoreFailedPrompt(line, attachments, images)
      this.notice = { tone: 'error', message: errorMessage(error) }
      if (this.agent === 'running') this.agent = 'idle'
      this.emit()
    })
    this.emit()
  }

  private visibleCommands(): Command[] {
    return [...this.commands.list(this.capabilities), ...this.skillCommands(), ...this.remoteCommandEntries()]
  }

  private remoteCommandEntries(): Command[] {
    if (!this.capabilities.commands || this.remoteCommands.length === 0) return []
    const visibleNames = new Set([
      ...this.commands.list(this.capabilities).map((command) => command.name),
      ...this.skillCommands().map((command) => command.name),
    ])
    return this.remoteCommands
      .filter((command) => !visibleNames.has(command.name))
      .map((command) => ({
        name: command.name,
        summary: command.description,
        ...(command.input === undefined ? {} : { input: command.input }),
        kind: 'prompt-text' as const,
        available: () => true,
        run: () => undefined,
      }))
  }

  private skillCommands(): Command[] {
    if (!this.capabilities.skills || this.skills.length === 0) return []
    const localNames = new Set(this.commands.list(this.capabilities).map((command) => command.name))
    return this.skills
      .filter((skill) => !localNames.has(skillCommandName(skill)))
      .map((skill) => ({
        name: skillCommandName(skill),
        summary: skill.description,
        kind: 'prompt-text' as const,
        available: () => true,
        run: () => undefined,
      }))
  }

  private onNotification(notification: TuiNotification): void {
    if (notification.method === 'session.status') {
      const { sessionId, status } = notification.params
      this.sessionActivities.set(sessionId, status)
      if (this.sessionTreePicker !== undefined) {
        this.sessionTreePicker = setSessionTreeActivity(this.sessionTreePicker, sessionId, status)
      }
    }
    handleNotification(notification, {
      sessionId: this.sessionId,
      ingest: (event) => this.ingestSessionEvent(event),
      isDeadOrExiting: () => this.agent === 'dead' || this.exiting,
      setAgent: (agent) => {
        const previous = this.agent
        this.agent = agent
        if (previous === 'running' && agent === 'idle' && this.promptQueue.size === 0) {
          notifyTerminal({
            ...this.terminalNotify,
            title: 'Cocode',
            body: text(this.locale, 'turnComplete'),
          })
        }
        if (agent === 'idle') {
          this.assembler.settleOpen()
          if (this.notice?.message === text(this.locale, 'cancelRequested')) {
            this.notice = undefined
          }
          this.flushQueuedPrompt()
        }
      },
      clearInterrupt: () => {
        this.interruptArmed = false
      },
      subagentStarted: (childSessionId) => {
        this.recordSubagent(childSessionId, 'started')
        return text(this.locale, 'subagentStarted', { id: safeSubagentId(childSessionId) })
      },
      subagentFinished: (childSessionId) => {
        this.recordSubagent(childSessionId, 'finished')
        return text(this.locale, 'subagentFinished', { id: safeSubagentId(childSessionId) })
      },
      queueSnapshot: (items) => {
        this.remoteQueue = [...items]
        if (this.remoteQueuePicker !== undefined) {
          this.remoteQueuePicker = setRemoteQueueItems(this.remoteQueuePicker, this.remoteQueue)
        }
      },
      projectionUpdate: (update: TuiSessionProjectionUpdate) => {
        this.projectionStore.apply(update)
      },
      notice: (message) => {
        this.notice = { tone: 'info', message }
      },
      fail: (message) => {
        const safeMessage = redactSecrets(message)
        this.runtimeFailureNotice = safeMessage
        this.notice = { tone: 'error', message: safeMessage }
      },
      recover: () => {
        if (
          this.runtimeFailureNotice !== undefined &&
          this.notice?.tone === 'error' &&
          this.notice.message === this.runtimeFailureNotice
        ) {
          this.notice = undefined
        }
        this.runtimeFailureNotice = undefined
      },
      emit: () => this.scheduleEmit(),
    })
  }

  private recordSubagent(childSessionId: string, event: 'started' | 'finished'): void {
    const id = safeSubagentId(childSessionId)
    if (id === '') return
    if (event === 'started') this.activeSubagents.add(id)
    else this.activeSubagents.delete(id)
    this.lastSubagent = { id, event }
  }

  private resetSubagentActivity(): void {
    this.activeSubagents.clear()
    this.lastSubagent = undefined
  }

  private resetTelemetry(): void {
    this.telemetry.reset()
  }

  private resetSessionState(): void {
    this.sessionState.reset()
  }

  private resetSessionControls(): void {
    this.permissionMode = 'manual'
    this.supportedPermissionModes = ['manual']
    this.permissionPicker = undefined
    this.effortPicker = undefined
    this.planMode = false
    this.checklist = undefined
  }

  private switchHost(): ChannelSwitchHost {
    return this as unknown as ChannelSwitchHost
  }

  private beginQuit(): void {
    if (this.exiting) return
    this.quitConfirmation = false
    this.quitConfirmationSelection = 'confirm'
    this.interruptArmed = false
    this.exiting = true
    this.emit()
    void this.close().catch(() => undefined)
  }

  private cancelQuitConfirmation(): void {
    if (!this.quitConfirmation) return
    this.quitConfirmation = false
    this.quitConfirmationSelection = 'confirm'
    this.interruptArmed = false
    this.notice = undefined
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private replaceSessionProjection(
    events: readonly SessionEvent[],
    projections?: import('@cocode/tui-connection').TuiSessionProjectionBaseline,
  ): void {
    const projection = createSessionProjection()
    this.resetHistoryState()
    if (projections !== undefined) this.projectionStore.applyBaseline(projections)
    for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
      if (event.seq <= this.highestSessionSeq) continue
      this.highestSessionSeq = event.seq
      this.historyEvents.push(event)
      projection.assembler.ingest(event)
      projection.telemetry.ingest(event)
      projection.sessionState.ingest(event)
    }
    this.assembler = projection.assembler
    this.telemetry = projection.telemetry
    this.sessionState = projection.sessionState
  }

  private resetHistoryState(): void {
    this.highestSessionSeq = -1
    this.historyEvents = []
    this.historyHasMore = false
    this.projectionStore.clear()
  }

  private ingestSessionEvent(event: SessionEvent): void {
    if (event.seq <= this.highestSessionSeq) return
    this.highestSessionSeq = event.seq
    this.historyEvents.push(event)
    this.telemetry.ingest(event)
    this.sessionState.ingest(event)
    if (event.type === 'turn/start') this.checklist = undefined
    if (event.type === 'session/title') this.sessionTitleOverride = undefined
    this.assembler.ingest(event)
  }

  private scheduleEmit(): void {
    if (this.emitScheduled) return
    this.emitScheduled = true
    queueMicrotask(() => {
      this.emitScheduled = false
      this.emit()
    })
  }
}

function runtimeCapabilityEntries(
  snapshot: TuiCapabilitySnapshot | undefined,
  effective: TuiCapabilities,
): readonly { name: TuiDisplayedCapabilityName; enabled: boolean }[] {
  const names: TuiDisplayedCapabilityName[] = [
    'cancel',
    'open',
    'fork',
    'rewind',
    'skills',
    'onRequest',
    'approval',
    'permissionMode',
    'planMode',
    'sessionList',
    'modelList',
    'imageAttachments',
    'commands',
    'plugins',
    'pluginsMutate',
    'sessionSearch',
    'sessionHistory',
    'sessionModels',
    'sessionRename',
    'queueMutation',
    'attachmentRead',
    'sessionCreate',
    'subagentList',
    'subagentHistory',
    'subagentPrompt',
    'subagentInterrupt',
    'promptMode',
    'queueMode',
  ]
  return names.map((name) => ({
    name,
    enabled:
      name === 'skills'
        ? effective.skills
        : name === 'onRequest'
        ? snapshot?.capabilities.onRequest === true
        : snapshot === undefined
        ? name === 'sessionList'
          ? effective.sessionList !== 'none'
          : effective[name as keyof Omit<TuiCapabilities, 'sessionList'>] === true
        : snapshot.capabilities[name] === true,
  }))
}

function formatPluginMutationResult(plugin: TuiPluginEntry, locale: UiLocale): string {
  const phase = pluginPhaseLabel(plugin.fiberPhase, locale)
  return locale === 'zh'
    ? `${plugin.moduleName}（${plugin.entryId}）已${plugin.enabled ? '启用' : '禁用'}（${phase}）。`
    : `${plugin.moduleName} (${plugin.entryId}) is ${plugin.enabled ? 'enabled' : 'disabled'} (${phase}).`
}

function makeSessionTreeItems(
  sessions: ReadonlyArray<{
    id: string
    createdAt: number
    updatedAt?: number
    cwd?: string
    title?: string
    preview?: string
    parentSession?: string
    seedLength?: number
    running?: boolean
    blank?: boolean
    origin?: 'subagent'
    agentPreset?: string
    path: string
    externalSessionId?: string
  }>,
  source: 'rpc' | 'jsonl' | 'external',
  currentSessionId: string,
  activities: ReadonlyMap<string, 'idle' | 'running'>,
): SessionTreePickerItem[] {
  const tree = buildSessionTree(sessions)
  return flattenSessionTree(tree, currentSessionId).map((row) => {
    const sourceSession = sessions.find((session) => session.id === row.session.id)
    const activity = activities.get(row.session.id)
    return {
      ...row,
      source,
      ...(sourceSession?.path === undefined || sourceSession.path === ''
        ? {}
        : { path: sourceSession.path }),
      ...(sourceSession?.updatedAt === undefined ? {} : { updatedAt: sourceSession.updatedAt }),
      ...(sourceSession?.running === undefined ? {} : { activity: sourceSession.running ? 'running' : 'idle' }),
      ...(sourceSession?.blank === undefined ? {} : { blank: sourceSession.blank }),
      ...(sourceSession?.origin === undefined ? {} : { origin: sourceSession.origin }),
      ...(sourceSession?.agentPreset === undefined ? {} : { agentPreset: sourceSession.agentPreset }),
      ...(sourceSession?.externalSessionId === undefined
        ? {}
        : { externalSessionId: sourceSession.externalSessionId }),
      ...(activity === undefined ? {} : { activity }),
    }
  })
}

function makeExternalSessionTreeItems(
  summaries: readonly ExternalSessionSummary[],
  currentSessionIdentity: string,
): SessionTreePickerItem[] {
  const sessions = summaries.map((summary) => ({
    id: externalSessionIdentity(summary.id),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    cwd: summary.cwd,
    title: summary.title,
    preview: summary.preview,
    parentSession:
      summary.parentSession === undefined
        ? undefined
        : externalSessionIdentity(summary.parentSession),
    seedLength: summary.seedLength,
    path: summary.path,
    externalSessionId: summary.id,
  }))
  return makeSessionTreeItems(
    sessions,
    'external',
    currentSessionIdentity,
    new Map(),
  )
}

function externalSessionIdentity(sessionId: string): string {
  return `shared-dsh:${sessionId}`
}

function toSessionEvent(event: ExternalSessionEvent): SessionEvent {
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: event.data,
    ...(event.ignorable === true ? { ignorable: true as const } : {}),
  }
}

function externalCommandAllowed(name: string): boolean {
  return new Set([
    'help',
    'exit',
    'quit',
    'q',
    'redraw',
    'status',
    'doctor',
    'theme',
    'lang',
    'thinking',
    'tokens',
    'cost',
    'export',
    'copy',
    'todos',
    'focus',
    'clear',
    'resume',
    'new',
    'tree',
    'sessions',
  ]).has(name.toLowerCase())
}

function normalizeOpenResult(result: boolean | TuiSessionOpenResult): TuiSessionOpenResult {
  return typeof result === 'boolean' ? { opened: result } : result
}

function safeSubagentId(value: string): string {
  return [...value]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .slice(0, 32)
}

function skillCommandName(skill: SkillEntry): string {
  const source = skill.source
  if (source === undefined || source === '') return skill.name
  const prefix =
    source.startsWith('project-')
      ? 'project'
      : source.startsWith('user-')
      ? 'user'
      : source
  return `${prefix}:${skill.name}`
}

function formatSkillInvocation(skill: SkillEntry, args: string): string {
  const suffix = args.trim()
  return suffix === '' ? `/${skill.name}` : `/${skill.name} ${suffix}`
}

function imageExtension(mediaType: TuiImageInput['mediaType']): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  return mediaType.slice('image/'.length)
}

function clipboardImageError(locale: UiLocale, error: unknown): string {
  if (!(error instanceof ClipboardImageError)) return errorMessage(error)
  switch (error.code) {
    case 'unavailable':
      return text(locale, 'imageClipboardUnavailable')
    case 'empty':
      return text(locale, 'imageClipboardEmpty')
    case 'too-large':
      return text(locale, 'imageTooLarge')
    case 'unsupported':
      return text(locale, 'imageUnsupported')
  }
}

const MAX_DRAFT_IMAGES = 20
