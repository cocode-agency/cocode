import { Box, Text } from 'ink'
import {
  MODEL_PICKER_WINDOW_SIZE,
  visibleModelItems,
  type ModelPickerState,
} from '../../runtime/model-picker.ts'
import { text, type UiLocale } from '../../runtime/ui-locale.ts'
import { listWindowStart } from '../list-window.ts'
import { glyphs } from '../glyphs.ts'
import { selectionStyle } from '../selection.ts'
import { PANEL_BORDER } from '../layout.ts'
import { theme } from '../theme.ts'

export function ModelPicker(props: {
  state: ModelPickerState
  currentProvider: string
  currentModel: string
  locale: UiLocale
  maxRows?: number
}) {
  const items = visibleModelItems(props.state)
  const windowSize =
    props.maxRows === undefined
      ? MODEL_PICKER_WINDOW_SIZE
      : Math.max(1, Math.min(MODEL_PICKER_WINDOW_SIZE, Math.trunc(props.maxRows) - 7))
  const start = listWindowStart(props.state.selected, items.length, windowSize)
  const visible = items.slice(start, start + windowSize)
  const above = start
  const below = Math.max(0, items.length - start - visible.length)

  return (
    <Box flexDirection="column" marginTop={1} borderStyle={PANEL_BORDER} borderColor={theme.border} paddingX={1}>
      <Text color={theme.text} bold wrap="truncate-end">
        {text(props.locale, 'modelCatalogTitle')}{' '}
        <Text color={theme.mute}>· {text(props.locale, 'modelCatalogHint')}</Text>
      </Text>
      <Text color={theme.dim} wrap="truncate-end">
        {text(props.locale, 'modelCatalogQuery', { query: props.state.query || '…' })}
      </Text>
      {above > 0 ? (
        <Text color={theme.mute} wrap="truncate-end">↑ {above}</Text>
      ) : null}
      {visible.length === 0 ? (
        <Text color={theme.mute} wrap="truncate-end">{text(props.locale, 'modelCatalogEmpty')}</Text>
      ) : (
        visible.map((item, offset) => {
          const index = start + offset
          const active = index === props.state.selected
          const current =
            item.providerId === props.currentProvider && item.model.id === props.currentModel
          return (
            <Text
              key={`${item.providerId}:${item.model.id}`}
              {...selectionStyle(active)}
              wrap="truncate-end"
            >
              {active ? glyphs.optionActive : glyphs.optionInactive} {current ? glyphs.checkDone : ' '} {item.model.name}{' '}
              <Text color={active ? theme.text : theme.dim}>
                · {item.providerName}
              </Text>
            </Text>
          )
        })
      )}
      {below > 0 ? (
        <Text color={theme.mute} wrap="truncate-end">↓ {below}</Text>
      ) : null}
      {props.state.failures.length > 0 ? (
        <Text color={theme.accent} wrap="truncate-end">
          {text(props.locale, 'modelCatalogPartial')}
        </Text>
      ) : null}
    </Box>
  )
}
