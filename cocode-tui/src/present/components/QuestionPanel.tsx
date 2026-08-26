import { Box, Text, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'
import type { TuiQuestionSnapshot, TuiAction } from '../../runtime/app-contracts.ts'
import {
  questionTabLabel,
  type TuiQuestionTab,
} from '../../runtime/question-coordinator.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { glyphs } from '../glyphs.ts'
import { selectionStyle } from '../selection.ts'
import { theme } from '../theme.ts'
import { isMouseInput, type TuiMousePointer } from '../mouse.ts'
import { questionCustomRow, questionOptionIndexAtRow } from '../mouse-hit.ts'
import { PanelFrame } from './PanelFrame.tsx'

export function QuestionPanel(props: {
  state: TuiQuestionSnapshot
  locale: UiLocale
  panelStartRow: number
  mousePointer?: TuiMousePointer
  dispatch: (action: TuiAction) => void
}) {
  const options = props.state.question.options ?? []
  const allowCustom = props.state.question.customInput !== false
  const inputIndex = options.length
  const multiSelect = props.state.question.multiSelect === true
  const savedAnswer = props.state.answer
  const savedSelected = new Set(
    (savedAnswer?.selected ?? [])
      .map((label) => options.findIndex((option) => option.label === label))
      .filter((index) => index >= 0),
  )
  const [focus, setFocus] = useState(() => {
    const selectedIndex = [...savedSelected][0]
    if (selectedIndex !== undefined) return selectedIndex
    return allowCustom && savedAnswer?.custom !== undefined ? inputIndex : 0
  })
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => savedSelected)
  const [custom, setCustom] = useState(() => savedAnswer?.custom ?? '')
  const [dirty, setDirty] = useState(false)
  const inputFocused = allowCustom && focus === inputIndex
  const focusCount = options.length + Number(allowCustom)
  const lastOptionFocus = useRef(0)
  if (focus < options.length) lastOptionFocus.current = focus
  const customLines = custom.split('\n')
  const visibleCustomLines = customLines.slice(-3)
  const lastPointerId = useRef(props.mousePointer?.id)
  const tabs = props.state.total > 1 ? props.state.tabs ?? [fallbackTab(props.state)] : []
  const firstOptionRow = props.panelStartRow + 6 + Number(tabs.length > 0) + Number(props.state.question.detail !== undefined)
  const prompt = questionPrompt(props.state.question, text(props.locale, 'questionUnavailable'))

  useEffect(() => {
    const selectedIndex = [...savedSelected][0]
    setFocus(selectedIndex ?? (allowCustom && savedAnswer?.custom !== undefined ? inputIndex : 0))
    setSelected(savedSelected)
    setCustom(savedAnswer?.custom ?? '')
    setDirty(false)
    lastOptionFocus.current = selectedIndex ?? 0
  }, [allowCustom, inputIndex, props.state.key])

  useEffect(() => {
    const pointer = props.mousePointer
    if (pointer === undefined || pointer.id === lastPointerId.current) return
    lastPointerId.current = pointer.id
    const optionHasDescription = options.map((option) => option.description !== undefined)
    const optionIndex = questionOptionIndexAtRow({
      row: pointer.row,
      firstOptionRow,
      optionHasDescription,
    })
    if (optionIndex !== undefined) {
      setFocus(optionIndex)
      if (pointer.action === 'move') return
      const option = options[optionIndex]
      if (option === undefined) return
      if (multiSelect) {
        setSelected((current) => {
          const next = new Set(current)
          if (next.has(optionIndex)) next.delete(optionIndex)
          else next.add(optionIndex)
          return next
        })
        setDirty(true)
      } else {
        setSelected(new Set([optionIndex]))
        setDirty(true)
      }
      return
    }
    if (allowCustom) {
      const customRow = questionCustomRow({ firstOptionRow, optionHasDescription })
      if (pointer.row >= customRow && pointer.row <= customRow + 2) {
        setFocus(inputIndex)
      }
    }
  }, [allowCustom, firstOptionRow, inputIndex, multiSelect, options, props])

  useInput((input, key) => {
    if (isMouseInput(input)) return
    if (key.escape || (key.ctrl && input === 'c')) {
      props.dispatch({ type: 'question.cancel' })
      return
    }
    if (props.state.total > 1 && (key.leftArrow || key.rightArrow)) {
      props.dispatch({
        type: 'question.navigate',
        direction: key.leftArrow ? 'previous' : 'next',
        selected: [...selected]
          .sort((a, b) => a - b)
          .map((index) => options[index]?.label)
          .filter((label): label is string => label !== undefined),
        ...(custom.trim() === '' ? {} : { custom: custom.trim() }),
        dirty,
      })
      return
    }
    if (key.upArrow) {
      if (focusCount === 0) return
      setFocus((current) => (current - 1 + focusCount) % focusCount)
      return
    }
    if (key.downArrow || key.tab) {
      if (focusCount === 0) return
      setFocus((current) => (current + 1) % focusCount)
      return
    }
    if (!inputFocused && multiSelect && input === ' ') {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(focus)) next.delete(focus)
        else next.add(focus)
        return next
      })
      setDirty(true)
      return
    }
    if (inputFocused && (key.backspace || key.delete)) {
      setCustom((value) => value.slice(0, -1))
      setDirty(true)
      return
    }
    if (inputFocused && key.return && key.shift) {
      setCustom((value) => `${value}\n`)
      setDirty(true)
      return
    }
    if (key.return) {
      const trimmedCustom = custom.trim()
      if (allowCustom && trimmedCustom !== '') {
        props.dispatch({
          type: 'question.answer',
          selected: multiSelect
            ? [...selected]
                .sort((a, b) => a - b)
                .map((index) => options[index]?.label)
                .filter((label): label is string => label !== undefined)
            : [],
          custom: trimmedCustom,
        })
        return
      }
      if (multiSelect) {
        if (selected.size === 0) return
        props.dispatch({
          type: 'question.answer',
          selected: [...selected]
            .sort((a, b) => a - b)
            .map((index) => options[index]?.label)
            .filter((label): label is string => label !== undefined),
        })
        return
      }
      const option = options[inputFocused ? lastOptionFocus.current : focus]
      if (option === undefined) return
      props.dispatch({ type: 'question.answer', selected: [option.label] })
      return
    }
    if (allowCustom && inputFocused && input !== '' && !key.ctrl && !key.meta && !key.super) {
      setCustom((value) => value + input)
      setDirty(true)
    }
  })

  return (
    <PanelFrame
      title={text(props.locale, 'questionTitle')}
      hint={`${props.state.total > 1 ? `${props.state.position}/${props.state.total} · ` : ''}${text(props.locale, props.state.total > 1 ? 'questionHint' : 'questionSingleHint')}`}
      borderColor={theme.border}
      footer={
        [
          text(props.locale, 'questionSubmit'),
          ...(allowCustom ? [text(props.locale, 'questionNewline')] : []),
          text(props.locale, 'questionExit'),
          multiSelect
            ? text(props.locale, 'questionMultiHint')
            : allowCustom
              ? text(props.locale, 'questionSelectHint')
              : text(props.locale, 'questionOptionHint'),
        ].join(' · ')
      }
    >
      {tabs.length > 0 ? (
        <Box flexDirection="row" gap={1}>
          {tabs.map((tab) => {
            const active = tab.position === props.state.position
            return (
              <Text
                key={`${tab.position}-${tab.label}`}
                color={active ? theme.accent : tab.answered ? theme.dim : theme.mute}
                backgroundColor={active ? theme.accentSoft : undefined}
                bold={active}
                wrap="truncate-end"
              >
                {active
                  ? glyphs.optionActive
                  : tab.answered
                  ? glyphs.checkDone
                  : glyphs.optionInactive}{' '}
                {tab.position}. {tab.label}
              </Text>
            )
          })}
        </Box>
      ) : null}
      <Box flexDirection="row" marginTop={1}>
        <Text color={theme.accent} bold>
          {glyphs.railSelected}
        </Text>
        <Box flexDirection="column" marginLeft={1}>
          <Text color={theme.text} bold wrap="truncate-end">
            {prompt}
          </Text>
          {props.state.question.detail !== undefined ? (
            <Text color={theme.dim} wrap="truncate-end">
              {props.state.question.detail}
            </Text>
          ) : null}
        </Box>
      </Box>
      {options.map((option, index) => {
        const active = focus === index
        const checked = multiSelect ? selected.has(index) : active
        return (
          <Box key={option.label} flexDirection="column">
            <Text {...selectionStyle(active)} wrap="truncate-end">
              {active ? glyphs.optionActive : glyphs.optionInactive}{' '}
              {checked ? glyphs.checkActive : glyphs.checkTodo} {option.label}
            </Text>
            {option.description !== undefined ? (
              <Text color={theme.dim} wrap="truncate-end">
                {' '}
                {option.description}
              </Text>
            ) : null}
          </Box>
        )
      })}
      {allowCustom ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={inputFocused ? theme.accent : theme.dim}>
            {inputFocused ? glyphs.rail : ' '} {glyphs.editMark}{' '}
            {text(props.locale, 'questionCustom')}
          </Text>
          {visibleCustomLines.map((line, index) => (
            <Text
              key={`${index}-${line}`}
              color={inputFocused ? theme.text : theme.mute}
              inverse={inputFocused && index === visibleCustomLines.length - 1}
              wrap="truncate-end"
            >
              {inputFocused ? `${glyphs.rail} ` : '  '}
              {line === '' && custom === '' ? text(props.locale, 'questionCustom') : line}
            </Text>
          ))}
        </Box>
      ) : null}
    </PanelFrame>
  )
}

function fallbackTab(state: TuiQuestionSnapshot): TuiQuestionTab {
  return {
    position: state.position,
    label: questionTabLabel(state.question),
    answered: state.answer !== undefined,
  }
}

function questionPrompt(
  question: TuiQuestionSnapshot['question'],
  unavailableLabel: string,
): string {
  const value = question.question.trim()
  if (value !== '' && value !== '?' && value !== '？') return value
  const detail = question.detail?.trim()
  if (detail !== undefined && detail !== '') return detail.split(/\r?\n/u, 1)[0] ?? detail
  const header = question.header?.trim()
  if (header !== undefined && header !== '' && header !== '?' && header !== '？') return header
  return unavailableLabel
}
