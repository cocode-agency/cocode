import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_DEBUG_MODE, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable busy-Enter preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR, debugMode: DEFAULT_DEBUG_MODE })
    await ctx.settings.update(ns, { busyEnter: 'steer', debugMode: true })
    expect(ctx.settings.get(ns)).toEqual({ busyEnter: 'steer', debugMode: true })
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid', debugMode: true })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
