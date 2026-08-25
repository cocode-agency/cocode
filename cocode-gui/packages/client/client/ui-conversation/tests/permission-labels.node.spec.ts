import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('permission labels', () => {
  it('provides localized labels for the built-in access modes', () => {
    expect(zh['access.readOnly']).toBe('只读')
    expect(zh['access.workspaceWrite']).toBe('工作区可写')
    expect(zh['access.fullAccess']).toBe('完全权限')
    expect(en['access.readOnly']).toBe('Read Only')
    expect(en['access.workspaceWrite']).toBe('Workspace Write')
    expect(en['access.fullAccess']).toBe('Full access')
    expect(zh['hero.defaultWorkspace']).toBe('默认工作区')
    expect(en['hero.defaultWorkspace']).toBe('Default workspace')
  })
})
