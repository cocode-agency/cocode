import { describe, expect, it } from 'vitest'
import { HostedProviderGate, isAccountManagedProvider, isAccountManagedProviderPath } from '../src/client/account-gate.ts'

describe('account-managed model providers', () => {
  it('recognizes the reserved Cocode routes', () => {
    expect(isAccountManagedProvider('cocode-nut')).toBe(true)
    expect(isAccountManagedProvider('cocode-cloud')).toBe(true)
    expect(isAccountManagedProvider('openai')).toBe(false)
  })

  it('recognizes only reserved pi-ai provider profile paths', () => {
    expect(isAccountManagedProviderPath('llm-pi-ai', ['providers', 'cocode-nut'])).toBe(true)
    expect(isAccountManagedProviderPath('llm-pi-ai', ['providers', 'openai'])).toBe(false)
    expect(isAccountManagedProviderPath('llm-deepseek', ['providers', 'cocode-nut'])).toBe(false)
  })

  it('does not let a stale startup snapshot revive a signed-out event', async () => {
    let resolveSnapshot!: (value: { phase: 'signed-in' | 'signed-out' }) => void
    let listener: ((value: { phase: 'signed-in' | 'signed-out' }) => void) | undefined
    const previous = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        desktopApi: {
          account: {
            snapshot: () => new Promise(resolve => { resolveSnapshot = resolve }),
            onChanged: (next: typeof listener) => {
              listener = next
              return () => { listener = undefined }
            },
          },
        },
      },
    })
    try {
      const changed: boolean[] = []
      const gate = new HostedProviderGate(() => { changed.push(gate.allowed()) })
      gate.start()
      listener?.({ phase: 'signed-out' })
      resolveSnapshot({ phase: 'signed-in' })
      await Promise.resolve()
      expect(gate.allowed()).toBe(false)
      expect(changed).toEqual([false])
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    }
  })

  it('ignores a startup snapshot after dispose', async () => {
    let resolveSnapshot!: (value: { phase: 'signed-in' | 'signed-out' }) => void
    const previous = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        desktopApi: {
          account: {
            snapshot: () => new Promise(resolve => { resolveSnapshot = resolve }),
            onChanged: () => () => undefined,
          },
        },
      },
    })
    try {
      const changed = [] as boolean[]
      const gate = new HostedProviderGate(() => { changed.push(gate.allowed()) })
      gate.start()
      gate.dispose()
      resolveSnapshot({ phase: 'signed-out' })
      await Promise.resolve()
      expect(gate.allowed()).toBe(true)
      expect(changed).toEqual([])
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    }
  })
})
