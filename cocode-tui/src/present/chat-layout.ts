/** Calculate the shared horizontal and vertical projection for the chat page. */

import { CHECKLIST_WINDOW_SIZE } from '../runtime/checklist.ts'
import { PLUGIN_PICKER_WINDOW_SIZE } from '../runtime/plugin-picker.ts'
import { RESUME_WINDOW_SIZE } from '../runtime/resume-picker.ts'
import { REWIND_WINDOW_SIZE } from '../runtime/rewind-picker.ts'
import { SKILLS_WINDOW_SIZE } from '../runtime/skills-picker.ts'
import { PERMISSION_PICKER_WINDOW_SIZE } from '../runtime/permission-picker.ts'
import { EFFORT_PICKER_WINDOW_SIZE } from '../runtime/effort-picker.ts'
import { listWindowStart } from './list-window.ts'
import {
  compactColumns,
  paintColumns,
  resolveInspectorLayout,
  type InspectorLayout,
} from './panel-layout.ts'

export const CHAT_HEADER_ROWS = 2
const STATUS_ROWS = 2
const FOOTER_ROWS = 2
const MIN_MESSAGE_ROWS_WITH_OVERLAY = 1
const MIN_OVERLAY_ROWS = 5
const MIN_RESUME_OVERLAY_ROWS = 8
const MIN_REWIND_OVERLAY_ROWS = 7

export const MAX_COMPOSER_ROWS = 6

export type ChatViewport = { columns: number; rows: number }

export type ChatOverlayKind =
  | 'help'
  | 'slash'
  | 'command-argument'
  | 'file'
  | 'history'
  | 'resume'
  | 'checklist'
  | 'rewind'
  | 'skills'
  | 'plugins'
  | 'permission'
  | 'effort'
  | 'question'
  | 'approval'
  | 'review'
  | 'action-menu'
  | 'model'
  | 'quit'

export type ChatOverlayInput = {
  kind: ChatOverlayKind
  rows: number
  minimumRows?: number
}

export type ChatLayoutInput = {
  viewport?: ChatViewport
  viewportColumns?: number
  viewportRows?: number
  composerRows?: number
  composerInputRows?: number
  /** @deprecated Use composerRows, which is the actual projected row count. */
  composerLines?: number
  attachmentRows?: number
  inspectorPreferredWidth?: number
  activeOverlays?: readonly ChatOverlayInput[]
  /** Legacy inputs kept while callers migrate to activeOverlays. */
  hasAttachments?: boolean
  noticeRows?: number
  hasStatusDetails?: boolean
  checklistStripRows?: number
  editorFeedbackRows?: number
  queueDockRows?: number
  helpLines?: number
  slashItems?: number
  commandArgumentItems?: number
  fileItems?: number
  fileLoading?: boolean
  historyMatches?: number
  resumeItems?: number
  resumeSelected?: number
  checklistItems?: number
  checklistSelected?: number
  rewindItems?: number
  rewindSelected?: number
  rewindConfirming?: boolean
  skillsItems?: number
  skillsSelected?: number
  pluginItems?: number
  pluginSelected?: number
  pluginStatus?: boolean
  permissionItems?: number
  permissionSelected?: number
  effortItems?: number
  effortSelected?: number
  questionRows?: number
  approvalRows?: number
  reviewRows?: number
  actionMenuItems?: number
  actionMenuQuery?: boolean
  modelSwitchRows?: number
  quitConfirmation?: boolean
}

export type ChatLayout = {
  mode: 'tiny' | 'compact' | 'wide'
  /** Painted columns; always one cell narrower than the real viewport. */
  paintColumns: number
  mainColumns: number
  inspector?: InspectorLayout
  rows: {
    header: number
    transcript: number
    checklist: number
    status: number
    editorFeedback: number
    queueDock: number
    overlay: number
    composer: number
    footer: number
  }
  activeOverlay?: ChatOverlayInput
  composerInputRows: number
  composerAttachmentRows: number
  /** Legacy fields kept until downstream panel consumers migrate. */
  baseRows: number
  composerRows: number
  overlayRows: number
  reservedRows: number
  messageRows: number
  minimumRows: number
  tooSmall: boolean
}

export function calculateChatLayout(input: ChatLayoutInput): ChatLayout {
  const viewportRows = nonNegativeInteger(input.viewport?.rows ?? input.viewportRows)
  const viewportColumns = nonNegativeInteger(
    input.viewport?.columns ?? input.viewportColumns ?? 120,
  )
  const paintedColumns = paintColumns(viewportColumns)
  const mode = compactColumns(viewportColumns)
  const inspector = mode === 'wide'
    ? resolveInspectorLayout(viewportColumns, input.inspectorPreferredWidth ?? 30)
    : undefined
  const mainColumns = inspector?.mainColumns ?? paintedColumns
  const composerAttachmentRows = input.attachmentRows === undefined
    ? optionalRow(input.hasAttachments)
    : nonNegativeInteger(input.attachmentRows)
  const composerInputRows = atLeastOne(
    input.composerInputRows ?? input.composerRows ?? input.composerLines ?? 1,
  )
  const composerRows = atLeastOne(
    input.composerRows ?? composerInputRows + composerAttachmentRows + 1,
  )
  const statusRows =
    STATUS_ROWS + nonNegativeInteger(input.noticeRows) + optionalRow(input.hasStatusDetails)
  const checklistRows = nonNegativeInteger(input.checklistStripRows)
  const editorFeedbackRows = nonNegativeInteger(input.editorFeedbackRows)
  const queueDockRows = nonNegativeInteger(input.queueDockRows)
  const composerRegionRows = composerRows
  const baseRows =
    CHAT_HEADER_ROWS +
    statusRows +
    composerRegionRows +
    FOOTER_ROWS +
    checklistRows +
    editorFeedbackRows +
    queueDockRows
  const overlayInputs = input.activeOverlays ?? legacyOverlays(input)
  const activeOverlay = selectActiveOverlay(overlayInputs)
  const requestedOverlayRows = nonNegativeInteger(activeOverlay?.rows)
  const availableRows = Math.max(0, viewportRows - baseRows)
  const minimumOverlayRows = activeOverlay === undefined
    ? 0
    : nonNegativeInteger(activeOverlay.minimumRows ?? defaultMinimumOverlayRows(activeOverlay.kind))
  const minimumRows =
    baseRows + (requestedOverlayRows > 0 ? minimumOverlayRows + MIN_MESSAGE_ROWS_WITH_OVERLAY : 0)
  const verticallyTooSmall = viewportRows < minimumRows
  const tooSmall = verticallyTooSmall || mode === 'tiny'
  const messageFloor =
    requestedOverlayRows > 0 && availableRows > 0 && !verticallyTooSmall
      ? MIN_MESSAGE_ROWS_WITH_OVERLAY
      : 0
  const overlayRows = Math.min(
    requestedOverlayRows,
    verticallyTooSmall ? 0 : Math.max(0, availableRows - messageFloor),
  )
  const reservedRows = baseRows + overlayRows
  const messageRows = Math.max(0, viewportRows - reservedRows)

  return {
    mode,
    paintColumns: paintedColumns,
    mainColumns,
    inspector,
    rows: {
      header: CHAT_HEADER_ROWS,
      transcript: messageRows,
      checklist: checklistRows,
      status: statusRows,
      editorFeedback: editorFeedbackRows,
      queueDock: queueDockRows,
      overlay: overlayRows,
      composer: composerRegionRows,
      footer: FOOTER_ROWS,
    },
    activeOverlay,
    composerInputRows,
    composerAttachmentRows,
    baseRows,
    composerRows,
    overlayRows,
    reservedRows,
    messageRows,
    minimumRows,
    tooSmall,
  }
}

function legacyOverlays(input: ChatLayoutInput): ChatOverlayInput[] {
  const overlays: ChatOverlayInput[] = []
  if (input.helpLines !== undefined) overlays.push({ kind: 'help', rows: helpRows(input.helpLines) })
  if (input.slashItems !== undefined) overlays.push({ kind: 'slash', rows: slashRows(input.slashItems) })
  if (input.commandArgumentItems !== undefined) {
    overlays.push({ kind: 'command-argument', rows: slashRows(input.commandArgumentItems) })
  }
  if (input.fileItems !== undefined || input.fileLoading === true) {
    overlays.push({ kind: 'file', rows: fileRows(input.fileItems, input.fileLoading) })
  }
  if (input.historyMatches !== undefined) {
    overlays.push({ kind: 'history', rows: historyRows(input.historyMatches) })
  }
  if (input.resumeItems !== undefined) {
    overlays.push({
      kind: 'resume',
      rows: resumeRows(input.resumeItems, input.resumeSelected),
      minimumRows: MIN_RESUME_OVERLAY_ROWS,
    })
  }
  if (input.checklistItems !== undefined) {
    overlays.push({
      kind: 'checklist',
      rows: checklistRows(input.checklistItems, input.checklistSelected),
    })
  }
  if (input.rewindItems !== undefined) {
    overlays.push({
      kind: 'rewind',
      rows: rewindRows(input.rewindItems, input.rewindSelected, input.rewindConfirming),
      minimumRows: MIN_REWIND_OVERLAY_ROWS,
    })
  }
  if (input.skillsItems !== undefined) {
    overlays.push({ kind: 'skills', rows: skillsRows(input.skillsItems, input.skillsSelected) })
  }
  if (input.pluginItems !== undefined) {
    overlays.push({
      kind: 'plugins',
      rows: pluginRows(input.pluginItems, input.pluginSelected, input.pluginStatus),
    })
  }
  if (input.permissionItems !== undefined) {
    overlays.push({
      kind: 'permission',
      rows: permissionRows(input.permissionItems, input.permissionSelected),
    })
  }
  if (input.effortItems !== undefined) {
    overlays.push({
      kind: 'effort',
      rows: effortRows(input.effortItems, input.effortSelected),
    })
  }
  if (input.questionRows !== undefined) {
    overlays.push({ kind: 'question', rows: questionRows(input.questionRows) })
  }
  if (input.approvalRows !== undefined) {
    overlays.push({ kind: 'approval', rows: questionRows(input.approvalRows) })
  }
  if (input.reviewRows !== undefined) {
    overlays.push({ kind: 'review', rows: reviewRows(input.reviewRows) })
  }
  if (input.actionMenuItems !== undefined) {
    overlays.push({
      kind: 'action-menu',
      rows: actionMenuRows(input.actionMenuItems, input.actionMenuQuery),
    })
  }
  if (input.modelSwitchRows !== undefined) {
    overlays.push({ kind: 'model', rows: modelSwitchRows(input.modelSwitchRows) })
  }
  if (input.quitConfirmation === true) overlays.push({ kind: 'quit', rows: 7 })
  return overlays
}

const OVERLAY_PRIORITY: readonly ChatOverlayKind[] = [
  'question',
  'approval',
  'review',
  'rewind',
  'resume',
  'checklist',
  'skills',
  'plugins',
  'permission',
  'effort',
  'model',
  'quit',
  'action-menu',
  'history',
  'file',
  'slash',
  'command-argument',
  'help',
]

function selectActiveOverlay(overlays: readonly ChatOverlayInput[]): ChatOverlayInput | undefined {
  const candidates = overlays.filter((overlay) => nonNegativeInteger(overlay.rows) > 0)
  if (candidates.length <= 1) return candidates[0]
  const active = [...candidates].sort(
    (left, right) => OVERLAY_PRIORITY.indexOf(left.kind) - OVERLAY_PRIORITY.indexOf(right.kind),
  )[0]
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[cocode-tui] multiple active overlays; using highest priority', {
      active: active?.kind,
      candidates: candidates.map((candidate) => candidate.kind),
    })
  }
  return active
}

function defaultMinimumOverlayRows(kind: ChatOverlayKind): number {
  if (kind === 'resume') return MIN_RESUME_OVERLAY_ROWS
  if (kind === 'rewind') return MIN_REWIND_OVERLAY_ROWS
  return MIN_OVERLAY_ROWS
}

function helpRows(lines: number | undefined): number {
  if (lines === undefined) return 0
  return nonNegativeInteger(lines) + 4
}

function slashRows(items: number | undefined): number {
  if (items === undefined) return 0
  return Math.max(1, nonNegativeInteger(items)) + 4
}

function fileRows(items: number | undefined, loading = false): number {
  const count = nonNegativeInteger(items)
  if (count === 0 && !loading) return 0
  return count + 4 + optionalRow(loading)
}

function historyRows(matches: number | undefined): number {
  if (matches === undefined) return 0
  return Math.max(1, nonNegativeInteger(matches)) + 5
}

function resumeRows(items: number | undefined, selected = 0): number {
  const count = nonNegativeInteger(items)
  if (items === undefined) return 0
  const visible = Math.max(1, Math.min(count, RESUME_WINDOW_SIZE))
  const start = listWindowStart(selected, count, RESUME_WINDOW_SIZE)
  const indicators = optionalRow(start > 0) + optionalRow(count - start - visible > 0)
  return visible + indicators + 5
}

function checklistRows(items: number | undefined, selected = 0): number {
  if (items === undefined) return 0
  const count = nonNegativeInteger(items)
  const visible = Math.max(1, Math.min(count, CHECKLIST_WINDOW_SIZE))
  const start = listWindowStart(selected, count, CHECKLIST_WINDOW_SIZE)
  const indicators = optionalRow(start > 0) + optionalRow(count - start - visible > 0)
  return visible + indicators + 4
}

function actionMenuRows(items: number | undefined, query = false): number {
  if (items === undefined) return 0
  return Math.max(1, nonNegativeInteger(items)) + 4 + optionalRow(query)
}

function rewindRows(items: number | undefined, selected = 0, confirming = false): number {
  if (items === undefined) return 0
  const count = nonNegativeInteger(items)
  const visible = Math.max(1, Math.min(count, REWIND_WINDOW_SIZE))
  const start = listWindowStart(selected, count, REWIND_WINDOW_SIZE)
  const indicators = optionalRow(start > 0) + optionalRow(count - start - visible > 0)
  return visible + indicators + 6 + optionalRow(confirming)
}

function skillsRows(items: number | undefined, selected = 0): number {
  if (items === undefined) return 0
  const count = nonNegativeInteger(items)
  const visible = Math.max(1, Math.min(count, SKILLS_WINDOW_SIZE))
  const start = listWindowStart(selected, count, SKILLS_WINDOW_SIZE)
  const indicators = optionalRow(start > 0) + optionalRow(count - start - visible > 0)
  return visible + indicators + 6
}

function pluginRows(items: number | undefined, selected = 0, status = false): number {
  if (items === undefined) return 0
  const count = nonNegativeInteger(items)
  const visible = Math.max(1, Math.min(count, PLUGIN_PICKER_WINDOW_SIZE))
  const start = listWindowStart(selected, count, PLUGIN_PICKER_WINDOW_SIZE)
  const indicators = optionalRow(start > 0) + optionalRow(count - start - visible > 0)
  return visible + indicators + 6 + optionalRow(status)
}

function permissionRows(items: number | undefined, selected = 0): number {
  if (items === undefined) return 0
  const count = nonNegativeInteger(items)
  const visible = Math.max(1, Math.min(count, PERMISSION_PICKER_WINDOW_SIZE))
  const start = listWindowStart(selected, count, PERMISSION_PICKER_WINDOW_SIZE)
  const indicators = optionalRow(start > 0) + optionalRow(count - start - visible > 0)
  return visible + indicators + 6
}

function effortRows(items: number | undefined, selected = 0): number {
  if (items === undefined) return 0
  const count = nonNegativeInteger(items)
  const visible = Math.max(1, Math.min(count, EFFORT_PICKER_WINDOW_SIZE))
  const start = listWindowStart(selected, count, EFFORT_PICKER_WINDOW_SIZE)
  const indicators = optionalRow(start > 0) + optionalRow(count - start - visible > 0)
  return visible + indicators + 6
}

function questionRows(rows: number | undefined): number {
  return rows === undefined ? 0 : Math.max(MIN_OVERLAY_ROWS, nonNegativeInteger(rows))
}

function reviewRows(rows: number | undefined): number {
  return rows === undefined ? 0 : Math.max(MIN_OVERLAY_ROWS, nonNegativeInteger(rows))
}

function modelSwitchRows(rows: number | undefined): number {
  return rows === undefined ? 0 : Math.max(MIN_OVERLAY_ROWS, nonNegativeInteger(rows))
}

function optionalRow(enabled = false): number {
  return enabled ? 1 : 0
}

function atLeastOne(value: number): number {
  return Math.max(1, nonNegativeInteger(value))
}

function nonNegativeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}
