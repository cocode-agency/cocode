import type {
  TuiModel,
  TuiModelCatalog,
  TuiModelProviderGroup,
} from '@cocode/tui-connection'
import { CLOUD_DISPLAY_NAME, CLOUD_PROVIDER, LEGACY_CLOUD_PROVIDER } from './auth/types.ts'

export type ModelPickerItem = {
  providerId: string
  providerName: string
  model: TuiModel
}

export type ModelPickerState = {
  groups: readonly TuiModelProviderGroup[]
  failures: TuiModelCatalog['failures']
  query: string
  selected: number
  open: boolean
}

export const MODEL_PICKER_WINDOW_SIZE = 8

function providerDisplayName(id: string, name: string): string {
  return id === CLOUD_PROVIDER || id === LEGACY_CLOUD_PROVIDER ? CLOUD_DISPLAY_NAME : name
}

export function createModelPicker(
  catalog: TuiModelCatalog,
  currentProvider: string,
  currentModel: string,
): ModelPickerState {
  const state: ModelPickerState = {
    groups: [...catalog.groups],
    failures: [...catalog.failures],
    query: '',
    selected: 0,
    open: true,
  }
  const selected = visibleModelItems(state).findIndex(
    (item) => item.providerId === currentProvider && item.model.id === currentModel,
  )
  return selected < 0 ? state : { ...state, selected }
}

export function setModelQuery(state: ModelPickerState, query: string): ModelPickerState {
  return { ...state, query, selected: 0 }
}

export function moveModelSelection(state: ModelPickerState, delta: number): ModelPickerState {
  const visible = visibleModelItems(state)
  if (visible.length === 0) return { ...state, selected: 0 }
  return {
    ...state,
    selected: (((state.selected + delta) % visible.length) + visible.length) % visible.length,
  }
}

export function selectedModel(state: ModelPickerState): ModelPickerItem | undefined {
  return visibleModelItems(state)[state.selected]
}

export function closeModelPicker(state: ModelPickerState): ModelPickerState {
  return { ...state, open: false }
}

export function visibleModelItems(state: ModelPickerState): ModelPickerItem[] {
  const query = state.query.trim().toLocaleLowerCase()
  const items: ModelPickerItem[] = []
  for (const group of state.groups) {
    const providerName = providerDisplayName(group.id, group.name)
    for (const model of group.models) {
      const item = { providerId: group.id, providerName, model }
      if (
        query === '' ||
        `${group.id} ${group.name} ${providerName} ${model.id} ${model.name} ${model.description ?? ''}`
          .toLocaleLowerCase()
          .includes(query)
      ) {
        items.push(item)
      }
    }
  }
  return items
}

export function findCatalogModel(
  catalog: TuiModelCatalog,
  providerId: string,
  modelId: string,
): TuiModel | undefined {
  return catalog.groups
    .find((group) => group.id === providerId)
    ?.models.find((model) => model.id === modelId)
}
