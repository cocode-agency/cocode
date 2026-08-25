import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '../src/credentials-local-provider.ts'

test('LocalCredentialProvider persists and removes a credential record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cocode-host-credentials-records-'))
  const filename = join(directory, '.credentials.yaml')
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path: filename, dshHome: directory, watch: false })

  try {
    await fiber
    const stored = await ctx.credentials.modifyRecord(key, async () => ({
      kind: 'grant',
      payload: { access: 'at', refresh: 'rt' },
    }))
    assert.deepEqual(stored, { kind: 'grant', payload: { access: 'at', refresh: 'rt' } })
    assert.deepEqual(await ctx.credentials.readRecord(key), stored)
    assert.deepEqual(await ctx.credentials.listRecords(), [{ key, kind: 'grant' }])
    assert.match(await readFile(filename, 'utf8'), /llm-pi-ai\/openai-codex/)

    await ctx.credentials.deleteRecord(key)
    assert.equal(await ctx.credentials.readRecord(key), undefined)
  } finally {
    await fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
