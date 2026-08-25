import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { resolveWorkspaceInfo, workspaceName, workspacePath } from '../../src/runtime/workspace.ts'

describe('workspace info', () => {
  it('uses the cwd basename and injected branch query', async () => {
    await expect(resolveWorkspaceInfo('/tmp/cocode', async () => 'feat/tui')).resolves.toEqual({
      name: 'cocode',
      branch: 'feat/tui',
    })
  })

  it('hides branch when git lookup fails or is detached', async () => {
    await expect(
      resolveWorkspaceInfo('/tmp/cocode', async () => {
        throw new Error('not a repository')
      }),
    ).resolves.toEqual({ name: 'cocode' })
    await expect(resolveWorkspaceInfo('/tmp/cocode', async () => 'HEAD')).resolves.toEqual({
      name: 'cocode',
    })
  })

  it('keeps a useful name for the filesystem root', () => {
    expect(workspaceName('/')).toBe('/')
  })

  it('shortens paths inside the home directory and keeps external paths absolute', () => {
    expect(workspacePath('/Users/coder/Documents/cocode-tui', '/Users/coder')).toBe(
      '~/Documents/cocode-tui',
    )
    const externalPath = join(tmpdir(), 'cocode-tui')
    expect(workspacePath(externalPath, '/Users/coder')).toBe(externalPath.split(sep).join('/'))
    expect(workspacePath('/Users/coder', '/Users/coder')).toBe('~')
  })
})
