/** Pure formatting helpers used by the TUI app. */

import type {
  TuiCapabilitySnapshot,
  TuiImageInput,
  TuiPluginEntry,
  TuiRuntimeCapabilityName,
} from '@cocode/tui-connection'
import type { TuiCapabilities } from './capabilities.ts'
import { errorMessage } from './app-view.ts'
import { ClipboardImageError } from './image-clipboard.ts'
import { pluginPhaseLabel } from './plugin-picker.ts'
import { text, type UiLocale } from './ui-locale.ts'

type TuiDisplayedCapabilityName = TuiRuntimeCapabilityName

export function runtimeCapabilityEntries(
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

export function formatPluginMutationResult(plugin: TuiPluginEntry, locale: UiLocale): string {
  const phase = pluginPhaseLabel(plugin.fiberPhase, locale)
  return locale === 'zh'
    ? `${plugin.moduleName}（${plugin.entryId}）已${plugin.enabled ? '启用' : '禁用'}（${phase}）。`
    : `${plugin.moduleName} (${plugin.entryId}) is ${plugin.enabled ? 'enabled' : 'disabled'} (${phase}).`
}

export function imageExtension(mediaType: TuiImageInput['mediaType']): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  return mediaType.slice('image/'.length)
}

export function clipboardImageError(locale: UiLocale, error: unknown): string {
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
