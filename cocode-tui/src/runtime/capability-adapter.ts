import type { TuiCapabilitySnapshot, TuiRuntime } from '@cocode/tui-connection'
import type { TuiCapabilities } from './capabilities.ts'

/**
 * Projects live runtime facts onto the local command/UI capability map.
 *
 * The configured map remains the fallback for legacy runtimes. A runtime
 * snapshot only narrows or enables capabilities that the wire explicitly
 * advertises; it never invents support for an absent method.
 */
export function applyRuntimeCapabilities(
  configured: TuiCapabilities,
  runtime: TuiCapabilitySnapshot,
): TuiCapabilities {
  return {
    ...configured,
    cancel: runtime.capabilities.cancel,
    open: runtime.capabilities.open,
    fork: runtime.capabilities.fork,
    rewind: runtime.capabilities.rewind,
    skills: runtime.capabilities.skills,
    approval: runtime.capabilities.approval,
    permissionMode: runtime.capabilities.permissionMode,
    planMode: runtime.capabilities.planMode,
    promptMode: runtime.capabilities.promptMode,
    queueMode: runtime.capabilities.queueMode,
    modelList: runtime.capabilities.modelList,
    imageAttachments: runtime.capabilities.imageAttachments,
    commands: runtime.capabilities.commands,
    plugins: runtime.capabilities.plugins,
    pluginsMutate: runtime.capabilities.pluginsMutate,
    sessionSearch: runtime.capabilities.sessionSearch === true,
    sessionHistory: runtime.capabilities.sessionHistory === true,
    sessionModels: runtime.capabilities.sessionModels === true,
    sessionRename: runtime.capabilities.sessionRename === true,
    queueMutation: runtime.capabilities.queueMutation === true,
    attachmentRead: runtime.capabilities.attachmentRead === true,
    sessionCreate: runtime.capabilities.sessionCreate === true,
    subagentList: runtime.capabilities.subagentList === true,
    subagentHistory: runtime.capabilities.subagentHistory === true,
    subagentPrompt: runtime.capabilities.subagentPrompt === true,
    subagentInterrupt: runtime.capabilities.subagentInterrupt === true,
    sessionList: runtime.capabilities.sessionList
      ? 'rpc'
      : configured.sessionList === 'jsonl'
      ? 'jsonl'
      : 'none',
  }
}

export type RuntimeCapabilityState = {
  snapshot: TuiCapabilitySnapshot | undefined
  capabilities: TuiCapabilities
}

/** Read a live capability probe without changing legacy fallback semantics. */
export function refreshRuntimeCapabilities(
  runtime: Pick<TuiRuntime, 'getCapabilities'>,
  configured: TuiCapabilities,
): RuntimeCapabilityState {
  const snapshot = runtime.getCapabilities?.()
  return {
    snapshot,
    capabilities:
      snapshot?.source === 'runtime' ? applyRuntimeCapabilities(configured, snapshot) : configured,
  }
}
