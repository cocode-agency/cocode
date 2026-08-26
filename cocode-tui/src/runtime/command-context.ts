/** Build the local command context from app-owned callbacks and data. */

import type { TuiAuthInfo, TuiCommandCtx, TuiAppOptions } from './app-contracts.ts'
import type { TuiCapabilities } from './capabilities.ts'
import type { TuiCapabilitySnapshot } from '@cocode/tui-connection'
import { formatDoctor } from './diagnostics.ts'
import { formatError } from './errors/index.ts'
import { writeSessionExport } from './export-file.ts'
import { listSessionSummaries, type SessionSummary } from './sessions-fs.ts'
import { ensureAgentsFile } from './workspace-init.ts'
import type { ConversationNode } from './nodes/types.ts'
import { text, type UiLocale } from './ui-locale.ts'

export type CommandContextOptions = {
  dispatch: TuiCommandCtx['dispatch']
  newSession: TuiCommandCtx['newSession']
  clearTranscript: TuiCommandCtx['clearTranscript']
  showStatus: TuiCommandCtx['showStatus']
  notice: TuiCommandCtx['notice']
  logout: TuiCommandCtx['logout']
  useAuth?: TuiCommandCtx['useAuth']
  showDoctor: NonNullable<TuiCommandCtx['showDoctor']>
  cwd: string
  sessionId: string
  nodes: readonly ConversationNode[]
  sessionRoot?: string
  setTheme?: TuiCommandCtx['setTheme']
  setLocale?: TuiCommandCtx['setLocale']
  setModel?: TuiCommandCtx['setModel']
  renameSession?: TuiCommandCtx['renameSession']
  showModelPicker?: TuiCommandCtx['showModelPicker']
  showEffortPicker?: TuiCommandCtx['showEffortPicker']
  setEffort?: TuiCommandCtx['setEffort']
  showRewindPicker?: TuiCommandCtx['showRewindPicker']
  showUsage?: TuiCommandCtx['showUsage']
  locale?: UiLocale
  showResumePicker?: (sessions: readonly SessionSummary[]) => void
  resumeSessions?: TuiCommandCtx['resumeSessions']
  showSkillsPicker?: TuiCommandCtx['showSkillsPicker']
  showPlugins?: TuiCommandCtx['showPlugins']
  copyLatestAssistant?: TuiCommandCtx['copyLatestAssistant']
  pasteImage?: TuiCommandCtx['pasteImage']
  toggleFocus?: TuiCommandCtx['toggleFocus']
  review?: TuiCommandCtx['review']
  forkSession?: TuiCommandCtx['forkSession']
  cloneSession?: TuiCommandCtx['cloneSession']
  showSessionTree?: TuiCommandCtx['showSessionTree']
  showForkPicker?: TuiCommandCtx['showForkPicker']
  showQueuePicker?: TuiCommandCtx['showQueuePicker']
  showChecklist?: TuiCommandCtx['showChecklist']
  showSubagents?: TuiCommandCtx['showSubagents']
  showHistory?: TuiCommandCtx['showHistory']
  editRemoteQueue?: TuiCommandCtx['editRemoteQueue']
  showSubagentHistory?: TuiCommandCtx['showSubagentHistory']
  promptSubagent?: TuiCommandCtx['promptSubagent']
  interruptSubagent?: TuiCommandCtx['interruptSubagent']
}

export type AppCommandContextOptions = {
  dispatch: TuiCommandCtx['dispatch']
  sessionId: () => string
  newSession: TuiCommandCtx['newSession']
  clearTranscript: TuiCommandCtx['clearTranscript']
  notice: TuiCommandCtx['notice']
  logout: () => Promise<void>
  useAuth?: TuiCommandCtx['useAuth']
  showStatus: () => void
  initError?: string
  capabilities: TuiCapabilities
  configuredCapabilities: TuiCapabilities
  runtimeCapabilities?: TuiCapabilitySnapshot
  cwd: string
  provider: string
  model: string
  runtimeName: string
  diagnostics: NonNullable<TuiAppOptions['diagnostics']>
  auth?: TuiAuthInfo
  nodes: readonly ConversationNode[]
  setTheme?: TuiCommandCtx['setTheme']
  setLocale?: TuiCommandCtx['setLocale']
  setModel?: TuiCommandCtx['setModel']
  renameSession?: TuiCommandCtx['renameSession']
  showModelPicker?: TuiCommandCtx['showModelPicker']
  showEffortPicker?: TuiCommandCtx['showEffortPicker']
  setEffort?: TuiCommandCtx['setEffort']
  showRewindPicker?: TuiCommandCtx['showRewindPicker']
  showUsage?: TuiCommandCtx['showUsage']
  locale: UiLocale
  showResumePicker: (sessions: readonly SessionSummary[]) => void
  resumeSessions?: TuiCommandCtx['resumeSessions']
  showSkillsPicker: TuiCommandCtx['showSkillsPicker']
  showPlugins?: TuiCommandCtx['showPlugins']
  copyLatestAssistant?: TuiCommandCtx['copyLatestAssistant']
  pasteImage?: TuiCommandCtx['pasteImage']
  toggleFocus?: TuiCommandCtx['toggleFocus']
  review?: TuiCommandCtx['review']
  forkSession?: TuiCommandCtx['forkSession']
  cloneSession?: TuiCommandCtx['cloneSession']
  showSessionTree?: TuiCommandCtx['showSessionTree']
  showForkPicker?: TuiCommandCtx['showForkPicker']
  showQueuePicker?: TuiCommandCtx['showQueuePicker']
  showChecklist?: TuiCommandCtx['showChecklist']
  showSubagents?: TuiCommandCtx['showSubagents']
  showHistory?: TuiCommandCtx['showHistory']
  editRemoteQueue?: TuiCommandCtx['editRemoteQueue']
  showSubagentHistory?: TuiCommandCtx['showSubagentHistory']
  promptSubagent?: TuiCommandCtx['promptSubagent']
  interruptSubagent?: TuiCommandCtx['interruptSubagent']
}

export function createCommandContext(options: CommandContextOptions): TuiCommandCtx {
  return {
    dispatch: options.dispatch,
    newSession: options.newSession,
    clearTranscript: options.clearTranscript,
    showStatus: options.showStatus,
    notice: options.notice,
    logout: options.logout,
    useAuth: options.useAuth,
    showDoctor: options.showDoctor,
    setTheme: options.setTheme,
    setLocale: options.setLocale,
    setModel: options.setModel,
    renameSession: options.renameSession,
    showModelPicker: options.showModelPicker,
    showEffortPicker: options.showEffortPicker,
    setEffort: options.setEffort,
    showRewindPicker: options.showRewindPicker,
    showUsage: options.showUsage,
    exportTranscript: async () => {
      const path = await writeSessionExport(options.cwd, options.sessionId, options.nodes)
      options.notice('info', `Exported ${path}`)
    },
    initWorkspace: async () => {
      const result = await ensureAgentsFile(options.cwd)
      options.notice(
        'info',
        result.kind === 'created'
          ? `Created ${result.path}`
          : `AGENTS.md already exists: ${result.path}`,
      )
    },
    resumeSessions:
      options.resumeSessions ??
      (async () => {
        if (options.sessionRoot === undefined) {
          options.notice('error', formatError('SESSION_ROOT_UNAVAILABLE'))
          return
        }
        try {
          const result = await listSessionSummaries({
            root: options.sessionRoot,
            cwd: options.cwd,
            limit: 50,
          })
          if (result.sessions.length === 0) {
            options.notice('info', text(options.locale ?? 'en', 'resumeEmpty'))
            return
          }
          options.showResumePicker?.(result.sessions)
        } catch {
          options.notice('error', formatError('SESSION_ROOT_UNAVAILABLE'))
        }
      }),
    showSkillsPicker: options.showSkillsPicker,
    showPlugins: options.showPlugins,
    copyLatestAssistant: options.copyLatestAssistant,
    pasteImage: options.pasteImage,
    toggleFocus: options.toggleFocus,
    review: options.review,
    forkSession: options.forkSession,
    cloneSession: options.cloneSession,
    showSessionTree: options.showSessionTree,
    showForkPicker: options.showForkPicker,
    showQueuePicker: options.showQueuePicker,
    showChecklist: options.showChecklist,
    showSubagents: options.showSubagents,
    showHistory: options.showHistory,
    editRemoteQueue: options.editRemoteQueue,
    showSubagentHistory: options.showSubagentHistory,
    promptSubagent: options.promptSubagent,
    interruptSubagent: options.interruptSubagent,
  }
}

export function createAppCommandContext(options: AppCommandContextOptions): TuiCommandCtx {
  return createCommandContext({
    dispatch: options.dispatch,
    newSession: options.newSession,
    clearTranscript: options.clearTranscript,
    showStatus: options.showStatus,
    notice: options.notice,
    logout: options.logout,
    useAuth: options.useAuth,
    showDoctor: () => {
      options.notice(
        'info',
        formatDoctor({
          ...options.diagnostics,
          initError: options.initError,
          runtimeName: options.runtimeName,
          cwd: options.cwd,
          provider: options.provider,
          model: options.model,
          sessionId: options.sessionId(),
          capabilities: options.capabilities,
          configuredCapabilities: options.configuredCapabilities,
          runtimeCapabilities: options.runtimeCapabilities,
        }),
      )
    },
    cwd: options.cwd,
    sessionId: options.sessionId(),
    nodes: options.nodes,
    sessionRoot: options.diagnostics.sessionRoot,
    setTheme: options.setTheme,
    setLocale: options.setLocale,
    setModel: options.setModel,
    renameSession: options.renameSession,
    showModelPicker: options.showModelPicker,
    showEffortPicker: options.showEffortPicker,
    setEffort: options.setEffort,
    showRewindPicker: options.showRewindPicker,
    showUsage: options.showUsage,
    locale: options.locale,
    showResumePicker: options.showResumePicker,
    resumeSessions: options.resumeSessions,
    showSkillsPicker: options.showSkillsPicker,
    showPlugins: options.showPlugins,
    copyLatestAssistant: options.copyLatestAssistant,
    pasteImage: options.pasteImage,
    toggleFocus: options.toggleFocus,
    review: options.review,
    forkSession: options.forkSession,
    cloneSession: options.cloneSession,
    showSessionTree: options.showSessionTree,
    showForkPicker: options.showForkPicker,
    showQueuePicker: options.showQueuePicker,
    showChecklist: options.showChecklist,
    showSubagents: options.showSubagents,
    showHistory: options.showHistory,
    editRemoteQueue: options.editRemoteQueue,
    showSubagentHistory: options.showSubagentHistory,
    promptSubagent: options.promptSubagent,
    interruptSubagent: options.interruptSubagent,
  })
}
