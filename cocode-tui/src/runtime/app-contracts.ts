/** Public contracts for the TUI runtime application. */

import type {
  SkillEntry,
  TuiApprovalAnswer,
  TuiCapabilitySnapshot,
  TuiImageInput,
  TuiRuntime,
  TuiRuntimeCapabilityName,
  TuiRemoteQueueItem,
} from '@cocode/tui-connection'
import type { ExternalDshReadSource } from '@cocode-agency/host-supervisor'
import type { SelectModeResult } from './auth/store.ts'
import type { AuthSnapshot, ResolvedAuth } from './auth/types.ts'
import type { CommandRegistry } from './commands.ts'
import type { ConversationNode } from './nodes/types.ts'
import type { SessionGoal, SessionTodo } from './session-state.ts'
import type { TerminalNotifyMode } from './terminal-notify.ts'
import type { TuiLogger } from './logging.ts'
import type { TelemetrySnapshot } from './telemetry.ts'
import type { ChecklistState } from './checklist.ts'
import type { EffortPickerState } from './effort-picker.ts'
import type { ModelPickerState } from './model-picker.ts'
import type { PermissionPickerState } from './permission-picker.ts'
import type { PluginPickerState } from './plugin-picker.ts'
import type { PromptQueuePickerState } from './prompt-queue-picker.ts'
import type { QueuedPrompt } from './prompt-queue.ts'
import type { RemoteQueuePickerState } from './remote-queue-picker.ts'
import type { ResumePickerState } from './resume-picker.ts'
import type { ReviewPickerState } from './review-picker.ts'
import type { RewindPickerState } from './rewind-picker.ts'
import type { SessionTreePickerState } from './session-tree-picker.ts'
import type { SkillsPickerState } from './skills-picker.ts'
import type { SubagentPickerState } from './subagent-picker.ts'
import type { UiLocale } from './ui-locale.ts'
import type { ApprovalState } from './approval.ts'
import type { TuiQuestionSnapshot } from './question-coordinator.ts'
import type { TuiCapabilities } from './capabilities.ts'

export type { TuiCapabilities }
type TuiDisplayedCapabilityName = TuiRuntimeCapabilityName

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
    routable: boolean | null
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
  queuedPrompts: readonly QueuedPrompt[]
  remoteQueue: readonly TuiRemoteQueueItem[]
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
