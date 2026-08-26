import { describe, expect, it } from 'vitest'
import { createDraft, insertDraft } from '../../src/runtime/draft.ts'
import { createComposerState } from '../../src/runtime/composer-state.ts'

describe('ComposerState', () => {
  it('owns mutable draft state and resets transient values', () => {
    const composer = createComposerState()
    composer.draft = insertDraft(createDraft(), 'hello')
    composer.attachments = [{ path: '/tmp/a.txt', token: '@a.txt' }]
    composer.pendingSkillInvocation = 'review'
    composer.capturingByok = true

    composer.reset()

    expect(composer.draft.text).toBe('')
    expect(composer.attachments).toEqual([])
    expect(composer.images).toEqual([])
    expect(composer.pendingSkillInvocation).toBeUndefined()
    expect(composer.capturingByok).toBe(false)
  })

  it('keeps history and image serial independent from transient reset', () => {
    const composer = createComposerState()
    composer.history.push('first')
    composer.imageSerial = 4
    composer.reset()

    expect(composer.history.entriesSnapshot()).toEqual(['first'])
    expect(composer.imageSerial).toBe(4)
  })
})
