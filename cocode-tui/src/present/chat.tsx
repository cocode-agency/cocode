/**
 * Single chat layout. Components only see Snapshot + dispatch.
 */

import { Box, Text, useInput, useStdout, useStdin } from 'ink'
import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { TuiApp, TuiSnapshot } from '../runtime/app-contracts.ts'
import { matchKey, type Keymap } from '../runtime/keymap.ts'
import { resolveKeymap } from '../runtime/keymap-config.ts'
import { Composer } from './components/Composer.tsx'
import { ModelSwitchPanel } from './components/ModelSwitchPanel.tsx'
import { ModelPicker } from './components/ModelPicker.tsx'
import { ActionMenu, type ActionMenuItem } from './components/ActionMenu.tsx'
import { FileMenu } from './components/FileMenu.tsx'
import { Header } from './components/Header.tsx'
import { Help } from './components/Help.tsx'
import { HistorySearch } from './components/HistorySearch.tsx'
import { MessageList } from './components/MessageList.tsx'
import { ResumePicker } from './components/ResumePicker.tsx'
import { SessionTreePicker } from './components/SessionTreePicker.tsx'
import { RewindPicker } from './components/RewindPicker.tsx'
import { ForkPicker } from './components/ForkPicker.tsx'
import { QuestionPanel } from './components/QuestionPanel.tsx'
import {
  isPlanReviewQuestion,
  PlanReviewPanel,
  planReviewPanelRows,
} from './components/PlanReviewPanel.tsx'
import { SkillsPicker } from './components/SkillsPicker.tsx'
import { PluginsPicker } from './components/PluginsPicker.tsx'
import { CommandArgumentMenu } from './components/CommandArgumentMenu.tsx'
import { PermissionPicker } from './components/PermissionPicker.tsx'
import { EffortPicker } from './components/EffortPicker.tsx'
import {
  noticeRows,
  StatusLine,
  visibleNoticeRows,
} from './components/StatusLine.tsx'
import {
  filterSlashItems,
  isSlashDraft,
  moveSlashSelection,
  SlashMenu,
  slashCommandCompletion,
  type SlashMenuItem,
} from './components/SlashMenu.tsx'
import { theme } from './theme.ts'
import { findFileMentionAtCursor } from '../runtime/file-mentions.ts'
import { searchHistory } from '../runtime/history-search.ts'
import {
  listWorkspaceEntries,
  rankFileMatches,
} from '../runtime/workspace-files.ts'
import {
  messageSupportsDetails,
  moveMessageSelection,
  pruneExpandedMessageKeys,
  selectableMessageKeys,
  toggleMessageDetails,
} from './message-selection.ts'
import {
  maxMessageScrollOffset,
  scrollOffsetForMessage,
  transcriptPaintColumns,
} from './message-scroll.ts'
import {
  contentColumnFromMouseX,
  selectableNodeText,
  selectedMessageText as getSelectedMessageText,
  textPointAtViewportRow,
  type MessageTextPoint,
} from './message-text-selection.ts'
import { focusConversationNodes } from '../runtime/focus.ts'
import { text } from '../runtime/ui-locale.ts'
import {
  RESUME_WINDOW_SIZE,
  visibleResumeItems,
} from '../runtime/resume-picker.ts'
import {
  PROMPT_QUEUE_WINDOW_SIZE,
  visiblePromptQueueItems,
} from '../runtime/prompt-queue-picker.ts'
import {
  SESSION_TREE_WINDOW_SIZE,
  visibleSessionTreeItems,
} from '../runtime/session-tree-picker.ts'
import { visibleSubagents } from '../runtime/subagent-picker.ts'
import { REWIND_WINDOW_SIZE } from '../runtime/rewind-picker.ts'
import { SKILLS_WINDOW_SIZE, visibleSkills } from '../runtime/skills-picker.ts'
import {
  PLUGIN_PICKER_WINDOW_SIZE,
  visiblePlugins,
} from '../runtime/plugin-picker.ts'
import { PERMISSION_PICKER_WINDOW_SIZE } from '../runtime/permission-picker.ts'
import { EFFORT_PICKER_WINDOW_SIZE } from '../runtime/effort-picker.ts'
import {
  MODEL_PICKER_WINDOW_SIZE,
  visibleModelItems,
} from '../runtime/model-picker.ts'
import { nodeKey } from '../runtime/nodes/types.ts'
import { editDraft } from '../runtime/external-editor.ts'
import { listWindowStart } from './list-window.ts'
import {
  calculateChatLayout,
  CHAT_HEADER_ROWS,
  MAX_COMPOSER_ROWS,
} from './chat-layout.ts'
import { composerHeaderLayout } from './composer-header.ts'
import { composerInputRows, composerRenderedRows } from './composer-layout.ts'
import { Inspector, INSPECTOR_WIDTH } from './components/Inspector.tsx'
import type { InspectorMouseInput } from './inspector-scroll.ts'
import { useInspectorResize } from './inspector-resize.ts'
import { compactColumns, paintColumns } from './panel-layout.ts'
import { terminalViewport } from './terminal-output.ts'
import { ReviewPicker } from './components/ReviewPicker.tsx'
import { ApprovalPanel } from './components/ApprovalPanel.tsx'
import { QueuePicker } from './components/QueuePicker.tsx'
import { RemoteQueuePicker } from './components/RemoteQueuePicker.tsx'
import { SubagentPicker } from './components/SubagentPicker.tsx'
import { ChecklistPanel } from './components/ChecklistPanel.tsx'
import { QuitConfirmation } from './components/QuitConfirmation.tsx'
import {
  ChecklistStrip,
  CHECKLIST_STRIP_MAX_ITEMS,
  checklistStripRows,
} from './components/ChecklistStrip.tsx'
import {
  dispatchComposerShortcut,
  dispatchCommandArgumentCompletion,
  dispatchComposerTab,
  dispatchHelpInput,
  dispatchKeyCommand,
  dispatchPickerInput,
  isCopyShortcut,
  moveSelection,
} from './chat-input.ts'
import {
  applyMousePointerShape,
  createMouseDecoder,
  enableMouseTracking,
  isMousePointerEvent,
  isMouseInput,
  layoutRowFromMouseY,
  mousePointerForTranscript,
  mouseWheelDelta,
  shouldEnableMouseTracking,
  type MousePointerShape,
  type TuiMousePointer,
  type TuiMouseEvent,
} from './mouse.ts'
import { filterSearchItems } from './search.ts'
import { commandArgumentCompletions } from './command-completion.ts'
import { CHECKLIST_WINDOW_SIZE } from '../runtime/checklist.ts'
import {
  actionMenuItemIndexAtRow,
  listItemIndexAtRow,
  composerModelHit,
  popupContains,
} from './mouse-hit.ts'
import { resolveFooterHints, type FooterOverlay } from './footer-hints.ts'
import {
  initialMessageSelectionState,
  reduceMessageSelection,
} from './message-selection-controller.ts'

export function Chat(props: {
  app: TuiApp
  keymap?: Keymap
  mouseSupported?: boolean
  mouseInput?: Pick<NodeJS.ReadStream, 'on' | 'off'>
  mouseOutput?: Pick<NodeJS.WriteStream, 'write'>
}) {
  const { app } = props
  const [snap, setSnap] = useState<TuiSnapshot>(() => app.snapshot())
  const keymap = useMemo(() => props.keymap ?? resolveKeymap(), [props.keymap])
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [commandArgumentDismissed, setCommandArgumentDismissed] =
    useState(false)
  const [commandArgumentIndex, setCommandArgumentIndex] = useState(0)
  const [fileDismissed, setFileDismissed] = useState(false)
  const [fileIndex, setFileIndex] = useState(0)
  const [fileItems, setFileItems] = useState<readonly string[]>([])
  const [fileLoading, setFileLoading] = useState(false)
  const [historySearchOpen, setHistorySearchOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyIndex, setHistoryIndex] = useState(0)
  const [messageSelection, dispatchMessageSelection] = useReducer(
    reduceMessageSelection,
    initialMessageSelectionState,
  )
  const [messageScrollOffset, setMessageScrollOffset] = useState(0)
  const [noticeScrollOffset, setNoticeScrollOffset] = useState(0)
  const [followTranscript, setFollowTranscript] = useState(true)
  const [expandedMessageIds, setExpandedMessageIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [expandedMessageLevels, setExpandedMessageLevels] = useState<
    ReadonlyMap<string, 0 | 1 | 2>
  >(() => new Map())
  const [messageActionMenuOpen, setMessageActionMenuOpen] = useState(false)
  const [messageActionIndex, setMessageActionIndex] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | undefined>()
  const [questionMousePointer, setQuestionMousePointer] =
    useState<TuiMousePointer>()
  const [approvalMousePointer, setApprovalMousePointer] =
    useState<TuiMousePointer>()
  const [inspectorMouseInput, setInspectorMouseInput] =
    useState<InspectorMouseInput>()
  const mouseClickId = useRef(0)
  const planReviewWheelTicks = useRef(0)
  // Mouse press/move packets can share one stdin chunk; this ref keeps the
  // drag session available before React commits the reducer update.
  const messageSelectionDragging = useRef(false)
  const mousePointerShape = useRef<MousePointerShape>('default')
  const handleMouseEventRef = useRef<(event: TuiMouseEvent) => void>(
    () => undefined,
  )
  const { stdout } = useStdout()
  const { columns: terminalColumns, rows: viewportRows } =
    terminalViewport(stdout)
  const { isRawModeSupported, setRawMode } = useStdin()
  const messageSelectionActive = messageSelection.active
  const messageTextSelection = messageSelection.selection
  const selectedMessageId = messageSelection.selectedNodeId

  const toggleSelectedMessageDetails = () => {
    if (selectedMessageId === null) return
    const selected = displayNodes.find(
      (node) => nodeKey(node.kind, node.id) === selectedMessageId,
    )
    if (
      selected?.kind !== 'assistant' ||
      selected.streaming ||
      selected.reasoning.trim() === ''
    ) {
      setExpandedMessageIds((current) =>
        toggleMessageDetails(displayNodes, selectedMessageId, current),
      )
      return
    }
    const currentLevel = expandedMessageLevels.get(selectedMessageId) ?? 0
    const nextLevel: 0 | 1 | 2 =
      currentLevel === 0 ? 1 : currentLevel === 1 ? 2 : 0
    setExpandedMessageLevels((current) => {
      const next = new Map(current)
      if (nextLevel === 0) next.delete(selectedMessageId)
      else next.set(selectedMessageId, nextLevel)
      return next
    })
    setExpandedMessageIds((current) => {
      const next = new Set(current)
      if (nextLevel === 0) next.delete(selectedMessageId)
      else next.add(selectedMessageId)
      return next
    })
  }
  const slashItems = useMemo<readonly SlashMenuItem[]>(
    () => filterSlashItems(snap.commands, snap.composer.text),
    [snap.commands, snap.composer.text],
  )
  const commandArgumentState = useMemo(
    () => commandArgumentCompletions(snap.commands, snap.composer.text),
    [snap.commands, snap.composer.text],
  )
  const resumeOpen = snap.resumePicker?.open === true
  const sessionTreeOpen = snap.sessionTreePicker?.open === true
  const subagentOpen = snap.subagentPicker?.open === true
  const queueOpen = snap.queuePicker?.open === true
  const checklistOpen = snap.checklist?.open === true
  const queueItems =
    snap.queuePicker === undefined
      ? []
      : visiblePromptQueueItems(snap.queuePicker)
  const resumeItems =
    snap.resumePicker === undefined ? [] : visibleResumeItems(snap.resumePicker)
  const rewindState = snap.rewindPicker
  const rewindOpen = rewindState?.open === true
  const forkState = snap.forkPicker
  const forkOpen = forkState?.open === true
  const skillsState = snap.skillsPicker
  const skillsOpen = skillsState?.open === true
  const pluginState = snap.pluginPicker
  const pluginOpen = pluginState?.open === true
  const modelPickerOpen = snap.modelPicker?.open === true
  const modelInputOpen = snap.modelInputOpen
  const modelOverlayOpen = modelPickerOpen || modelInputOpen
  const quitConfirmationOpen = snap.quitConfirmation
  const permissionOpen = snap.permissionPicker?.open === true
  const effortOpen = snap.effortPicker?.open === true
  const questionOpen = snap.question !== undefined
  const approvalOpen = snap.approval?.open === true
  const reviewOpen = snap.reviewPicker?.open === true
  const slashOpen =
    !questionOpen &&
    !approvalOpen &&
    !reviewOpen &&
    !forkOpen &&
    !rewindOpen &&
    !skillsOpen &&
    !pluginOpen &&
    !permissionOpen &&
    !effortOpen &&
    !resumeOpen &&
    !sessionTreeOpen &&
    !subagentOpen &&
    !queueOpen &&
    !checklistOpen &&
    !historySearchOpen &&
    !commandPaletteOpen &&
    !messageActionMenuOpen &&
    !modelOverlayOpen &&
    !snap.helpOpen &&
    !quitConfirmationOpen &&
    !slashDismissed &&
    isSlashDraft(snap.composer.text)
  const commandArgumentOpen =
    !questionOpen &&
    !approvalOpen &&
    !reviewOpen &&
    !forkOpen &&
    !rewindOpen &&
    !skillsOpen &&
    !pluginOpen &&
    !permissionOpen &&
    !effortOpen &&
    !resumeOpen &&
    !sessionTreeOpen &&
    !subagentOpen &&
    !queueOpen &&
    !checklistOpen &&
    !historySearchOpen &&
    !commandPaletteOpen &&
    !messageActionMenuOpen &&
    !modelOverlayOpen &&
    !snap.helpOpen &&
    !quitConfirmationOpen &&
    !slashOpen &&
    !commandArgumentDismissed &&
    commandArgumentState !== undefined
  const fileMention = useMemo(
    () => findFileMentionAtCursor(snap.composer.text, snap.composer.cursor),
    [snap.composer.cursor, snap.composer.text],
  )
  const fileVisible =
    !questionOpen &&
    !approvalOpen &&
    !reviewOpen &&
    !forkOpen &&
    !rewindOpen &&
    !skillsOpen &&
    !pluginOpen &&
    !permissionOpen &&
    !effortOpen &&
    !resumeOpen &&
    !sessionTreeOpen &&
    !queueOpen &&
    !checklistOpen &&
    !historySearchOpen &&
    !commandPaletteOpen &&
    !messageActionMenuOpen &&
    !modelOverlayOpen &&
    !snap.helpOpen &&
    !quitConfirmationOpen &&
    !slashOpen &&
    !commandArgumentOpen &&
    !fileDismissed &&
    fileMention !== undefined
  const fileOpen = fileVisible && (fileLoading || fileItems.length > 0)
  const activeFooterOverlay: FooterOverlay | undefined = questionOpen
    ? 'question'
    : approvalOpen
      ? 'approval'
      : reviewOpen
        ? 'review'
        : forkOpen
          ? 'fork'
          : rewindOpen
            ? 'rewind'
            : skillsOpen
              ? 'skills'
              : pluginOpen
                ? 'plugins'
                : resumeOpen
                  ? 'resume'
                  : sessionTreeOpen
                    ? 'sessionTree'
                    : queueOpen
                      ? 'queue'
                      : checklistOpen
                        ? 'checklist'
                        : historySearchOpen
                          ? 'history'
                          : commandPaletteOpen
                            ? 'commandPalette'
                            : messageActionMenuOpen
                              ? 'messageActions'
                              : modelInputOpen
                                ? 'modelInput'
                                : modelPickerOpen
                                  ? 'model'
                                  : effortOpen
                                    ? 'effort'
                                    : snap.helpOpen
                                      ? 'help'
                                      : slashOpen
                                        ? 'slash'
                                        : fileOpen
                                          ? 'file'
                                          : undefined
  const historyItems = useMemo(
    () => searchHistory(snap.history, historyQuery, 8),
    [historyQuery, snap.history],
  )
  const displayNodes = useMemo(
    () =>
      focusConversationNodes(snap.nodes, snap.status.focusMode).filter(
        (node) => {
          const key = nodeKey(node.kind, node.id)
          if (node.kind === 'context')
            return snap.verbose || expandedMessageIds.has(key)
          if (node.kind === 'notice' && node.verboseOnly === true)
            return snap.verbose
          return true
        },
      ),
    [expandedMessageIds, snap.nodes, snap.status.focusMode, snap.verbose],
  )
  const selectableMessages = useMemo(
    () => selectableMessageKeys(displayNodes),
    [displayNodes],
  )
  const selectedMessageText = useMemo(
    () =>
      getSelectedMessageText(displayNodes, messageTextSelection, {
        verbose: snap.verbose,
        expandedNodeIds: expandedMessageIds,
      }),
    [displayNodes, expandedMessageIds, messageTextSelection, snap.verbose],
  )
  const selectedNode = useMemo(
    () =>
      displayNodes.find(
        (node) => nodeKey(node.kind, node.id) === selectedMessageId,
      ),
    [displayNodes, selectedMessageId],
  )
  const messageActionItems = useMemo<readonly ActionMenuItem[]>(() => {
    if (selectedNode === undefined) return []
    const key = nodeKey(selectedNode.kind, selectedNode.id)
    const expanded = expandedMessageIds.has(key)
    const items: ActionMenuItem[] = []
    if (messageSupportsDetails(selectedNode)) {
      items.push({
        id: 'toggle-expand',
        label: expanded
          ? snap.locale === 'zh'
            ? '收起详情'
            : 'Collapse details'
          : snap.locale === 'zh'
            ? '展开详情'
            : 'Expand details',
        shortcut: 'enter',
      })
    }
    items.push({
      id: 'copy',
      label: snap.locale === 'zh' ? '复制选中文本' : 'Copy selected text',
      shortcut: 'c',
    })
    if (snap.capabilities.rewind && selectedNode.kind === 'user') {
      items.push({
        id: 'rewind',
        label: snap.locale === 'zh' ? '从此处回退…' : 'Rewind from message…',
      })
    }
    if (snap.capabilities.fork && selectedNode.kind === 'user') {
      items.push({
        id: 'fork',
        label: snap.locale === 'zh' ? '从此处创建分支…' : 'Fork from message…',
      })
    }
    return items
  }, [
    expandedMessageIds,
    selectedNode,
    snap.capabilities.fork,
    snap.capabilities.rewind,
    snap.locale,
  ])
  const allCommandPaletteItems = useMemo<readonly ActionMenuItem[]>(
    () =>
      snap.commands.map((command) => ({
        id: command.name,
        label: `/${command.name}`,
        description: command.summary,
      })),
    [snap.commands],
  )
  const commandPaletteItems = useMemo(
    () =>
      filterSearchItems(
        allCommandPaletteItems,
        commandPaletteQuery,
        (item) => `${item.label} ${item.description ?? ''}`,
      ),
    [allCommandPaletteItems, commandPaletteQuery],
  )
  const projectedMode = compactColumns(terminalColumns)
  const inspectorResize = useInspectorResize({
    terminalColumns,
    visible: projectedMode === 'wide',
    defaultWidth: INSPECTOR_WIDTH,
  })
  const projectedInspectorLayout = inspectorResize.layout
  const projectedMainColumns =
    projectedMode === 'wide'
      ? projectedInspectorLayout.mainColumns
      : paintColumns(terminalColumns)
  const mainChecklistRows = checklistStripRows(
    snap.status.todos.length,
    projectedMode === 'wide' ? CHECKLIST_STRIP_MAX_ITEMS : 2,
  )
  const noticeContentRows =
    snap.notice === undefined
      ? 0
      : noticeRows(snap.notice.message, projectedMainColumns)
  const noticeRowCount =
    snap.notice === undefined
      ? 0
      : visibleNoticeRows(snap.notice.message, projectedMainColumns)
  const noticeScrollMax = Math.max(0, noticeContentRows - noticeRowCount)
  const composerVisibleInputRows = composerInputRows(
    snap.composer.text,
    MAX_COMPOSER_ROWS,
  )
  const composerAttachmentRows = Number(snap.composer.attachments.length > 0)
  const composerImageRows = Number(snap.composer.images.length > 0)
  const composerRows = composerRenderedRows({
    text: snap.composer.text,
    maxRows: MAX_COMPOSER_ROWS,
    hasAttachments: composerAttachmentRows === 1,
    hasImages: composerImageRows === 1,
  })
  const layout = calculateChatLayout({
    viewport: { columns: terminalColumns, rows: viewportRows },
    viewportRows,
    composerRows,
    composerInputRows: composerVisibleInputRows,
    attachmentRows: composerAttachmentRows + composerImageRows,
    inspectorPreferredWidth: inspectorResize.preferredWidth,
    noticeRows: noticeRowCount,
    hasStatusDetails: hasStatusDetails(snap.status),
    checklistStripRows: mainChecklistRows,
    editorFeedbackRows: Number(editorBusy) + Number(editorError !== undefined),
    helpLines: snap.helpOpen ? snap.helpText.split('\n').length : undefined,
    slashItems: slashOpen ? slashItems.length : undefined,
    commandArgumentItems: commandArgumentOpen
      ? commandArgumentState?.items.length
      : undefined,
    fileItems: fileOpen ? fileItems.length : undefined,
    fileLoading: fileOpen && fileLoading,
    historyMatches: historySearchOpen ? historyItems.length : undefined,
    resumeItems: queueOpen
      ? queueItems.length
      : sessionTreeOpen
        ? snap.sessionTreePicker === undefined
          ? 0
          : snap.sessionTreePicker.items.length
        : subagentOpen
          ? snap.subagentPicker === undefined
            ? 0
            : visibleSubagents(snap.subagentPicker).length
        : resumeOpen
          ? resumeItems.length
          : undefined,
    resumeSelected: queueOpen
      ? snap.queuePicker?.selected
      : sessionTreeOpen
        ? snap.sessionTreePicker?.selected
        : subagentOpen
          ? snap.subagentPicker?.selected
        : resumeOpen
          ? snap.resumePicker?.selected
          : undefined,
    checklistItems: checklistOpen ? snap.status.todos.length : undefined,
    checklistSelected: checklistOpen ? snap.checklist?.selected : undefined,
    rewindItems: rewindOpen
      ? rewindState.items.length
      : forkOpen
        ? forkState.items.length
        : undefined,
    rewindSelected: rewindOpen
      ? rewindState.selected
      : forkOpen
        ? forkState.selected
        : undefined,
    rewindConfirming: rewindOpen
      ? rewindState.confirming
      : forkOpen
        ? forkState.confirming
        : undefined,
    skillsItems: skillsOpen ? skillsState.skills.length : undefined,
    skillsSelected: skillsOpen ? skillsState.selected : undefined,
    pluginItems:
      pluginOpen && pluginState !== undefined
        ? visiblePlugins(pluginState).length
        : undefined,
    pluginSelected: pluginOpen ? pluginState?.selected : undefined,
    pluginStatus: pluginOpen && pluginState?.status !== undefined,
    permissionItems: permissionOpen
      ? snap.permissionPicker?.modes.length
      : undefined,
    permissionSelected: permissionOpen
      ? snap.permissionPicker?.selected
      : undefined,
    effortItems: effortOpen ? snap.effortPicker?.items.length : undefined,
    effortSelected: effortOpen ? snap.effortPicker?.selected : undefined,
    questionRows:
      snap.question === undefined
        ? undefined
        : isPlanReviewQuestion(snap.question.question)
          ? planReviewPanelRows(snap.question, projectedMainColumns)
          : questionPanelRows(snap.question),
    approvalRows: approvalOpen ? 12 : undefined,
    reviewRows: reviewOpen ? reviewRowsFor(snap.reviewPicker) : undefined,
    actionMenuItems: commandPaletteOpen
      ? 0
      : messageActionMenuOpen
        ? messageActionItems.length
        : undefined,
    actionMenuQuery: commandPaletteOpen,
    modelSwitchRows: modelPickerOpen ? 14 : modelInputOpen ? 6 : undefined,
    quitConfirmation: quitConfirmationOpen,
  })
  const mainColumns = layout.mainColumns
  const inspectorLayout = layout.inspector ?? projectedInspectorLayout
  const messageMaxRows = layout.rows.transcript
  const statusRows = layout.rows.status
  const editorRows = layout.rows.editorFeedback
  const wideInspector = layout.inspector !== undefined
  const messageStartRow = CHAT_HEADER_ROWS + 1
  const contentOverlayStartRow =
    messageStartRow +
    messageMaxRows +
    mainChecklistRows +
    statusRows +
    editorRows
  const messageContentColumns = useMemo(
    () =>
      transcriptPaintColumns(
        displayNodes,
        messageMaxRows,
        snap.verbose,
        expandedMessageIds,
        mainColumns,
      ) ?? Math.max(1, mainColumns),
    [
      displayNodes,
      expandedMessageIds,
      mainColumns,
      messageMaxRows,
      snap.verbose,
    ],
  )
  const composerHeader = composerHeaderLayout({
    composer: snap.composer,
    agent: snap.agent,
    planMode: snap.status.planMode,
    planModeAvailable: snap.capabilities.planMode,
    locale: snap.locale,
    provider: snap.header.provider,
    model: snap.header.model,
    reasoningEffort: snap.header.reasoningEffort,
    columns: mainColumns,
  })
  const composerMetadataRow = contentOverlayStartRow + layout.rows.overlay
  const popupBounds = {
    startRow: contentOverlayStartRow,
    startColumn: 1,
    rows: layout.rows.overlay,
    columns: mainColumns,
  }
  const popupStartRow = popupBounds.startRow
  const mouseTrackingActive = shouldEnableMouseTracking({
    supported: props.mouseSupported !== false,
    manualMode: false,
    // The transcript owns wheel and drag selection while overlays reuse the
    // same input stream for their existing pointer interactions.
    overlayOpen: layout.rows.overlay > 0,
  })
  const selectedMessageSupportsDetails =
    selectedNode !== undefined && messageSupportsDetails(selectedNode)
  const selectedMessageExpanded =
    selectedMessageId !== null && expandedMessageIds.has(selectedMessageId)
  const resolvedFooter = useMemo(
    () =>
      resolveFooterHints(
        {
          activeOverlay: activeFooterOverlay,
          agent: snap.agent,
          draft: snap.composer.text,
          readOnly: snap.header.readOnly,
          messageSelection: messageSelectionActive,
          paneFocus: 'conversation',
          overlayConfirming:
            activeFooterOverlay === 'rewind'
              ? rewindState?.confirming === true
              : activeFooterOverlay === 'fork'
                ? forkState?.confirming === true
                : false,
          detailsAvailable: !wideInspector,
          messageDetailsAvailable: selectedMessageSupportsDetails,
          messageDetailsExpanded: selectedMessageExpanded,
        },
        keymap,
        snap.locale,
        mainColumns,
      ),
    [
      activeFooterOverlay,
      forkState?.confirming,
      keymap,
      mainColumns,
      messageSelectionActive,
      rewindState?.confirming,
      selectedMessageExpanded,
      selectedMessageSupportsDetails,
      snap.agent,
      snap.composer.text,
      snap.header.readOnly,
      snap.locale,
      wideInspector,
    ],
  )

  const messageScrollMax = useMemo(
    () =>
      maxMessageScrollOffset(
        displayNodes,
        messageMaxRows,
        snap.verbose,
        expandedMessageIds,
        messageContentColumns,
      ),
    [
      displayNodes,
      expandedMessageIds,
      messageContentColumns,
      messageMaxRows,
      snap.verbose,
    ],
  )
  useEffect(
    () =>
      app.subscribe(() => {
        setSnap(app.snapshot())
      }),
    [app],
  )

  useEffect(() => {
    setNoticeScrollOffset(0)
  }, [mainColumns, snap.notice?.message])

  useEffect(() => {
    if (!questionOpen) planReviewWheelTicks.current = 0
  }, [questionOpen])

  useEffect(() => {
    if (followTranscript) setMessageScrollOffset(0)
  }, [
    followTranscript,
    messageMaxRows,
    snap.nodes.length,
    expandedMessageIds.size,
  ])

  const openCommandPalette = (): void => {
    setCommandPaletteOpen(true)
    setCommandPaletteIndex(0)
    setCommandPaletteQuery('')
    setMessageActionMenuOpen(false)
  }

  const openModelSwitch = (): void => {
    if (snap.composer.disabled) return
    app.dispatch({ type: 'model.open' })
    setCommandPaletteOpen(false)
    setMessageActionMenuOpen(false)
  }

  const copySelectedMessages = (): void => {
    if (selectedMessageText === '') return
    app.dispatch({ type: 'copyText', text: selectedMessageText })
  }

  const messageAtMouseEvent = (
    event: TuiMouseEvent,
  ): MessageTextPoint | undefined => {
    if (event.x < 1 || event.x > messageContentColumns) return undefined
    const viewportRow = event.y - messageStartRow
    if (viewportRow < 0 || viewportRow >= messageMaxRows) return undefined
    return textPointAtViewportRow({
      nodes: displayNodes,
      maxRows: messageMaxRows,
      viewportRow,
      cellColumn: contentColumnFromMouseX(event.x),
      verbose: snap.verbose,
      expandedNodeIds: expandedMessageIds,
      scrollOffset: messageScrollOffset,
      maxColumns: messageContentColumns,
    }) as MessageTextPoint | undefined
  }

  const runMessageAction = (item: ActionMenuItem | undefined): void => {
    if (item?.id === 'toggle-expand' && selectedMessageId !== null) {
      setExpandedMessageIds((current) => {
        const next = new Set(current)
        if (next.has(selectedMessageId)) next.delete(selectedMessageId)
        else next.add(selectedMessageId)
        return next
      })
    } else if (item?.id === 'copy') {
      copySelectedMessages()
    } else if (item?.id === 'rewind') {
      app.dispatch({ type: 'rewind.open' })
    } else if (item?.id === 'fork') {
      app.dispatch({ type: 'fork.open' })
    }
    setMessageActionMenuOpen(false)
  }

  const handleMouseEvent = (event: TuiMouseEvent): void => {
    try {
      if (quitConfirmationOpen) return
      if (inspectorResize.handleMouseEvent(event)) return
      if (event.action === 'release' && messageSelectionDragging.current) {
        messageSelectionDragging.current = false
        dispatchMessageSelection({ type: 'endDrag' })
        return
      }
      const insideInspector =
        wideInspector && event.x >= inspectorLayout.startColumn
      if (insideInspector) {
        if (
          event.button === 'wheel-up' ||
          event.button === 'wheel-down' ||
          (event.action === 'press' && event.button === 0)
        ) {
          setInspectorMouseInput({ id: mouseClickId.current++, event })
        }
        return
      }
      const wheelDelta = mouseWheelDelta(event)
      if (wheelDelta !== undefined) {
        if (
          questionOpen &&
          snap.question !== undefined &&
          isPlanReviewQuestion(snap.question.question)
        ) {
          planReviewWheelTicks.current += wheelDelta
          setQuestionMousePointer({
            id: mouseClickId.current++,
            row: layoutRowFromMouseY(event.y),
            action: 'move',
            wheelDelta: planReviewWheelTicks.current,
          })
          return
        }
        if (
          layout.tooSmall ||
          commandPaletteOpen ||
          messageActionMenuOpen ||
          questionOpen ||
          approvalOpen ||
          reviewOpen ||
          rewindOpen ||
          forkOpen ||
          skillsOpen ||
          pluginOpen ||
          permissionOpen ||
          effortOpen ||
          commandArgumentOpen ||
          resumeOpen ||
          sessionTreeOpen ||
          queueOpen ||
          checklistOpen ||
          historySearchOpen ||
          modelOverlayOpen ||
          (snap.composer.disabled && !snap.header.readOnly)
        ) {
          return
        }
        const wheelRows = Math.max(1, Math.floor(messageMaxRows / 3))
        setMessageScrollOffset((offset) =>
          Math.max(
            0,
            Math.min(messageScrollMax, offset + wheelDelta * wheelRows),
          ),
        )
        setFollowTranscript(wheelDelta < 0 && messageScrollOffset <= wheelRows)
        return
      }
      const pointerRow = layoutRowFromMouseY(event.y)
      const insidePopup = popupContains(popupBounds, event.x, pointerRow)
      const hitRow = insidePopup ? pointerRow : -1
      if (modelPickerOpen && snap.modelPicker !== undefined) {
        if (!insidePopup || event.button !== 0) return
        const items = visibleModelItems(snap.modelPicker)
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          MODEL_PICKER_WINDOW_SIZE,
          7,
        )
        const start = listWindowStart(
          snap.modelPicker.selected,
          items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 3 + Number(start > 0),
          itemCount: items.length,
          selectedIndex: snap.modelPicker.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'model.move',
            delta: index - snap.modelPicker.selected,
          })
          if (event.action === 'press') app.dispatch({ type: 'model.confirm' })
        }
        return
      }
      if (permissionOpen && snap.permissionPicker !== undefined) {
        if (!insidePopup || event.button !== 0) return
        const state = snap.permissionPicker
        const windowSize = pickerWindowSize(
          layout.overlayRows,
          PERMISSION_PICKER_WINDOW_SIZE,
          6,
        )
        const start = listWindowStart(
          state.selected,
          state.modes.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 3 + Number(start > 0),
          itemCount: state.modes.length,
          selectedIndex: state.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'permission.move',
            delta: index - state.selected,
          })
          if (event.action === 'press')
            app.dispatch({ type: 'permission.confirm' })
        }
        return
      }
      if (effortOpen && snap.effortPicker !== undefined) {
        if (!insidePopup || event.button !== 0) return
        const state = snap.effortPicker
        const windowSize = pickerWindowSize(
          layout.overlayRows,
          EFFORT_PICKER_WINDOW_SIZE,
          6,
        )
        const start = listWindowStart(
          state.selected,
          state.items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 3 + Number(start > 0),
          itemCount: state.items.length,
          selectedIndex: state.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'effort.move',
            delta: index - state.selected,
          })
          if (event.action === 'press') app.dispatch({ type: 'effort.confirm' })
        }
        return
      }
      if (modelOverlayOpen) return
      if (questionOpen || approvalOpen) {
        if (isMousePointerEvent(event)) {
          const pointer = {
            id: mouseClickId.current++,
            row: hitRow,
            action: event.action === 'move' ? 'move' : 'press',
          } as const
          if (questionOpen) setQuestionMousePointer(pointer)
          else setApprovalMousePointer(pointer)
        }
        return
      }
      const transcriptSelectionAvailable =
        activeFooterOverlay === undefined && !layout.tooSmall
      if (transcriptSelectionAvailable && isMousePointerEvent(event)) {
        const point = messageAtMouseEvent(event)
        if (event.action === 'press' && point !== undefined) {
          messageSelectionDragging.current = true
          dispatchMessageSelection({ type: 'beginDrag', point })
          setMessageActionMenuOpen(false)
          setFollowTranscript(false)
          return
        }
        if (event.action === 'move' && messageSelectionDragging.current) {
          if (point !== undefined) {
            dispatchMessageSelection({ type: 'moveDrag', point })
          }
          return
        }
      }
      if (
        (event.action !== 'press' && event.action !== 'move') ||
        event.button !== 0 ||
        layout.tooSmall
      )
        return
      const isPress = event.action === 'press'
      const headerRows = CHAT_HEADER_ROWS
      if (commandPaletteOpen) {
        const index = actionMenuItemIndexAtRow({
          row: hitRow,
          menuStartRow: popupStartRow,
          itemCount: commandPaletteItems.length,
          selectedIndex: commandPaletteIndex,
          maxRows: layout.rows.overlay,
          query: true,
        })
        if (index !== undefined) {
          if (isPress) {
            const item = commandPaletteItems[index]
            if (item !== undefined)
              app.dispatch({ type: 'command', line: `/${item.id}` })
            setCommandPaletteOpen(false)
          } else {
            setCommandPaletteIndex(index)
          }
        }
        return
      }
      if (messageActionMenuOpen) {
        const index = actionMenuItemIndexAtRow({
          row: hitRow,
          menuStartRow: popupStartRow,
          itemCount: messageActionItems.length,
          selectedIndex: messageActionIndex,
          maxRows: layout.rows.overlay,
        })
        if (index !== undefined) {
          if (isPress) runMessageAction(messageActionItems[index])
          else setMessageActionIndex(index)
        } else if (
          isPress &&
          (event.y < popupStartRow ||
            event.y > popupStartRow + layout.rows.overlay)
        ) {
          setMessageActionMenuOpen(false)
        }
        return
      }
      if (slashOpen) {
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4,
          itemCount: slashItems.length,
          selectedIndex: slashIndex,
          windowSize: overlayWindowSize(
            layout.rows.overlay,
            slashItems.length,
            4,
          ),
        })
        const item = index === undefined ? undefined : slashItems[index]
        if (index !== undefined && isPress && item !== undefined) {
          app.dispatch({ type: 'command.select', line: `/${item.name}` })
        } else if (index !== undefined) {
          setSlashIndex(index)
        }
        return
      }
      if (commandArgumentOpen && commandArgumentState !== undefined) {
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4,
          itemCount: commandArgumentState.items.length,
          selectedIndex: commandArgumentIndex,
          windowSize: overlayWindowSize(
            layout.overlayRows,
            commandArgumentState.items.length,
            4,
          ),
        })
        if (index !== undefined) {
          setCommandArgumentIndex(index)
          if (isPress) {
            const item = commandArgumentState.items[index]
            if (item !== undefined) dispatchCommandArgumentCompletion(app, item)
          }
        }
        return
      }
      if (fileOpen && fileMention !== undefined) {
        const loadingRows = fileLoading ? 1 : 0
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 3 + loadingRows,
          itemCount: fileItems.length,
          selectedIndex: fileIndex,
          windowSize: overlayWindowSize(
            layout.rows.overlay,
            fileItems.length,
            4 + loadingRows,
          ),
        })
        const item = index === undefined ? undefined : fileItems[index]
        if (item !== undefined && isPress) {
          app.dispatch({
            type: 'attachFile',
            start: fileMention.start,
            end: fileMention.end,
            path: item,
          })
        } else if (index !== undefined) setFileIndex(index)
        return
      }
      if (historySearchOpen) {
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4,
          itemCount: historyItems.length,
          selectedIndex: historyIndex,
          windowSize: overlayWindowSize(
            layout.rows.overlay,
            historyItems.length,
            5,
          ),
        })
        const item = index === undefined ? undefined : historyItems[index]
        if (item !== undefined && isPress) {
          app.dispatch({ type: 'setDraft', text: item })
          setHistorySearchOpen(false)
          setHistoryQuery('')
          setHistoryIndex(0)
        } else if (index !== undefined) setHistoryIndex(index)
        return
      }
      if (resumeOpen && snap.resumePicker !== undefined) {
        const items = resumeItems
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          RESUME_WINDOW_SIZE,
        )
        const start = listWindowStart(
          snap.resumePicker.selected,
          items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4 + Number(start > 0),
          itemCount: items.length,
          selectedIndex: snap.resumePicker.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'resume.move',
            delta: index - snap.resumePicker.selected,
          })
          if (isPress) app.dispatch({ type: 'resume.confirm' })
        }
        return
      }
      if (sessionTreeOpen && snap.sessionTreePicker !== undefined) {
        const items = visibleSessionTreeItems(snap.sessionTreePicker)
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          SESSION_TREE_WINDOW_SIZE,
        )
        const start = listWindowStart(
          snap.sessionTreePicker.selected,
          items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4 + Number(start > 0),
          itemCount: items.length,
          selectedIndex: snap.sessionTreePicker.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'sessionTree.move',
            delta: index - snap.sessionTreePicker.selected,
          })
          if (isPress) app.dispatch({ type: 'sessionTree.confirm' })
        }
        return
      }
      if (queueOpen && snap.queuePicker !== undefined) {
        const items = queueItems
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          PROMPT_QUEUE_WINDOW_SIZE,
        )
        const start = listWindowStart(
          snap.queuePicker.selected,
          items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4 + Number(start > 0),
          itemCount: items.length,
          selectedIndex: snap.queuePicker.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'queue.move',
            delta: index - snap.queuePicker.selected,
          })
          if (isPress) app.dispatch({ type: 'queue.restore' })
        }
        return
      }
      if (checklistOpen && snap.checklist !== undefined) {
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          CHECKLIST_WINDOW_SIZE,
          4,
        )
        const start = listWindowStart(
          snap.checklist.selected,
          snap.status.todos.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 3 + Number(start > 0),
          itemCount: snap.status.todos.length,
          selectedIndex: snap.checklist.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'checklist.move',
            delta: index - snap.checklist.selected,
          })
        }
        return
      }
      if (skillsOpen && skillsState !== undefined) {
        const items = visibleSkills(skillsState)
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          SKILLS_WINDOW_SIZE,
        )
        const start = listWindowStart(
          skillsState.selected,
          items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4 + Number(start > 0),
          itemCount: items.length,
          selectedIndex: skillsState.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'skills.move',
            delta: index - skillsState.selected,
          })
          if (isPress) app.dispatch({ type: 'skills.confirm' })
        }
        return
      }
      if (pluginOpen && pluginState !== undefined) {
        const items = visiblePlugins(pluginState)
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          PLUGIN_PICKER_WINDOW_SIZE,
        )
        const start = listWindowStart(
          pluginState.selected,
          items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow: popupStartRow + 4 + Number(start > 0),
          itemCount: items.length,
          selectedIndex: pluginState.selected,
          windowSize,
        })
        if (index !== undefined) {
          app.dispatch({
            type: 'plugins.move',
            delta: index - pluginState.selected,
          })
          if (isPress) app.dispatch({ type: 'plugins.confirm' })
        }
        return
      }
      if (rewindOpen && rewindState !== undefined) {
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          REWIND_WINDOW_SIZE,
          6,
        )
        const start = listWindowStart(
          rewindState.selected,
          rewindState.items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow:
            popupStartRow +
            3 +
            Number(rewindState.confirming) +
            Number(start > 0),
          itemCount: rewindState.items.length,
          selectedIndex: rewindState.selected,
          windowSize,
        })
        if (index !== undefined) {
          if (index !== rewindState.selected && !rewindState.confirming) {
            app.dispatch({
              type: 'rewind.move',
              delta: index - rewindState.selected,
            })
          } else if (isPress) {
            app.dispatch({ type: 'rewind.confirm' })
          }
        }
        return
      }
      if (forkOpen && forkState !== undefined) {
        const windowSize = pickerWindowSize(
          layout.rows.overlay,
          REWIND_WINDOW_SIZE,
          6,
        )
        const start = listWindowStart(
          forkState.selected,
          forkState.items.length,
          windowSize,
        )
        const index = listItemIndexAtRow({
          row: hitRow,
          itemStartRow:
            popupStartRow +
            3 +
            Number(forkState.confirming) +
            Number(start > 0),
          itemCount: forkState.items.length,
          selectedIndex: forkState.selected,
          windowSize,
        })
        if (index !== undefined) {
          if (index !== forkState.selected && !forkState.confirming) {
            app.dispatch({
              type: 'fork.move',
              delta: index - forkState.selected,
            })
          } else if (isPress) {
            app.dispatch({ type: 'fork.confirm' })
          }
        }
        return
      }
      if (reviewOpen && snap.reviewPicker !== undefined) {
        if (snap.reviewPicker.phase === 'scope') {
          const index = listItemIndexAtRow({
            row: hitRow,
            itemStartRow: popupStartRow + 3,
            itemCount: snap.reviewPicker.scopes.length,
            selectedIndex: snap.reviewPicker.selected,
            windowSize: snap.reviewPicker.scopes.length,
          })
          if (index !== undefined) {
            app.dispatch({
              type: 'review.move',
              delta: index - snap.reviewPicker.selected,
            })
            if (isPress) app.dispatch({ type: 'review.confirm' })
          }
        } else if (
          isPress &&
          insidePopup &&
          snap.reviewPicker.phase === 'preview' &&
          event.y >= popupStartRow + layout.rows.overlay - 2
        ) {
          app.dispatch({ type: 'review.confirm' })
        }
        return
      }
      if (!isPress) return
      if (
        composerModelHit({
          row: event.y,
          x: event.x,
          titleRow: composerMetadataRow,
          modelStartColumn: composerHeader.modelStartColumn,
          modelEndColumn: composerHeader.modelEndColumn,
        })
      ) {
        openModelSwitch()
        return
      }
      if (event.y <= headerRows) {
        openCommandPalette()
        return
      }
    } finally {
      if (
        event.button !== 'wheel-up' &&
        event.button !== 'wheel-down' &&
        (event.action === 'press' ||
          event.action === 'move' ||
          event.action === 'release')
      ) {
        const available =
          !quitConfirmationOpen &&
          activeFooterOverlay === undefined &&
          !layout.tooSmall
        const insideInspector =
          wideInspector && event.x >= inspectorLayout.startColumn
        const overText =
          available &&
          !insideInspector &&
          messageAtMouseEvent(event) !== undefined
        mousePointerShape.current = applyMousePointerShape(
          props.mouseOutput ?? process.stdout,
          mousePointerForTranscript({
            available,
            dragging: messageSelectionDragging.current,
            overText,
          }),
          mousePointerShape.current,
        )
      }
    }
  }

  handleMouseEventRef.current = handleMouseEvent

  useEffect(() => {
    if (!mouseTrackingActive) return
    const output = props.mouseOutput ?? process.stdout
    const leave = enableMouseTracking(output)
    return () => {
      mousePointerShape.current = 'default'
      leave()
    }
  }, [mouseTrackingActive, props.mouseOutput])

  useEffect(() => {
    if (!mouseTrackingActive) return
    const mouseInput = props.mouseInput ?? process.stdin
    const decoder = createMouseDecoder((event) =>
      handleMouseEventRef.current(event),
    )
    const onData = (chunk: Buffer | string): void => decoder.feed(String(chunk))
    mouseInput.on('data', onData)
    return () => {
      mouseInput.off('data', onData)
      decoder.reset()
    }
  }, [mouseTrackingActive, props.mouseInput])

  useEffect(() => {
    setMessageScrollOffset((offset) => Math.min(offset, messageScrollMax))
  }, [messageScrollMax])

  useEffect(() => {
    setMessageScrollOffset(0)
    setExpandedMessageIds(new Set())
    messageSelectionDragging.current = false
    dispatchMessageSelection({ type: 'clear' })
  }, [snap.header.sessionId])

  useEffect(() => {
    setExpandedMessageIds((current) =>
      pruneExpandedMessageKeys(current, snap.nodes),
    )
  }, [snap.nodes])

  useEffect(() => {
    setSlashDismissed(false)
    setSlashIndex(0)
    setCommandArgumentDismissed(false)
    setCommandArgumentIndex(0)
    setFileDismissed(false)
    setFileIndex(0)
  }, [snap.composer.text])

  useEffect(() => {
    if (!messageSelectionActive) return
    if (selectableMessages.length === 0) {
      dispatchMessageSelection({ type: 'clear' })
      return
    }
    if (
      messageTextSelection === undefined ||
      selectedMessageId === null ||
      !selectableMessages.includes(selectedMessageId)
    ) {
      const latestMessageId =
        selectableMessages[selectableMessages.length - 1] ?? null
      if (latestMessageId !== null) {
        const latestNode = displayNodes.find(
          (node) => nodeKey(node.kind, node.id) === latestMessageId,
        )
        if (latestNode !== undefined) {
          dispatchMessageSelection({
            type: 'activateMessage',
            selectedNodeId: latestMessageId,
            text: selectableNodeText(latestNode, {
              verbose: snap.verbose,
              expandedNodeIds: expandedMessageIds,
            }),
          })
        }
      }
    }
  }, [
    displayNodes,
    expandedMessageIds,
    messageSelectionActive,
    messageTextSelection,
    selectableMessages,
    selectedMessageId,
    snap.verbose,
  ])

  useEffect(() => {
    if (!fileVisible || fileMention === undefined) {
      setFileItems([])
      setFileLoading(false)
      return
    }
    let active = true
    setFileLoading(true)
    void listWorkspaceEntries({ cwd: snap.header.cwd })
      .then((files) => {
        if (!active) return
        setFileItems(rankFileMatches(files, fileMention.query, 8))
      })
      .catch(() => {
        if (active) setFileItems([])
      })
      .finally(() => {
        if (active) setFileLoading(false)
      })
    return () => {
      active = false
    }
  }, [fileMention, fileVisible, snap.header.cwd])

  function openExternalEditor(): void {
    if (!isRawModeSupported) {
      setEditorError(text(snap.locale, 'editorUnavailable'))
      return
    }
    setEditorBusy(true)
    setEditorError(undefined)
    try {
      setRawMode(false)
    } catch {
      setEditorBusy(false)
      setEditorError(text(snap.locale, 'editorUnavailable'))
      return
    }
    void editDraft({ text: snap.composer.text })
      .then((edited) => {
        app.dispatch({ type: 'setDraft', text: edited })
      })
      .catch((error: unknown) => {
        setEditorError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        try {
          setRawMode(true)
        } catch {
          // The terminal may already be closing.
        }
        setEditorBusy(false)
      })
  }

  useInput((input, key) => {
    if (editorBusy) return
    if (isMouseInput(input)) return
    if (quitConfirmationOpen) {
      if (key.ctrl && input === 'c') app.dispatch({ type: 'interruptOrQuit' })
      else if (key.return) app.dispatch({ type: 'quit.confirm' })
      else if (key.escape) app.dispatch({ type: 'quit.cancel' })
      else if (key.leftArrow || key.rightArrow) {
        app.dispatch({ type: 'quit.move', delta: key.leftArrow ? -1 : 1 })
      }
      return
    }
    if (pluginOpen && pluginState !== undefined) {
      if (key.escape) {
        app.dispatch({ type: 'plugins.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'plugins.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return || input === ' ') {
        app.dispatch({ type: 'plugins.confirm' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'plugins.setQuery',
          query: pluginState.query.slice(0, -1),
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.meta && !key.super) {
        app.dispatch({
          type: 'plugins.setQuery',
          query: `${pluginState.query}${input}`,
        })
      }
      return
    }
    if (modelPickerOpen) {
      if (key.escape) {
        app.dispatch({ type: 'model.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'model.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return) {
        app.dispatch({ type: 'model.confirm' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'model.setQuery',
          query: snap.modelPicker?.query.slice(0, -1) ?? '',
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.meta && !key.super) {
        app.dispatch({
          type: 'model.setQuery',
          query: `${snap.modelPicker?.query ?? ''}${input}`,
        })
      }
      return
    }
    if (modelInputOpen) return
    if (effortOpen) {
      if (key.escape) {
        app.dispatch({ type: 'effort.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'effort.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return) {
        app.dispatch({ type: 'effort.confirm' })
        return
      }
      return
    }
    if (permissionOpen) {
      if (key.escape) {
        app.dispatch({ type: 'permission.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'permission.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return) {
        app.dispatch({ type: 'permission.confirm' })
        return
      }
      return
    }
    if (snap.helpOpen) {
      dispatchHelpInput(app, input, key)
      return
    }
    if (approvalOpen) return
    if (questionOpen) return
    if (reviewOpen) {
      dispatchPickerInput(app, 'review', key, false)
      return
    }
    if (commandPaletteOpen) {
      if (key.escape) {
        setCommandPaletteOpen(false)
        return
      }
      if (key.backspace || key.delete) {
        setCommandPaletteQuery((query) => query.slice(0, -1))
        setCommandPaletteIndex(0)
        return
      }
      if (key.upArrow || key.downArrow) {
        setCommandPaletteIndex((index) =>
          moveSelection(
            index,
            key.upArrow ? -1 : 1,
            commandPaletteItems.length,
          ),
        )
        return
      }
      if (key.return) {
        const item =
          commandPaletteItems[
            moveSelection(commandPaletteIndex, 0, commandPaletteItems.length)
          ]
        if (item !== undefined)
          app.dispatch({ type: 'command', line: `/${item.id}` })
        setCommandPaletteOpen(false)
        return
      }
      if (input !== '' && !key.ctrl && !key.meta && !key.super && !key.shift) {
        setCommandPaletteQuery((query) => `${query}${input}`)
        setCommandPaletteIndex(0)
      }
      return
    }
    const scrollUp = key.pageUp || (key.ctrl && key.upArrow)
    const scrollDown = key.pageDown || (key.ctrl && key.downArrow)
    const endKey = input === '\u001b[F' || input === '\u001b[4~'
    if (key.ctrl && endKey && !layout.tooSmall) {
      setMessageScrollOffset(0)
      setFollowTranscript(true)
      return
    }
    if (
      (scrollUp || scrollDown) &&
      !layout.tooSmall &&
      !rewindOpen &&
      !forkOpen &&
      !skillsOpen &&
      !pluginOpen &&
      !permissionOpen &&
      !effortOpen &&
      !resumeOpen &&
      !sessionTreeOpen &&
      !queueOpen &&
      !checklistOpen &&
      !historySearchOpen &&
      !messageSelectionActive &&
      !slashOpen &&
      !commandArgumentOpen &&
      !fileOpen &&
      !snap.helpOpen
    ) {
      if (noticeScrollMax > 0) {
        const pageRows = Math.max(1, Math.floor(noticeRowCount / 2))
        const delta = scrollDown ? pageRows : -pageRows
        setNoticeScrollOffset((offset) =>
          Math.max(0, Math.min(noticeScrollMax, offset + delta)),
        )
        return
      }
      const pageRows = Math.max(1, Math.floor(messageMaxRows / 2))
      const delta = scrollUp ? pageRows : -pageRows
      setMessageScrollOffset((offset) =>
        Math.max(0, Math.min(messageScrollMax, offset + delta)),
      )
      setFollowTranscript(scrollDown && messageScrollOffset <= Math.abs(delta))
      return
    }
    if (rewindOpen) {
      dispatchPickerInput(app, 'rewind', key, rewindState?.confirming ?? false)
      return
    }
    if (forkOpen) {
      dispatchPickerInput(app, 'fork', key, forkState?.confirming ?? false)
      return
    }
    if (skillsOpen) {
      if (key.escape) {
        app.dispatch({ type: 'skills.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'skills.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return) {
        app.dispatch({ type: 'skills.confirm' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'skills.setQuery',
          query: skillsState?.query.slice(0, -1) ?? '',
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.super) {
        app.dispatch({
          type: 'skills.setQuery',
          query: (skillsState?.query ?? '') + input,
        })
      }
      return
    }
    if (checklistOpen) {
      if (key.escape) {
        app.dispatch({ type: 'checklist.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'checklist.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      return
    }
    if (layout.tooSmall) {
      if (key.escape || (key.ctrl && (input === 'c' || input === 'd'))) {
        app.dispatch({ type: 'quit' })
      }
      return
    }
    if (
      snap.composer.disabled &&
      !snap.header.readOnly &&
      !key.ctrl &&
      !key.super &&
      input !== 'c'
    ) {
      if (key.escape || (key.ctrl && input === 'c')) {
        app.dispatch({ type: 'quit' })
      }
      return
    }

    if (snap.resumePicker?.open === true) {
      if (key.escape) {
        app.dispatch({ type: 'resume.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'resume.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return) {
        app.dispatch({ type: 'resume.confirm' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'resume.setQuery',
          query: snap.resumePicker.query.slice(0, -1),
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.super) {
        app.dispatch({
          type: 'resume.setQuery',
          query: snap.resumePicker.query + input,
        })
      }
      return
    }

    if (snap.sessionTreePicker?.open === true) {
      if (key.escape) {
        app.dispatch({ type: 'sessionTree.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'sessionTree.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return) {
        app.dispatch({ type: 'sessionTree.confirm' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'sessionTree.setQuery',
          query: snap.sessionTreePicker.query.slice(0, -1),
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.super) {
        app.dispatch({
          type: 'sessionTree.setQuery',
          query: snap.sessionTreePicker.query + input,
        })
      }
      return
    }

    if (snap.subagentPicker?.open === true) {
      if (key.escape) {
        app.dispatch({ type: 'subagents.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'subagents.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return) {
        app.dispatch({ type: 'subagents.confirm' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'subagents.setQuery',
          query: snap.subagentPicker.query.slice(0, -1),
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.super) {
        app.dispatch({
          type: 'subagents.setQuery',
          query: snap.subagentPicker.query + input,
        })
      }
      return
    }

    if (snap.remoteQueuePicker?.open === true) {
      if (key.escape) {
        app.dispatch({ type: 'remoteQueue.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'remoteQueue.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.ctrl && input === 'd') {
        app.dispatch({ type: 'remoteQueue.delete' })
        return
      }
      if (key.ctrl && input === 'r') {
        app.dispatch({ type: 'remoteQueue.steer' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'remoteQueue.setQuery',
          query: snap.remoteQueuePicker.query.slice(0, -1),
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.meta && !key.super) {
        app.dispatch({
          type: 'remoteQueue.setQuery',
          query: snap.remoteQueuePicker.query + input,
        })
      }
      return
    }

    if (snap.queuePicker?.open === true) {
      if (key.escape) {
        app.dispatch({ type: 'queue.close' })
        return
      }
      if (key.upArrow || key.downArrow) {
        app.dispatch({ type: 'queue.move', delta: key.upArrow ? -1 : 1 })
        return
      }
      if (key.return || (key.ctrl && input === 'r')) {
        app.dispatch({ type: 'queue.restore' })
        return
      }
      if (key.ctrl && input === 'd') {
        app.dispatch({ type: 'queue.delete' })
        return
      }
      if (key.backspace || key.delete) {
        app.dispatch({
          type: 'queue.setQuery',
          query: snap.queuePicker.query.slice(0, -1),
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.meta && !key.super) {
        app.dispatch({
          type: 'queue.setQuery',
          query: snap.queuePicker.query + input,
        })
        return
      }
      return
    }

    if (historySearchOpen) {
      if (key.escape) {
        setHistorySearchOpen(false)
        setHistoryQuery('')
        setHistoryIndex(0)
        return
      }
      if (key.upArrow) {
        setHistoryIndex((index) =>
          moveSelection(index, -1, historyItems.length),
        )
        return
      }
      if (key.downArrow) {
        setHistoryIndex((index) => moveSelection(index, 1, historyItems.length))
        return
      }
      if (key.return) {
        const selected =
          historyItems[moveSelection(historyIndex, 0, historyItems.length)]
        if (selected !== undefined)
          app.dispatch({ type: 'setDraft', text: selected })
        setHistorySearchOpen(false)
        setHistoryQuery('')
        setHistoryIndex(0)
        return
      }
      if (key.backspace || key.delete) {
        setHistoryQuery((query) => query.slice(0, -1))
        setHistoryIndex(0)
        return
      }
      if (input !== '' && !key.ctrl && !key.super) {
        setHistoryQuery((query) => query + input)
        setHistoryIndex(0)
      }
      return
    }

    const matched = matchKey(
      {
        raw: input,
        return: key.return,
        escape: key.escape,
        upArrow: key.upArrow,
        downArrow: key.downArrow,
        leftArrow: key.leftArrow,
        rightArrow: key.rightArrow,
        tab: key.tab,
        backspace: key.backspace,
        delete: key.delete,
        ctrl: key.ctrl,
        // Ink marks plain Escape as meta, but the keymap must treat it as Esc.
        alt: key.meta && !key.escape,
        shift: key.shift,
        empty: snap.composer.text === '',
      },
      keymap,
    )

    if (messageSelectionActive) {
      if (messageActionMenuOpen) {
        if (key.escape) {
          setMessageActionMenuOpen(false)
          return
        }
        if (key.upArrow || key.downArrow) {
          setMessageActionIndex((index) =>
            moveSelection(
              index,
              key.upArrow ? -1 : 1,
              messageActionItems.length,
            ),
          )
          return
        }
        if (key.return) {
          runMessageAction(
            messageActionItems[
              moveSelection(messageActionIndex, 0, messageActionItems.length)
            ],
          )
          return
        }
        return
      }
      if (key.escape) {
        messageSelectionDragging.current = false
        dispatchMessageSelection({ type: 'clear' })
        return
      }
      if (key.upArrow || key.downArrow) {
        const nextSelectedMessageId = moveMessageSelection(
          selectableMessages,
          selectedMessageId,
          key.upArrow ? -1 : 1,
        )
        if (nextSelectedMessageId !== null) {
          const nextNode = displayNodes.find(
            (node) => nodeKey(node.kind, node.id) === nextSelectedMessageId,
          )
          if (nextNode !== undefined) {
            dispatchMessageSelection({
              type: 'activateMessage',
              selectedNodeId: nextSelectedMessageId,
              text: selectableNodeText(nextNode, {
                verbose: snap.verbose,
                expandedNodeIds: expandedMessageIds,
              }),
            })
          }
          setMessageScrollOffset(
            scrollOffsetForMessage(
              displayNodes,
              messageMaxRows,
              nextSelectedMessageId,
              messageScrollOffset,
              snap.verbose,
              expandedMessageIds,
            ),
          )
        }
        return
      }
      if (matched?.id === 'transcript.toggleVerbose') {
        toggleSelectedMessageDetails()
        return
      }
      if (key.return && selectedMessageId !== null) {
        toggleSelectedMessageDetails()
        return
      }
      if (input === ' ' && selectedMessageId !== null) {
        toggleSelectedMessageDetails()
        return
      }
      if (input === 'm' && !key.ctrl && !key.meta && !key.super && !key.shift) {
        setMessageActionMenuOpen(true)
        setMessageActionIndex(0)
        return
      }
      if (
        isCopyShortcut(input, key) &&
        messageTextSelection !== undefined &&
        selectedMessageText !== ''
      ) {
        copySelectedMessages()
        return
      }
      if (key.ctrl && input === 'c') {
        app.dispatch({ type: 'interruptOrQuit' })
        return
      }
      return
    }

    if (snap.header.readOnly) {
      if (key.escape) {
        app.dispatch({ type: 'session.back' })
        return
      }
      if (key.ctrl && input === 'c') {
        app.dispatch({ type: 'quit' })
        return
      }
      if (
        matched?.id !== 'messages.select' &&
        matched?.id !== 'transcript.toggleVerbose'
      ) {
        return
      }
    }

    if (slashOpen) {
      if (key.escape) {
        setSlashDismissed(true)
        return
      }
      if (key.downArrow || key.tab) {
        if (key.tab) {
          const selected =
            slashItems[moveSlashSelection(slashIndex, 0, slashItems.length)]
          if (selected !== undefined) {
            app.dispatch({
              type: 'setDraft',
              text: slashCommandCompletion(selected),
            })
          }
          return
        }
        setSlashIndex((index) =>
          moveSlashSelection(index, 1, slashItems.length),
        )
        return
      }
      if (key.upArrow) {
        setSlashIndex((index) =>
          moveSlashSelection(index, -1, slashItems.length),
        )
        return
      }
      if (key.return) {
        const selected =
          slashItems[moveSlashSelection(slashIndex, 0, slashItems.length)]
        if (selected !== undefined) {
          app.dispatch({ type: 'command.select', line: `/${selected.name}` })
        }
        return
      }
    }

    if (commandArgumentOpen && commandArgumentState !== undefined) {
      if (key.escape) {
        setCommandArgumentDismissed(true)
        return
      }
      if (key.downArrow || key.upArrow) {
        setCommandArgumentIndex((index) =>
          moveSelection(
            index,
            key.upArrow ? -1 : 1,
            commandArgumentState.items.length,
          ),
        )
        return
      }
      if (key.tab) {
        const item =
          commandArgumentState.items[
            moveSelection(
              commandArgumentIndex,
              0,
              commandArgumentState.items.length,
            )
          ]
        if (item !== undefined)
          app.dispatch({ type: 'setDraft', text: item.insert })
        return
      }
      if (key.return) {
        const item =
          commandArgumentState.items[
            moveSelection(
              commandArgumentIndex,
              0,
              commandArgumentState.items.length,
            )
          ]
        if (item !== undefined) dispatchCommandArgumentCompletion(app, item)
        return
      }
    }

    if (fileOpen && fileMention !== undefined) {
      if (key.escape) {
        setFileDismissed(true)
        return
      }
      if (key.downArrow || key.tab) {
        setFileIndex((index) => moveSelection(index, 1, fileItems.length))
        return
      }
      if (key.upArrow) {
        setFileIndex((index) => moveSelection(index, -1, fileItems.length))
        return
      }
      if (key.return) {
        const selected =
          fileItems[moveSelection(fileIndex, 0, fileItems.length)]
        if (selected !== undefined) {
          app.dispatch({
            type: 'attachFile',
            start: fileMention.start,
            end: fileMention.end,
            path: selected,
          })
        }
        return
      }
    }

    if ((key.tab && key.shift) || (key.ctrl && input === 'm')) {
      app.dispatch({ type: 'permission.toggle' })
      return
    }

    if (key.tab && !key.shift && dispatchComposerTab(app, snap)) {
      return
    }

    if (key.super) {
      dispatchComposerShortcut(app, snap, input, key)
      return
    }

    if (matched !== undefined) {
      if (
        matched.id === 'session.interruptOrQuit' &&
        dispatchComposerShortcut(app, snap, input, key)
      ) {
        return
      }
      if (matched.emptyOnly === true && snap.composer.text !== '') return
      if (matched.id === 'editor.open') {
        openExternalEditor()
        return
      }
      if (matched.id === 'history.search') {
        setHistorySearchOpen(true)
        setHistoryQuery('')
        setHistoryIndex(0)
        return
      }
      if (matched.id === 'messages.select') {
        if (selectableMessages.length === 0) return
        const latestMessageId =
          selectableMessages[selectableMessages.length - 1]
        if (latestMessageId === undefined) return
        const latestNode = displayNodes.find(
          (node) => nodeKey(node.kind, node.id) === latestMessageId,
        )
        if (latestNode !== undefined) {
          dispatchMessageSelection({
            type: 'activateMessage',
            selectedNodeId: latestMessageId,
            text: selectableNodeText(latestNode, {
              verbose: snap.verbose,
              expandedNodeIds: expandedMessageIds,
            }),
          })
        }
        setMessageScrollOffset(
          scrollOffsetForMessage(
            displayNodes,
            messageMaxRows,
            latestMessageId,
            messageScrollOffset,
            snap.verbose,
            expandedMessageIds,
          ),
        )
        return
      }
      if (matched.id === 'command.palette') {
        openCommandPalette()
        return
      }
      dispatchKeyCommand(app, matched.id, snap.composer.text)
      return
    }
    if (dispatchComposerShortcut(app, snap, input, key)) {
      return
    }
    if (key.leftArrow) {
      app.dispatch({
        type: 'moveCursor',
        delta: -1,
        extendSelection: key.shift,
      })
      return
    }
    if (key.rightArrow) {
      app.dispatch({
        type: 'moveCursor',
        delta: 1,
        extendSelection: key.shift,
      })
      return
    }
    if (key.backspace || key.delete) {
      app.dispatch({ type: 'deleteBackward' })
      return
    }
    if (input === '') return
    if (
      input.length > 1 &&
      !key.ctrl &&
      !key.super &&
      !key.meta &&
      !key.shift
    ) {
      app.dispatch({ type: 'insertPastedInput', text: input })
      return
    }
    app.dispatch({ type: 'insertDraft', text: input })
  })

  if (layout.tooSmall) {
    return (
      <Box
        flexDirection="column"
        width={layout.paintColumns}
        height={viewportRows}
        overflowY="hidden"
      >
        <Text color={theme.accent} bold wrap="truncate-end">
          cocode · {text(snap.locale, 'terminalTooSmall')}
        </Text>
        {viewportRows > 1 ? (
          <Text color={theme.mute} wrap="truncate-end">
            {text(snap.locale, 'terminalResize', {
              current: String(viewportRows),
              required: String(layout.minimumRows),
            })}
          </Text>
        ) : null}
        {rewindOpen && rewindState !== undefined ? (
          <RewindPicker
            state={rewindState}
            locale={snap.locale}
            maxRows={Math.max(1, viewportRows - 2)}
          />
        ) : null}
        {forkOpen && forkState !== undefined ? (
          <ForkPicker
            state={forkState}
            locale={snap.locale}
            maxRows={Math.max(1, viewportRows - 2)}
          />
        ) : null}
      </Box>
    )
  }

  const overlays = quitConfirmationOpen ? (
    <QuitConfirmation
      locale={snap.locale}
      maxRows={layout.overlayRows}
      maxColumns={mainColumns}
      selection={snap.quitConfirmationSelection}
    />
  ) : (
    <>
      {slashOpen ? (
        <SlashMenu
          items={slashItems}
          selectedIndex={slashIndex}
          query={snap.composer.text.slice(1)}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {commandArgumentOpen && commandArgumentState !== undefined ? (
        <CommandArgumentMenu
          commandName={commandArgumentState.commandName}
          items={commandArgumentState.items}
          selectedIndex={commandArgumentIndex}
          query={commandArgumentState.query}
          locale={snap.locale}
          maxRows={layout.overlayRows}
        />
      ) : null}
      {fileOpen ? (
        <FileMenu
          items={fileItems}
          selectedIndex={fileIndex}
          query={fileMention?.query ?? ''}
          loading={fileLoading}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {historySearchOpen ? (
        <HistorySearch
          query={historyQuery}
          matches={historyItems}
          selectedIndex={historyIndex}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {snap.resumePicker?.open === true ? (
        <ResumePicker
          state={snap.resumePicker}
          currentSessionId={snap.header.sessionId}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {sessionTreeOpen && snap.sessionTreePicker !== undefined ? (
        <SessionTreePicker
          state={snap.sessionTreePicker}
          currentSessionId={snap.header.sessionId}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {subagentOpen && snap.subagentPicker !== undefined ? (
        <SubagentPicker
          state={snap.subagentPicker}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {queueOpen && snap.queuePicker !== undefined ? (
        <QueuePicker
          state={snap.queuePicker}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {snap.remoteQueuePicker?.open === true ? (
        <RemoteQueuePicker
          state={snap.remoteQueuePicker}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {checklistOpen && snap.checklist !== undefined ? (
        <ChecklistPanel
          state={snap.checklist}
          todos={snap.status.todos}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {rewindOpen ? (
        <RewindPicker
          state={rewindState}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {forkOpen && forkState !== undefined ? (
        <ForkPicker
          state={forkState}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {skillsOpen && skillsState !== undefined ? (
        <SkillsPicker
          state={skillsState}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {pluginOpen && pluginState !== undefined ? (
        <PluginsPicker
          state={pluginState}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {permissionOpen && snap.permissionPicker !== undefined ? (
        <PermissionPicker
          state={snap.permissionPicker}
          locale={snap.locale}
          maxRows={layout.overlayRows}
        />
      ) : null}
      {effortOpen && snap.effortPicker !== undefined ? (
        <EffortPicker
          state={snap.effortPicker}
          locale={snap.locale}
          maxRows={layout.overlayRows}
        />
      ) : null}
      {modelPickerOpen && snap.modelPicker !== undefined ? (
        <ModelPicker
          state={snap.modelPicker}
          currentProvider={snap.header.provider}
          currentModel={snap.header.model}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {modelInputOpen ? (
        <ModelSwitchPanel
          currentModel={snap.header.model}
          locale={snap.locale}
          onSubmit={(model) => {
            app.dispatch({ type: 'model.input.submit', model })
          }}
          onClose={() => app.dispatch({ type: 'model.input.close' })}
        />
      ) : null}
      {snap.question !== undefined ? (
        isPlanReviewQuestion(snap.question.question) ? (
          <PlanReviewPanel
            key={snap.question.key}
            state={snap.question}
            locale={snap.locale}
            panelStartRow={popupStartRow}
            maxRows={layout.rows.overlay}
            maxColumns={mainColumns}
            mousePointer={questionMousePointer}
            dispatch={app.dispatch}
          />
        ) : (
          <QuestionPanel
            key={snap.question.key}
            state={snap.question}
            locale={snap.locale}
            panelStartRow={popupStartRow}
            mousePointer={questionMousePointer}
            dispatch={app.dispatch}
          />
        )
      ) : null}
      {approvalOpen && snap.approval !== undefined ? (
        <ApprovalPanel
          state={snap.approval}
          locale={snap.locale}
          panelStartRow={popupStartRow}
          mousePointer={approvalMousePointer}
          dispatch={app.dispatch}
        />
      ) : null}
      {reviewOpen && snap.reviewPicker !== undefined ? (
        <ReviewPicker
          state={snap.reviewPicker}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {snap.helpOpen ? (
        <Help
          text={snap.helpText}
          locale={snap.locale}
          maxRows={layout.rows.overlay}
        />
      ) : null}
      {commandPaletteOpen ? (
        <ActionMenu
          title={snap.locale === 'zh' ? '命令菜单' : 'Command menu'}
          hint={
            snap.locale === 'zh'
              ? '↑↓ 选择 · 回车执行 · Esc 关闭'
              : '↑↓ select · enter run · esc close'
          }
          items={commandPaletteItems}
          selectedIndex={commandPaletteIndex}
          maxRows={layout.rows.overlay}
          query={commandPaletteQuery}
          queryPlaceholder={text(snap.locale, 'commandsFilter')}
          emptyLabel={snap.locale === 'zh' ? '没有可用命令' : 'No commands'}
        />
      ) : null}
      {messageActionMenuOpen ? (
        <ActionMenu
          title={snap.locale === 'zh' ? '消息操作' : 'Message actions'}
          hint={
            snap.locale === 'zh'
              ? '↑↓ 选择 · 回车执行 · Esc 关闭'
              : '↑↓ select · enter run · esc close'
          }
          items={messageActionItems}
          selectedIndex={messageActionIndex}
          maxRows={layout.rows.overlay}
          emptyLabel={snap.locale === 'zh' ? '没有可用操作' : 'No actions'}
        />
      ) : null}
    </>
  )

  return (
    <Box flexDirection="row" width={layout.paintColumns} height={viewportRows}>
      <Box
        flexDirection="column"
        height={viewportRows}
        width={mainColumns}
        minWidth={0}
        minHeight={0}
        flexGrow={0}
        overflowY="hidden"
      >
        <Header
          header={snap.header}
          locale={snap.locale}
          columns={mainColumns}
          status={snap.status}
        />
        <MessageList
          nodes={displayNodes}
          verbose={snap.verbose}
          maxRows={messageMaxRows}
          scrollOffset={messageScrollOffset}
          selectedNodeId={
            messageSelectionActive ? selectedMessageId : undefined
          }
          textSelection={
            messageSelectionActive ? messageTextSelection : undefined
          }
          expandedNodeIds={expandedMessageIds}
          expandedNodeLevels={expandedMessageLevels}
          locale={snap.locale}
          maxColumns={mainColumns}
        />
        <ChecklistStrip
          todos={snap.status.todos}
          locale={snap.locale}
          maxItems={wideInspector ? CHECKLIST_STRIP_MAX_ITEMS : 2}
        />
        <StatusLine
          status={snap.status}
          agent={snap.agent}
          notice={snap.notice}
          locale={snap.locale}
          noticeRows={noticeRowCount}
          noticeScrollOffset={noticeScrollOffset}
        />
        {editorBusy ? (
          <Text color={theme.accent} wrap="truncate-end">
            {text(snap.locale, 'editorOpening')}
          </Text>
        ) : null}
        {editorError !== undefined ? (
          <Text color={theme.danger} wrap="truncate-end">
            {editorError}
          </Text>
        ) : null}
        {layout.rows.overlay > 0 ? (
          <Box
            flexDirection="column"
            height={layout.rows.overlay}
            overflowY="hidden"
          >
            {overlays}
          </Box>
        ) : null}
        <Composer
          composer={snap.composer}
          agent={snap.agent}
          planMode={snap.status.planMode}
          planModeAvailable={snap.capabilities.planMode}
          provider={snap.header.provider}
          model={snap.header.model}
          reasoningEffort={snap.header.reasoningEffort}
          locale={snap.locale}
          maxRows={layout.composerInputRows}
          maxColumns={mainColumns}
          // composerMetadataRow is 1-based; adding summary rows yields the
          // 0-based Ink row of the first input line.
          inputRow={composerMetadataRow + layout.composerAttachmentRows}
        />
        <Box
          flexShrink={0}
          width={mainColumns}
          marginTop={Math.max(0, layout.rows.footer - 1)}
        >
          <Text wrap="truncate-end">
            {resolvedFooter.hints.map((hint, index) => (
              <Fragment key={hint.id}>
                {index > 0 ? <Text color={theme.border}> · </Text> : null}
                {hint.shortcut !== undefined ? (
                  <Text color={theme.text} bold>{hint.shortcut}</Text>
                ) : null}
                {hint.shortcut !== undefined ? ' ' : null}
                <Text color={theme.dim}>{hint.label}</Text>
              </Fragment>
            ))}
          </Text>
        </Box>
      </Box>
      {wideInspector ? (
        <Inspector
          snapshot={snap}
          locale={snap.locale}
          maxRows={viewportRows}
          width={inspectorLayout.width}
          resizing={inspectorResize.resizing}
          mouseInput={inspectorMouseInput}
        />
      ) : null}
    </Box>
  )
}

function hasStatusDetails(status: TuiSnapshot['status']): boolean {
  return (
    status.telemetry.activity !== undefined ||
    status.todos.length > 0 ||
    status.goal !== undefined ||
    status.agentPreset !== undefined ||
    status.transcript !== undefined
  )
}

function reviewRowsFor(state: TuiSnapshot['reviewPicker']): number {
  if (state === undefined) return 0
  if (!state.open) return 0
  if (state.phase === 'scope') return state.scopes.length + 5
  if (state.phase === 'loading') return 7
  return Math.min(16, state.review.files.length + 8)
}

function questionPanelRows(
  state: NonNullable<TuiSnapshot['question']>,
): number {
  const options = state.question.options ?? []
  const optionRows = options.reduce(
    (rows, option) => rows + 1 + Number(option.description !== undefined),
    0,
  )
  return 7 + Number(state.total > 1) + Number(state.question.customInput !== false ? 3 : 0) + Number(state.question.detail !== undefined) + optionRows
}

function overlayWindowSize(
  maxRows: number,
  itemCount: number,
  chromeRows: number,
): number {
  return Math.max(1, Math.min(itemCount, Math.trunc(maxRows) - chromeRows))
}

function pickerWindowSize(
  maxRows: number,
  windowSize: number,
  chromeRows = 7,
): number {
  return Math.max(1, Math.min(windowSize, Math.trunc(maxRows) - chromeRows))
}
