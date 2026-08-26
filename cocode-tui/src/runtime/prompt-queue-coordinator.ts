import { createPromptQueue, type QueuedPrompt } from './prompt-queue.ts'
import {
  clampPromptQueueSelection,
  closePromptQueuePicker,
  createPromptQueuePicker,
  movePromptQueueSelection,
  removeSelectedPrompt,
  restoreSelectedPrompt,
  selectedPromptQueueItem,
  setPromptQueueQuery,
  type PromptQueuePickerState,
} from './prompt-queue-picker.ts'

export type PromptQueueTicket = {
  generation: number
  prompt: QueuedPrompt
}

export class PromptQueueCoordinator {
  private readonly queue = createPromptQueue()
  private pickerState: PromptQueuePickerState | undefined
  private serial = 0
  private generation = 0

  get size(): number {
    return this.queue.size
  }

  get picker(): PromptQueuePickerState | undefined {
    return this.pickerState
  }

  get items(): readonly QueuedPrompt[] {
    return this.queue.items
  }

  add(
    text: string,
    attachments: QueuedPrompt['attachments'],
    images: QueuedPrompt['images'],
  ): boolean {
    const added = this.queue.add({
      id: `queue-${++this.serial}`,
      text,
      attachments,
      images,
    })
    if (added) this.syncPicker()
    return added
  }

  take(): PromptQueueTicket | undefined {
    const prompt = this.queue.take()
    if (prompt === undefined) return undefined
    this.syncPicker()
    return { generation: this.generation, prompt }
  }

  restore(ticket: PromptQueueTicket): boolean {
    if (ticket.generation !== this.generation) return false
    this.queue.restore(ticket.prompt)
    this.syncPicker()
    return true
  }

  clear(): void {
    this.generation += 1
    this.queue.clear()
    this.pickerState = undefined
  }

  open(): boolean {
    if (this.queue.size === 0) return false
    this.pickerState = createPromptQueuePicker(this.queue.items)
    return true
  }

  close(): void {
    if (this.pickerState !== undefined) {
      this.pickerState = closePromptQueuePicker(this.pickerState)
    }
  }

  move(delta: number): void {
    if (this.pickerState !== undefined) {
      this.pickerState = movePromptQueueSelection(this.pickerState, delta)
    }
  }

  setQuery(query: string): void {
    if (this.pickerState !== undefined) {
      this.pickerState = setPromptQueueQuery(this.pickerState, query)
    }
  }

  deleteSelected(): boolean {
    if (this.pickerState === undefined) return false
    const next = removeSelectedPrompt(this.pickerState)
    if (next === this.pickerState) return false
    this.replace(next)
    return true
  }

  prioritizeSelected(): boolean {
    if (this.pickerState === undefined || selectedPromptQueueItem(this.pickerState) === undefined) {
      return false
    }
    const next = restoreSelectedPrompt(this.pickerState)
    if (next !== this.pickerState) this.replace(next)
    return true
  }

  dismissPicker(): void {
    this.pickerState = undefined
  }

  private replace(next: PromptQueuePickerState): void {
    this.queue.replace(next.items)
    this.pickerState =
      next.items.length === 0
        ? undefined
        : clampPromptQueueSelection({ ...next, items: this.queue.items })
  }

  private syncPicker(): void {
    if (this.pickerState === undefined) return
    this.pickerState =
      this.queue.size === 0
        ? undefined
        : clampPromptQueueSelection({ ...this.pickerState, items: this.queue.items })
  }
}
