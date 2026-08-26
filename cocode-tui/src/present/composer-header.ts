import stringWidth from 'string-width'
import type { TuiSnapshot } from '../runtime/app-contracts.ts'
import { text, type UiLocale } from '../runtime/ui-locale.ts'

export const COMPOSER_META_SEPARATOR = ' · '
export const COMPOSER_ROUTE_SEPARATOR = ' / '

const COMPACT_COLUMNS = 84
const CONTENT_START_COLUMN = 1

export type ComposerHeaderLayout = {
  title: string
  hint: string
  compact: boolean
  showRoute: boolean
  modelLabel?: string
  modelStartColumn?: number
  modelEndColumn?: number
}

export function composerHeaderLayout(options: {
  composer: Pick<TuiSnapshot['composer'], 'disabled' | 'mask' | 'placeholder'>
  agent: TuiSnapshot['agent']
  planMode: boolean
  planModeAvailable: boolean
  locale: UiLocale
  provider: string
  model: string
  reasoningEffort?: string
  columns?: number
}): ComposerHeaderLayout {
  const title = options.composer.mask
    ? text(options.locale, 'secret')
    : text(options.locale, options.planMode ? 'modePlan' : 'modeBuild')
  const hint = options.composer.mask
    ? options.composer.placeholder
    : options.composer.disabled
    ? text(options.locale, 'locked')
    : options.agent === 'running'
    ? text(options.locale, 'footerQueueDraft')
    : options.planModeAvailable
    ? text(options.locale, 'modeSwitchHint')
    : ''
  const columns = Math.max(1, Math.trunc(options.columns ?? 80))
  const hintWidth = stringWidth(hint)
  const modelLabel =
    options.reasoningEffort === undefined || options.reasoningEffort === ''
      ? options.model
      : `${options.model}${COMPOSER_META_SEPARATOR}${options.reasoningEffort}`
  const fullRouteWidth =
    stringWidth(title) +
    stringWidth(COMPOSER_META_SEPARATOR) +
    stringWidth(options.provider) +
    stringWidth(COMPOSER_ROUTE_SEPARATOR) +
    stringWidth(modelLabel)
  const compact =
    columns < COMPACT_COLUMNS || fullRouteWidth + hintWidth + 1 > Math.max(1, columns - 4)

  if (options.composer.mask) {
    return { title, hint, compact, showRoute: false }
  }

  const routePrefix = compact
    ? COMPOSER_META_SEPARATOR
    : `${COMPOSER_META_SEPARATOR}${options.provider}${COMPOSER_ROUTE_SEPARATOR}`
  const modelStartColumn = CONTENT_START_COLUMN + stringWidth(title) + stringWidth(routePrefix)
  const hintStartColumn = columns - hintWidth + 1
  const modelEndColumn = Math.min(
    modelStartColumn + stringWidth(modelLabel),
    hintStartColumn,
  )

  return {
    title,
    hint,
    compact,
    showRoute: true,
    modelLabel,
    ...(!options.composer.disabled && modelEndColumn > modelStartColumn
      ? { modelStartColumn, modelEndColumn }
      : {}),
  }
}
