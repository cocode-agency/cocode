import { describe, expect, it } from 'vitest'
import { composerHeaderLayout } from '../../src/present/composer-header.ts'

const base = {
  composer: { disabled: false, mask: false, placeholder: 'Type a message  / for commands' },
  agent: 'idle' as const,
  planMode: false,
  planModeAvailable: true,
  locale: 'en' as const,
  provider: 'deepseek-official',
  model: 'm1',
}

describe('composer header layout', () => {
  it('shows the provider and model when the composer is wide', () => {
    expect(composerHeaderLayout({ ...base, columns: 120 })).toEqual({
      title: 'Build',
      hint: 'tab switch mode',
      compact: false,
      showRoute: true,
      modelLabel: 'm1',
      modelStartColumn: 29,
      modelEndColumn: 31,
    })
  })

  it('includes the current reasoning effort in the clickable model label', () => {
    expect(composerHeaderLayout({ ...base, reasoningEffort: 'high', columns: 120 })).toEqual({
      title: 'Build',
      hint: 'tab switch mode',
      compact: false,
      showRoute: true,
      modelLabel: 'm1 · high',
      modelStartColumn: 29,
      modelEndColumn: 38,
    })
  })

  it('hides the provider while keeping the model clickable in compact layouts', () => {
    expect(composerHeaderLayout({ ...base, columns: 80 })).toEqual({
      title: 'Build',
      hint: 'tab switch mode',
      compact: true,
      showRoute: true,
      modelLabel: 'm1',
      modelStartColumn: 9,
      modelEndColumn: 11,
    })
  })

  it('removes the click range when the model is clipped or disabled', () => {
    const clipped = composerHeaderLayout({ ...base, columns: 20 })
    expect(clipped.showRoute).toBe(true)
    expect(clipped).not.toHaveProperty('modelStartColumn')
    expect(clipped).not.toHaveProperty('modelEndColumn')

    expect(
      composerHeaderLayout({
        ...base,
        composer: { disabled: true, mask: false, placeholder: 'Type a message  / for commands' },
        columns: 120,
      }),
    ).toMatchObject({ hint: 'locked' })
  })

  it('keeps secret input distinct from the model route', () => {
    expect(
      composerHeaderLayout({
        ...base,
        composer: { disabled: false, mask: true, placeholder: 'Paste API key, press enter to confirm' },
        columns: 120,
      }),
    ).toEqual({
      title: 'secret',
      hint: 'Paste API key, press enter to confirm',
      compact: false,
      showRoute: false,
    })
  })

  it('uses textual signals for running and plan modes', () => {
    expect(composerHeaderLayout({ ...base, agent: 'running', columns: 120 })).toMatchObject({
      title: 'Build',
      hint: 'enter queue draft',
    })
    expect(composerHeaderLayout({ ...base, planMode: true, columns: 120 })).toMatchObject({
      title: 'Plan',
      hint: 'tab switch mode',
    })
  })

  it('omits the duplicate submit hint when the footer already owns it', () => {
    expect(
      composerHeaderLayout({ ...base, planModeAvailable: false, columns: 120 }),
    ).toMatchObject({ hint: '' })
  })
})
