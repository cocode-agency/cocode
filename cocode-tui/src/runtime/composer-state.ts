/** Own mutable composer state while the app coordinates its side effects. */

import { InputHistory } from './history.ts'
import type { DraftImage } from './prompt-queue.ts'
import { createDraft, type DraftState } from './draft.ts'

export type ComposerAttachment = { path: string; token: string }

export type ComposerState = {
  readonly history: InputHistory
  draft: DraftState
  attachments: ComposerAttachment[]
  images: DraftImage[]
  pendingSkillInvocation: string | undefined
  imageSerial: number
  capturingByok: boolean
  reset(): void
}

export function createComposerState(): ComposerState {
  let draft = createDraft()
  let attachments: ComposerAttachment[] = []
  let images: DraftImage[] = []
  let pendingSkillInvocation: string | undefined
  let imageSerial = 0
  let capturingByok = false
  const history = new InputHistory()

  return {
    history,
    get draft() {
      return draft
    },
    set draft(value) {
      draft = value
    },
    get attachments() {
      return attachments
    },
    set attachments(value) {
      attachments = value
    },
    get images() {
      return images
    },
    set images(value) {
      images = value
    },
    get pendingSkillInvocation() {
      return pendingSkillInvocation
    },
    set pendingSkillInvocation(value) {
      pendingSkillInvocation = value
    },
    get imageSerial() {
      return imageSerial
    },
    set imageSerial(value) {
      imageSerial = value
    },
    get capturingByok() {
      return capturingByok
    },
    set capturingByok(value) {
      capturingByok = value
    },
    reset: () => {
      draft = createDraft()
      attachments = []
      images = []
      pendingSkillInvocation = undefined
      capturingByok = false
    },
  }
}
