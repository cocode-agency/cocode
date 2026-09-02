import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('ink', () => ({
  Box: 'box',
  Text: 'text',
}))

import { ModelPicker } from '../../src/present/components/ModelPicker.tsx'

describe('ModelPicker', () => {
  it('renders provider, model, current selection, and empty search state', () => {
    const tree = ModelPicker({
      state: {
        groups: [
          {
            id: 'provider-a',
            name: 'Provider A',
            models: [{ id: 'model-a', name: 'Model A' }],
          },
        ],
        failures: [],
        query: '',
        selected: 0,
        open: true,
      },
      currentProvider: 'provider-a',
      currentModel: 'model-a',
      locale: 'en',
    }) as ReactElement

    const rendered = textContent(tree)
    expect(rendered).toContain('Available models')
    expect(rendered).toContain('Model A')
    expect(rendered).toContain('Provider A')
    expect(rendered).not.toContain('model-a')
    expect(rendered).toContain('✓')
  })

  it('renders hosted providers as Cocode', () => {
    const tree = ModelPicker({
      state: {
        groups: [
          {
            id: 'cocode-nut',
            name: 'Cocode Nut',
            models: [{ id: 'cloud-model', name: 'Cloud Model' }],
          },
        ],
        failures: [],
        query: '',
        selected: 0,
        open: true,
      },
      currentProvider: 'cocode-nut',
      currentModel: 'cloud-model',
      locale: 'en',
    }) as ReactElement

    expect(textContent(tree)).toContain('Cocode')
    expect(textContent(tree)).not.toContain('Cocode Nut')
    expect(textContent(tree)).not.toContain('cloud-model')
  })

  it('renders the manual-input message when filtering removes all models', () => {
    const tree = ModelPicker({
      state: {
        groups: [],
        failures: [],
        query: 'missing',
        selected: 0,
        open: true,
      },
      currentProvider: 'provider-a',
      currentModel: 'model-a',
      locale: 'zh',
    }) as ReactElement

    expect(textContent(tree)).toContain('没有可用的模型目录')
  })
})

function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (node !== null && typeof node === 'object' && 'type' in node) {
    const element = node as ReactElement
    return textContent(element.props?.children)
  }
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
