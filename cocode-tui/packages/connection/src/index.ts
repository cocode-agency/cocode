/** Shared Host JSON-RPC transport for Cocode TUI. */

export { createTuiRuntime } from './client.ts'
export type { TuiRuntimeLogSink } from './client.ts'
export { parseInitFromEnv, parseLaunchFromEnv } from './env.ts'
export type { EnvError } from './env.ts'
export type {
  ContentBlock,
  SessionEvent,
  SkillEntry,
  TuiCommandDescriptor,
  TuiCommandExecution,
  TuiPluginEntry,
  TuiPluginFiberPhase,
  TuiQuestionAnswer,
  TuiQuestionAnswerItem,
  TuiQuestionItem,
  TuiQuestionIntent,
  TuiQuestionOption,
  TuiQuestionRequest,
  TuiApprovalAnswer,
  TuiApprovalOutcome,
  TuiApprovalRequest,
  TuiPromptMode,
  TuiRuntimeAdvertisement,
  TuiSessionSummary,
  TuiSessionOpenResult,
  TuiSessionSearchItem,
  TuiSessionCreateResult,
  TuiSubagentListEntry,
  TuiSubagentCatalog,
  TuiSessionHistoryResult,
  TuiSessionModels,
  TuiQueueAction,
  TuiAttachmentReadResult,
  TuiWorkspaceEnsureResult,
  TuiModel,
  TuiModelReasoning,
  TuiModelReasoningEffort,
  TuiModelProviderGroup,
  TuiModelCatalogFailure,
  TuiModelCatalog,
  TuiModelSelection,
  TuiImageMediaType,
  TuiImageAttachmentRef,
  TuiImageInput,
  TuiCapabilitySnapshot,
  TuiRuntimeCapabilities,
  TuiExtendedRuntimeCapabilities,
  TuiExtendedCapabilityName,
  TuiRuntimeCapabilityName,
  SubagentFinished,
  TuiInitialize,
  TuiLaunch,
  TuiNotification,
  TuiRuntime,
} from './types.ts'

/** @deprecated Use TuiLaunch. Kept for the scaffold call site. */
export type { TuiLaunch as HarnessJsonRpcLaunch } from './types.ts'
export { createExternalDshCatalog } from './external-dsh.ts'
