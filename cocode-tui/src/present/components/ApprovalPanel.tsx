import { Text, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'
import type { TuiAction, TuiApprovalSnapshot } from '../../runtime/app-contracts.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { glyphs } from '../glyphs.ts'
import { selectionStyle } from '../selection.ts'
import { theme } from '../theme.ts'
import { sanitizeSingleLine } from '../text-format.ts'
import { isMouseInput, type TuiMousePointer } from '../mouse.ts'
import { approvalActionAtRow } from '../mouse-hit.ts'
import { PanelFrame } from './PanelFrame.tsx'

const APPROVAL_ACTIONS = ['allowed-once', 'allowed-for-turn', 'rejected'] as const

type ApprovalChoice = (typeof APPROVAL_ACTIONS)[number]

function cycleApprovalAction(current: ApprovalChoice, delta: 1 | -1): ApprovalChoice {
  const index = APPROVAL_ACTIONS.indexOf(current)
  const next = (index + delta + APPROVAL_ACTIONS.length) % APPROVAL_ACTIONS.length
  return APPROVAL_ACTIONS[next] ?? current
}

export function ApprovalPanel(props: {
  state: TuiApprovalSnapshot
  locale: UiLocale
  panelStartRow: number
  mousePointer?: TuiMousePointer
  dispatch: (action: TuiAction) => void
}) {
  const [selectedAction, setSelectedAction] = useState<ApprovalChoice>('allowed-once')
  const [inputReady, setInputReady] = useState(false)
  const lastPointerId = useRef(props.mousePointer?.id)

  useEffect(() => {
    setInputReady(false)
    setSelectedAction('allowed-once')
    lastPointerId.current = props.mousePointer?.id
    const timer = setTimeout(() => setInputReady(true), 700)
    return () => clearTimeout(timer)
  }, [props.state.request.callId, props.state.request.toolName])

  useEffect(() => {
    const pointer = props.mousePointer
    if (!inputReady || pointer === undefined || pointer.id === lastPointerId.current) return
    lastPointerId.current = pointer.id
    const action = approvalActionAtRow(pointer.row, props.panelStartRow)
    if (action !== undefined) setSelectedAction(action)
    if (pointer.action === 'press' && action !== undefined) {
      props.dispatch({ type: 'approval.answer', outcome: action })
    }
  }, [inputReady, props])

  useInput((input, key) => {
    if (!inputReady) return
    if (key.upArrow) {
      setSelectedAction((current) => cycleApprovalAction(current, -1))
      return
    }
    if (key.downArrow || key.tab) {
      setSelectedAction((current) => cycleApprovalAction(current, 1))
      return
    }
    if (isMouseInput(input)) return
    if (key.escape || (key.ctrl && input === 'c')) {
      props.dispatch({ type: 'approval.cancel' })
      return
    }
    if (key.return) {
      props.dispatch({ type: 'approval.answer', outcome: selectedAction })
      return
    }
    if (input === 'a') {
      props.dispatch({ type: 'approval.answer', outcome: 'allowed-once' })
      return
    }
    if (input === 't') {
      props.dispatch({ type: 'approval.answer', outcome: 'allowed-for-turn' })
      return
    }
    if (input === 'd' || input === 'n') {
      props.dispatch({ type: 'approval.answer', outcome: 'rejected' })
    }
  })

  const request = props.state.request
  return (
    <PanelFrame
      title={text(props.locale, 'approvalTitle')}
      footer={
        inputReady
          ? text(props.locale, 'approvalHint')
          : props.locale === 'zh'
          ? '请稍候…'
          : 'Please wait…'
      }
      borderColor={theme.warning}
    >
      <Text color={theme.text} wrap="truncate-end">
        {sanitizeSingleLine(request.toolName)}
      </Text>
      <Text color={theme.dim} wrap="truncate-end">
        {text(props.locale, 'approvalTarget')}:{' '}
        {sanitizeSingleLine(request.target ?? text(props.locale, 'approvalUnavailableValue'))}
      </Text>
      <Text color={theme.dim} wrap="truncate-end">
        {text(props.locale, 'approvalRisk')}:{' '}
        {sanitizeSingleLine(
          request.risk ?? request.reason ?? text(props.locale, 'approvalUnavailableValue'),
        )}
      </Text>
      <Text color={theme.dim} wrap="truncate-end">
        {text(props.locale, 'approvalSource')}: {sanitizeSingleLine(request.source ?? 'runtime')}
      </Text>
      <ApprovalAction
        active={selectedAction === 'allowed-once'}
        label={props.locale === 'zh' ? '允许一次' : 'Allow once'}
        shortcut="a"
      />
      <ApprovalAction
        active={selectedAction === 'allowed-for-turn'}
        label={props.locale === 'zh' ? '本轮允许' : 'Allow for turn'}
        shortcut="t"
      />
      <ApprovalAction
        active={selectedAction === 'rejected'}
        label={props.locale === 'zh' ? '拒绝' : 'Deny'}
        shortcut="d / n"
      />
    </PanelFrame>
  )
}

function ApprovalAction(props: { active: boolean; label: string; shortcut: string }) {
  return (
    <Text {...selectionStyle(props.active)} wrap="truncate-end">
      {props.active ? glyphs.optionActive : glyphs.optionInactive} {props.label}{' '}
      <Text color={theme.dim}>{props.shortcut}</Text>
    </Text>
  )
}
