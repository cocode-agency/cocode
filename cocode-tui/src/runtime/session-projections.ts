import type {
  TuiSessionProjectionBaseline,
  TuiSessionProjectionUpdate,
} from '@cocode/tui-connection'

export type SessionProjectionStore = {
  readonly values: ReadonlyMap<string, unknown>
  applyBaseline(baseline: TuiSessionProjectionBaseline): void
  apply(update: TuiSessionProjectionUpdate): void
  clear(): void
}

export function createSessionProjectionStore(): SessionProjectionStore {
  const values = new Map<string, { seq: number; value: unknown }>()
  return {
    get values() {
      return new Map([...values].map(([key, entry]) => [key, entry.value]))
    },
    applyBaseline(baseline) {
      for (const [key, value] of Object.entries(baseline.values)) {
        const current = values.get(key)
        if (current !== undefined && current.seq > baseline.asOfSeq) continue
        values.set(key, { seq: baseline.asOfSeq, value })
      }
    },
    apply(update) {
      const current = values.get(update.key)
      if (current !== undefined && current.seq >= update.seq) return
      values.set(update.key, { seq: update.seq, value: update.value })
    },
    clear() {
      values.clear()
    },
  }
}
