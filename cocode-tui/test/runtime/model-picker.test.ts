import { describe, expect, it } from 'vitest'
import {
  createModelPicker,
  moveModelSelection,
  selectedModel,
  setModelQuery,
  visibleModelItems,
} from '../../src/runtime/model-picker.ts'

const catalog = {
  groups: [
    {
      id: 'provider-a',
      name: 'Provider A',
      models: [
        { id: 'model-a', name: 'Model A' },
        { id: 'model-b', name: 'Model B', description: 'Fast' },
      ],
    },
    {
      id: 'provider-b',
      name: 'Provider B',
      models: [{ id: 'model-c', name: 'Model C' }],
    },
  ],
  failures: [],
}

const cloudCatalog = {
  groups: [
    {
      id: 'cocode-nut',
      name: 'Cocode Nut',
      models: [{ id: 'cloud-model', name: 'Cloud Model' }],
    },
  ],
  failures: [],
}

describe('model picker state', () => {
  it('selects the current provider and model and searches across groups', () => {
    const state = createModelPicker(catalog, 'provider-a', 'model-b')
    expect(selectedModel(state)).toEqual({
      providerId: 'provider-a',
      providerName: 'Provider A',
      model: { id: 'model-b', name: 'Model B', description: 'Fast' },
    })
    expect(visibleModelItems(setModelQuery(state, 'provider b'))).toEqual([
      { providerId: 'provider-b', providerName: 'Provider B', model: { id: 'model-c', name: 'Model C' } },
    ])
  })

  it('wraps selection and keeps it valid when the filter has no matches', () => {
    const state = createModelPicker(catalog, 'missing', 'missing')
    expect(state.selected).toBe(0)
    expect(moveModelSelection(state, -1).selected).toBe(2)
    expect(setModelQuery(state, 'no such model').selected).toBe(0)
    expect(selectedModel(setModelQuery(state, 'no such model'))).toBeUndefined()
  })

  it('uses the unified Cocode label for hosted models', () => {
    const state = createModelPicker(cloudCatalog, 'cocode-nut', 'cloud-model')
    expect(selectedModel(state)).toEqual({
      providerId: 'cocode-nut',
      providerName: 'Cocode',
      model: { id: 'cloud-model', name: 'Cloud Model' },
    })
    expect(visibleModelItems(setModelQuery(state, 'cocode nut'))).toEqual([
      {
        providerId: 'cocode-nut',
        providerName: 'Cocode',
        model: { id: 'cloud-model', name: 'Cloud Model' },
      },
    ])
  })
})
