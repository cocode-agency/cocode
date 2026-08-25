import { resolveLocale } from './errors/locale.ts'

export type UiLocale = 'zh' | 'en'

export type UiTextKey =
  | 'session'
  | 'tokensIn'
  | 'tokensOut'
  | 'tokensInShort'
  | 'tokensOutShort'
  | 'usageEmpty'
  | 'usageCache'
  | 'usageContext'
  | 'usageTotals'
  | 'runtimeContextDetail'
  | 'secret'
  | 'prompt'
  | 'runtimeContextDetail'
  | 'locked'
  | 'send'
  | 'attached'
  | 'imageReading'
  | 'imageAttached'
  | 'imageClipboardUnavailable'
  | 'imageClipboardEmpty'
  | 'imageTooLarge'
  | 'imageUnsupported'
  | 'imageRuntimeUnavailable'
  | 'imageCountLimit'
  | 'commandImagesUnsupported'
  | 'commandRunning'
  | 'commandDone'
  | 'commandFailed'
  | 'commandTitle'
  | 'history'
  | 'historyHint'
  | 'historyPlaceholder'
  | 'historyEmpty'
  | 'files'
  | 'filesHint'
  | 'filesSearching'
  | 'commands'
  | 'commandsHint'
  | 'commandsFilter'
  | 'commandsEmpty'
  | 'commandArgumentsHint'
  | 'commandArgumentsFilter'
  | 'commandArgumentsEmpty'
  | 'help'
  | 'helpHint'
  | 'messageMode'
  | 'messageModeHint'
  | 'modeBuild'
  | 'modePlan'
  | 'modeSwitchHint'
  | 'footerHistory'
  | 'footerScroll'
  | 'footerMessages'
  | 'footerMenu'
  | 'footerDetails'
  | 'footerHelp'
  | 'footerQuit'
  | 'footerReadOnlyQuit'
  | 'footerReadOnlyBack'
  | 'footerRunning'
  | 'footerQueueDraft'
  | 'footerRedraw'
  | 'footerModel'
  | 'quitTitle'
  | 'quitConfirm'
  | 'quitCancel'
  | 'quitHint'
  | 'farewell'
  | 'footerSend'
  | 'footerNewline'
  | 'footerMove'
  | 'footerConfirm'
  | 'footerCancel'
  | 'footerClose'
  | 'footerSearch'
  | 'footerSelect'
  | 'footerUse'
  | 'footerRun'
  | 'footerToggle'
  | 'footerCopyMessages'
  | 'footerMessageActions'
  | 'footerMessageExpand'
  | 'footerMessageCollapse'
  | 'footerHistoryLabel'
  | 'footerDetailsLabel'
  | 'footerHelpLabel'
  | 'footerQuitLabel'
  | 'footerRunningLabel'
  | 'footerRedrawLabel'
  | 'footerModelLabel'
  | 'agentIdle'
  | 'agentRunning'
  | 'agentThinking'
  | 'agentStarting'
  | 'agentDead'
  | 'assistantInterrupted'
  | 'emptyTitle'
  | 'emptyHint'
  | 'langChanged'
  | 'langUsage'
  | 'modelUsage'
  | 'modelBusy'
  | 'modelSwitching'
  | 'modelChanged'
  | 'modelChangedFresh'
  | 'modelRestored'
  | 'modelRestoredFresh'
  | 'modelSwitchTitle'
  | 'modelSwitchCurrent'
  | 'modelSwitchHint'
  | 'modelSwitchPlaceholder'
  | 'modelCatalogTitle'
  | 'modelCatalogHint'
  | 'modelCatalogQuery'
  | 'modelCatalogEmpty'
  | 'modelCatalogLoading'
  | 'modelCatalogUnavailable'
  | 'modelCatalogFailed'
  | 'modelCatalogPartial'
  | 'effortTitle'
  | 'effortHint'
  | 'effortCurrent'
  | 'effortEmpty'
  | 'effortUnavailable'
  | 'effortChanged'
  | 'effortUsage'
  | 'effortApplying'
  | 'effortDefault'
  | 'resumeTitle'
  | 'resumeHint'
  | 'resumeQuery'
  | 'resumeEmpty'
  | 'resumeNoSummary'
  | 'resumeLoading'
  | 'resumeLoaded'
  | 'resumeUnavailable'
  | 'skillsTitle'
  | 'skillsHint'
  | 'skillsQuery'
  | 'skillsEmpty'
  | 'skillsUnavailable'
  | 'skillReady'
  | 'pluginsTitle'
  | 'pluginsHint'
  | 'pluginsQuery'
  | 'pluginsEmpty'
  | 'pluginsEnabled'
  | 'pluginsDisabled'
  | 'pluginsToggling'
  | 'questionTitle'
  | 'questionHint'
  | 'questionSingleHint'
  | 'questionCustom'
  | 'questionMultiHint'
  | 'questionSelectHint'
  | 'questionOptionHint'
  | 'questionStreaming'
  | 'questionReady'
  | 'questionUnavailable'
  | 'workspaceAuthorizationTitle'
  | 'workspaceAuthorizationQuestion'
  | 'workspaceAuthorizationAllow'
  | 'workspaceAuthorizationAllowDescription'
  | 'workspaceAuthorizationCancel'
  | 'workspaceAuthorizationCancelDescription'
  | 'workspaceAuthorizationCancelled'
  | 'workspaceAuthorizationUnavailable'
  | 'rewindTitle'
  | 'rewindHint'
  | 'rewindArm'
  | 'rewindEmpty'
  | 'rewindLoading'
  | 'rewindLoaded'
  | 'forkLoading'
  | 'rewindConfirm'
  | 'rewindUnavailable'
  | 'subagentsRunning'
  | 'subagentStarted'
  | 'subagentFinished'
  | 'queueCount'
  | 'queueAdded'
  | 'queueFull'
  | 'queueSending'
  | 'queueTitle'
  | 'queueHint'
  | 'queueQuery'
  | 'queueEmpty'
  | 'queueAttachments'
  | 'queueDeleted'
  | 'queueRestored'
  | 'checklistTitle'
  | 'checklistHint'
  | 'checklistEmpty'
  | 'checklistMore'
  | 'turnComplete'
  | 'turnBusy'
  | 'sessionChanging'
  | 'cancelRequested'
  | 'cancelNotRunning'
  | 'cancelFailed'
  | 'telemetryTps'
  | 'telemetryCache'
  | 'telemetryReasoning'
  | 'telemetryActivity'
  | 'todoProgress'
  | 'goalPhase'
  | 'agentPreset'
  | 'transcriptTrimmed'
  | 'editorOpening'
  | 'editorUnavailable'
  | 'terminalTooSmall'
  | 'terminalResize'
  | 'inspector'
  | 'inspectorActivity'
  | 'inspectorContext'
  | 'inspectorFiles'
  | 'inspectorSession'
  | 'inspectorShortcuts'
  | 'inspectorEmpty'
  | 'inspectorGoal'
  | 'inspectorTodos'
  | 'inspectorRuntime'
  | 'inspectorSkills'
  | 'inspectorCapabilities'
  | 'inspectorRuntimeName'
  | 'inspectorMcp'
  | 'inspectorCapabilitySource'
  | 'inspectorAvailable'
  | 'inspectorUnavailable'
  | 'inspectorNotReported'
  | 'inspectorLoadedSkill'
  | 'inspectorNone'
  | 'inspectorEnabled'
  | 'inspectorDisabled'
  | 'inspectorStatus'
  | 'inspectorAgents'
  | 'inspectorQueue'
  | 'inspectorTokens'
  | 'inspectorWindow'
  | 'inspectorCache'
  | 'inspectorSpeed'
  | 'inspectorReasoning'
  | 'inspectorCwd'
  | 'inspectorNoAttachments'
  | 'inspectorModel'
  | 'inspectorId'
  | 'inspectorTitle'
  | 'inspectorPreset'
  | 'questionSubmit'
  | 'questionNewline'
  | 'questionExit'
  | 'copySuccess'
  | 'copyEmpty'
  | 'copyUnavailable'
  | 'focusStatusOn'
  | 'focusEnabled'
  | 'focusDisabled'
  | 'reviewTitle'
  | 'reviewHint'
  | 'reviewLoading'
  | 'reviewPreview'
  | 'reviewScopeWorkingTree'
  | 'reviewScopeStaged'
  | 'reviewScopeLastCommit'
  | 'reviewScopeBranch'
  | 'reviewConfirm'
  | 'reviewEmpty'
  | 'reviewFailed'
  | 'reviewSending'
  | 'reviewUsage'
  | 'reviewBinary'
  | 'reviewUntracked'
  | 'reviewTruncated'
  | 'reviewDiffFolded'
  | 'reviewFilesFolded'
  | 'reviewTextFolded'
  | 'reviewSummary'
  | 'reviewOmittedFiles'
  | 'approvalTitle'
  | 'approvalHint'
  | 'approvalAllowed'
  | 'approvalAllowedForTurn'
  | 'approvalRejected'
  | 'approvalUnavailable'
  | 'approvalTimedOut'
  | 'approvalTarget'
  | 'approvalRisk'
  | 'approvalSource'
  | 'approvalUnavailableValue'
  | 'permissionUnavailable'
  | 'permissionChanged'
  | 'permissionTitle'
  | 'permissionHint'
  | 'permissionCurrent'
  | 'permissionEmpty'
  | 'permissionApplying'
  | 'planUnavailable'
  | 'planEnabled'
  | 'planDisabled'
  | 'planReviewTitle'
  | 'planReviewHint'
  | 'planReviewPreview'
  | 'planReviewEmpty'
  | 'planReviewFooter'
  | 'planStreaming'
  | 'planReady'
  | 'steerSending'
  | 'forkUnavailable'
  | 'forkCreated'
  | 'forkTitle'
  | 'forkHint'
  | 'forkConfirm'
  | 'forkEmpty'
  | 'sessionTreeUnavailable'
  | 'sessionTreeEmpty'
  | 'sessionTreeTitle'
  | 'sessionTreeHint'
  | 'sessionTreeLegend'
  | 'sessionTreeQuery'
  | 'sessionTreeLoading'
  | 'sessionTreeOpenFailed'
  | 'returningPreviousSession'
  | 'returnedToPreviousSession'

const TEXT: Record<UiLocale, Record<UiTextKey, string>> = {
  en: {
    session: 'session',
    tokensIn: 'tokens in',
    tokensOut: 'out',
    tokensInShort: 'in',
    tokensOutShort: 'out',
    usageEmpty: 'No token usage is available for this session.',
    usageCache: 'cache read {read} · cache write {write}',
    usageContext: 'context {percent}% / {window}',
    usageTotals: 'session total {input} in · {output} out',
    secret: 'secret',
    prompt: 'prompt',
    runtimeContextDetail: 'press Enter to view details',
    locked: 'locked',
    send: 'enter to send',
    attached: 'attached',
    imageReading: 'Reading image from the clipboard…',
    imageAttached: 'Attached {name}.',
    imageClipboardUnavailable: 'Image clipboard access is unavailable on this system.',
    imageClipboardEmpty: 'The clipboard does not contain an image.',
    imageTooLarge: 'Clipboard image exceeds the 5 MiB limit.',
    imageUnsupported: 'Clipboard image format is not supported.',
    imageRuntimeUnavailable: 'This runtime cannot store image attachments.',
    imageCountLimit: 'A prompt can contain at most 20 images.',
    commandImagesUnsupported: '/{command} does not accept image attachments. Remove them before running the command.',
    commandRunning: 'running',
    commandDone: 'done',
    commandFailed: 'failed',
    commandTitle: 'command',
    history: 'history',
    historyHint: 'ctrl+r · ↑↓ select · enter use · esc close',
    historyPlaceholder: 'type to search…',
    historyEmpty: 'No matching messages',
    files: 'files',
    filesHint: 'tab / ↑↓ select',
    filesSearching: ' searching workspace…',
    commands: 'commands',
    commandsHint: '↑↓ select · tab complete · enter use · esc close',
    commandsFilter: 'type to filter',
    commandsEmpty: 'No matching commands',
    commandArgumentsHint: '↑↓ select · tab complete · enter use · esc close',
    commandArgumentsFilter: 'argument to complete',
    commandArgumentsEmpty: 'No matching argument choices',
    help: 'help',
    helpHint: 'esc close',
    messageMode: 'message mode',
    messageModeHint: '↑↓ move · m menu · c copy · esc close',
    modeBuild: 'Build',
    modePlan: 'Plan',
    modeSwitchHint: 'tab switch mode',
    footerHistory: '↑↓ history',
    footerScroll: 'pgup / pgdn scroll',
    footerMessages: 'shift+↑ messages',
    footerMenu: 'ctrl+p menu',
    footerDetails: 'ctrl+o details',
    footerHelp: '? help',
    footerQuit: 'esc interrupt / quit',
    footerReadOnlyQuit: 'Ctrl+C quit',
    footerReadOnlyBack: 'Esc back',
    footerRunning: 'esc interrupt',
    footerQueueDraft: 'tab queue draft',
    footerRedraw: 'redraw: /redraw',
    footerModel: 'ctrl+l model',
    quitTitle: 'Are you sure you want to quit?',
    quitConfirm: 'Enter · Yep!',
    quitCancel: 'Esc · Nope',
    quitHint: '←→ switch · Enter confirm · Esc cancel · Ctrl+C twice exits',
    farewell: 'Thanks for using Cocode!',
    footerSend: 'send',
    footerNewline: 'new line',
    footerMove: '↑↓ move',
    footerConfirm: 'enter confirm',
    footerCancel: 'esc cancel',
    footerClose: 'esc close',
    footerSearch: 'type to search',
    footerSelect: '↑↓ select',
    footerUse: 'enter use',
    footerRun: 'enter run',
    footerToggle: 'space toggle',
    footerCopyMessages: 'Ctrl+C copy',
    footerMessageActions: 'M actions',
    footerMessageExpand: 'or enter expand details',
    footerMessageCollapse: 'or enter collapse details',
    footerHistoryLabel: 'history',
    footerDetailsLabel: 'details',
    footerHelpLabel: 'help',
    footerQuitLabel: 'interrupt / quit',
    footerRunningLabel: 'interrupt',
    footerRedrawLabel: '/redraw redraw',
    footerModelLabel: 'model',
    agentIdle: 'ready',
    agentRunning: 'running',
    agentThinking: 'thinking…',
    agentStarting: 'connecting…',
    agentDead: 'runtime stopped',
    assistantInterrupted: 'interrupted',
    emptyTitle: 'cocode is ready',
    emptyHint: 'Ask a question or describe a task to start.',
    langChanged: 'Language: {lang}',
    langUsage: 'Use /lang zh or /lang en.',
    modelUsage: 'Use /model <model-id>.',
    modelBusy: 'Turn in progress. Wait before changing model.',
    modelSwitching: 'Switching model to {model}…',
    modelChanged: 'Model changed to {model}; current session continued.',
    modelChangedFresh: 'Model changed to {model}. This runtime cannot switch models in the current session, so a new session was started.',
    modelRestored: 'Model switch failed; restored {model}.',
    modelRestoredFresh: 'Model switch failed. Restored {model} in a new session.',
    modelSwitchTitle: 'Switch model',
    modelSwitchCurrent: 'current: {model}',
    modelSwitchHint: 'type a model id · enter apply · esc close',
    modelSwitchPlaceholder: 'model id',
    modelCatalogTitle: 'Available models',
    modelCatalogHint: 'type to filter · ↑↓ select · enter apply · esc close',
    modelCatalogQuery: 'filter: {query}',
    modelCatalogEmpty: 'No model catalog is available; enter a model id manually.',
    modelCatalogLoading: 'Loading model catalog…',
    modelCatalogUnavailable: 'This runtime has no model catalog; enter a model id manually.',
    modelCatalogFailed: 'Could not load model catalog',
    modelCatalogPartial: 'Some providers could not be listed.',
    effortTitle: 'Reasoning effort',
    effortHint: '↑↓ select · enter apply · esc close',
    effortCurrent: 'current: {effort}',
    effortEmpty: 'This model provides no reasoning effort levels.',
    effortUnavailable: 'Could not change reasoning effort',
    effortChanged: 'Reasoning effort set to {effort}.',
    effortUsage: 'Use /effort <level>, /effort auto, or /effort.',
    effortApplying: 'Applying…',
    effortDefault: 'Default',
    resumeTitle: 'Recent sessions',
    resumeHint: 'type to filter · ↑↓ select · enter choose · esc close',
    resumeQuery: 'filter: {query}',
    resumeEmpty: 'No sessions found for this workspace.',
    resumeNoSummary: 'No summary',
    resumeLoading: 'Loading session history…',
    resumeLoaded: 'Resumed session {session}.',
    resumeUnavailable: 'Cannot resume session {session}: the session file is unavailable.',
    skillsTitle: 'Workspace skills',
    skillsHint: 'type to filter · ↑↓ select · enter use · esc close',
    skillsQuery: 'filter: {query}',
    skillsEmpty: 'No user-invocable skills found.',
    skillsUnavailable: 'Skills are unavailable in this runtime.',
    skillReady: 'Skill /{name} is ready in the composer.',
    pluginsTitle: 'Runtime plugins',
    pluginsHint: 'type to filter · ↑↓ select · enter/space toggle · esc close',
    pluginsQuery: 'filter: {query}',
    pluginsEmpty: 'No plugins match the current filter.',
    pluginsEnabled: 'enabled',
    pluginsDisabled: 'disabled',
    pluginsToggling: 'updating…',
    questionTitle: 'Question',
    questionHint: '↑↓ move · ←→ switch',
    questionSingleHint: '↑↓ choose',
    questionCustom: 'Type another answer',
    questionMultiHint: 'space toggles · tab custom',
    questionSelectHint: 'tab custom',
    questionOptionHint: '↑↓ choose',
    questionStreaming: 'question is streaming…',
    questionReady: 'question ready for interaction',
    questionUnavailable: 'Question text unavailable',
    workspaceAuthorizationTitle: 'Workspace access',
    workspaceAuthorizationQuestion: 'Allow Cocode to register the current directory as a workspace?',
    workspaceAuthorizationAllow: 'Allow',
    workspaceAuthorizationAllowDescription: 'Create the workspace and attach this session.',
    workspaceAuthorizationCancel: 'Cancel',
    workspaceAuthorizationCancelDescription: 'Cancel without creating a workspace or session.',
    workspaceAuthorizationCancelled: 'Workspace authorization was cancelled.',
    workspaceAuthorizationUnavailable: 'Workspace authorization could not be completed.',
    rewindTitle: 'Rewind conversation',
    rewindHint: '↑↓ select · enter review · esc close',
    rewindArm: 'Press Esc again to choose a rewind point.',
    rewindEmpty: 'No user messages available to rewind.',
    rewindLoading: 'Creating a rewind session…',
    rewindLoaded: 'Rewind ready. Edit the draft and press enter to resend.',
    forkLoading: 'Creating a child session…',
    rewindConfirm: 'Rewind to this message? Press enter again to confirm · esc cancel',
    rewindUnavailable: 'Rewind is unavailable.',
    subagentsRunning: '{count} subagents running',
    subagentStarted: 'subagent {id} started',
    subagentFinished: 'subagent {id} finished',
    queueCount: 'queued {count}',
    queueAdded: 'Queued prompt ({count}); it will send when the current turn finishes.',
    queueFull: 'Prompt queue is full (8).',
    queueSending: 'Sending queued prompt…',
    queueTitle: 'Prompt queue',
    queueHint: 'type to filter · ↑↓ select · enter prioritize/retry · ctrl+d remove · esc close',
    queueQuery: 'filter: {query}',
    queueEmpty: 'No queued prompts.',
    queueAttachments: '{count} attachments',
    queueDeleted: 'Queued prompt deleted.',
    queueRestored: 'Queued prompt restored to the front of the queue.',
    checklistTitle: 'Checklist',
    checklistHint: '↑↓ select · esc close',
    checklistEmpty: 'No tasks in the current turn.',
    checklistMore: '… {count} more',
    turnComplete: 'Turn complete',
    turnBusy: 'Turn in progress. Press Tab to queue this prompt.',
    sessionChanging: 'Session is changing. Wait for it to finish.',
    cancelRequested: 'Cancel requested; waiting for the runtime to become idle.',
    cancelNotRunning: 'No active turn to cancel.',
    cancelFailed: 'Cancel request failed',
    telemetryTps: '{value} tok/s',
    telemetryCache: 'cache {value}%',
    telemetryReasoning: 'reasoning {value}',
    telemetryActivity: '{phase}: {line}',
    todoProgress: 'todos {done}/{total}',
    goalPhase: 'goal {phase}',
    agentPreset: 'preset {name}',
    transcriptTrimmed: 'older nodes hidden {count}',
    editorOpening: 'opening draft in $EDITOR…',
    editorUnavailable: 'external editor unavailable',
    terminalTooSmall: 'terminal is too small',
    terminalResize: 'resize from {current} to at least {required} rows · esc quit',
    inspector: 'inspector',
    inspectorActivity: 'activity',
    inspectorContext: 'context',
    inspectorFiles: 'files',
    inspectorSession: 'session',
    inspectorShortcuts: 'shortcuts',
    inspectorEmpty: 'no active details',
    inspectorGoal: 'goal',
    inspectorTodos: 'todos',
    inspectorRuntime: 'runtime / MCP',
    inspectorSkills: 'skills',
    inspectorCapabilities: 'capabilities',
    inspectorRuntimeName: 'runtime',
    inspectorMcp: 'MCP / companion',
    inspectorCapabilitySource: 'capability source',
    inspectorAvailable: 'available',
    inspectorUnavailable: 'unavailable',
    inspectorNotReported: 'not reported',
    inspectorLoadedSkill: 'loaded skill',
    inspectorNone: 'none',
    inspectorEnabled: 'on',
    inspectorDisabled: 'off',
    inspectorStatus: 'status',
    inspectorAgents: 'agents',
    inspectorQueue: 'queue',
    inspectorTokens: 'tokens',
    inspectorWindow: 'window',
    inspectorCache: 'cache',
    inspectorSpeed: 'speed',
    inspectorReasoning: 'reasoning',
    inspectorCwd: 'cwd',
    inspectorNoAttachments: 'no attachments',
    inspectorModel: 'model',
    inspectorId: 'id',
    inspectorTitle: 'title',
    inspectorPreset: 'preset',
    questionSubmit: 'enter submit',
    questionNewline: 'shift+enter newline',
    questionExit: 'esc exit',
    copySuccess: 'Copied to clipboard.',
    copyEmpty: 'There is no message text to copy.',
    copyUnavailable: 'Clipboard unavailable on this terminal.',
    focusStatusOn: 'focus: latest turn',
    focusEnabled: 'Focus mode enabled: showing the latest turn.',
    focusDisabled: 'Focus mode disabled: showing the full transcript.',
    reviewTitle: 'Code review',
    reviewHint: '↑↓ select · enter continue · esc close',
    reviewLoading: 'Collecting a read-only Git diff…',
    reviewPreview: 'enter send to Cocode · esc close',
    reviewScopeWorkingTree: 'working tree (staged + unstaged)',
    reviewScopeStaged: 'staged changes',
    reviewScopeLastCommit: 'last commit',
    reviewScopeBranch: 'current branch vs base',
    reviewConfirm: 'Review this diff? Press enter to send · esc cancel',
    reviewEmpty: 'No changes found for this review scope.',
    reviewFailed: 'Review unavailable',
    reviewSending: 'Sending review context…',
    reviewUsage: 'Use /review, /review working-tree, staged, last-commit, or branch [base].',
    reviewBinary: 'binary',
    reviewUntracked: 'untracked',
    reviewTruncated: 'truncated',
    reviewDiffFolded: 'diff lines folded',
    reviewFilesFolded: 'files folded',
    reviewTextFolded: 'diff text folded',
    reviewSummary: '{files} files · +{additions}/-{deletions}{binary}{truncated}',
    reviewOmittedFiles: '… {count} untracked files omitted',
    approvalTitle: 'Approval required',
    approvalHint: '↑↓ choose · enter confirm · a once · t turn · d/n reject · esc',
    approvalAllowed: 'Tool allowed once.',
    approvalAllowedForTurn: 'Tool allowed for this turn.',
    approvalRejected: 'Tool request rejected.',
    approvalUnavailable: 'Approval is unavailable; the tool request was not allowed.',
    approvalTimedOut: 'Approval timed out; the tool request was cancelled.',
    approvalTarget: 'target',
    approvalRisk: 'risk',
    approvalSource: 'source',
    approvalUnavailableValue: 'unavailable',
    permissionUnavailable: 'Permission modes are unavailable in this runtime.',
    permissionChanged: 'Permission mode: {mode}',
    permissionTitle: 'Permission preset',
    permissionHint: '↑↓ select · enter apply · esc close',
    permissionCurrent: 'current: {mode}',
    permissionEmpty: 'No permission presets are available.',
    permissionApplying: 'Applying permission preset…',
    planUnavailable: 'Plan mode is unavailable in this runtime.',
    planEnabled: 'Plan mode enabled.',
    planDisabled: 'Plan mode disabled.',
    planReviewTitle: 'Plan review',
    planReviewHint: '↑↓ choose · wheel/pgup/pgdn scroll · enter confirm · esc cancel',
    planReviewPreview: 'Plan preview',
    planReviewEmpty: 'The plan preview is empty.',
    planReviewFooter: '↑↓ choose an action · wheel/PgUp/PgDn scroll · Enter confirm · Esc cancel',
    planStreaming: 'plan is streaming…',
    planReady: 'plan ready for review',
    steerSending: 'Sending follow-up at the next tool boundary…',
    forkUnavailable: 'Session fork is unavailable or the turn is still running.',
    forkCreated: 'Created a child session from the current conversation.',
    forkTitle: 'Fork session',
    forkHint: '↑↓ select user message · enter confirm · esc close',
    forkConfirm: 'Fork from this message? Press enter again to confirm · esc cancel',
    forkEmpty: 'No previous user message can be used as a fork boundary.',
    sessionTreeUnavailable: 'Runtime session tree is unavailable.',
    sessionTreeEmpty: 'No runtime sessions found.',
    sessionTreeTitle: 'Sessions',
    sessionTreeHint: 'type to filter · ↑↓ select · enter open · esc close',
    sessionTreeLegend: '{done} current · {running} running · {idle} idle',
    sessionTreeQuery: 'filter: {query}',
    sessionTreeLoading: 'Loading sessions…',
    sessionTreeOpenFailed: 'The runtime could not open this session.',
    returningPreviousSession: 'Returning to the previous session…',
    returnedToPreviousSession: 'Returned to the previous session.',
  },
  zh: {
    session: '会话',
    tokensIn: '输入 token',
    tokensOut: '输出',
    tokensInShort: '输入',
    tokensOutShort: '输出',
    usageEmpty: '当前会话暂无 token 用量。',
    usageCache: '缓存读取 {read} · 缓存写入 {write}',
    usageContext: 'context {percent}% / {window}',
    usageTotals: '会话累计输入 {input} · 输出 {output}',
    secret: '密钥',
    prompt: '输入',
    runtimeContextDetail: '按回车查看详情',
    locked: '已锁定',
    send: '回车发送',
    attached: '已附加',
    imageReading: '正在读取剪贴板图片…',
    imageAttached: '已附加图片 {name}。',
    imageClipboardUnavailable: '当前系统无法读取图片剪贴板。',
    imageClipboardEmpty: '剪贴板中没有图片。',
    imageTooLarge: '剪贴板图片超过 5 MiB 限制。',
    imageUnsupported: '不支持剪贴板中的图片格式。',
    imageRuntimeUnavailable: '当前运行时无法存储图片附件。',
    imageCountLimit: '一条输入最多包含 20 张图片。',
    commandImagesUnsupported: '/{command} 不接受图片附件，请先移除图片。',
    commandRunning: '运行中',
    commandDone: '已完成',
    commandFailed: '失败',
    commandTitle: '命令',
    history: '历史搜索',
    historyHint: 'Ctrl+R · ↑↓ 选择 · 回车使用 · Esc 关闭',
    historyPlaceholder: '输入关键词搜索…',
    historyEmpty: '没有匹配的消息',
    files: '文件',
    filesHint: 'Tab / ↑↓ 选择',
    filesSearching: ' 正在搜索工作区…',
    commands: '命令',
    commandsHint: '↑↓ 选择 · Tab 补全 · 回车使用 · Esc 关闭',
    commandsFilter: '输入关键词筛选',
    commandsEmpty: '没有匹配的命令',
    commandArgumentsHint: '↑↓ 选择 · Tab 补全 · 回车执行 · Esc 关闭',
    commandArgumentsFilter: '输入参数进行补全',
    commandArgumentsEmpty: '没有匹配的参数选项',
    help: '帮助',
    helpHint: 'Esc 关闭',
    messageMode: '消息模式',
    messageModeHint: '↑↓ 移动 · m 菜单 · c 复制 · Esc 关闭',
    modeBuild: 'Build',
    modePlan: 'Plan',
    modeSwitchHint: 'Tab 切换模式',
    footerHistory: '↑↓ 历史',
    footerScroll: 'PageUp / PageDown 滚动',
    footerMessages: 'Shift+↑ 消息',
    footerMenu: 'Ctrl+P 菜单',
    footerDetails: 'Ctrl+O 详情',
    footerHelp: '? 帮助',
    footerQuit: 'Esc 中断 / 退出',
    footerReadOnlyQuit: 'Ctrl+C 退出',
    footerReadOnlyBack: 'Esc 返回',
    footerRunning: '按 Esc 终止',
    footerQueueDraft: '按 Tab 加入队列',
    footerRedraw: '重绘：/redraw',
    footerModel: 'Ctrl+L 模型',
    quitTitle: '确定要退出吗？',
    quitConfirm: '回车 · 确认',
    quitCancel: 'Esc · 取消',
    quitHint: '←→ 切换 · 回车确认 · Esc 取消 · 再按 Ctrl+C 直接退出',
    farewell: '感谢使用 Cocode！',
    footerSend: '发送',
    footerNewline: '换行',
    footerMove: '↑↓ 移动',
    footerConfirm: '回车确认',
    footerCancel: 'Esc 取消',
    footerClose: 'Esc 关闭',
    footerSearch: '输入搜索',
    footerSelect: '↑↓ 选择',
    footerUse: '回车使用',
    footerRun: '回车执行',
    footerToggle: '空格切换',
    footerCopyMessages: 'Ctrl+C 复制',
    footerMessageActions: 'M 操作',
    footerMessageExpand: '或回车展开详情',
    footerMessageCollapse: '或回车收起详情',
    footerHistoryLabel: '历史',
    footerDetailsLabel: '详情',
    footerHelpLabel: '帮助',
    footerQuitLabel: '中断 / 退出',
    footerRunningLabel: '中断',
    footerRedrawLabel: '/redraw 重绘',
    footerModelLabel: '模型',
    agentIdle: '就绪',
    agentRunning: '运行中',
    agentThinking: '思考中…',
    agentStarting: '连接中…',
    agentDead: '运行时已停止',
    assistantInterrupted: '已中断',
    emptyTitle: 'cocode 已准备好',
    emptyHint: '输入问题或描述任务，开始工作。',
    langChanged: '界面语言：{lang}',
    langUsage: '使用 /lang zh 或 /lang en。',
    modelUsage: '使用 /model <model-id>。',
    modelBusy: '当前任务仍在运行，请等待任务结束后再切换模型。',
    modelSwitching: '正在切换模型到 {model}…',
    modelChanged: '已切换到 {model}，继续使用当前会话。',
    modelChangedFresh: '已切换到 {model}。当前运行时不支持在原会话中切换模型，因此已创建新会话。',
    modelRestored: '模型切换失败，已恢复为 {model}。',
    modelRestoredFresh: '模型切换失败，已在新会话中恢复为 {model}。',
    modelSwitchTitle: '切换模型',
    modelSwitchCurrent: '当前：{model}',
    modelSwitchHint: '输入模型名称 · 回车应用 · Esc 关闭',
    modelSwitchPlaceholder: '模型名称',
    modelCatalogTitle: '可用模型',
    modelCatalogHint: '输入过滤 · ↑↓ 选择 · 回车应用 · Esc 关闭',
    modelCatalogQuery: '筛选：{query}',
    modelCatalogEmpty: '没有可用的模型目录，请手动输入模型名称。',
    modelCatalogLoading: '正在加载模型目录…',
    modelCatalogUnavailable: '当前 runtime 不提供模型目录，请手动输入模型名称。',
    modelCatalogFailed: '模型目录加载失败',
    modelCatalogPartial: '部分 provider 无法列出模型。',
    effortTitle: '推理强度',
    effortHint: '↑↓ 选择 · 回车应用 · Esc 关闭',
    effortCurrent: '当前：{effort}',
    effortEmpty: '当前模型未提供推理强度档位。',
    effortUnavailable: '无法更改推理强度',
    effortChanged: '推理强度已设为 {effort}。',
    effortUsage: '使用 /effort <档位>、/effort auto，或 /effort 打开选择器。',
    effortApplying: '正在应用…',
    effortDefault: '默认',
    resumeTitle: '最近会话',
    resumeHint: '输入关键词过滤 · ↑↓ 选择 · 回车确认 · Esc 关闭',
    resumeQuery: '筛选：{query}',
    resumeEmpty: '当前工作区没有可用的历史会话。',
    resumeNoSummary: '无摘要',
    resumeLoading: '正在加载会话历史…',
    resumeLoaded: '已恢复会话 {session}。',
    resumeUnavailable: '无法恢复会话 {session}：会话文件不可用。',
    skillsTitle: '工作区技能',
    skillsHint: '输入过滤 · ↑↓ 选择 · 回车使用 · Esc 关闭',
    skillsQuery: '筛选：{query}',
    skillsEmpty: '当前运行时没有可调用的技能。',
    skillsUnavailable: '当前运行时未配置 Skills。',
    skillReady: '技能 /{name} 已写入输入区。',
    pluginsTitle: '运行时插件',
    pluginsHint: '输入过滤 · ↑↓ 选择 · 回车/空格切换 · Esc 关闭',
    pluginsQuery: '筛选：{query}',
    pluginsEmpty: '没有匹配的插件。',
    pluginsEnabled: '已启用',
    pluginsDisabled: '已禁用',
    pluginsToggling: '正在更新…',
    questionTitle: '需要确认',
    questionHint: '↑↓ 移动 · ←→ 切换问题',
    questionSingleHint: '↑↓ 选择',
    questionCustom: '输入其他答案',
    questionMultiHint: '空格勾选 · Tab 输入其他答案',
    questionSelectHint: 'Tab 输入其他答案',
    questionOptionHint: '↑↓ 选择',
    questionStreaming: '问题生成中…',
    questionReady: '问题已生成，等待交互',
    questionUnavailable: '问题内容暂不可用',
    workspaceAuthorizationTitle: '工作区授权',
    workspaceAuthorizationQuestion: '是否允许 Cocode 将当前目录注册为工作区？',
    workspaceAuthorizationAllow: '允许',
    workspaceAuthorizationAllowDescription: '创建工作区并绑定当前会话。',
    workspaceAuthorizationCancel: '取消',
    workspaceAuthorizationCancelDescription: '取消操作，不创建工作区或会话。',
    workspaceAuthorizationCancelled: '已取消工作区授权。',
    workspaceAuthorizationUnavailable: '工作区授权未完成。',
    rewindTitle: '回滚会话',
    rewindHint: '↑↓ 选择 · 回车预览 · Esc 关闭',
    rewindArm: '再次按 Esc 选择回滚位置。',
    rewindEmpty: '没有可回滚的用户消息。',
    rewindLoading: '正在创建回滚会话…',
    rewindLoaded: '已准备回滚草稿，修改后按回车重新发送。',
    forkLoading: '正在创建子会话…',
    rewindConfirm: '确定回滚到这条消息？再次回车确认 · Esc 取消',
    rewindUnavailable: '当前无法回滚。',
    subagentsRunning: '{count} 个子代理运行中',
    subagentStarted: '子代理 {id} 已启动',
    subagentFinished: '子代理 {id} 已完成',
    queueCount: '待处理 {count}',
    queueAdded: '已加入队列（{count} 条），当前任务结束后自动发送。',
    queueFull: '输入队列已满（最多 8 条）。',
    queueSending: '正在发送队列中的输入…',
    queueTitle: '输入队列',
    queueHint: '输入过滤 · ↑↓ 选择 · Enter 置顶/重试 · Ctrl+D 删除 · Esc 关闭',
    queueQuery: '筛选：{query}',
    queueEmpty: '当前没有排队中的输入。',
    queueAttachments: '{count} 个附件',
    queueDeleted: '已删除队列中的输入。',
    queueRestored: '已将队列输入恢复到队首。',
    checklistTitle: '任务清单',
    checklistHint: '↑↓ 选择 · Esc 关闭',
    checklistEmpty: '当前回合没有任务。',
    checklistMore: '… 还有 {count} 项',
    turnComplete: '本轮任务已完成',
    turnBusy: '当前任务仍在运行，按 Tab 可将输入加入队列。',
    sessionChanging: '正在切换会话，请等待当前操作完成。',
    cancelRequested: '已请求取消，等待运行时进入空闲状态。',
    cancelNotRunning: '当前没有可取消的任务。',
    cancelFailed: '取消请求失败',
    telemetryTps: '{value} tok/s',
    telemetryCache: '缓存命中 {value}%',
    telemetryReasoning: '推理 {value}',
    telemetryActivity: '{phase}：{line}',
    todoProgress: '待办 {done}/{total}',
    goalPhase: '目标 {phase}',
    agentPreset: '预设 {name}',
    transcriptTrimmed: '已隐藏较早节点 {count} 个',
    editorOpening: '正在 $EDITOR 中编辑草稿…',
    editorUnavailable: '外部编辑器不可用',
    terminalTooSmall: '终端高度不足',
    terminalResize: '当前 {current} 行，至少需要 {required} 行 · Esc 退出',
    inspector: '详情',
    inspectorActivity: '活动',
    inspectorContext: '上下文',
    inspectorFiles: '文件',
    inspectorSession: '会话',
    inspectorShortcuts: '快捷键',
    inspectorEmpty: '暂无活动详情',
    inspectorGoal: '目标',
    inspectorTodos: '待办',
    inspectorRuntime: '运行时 / MCP',
    inspectorSkills: 'Skills',
    inspectorCapabilities: '能力',
    inspectorRuntimeName: '运行时',
    inspectorMcp: 'MCP / companion',
    inspectorCapabilitySource: '能力来源',
    inspectorAvailable: '可用',
    inspectorUnavailable: '不可用',
    inspectorNotReported: '未提供',
    inspectorLoadedSkill: '当前 Skill',
    inspectorNone: '无',
    inspectorEnabled: '开启',
    inspectorDisabled: '关闭',
    inspectorStatus: '状态',
    inspectorAgents: '代理',
    inspectorQueue: '队列',
    inspectorTokens: 'token',
    inspectorWindow: '窗口',
    inspectorCache: '缓存',
    inspectorSpeed: '速度',
    inspectorReasoning: '推理',
    inspectorCwd: '工作目录',
    inspectorNoAttachments: '无附件',
    inspectorModel: '模型',
    inspectorId: 'ID',
    inspectorTitle: '标题',
    inspectorPreset: '预设',
    questionSubmit: '回车提交',
    questionNewline: 'Shift+Enter 换行',
    questionExit: 'Esc 退出',
    copySuccess: '已复制到剪贴板。',
    copyEmpty: '没有可复制的消息文本。',
    copyUnavailable: '当前终端无法使用剪贴板。',
    focusStatusOn: '聚焦：最近一轮',
    focusEnabled: '已开启聚焦模式：仅显示最近一轮。',
    focusDisabled: '已关闭聚焦模式：显示完整会话。',
    reviewTitle: '代码 Review',
    reviewHint: '↑↓ 选择 · 回车继续 · Esc 关闭',
    reviewLoading: '正在读取只读 Git Diff…',
    reviewPreview: '回车发送给 Cocode · Esc 关闭',
    reviewScopeWorkingTree: '工作树（已暂存 + 未暂存）',
    reviewScopeStaged: '已暂存改动',
    reviewScopeLastCommit: '最近一次提交',
    reviewScopeBranch: '当前分支相对基线',
    reviewConfirm: '确认 Review 这份 Diff？回车发送 · Esc 取消',
    reviewEmpty: '当前 Review 范围没有改动。',
    reviewFailed: 'Review 不可用',
    reviewSending: '正在发送 Review 上下文…',
    reviewUsage: '使用 /review、/review working-tree、staged、last-commit 或 branch [base]。',
    reviewBinary: '二进制',
    reviewUntracked: '未跟踪',
    reviewTruncated: '已截断',
    reviewDiffFolded: 'Diff 行已折叠',
    reviewFilesFolded: '个文件已折叠',
    reviewTextFolded: 'Diff 文本已折叠',
    reviewSummary: '{files} 个文件 · +{additions}/-{deletions}{binary}{truncated}',
    reviewOmittedFiles: '… {count} 个未跟踪文件未展示',
    approvalTitle: '需要审批',
    approvalHint: '↑↓ 选择 · 回车确认 · a 一次 · t 本轮 · d/n 拒绝 · Esc',
    approvalAllowed: '已允许本次工具调用。',
    approvalAllowedForTurn: '已允许本轮中的工具调用。',
    approvalRejected: '已拒绝工具调用。',
    approvalUnavailable: '审批不可用，工具调用未获允许。',
    approvalTimedOut: '审批超时，工具调用已取消。',
    approvalTarget: '目标',
    approvalRisk: '风险',
    approvalSource: '来源',
    approvalUnavailableValue: '不可用',
    permissionUnavailable: '当前运行时不支持权限模式。',
    permissionChanged: '权限模式：{mode}',
    permissionTitle: '权限 preset',
    permissionHint: '↑↓ 选择 · 回车应用 · Esc 关闭',
    permissionCurrent: '当前：{mode}',
    permissionEmpty: '当前没有可用的权限 preset。',
    permissionApplying: '正在应用权限 preset…',
    planUnavailable: '当前运行时不支持计划模式。',
    planEnabled: '已启用计划模式。',
    planDisabled: '已关闭计划模式。',
    planReviewTitle: '计划审阅',
    planReviewHint: '↑↓ 选择 · 滚轮/PgUp/PgDn 滚动 · 回车确认 · Esc 取消',
    planReviewPreview: '计划预览',
    planReviewEmpty: '计划内容为空。',
    planReviewFooter: '↑↓ 选择操作 · 滚轮/PgUp/PgDn 滚动 · 回车确认 · Esc 取消',
    planStreaming: '计划生成中…',
    planReady: '计划已生成，等待审阅',
    steerSending: '将在下一个工具步骤完成后发送后续输入……',
    forkUnavailable: '当前无法创建会话分支，或任务仍在运行。',
    forkCreated: '已从当前对话创建子会话。',
    forkTitle: '创建子会话',
    forkHint: '↑↓ 选择用户消息 · 回车确认 · Esc 关闭',
    forkConfirm: '从这条消息创建分支？再次回车确认 · Esc 取消',
    forkEmpty: '没有可用于创建分支边界的历史用户消息。',
    sessionTreeUnavailable: '当前运行时不支持会话树。',
    sessionTreeEmpty: '没有找到运行时会话。',
    sessionTreeTitle: '会话列表',
    sessionTreeHint: '输入过滤 · ↑↓ 选择 · 回车打开 · Esc 关闭',
    sessionTreeLegend: '{done} 当前 · {running} 运行中 · {idle} 空闲',
    sessionTreeQuery: '筛选：{query}',
    sessionTreeLoading: '正在加载会话列表……',
    sessionTreeOpenFailed: '运行时无法打开该会话。',
    returningPreviousSession: '正在返回上一个会话……',
    returnedToPreviousSession: '已返回上一个会话。',
  },
}

export function parseUiLocale(value: string | undefined): UiLocale | undefined {
  const language = value?.trim().toLowerCase().split(/[._-]/)[0]
  return language === 'zh' || language === 'en' ? language : undefined
}

export function resolveUiLocale(env: NodeJS.ProcessEnv = process.env): UiLocale {
  return resolveLocale(env)
}

export function text(locale: UiLocale, key: UiTextKey, params?: Record<string, string>): string {
  let value = TEXT[locale][key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, replacement)
  }
  return value
}

export function localeName(locale: UiLocale): string {
  return locale === 'zh' ? '中文' : 'English'
}
