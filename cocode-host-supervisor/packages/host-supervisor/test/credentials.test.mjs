import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CredentialsError,
  detectCredentialsLayout,
  loadCredentials,
  parseCredentialsDocument,
  refreshCredentials,
  writeCredentialRef,
} from '../lib/index.js'

async function tempCredentials(initial) {
  const home = await mkdtemp(join(tmpdir(), 'cocode-credentials-'))
  await chmod(home, 0o700)
  const filename = join(home, '.credentials.yaml')
  if (initial !== undefined) await writeFile(filename, initial, { mode: 0o600 })
  return { home, filename }
}

test('detects empty, flat, and v1 layouts without rewriting the file', async () => {
  assert.equal(detectCredentialsLayout('# empty\n', '/tmp/.credentials.yaml'), 'empty')
  assert.equal(detectCredentialsLayout('DEEPSEEK_API_KEY: sk-xxx\n', '/tmp/.credentials.yaml'), 'flat')
  assert.equal(detectCredentialsLayout('version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-xxx\n', '/tmp/.credentials.yaml'), 'v1')

  const { filename } = await tempCredentials('DEEPSEEK_API_KEY: sk-xxx\n')
  const document = await loadCredentials(filename)
  assert.equal(document.layout, 'flat')
  assert.equal(await readFile(filename, 'utf8'), 'DEEPSEEK_API_KEY: sk-xxx\n')
})

test('parses strict v1 documents and preserves records', () => {
  const document = parseCredentialsDocument(
    'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-xxx\nrecords:\n  provider/example:\n    kind: api-key\n',
    '/tmp/.credentials.yaml',
  )
  assert.equal(document.layout, 'v1')
  assert.equal(document.refs.get('DEEPSEEK_API_KEY'), 'sk-xxx')
  assert.equal(document.records.get('provider/example').kind, 'api-key')
})

test('allows missing or null refs and records in v1', () => {
  const document = parseCredentialsDocument('version: 1\nrefs: null\nrecords: null\n', '/tmp/.credentials.yaml')
  assert.equal(document.layout, 'v1')
  assert.equal(document.refs.size, 0)
  assert.equal(document.records.size, 0)
})

test('treats reserved top-level keys as v1 candidates and rejects invalid v1', () => {
  for (const text of [
    'version: "1"\nrefs: {}\n',
    'version: 2\nrefs: {}\n',
    'refs: {}\n',
    'version: 1\nunknown: true\nrefs: {}\n',
    'version: 1\nrefs:\n  bad-ref: value\n',
    'version: 1\nrefs: []\n',
    'version: 1\nrefs: {}\nrecords: []\n',
  ]) assert.throws(() => detectCredentialsLayout(text, '/tmp/.credentials.yaml'), CredentialsError)
})

test('rejects malformed flat documents without falling back to another layout', () => {
  for (const text of [
    'bad-ref: value\n',
    'DEEPSEEK_API_KEY:\n',
    'version: true\n',
    'DEEPSEEK_API_KEY: [secret]\n',
  ]) assert.throws(() => parseCredentialsDocument(text, '/tmp/.credentials.yaml'), CredentialsError)
})

test('writes a new file as flat and keeps an existing flat file flat', async () => {
  const created = await tempCredentials()
  await writeCredentialRef(created.filename, 'DEEPSEEK_API_KEY', 'sk-new')
  assert.equal((await loadCredentials(created.filename)).layout, 'flat')
  assert.doesNotMatch(await readFile(created.filename, 'utf8'), /version:|refs:/)

  const existing = await tempCredentials('# shared\nDEEPSEEK_API_KEY: "sk-old"\n\n')
  await writeCredentialRef(existing.filename, 'OPENAI_API_KEY', 'sk-new')
  const text = await readFile(existing.filename, 'utf8')
  assert.equal((await loadCredentials(existing.filename)).layout, 'flat')
  assert.match(text, /DEEPSEEK_API_KEY: "sk-old"/)
  assert.match(text, /OPENAI_API_KEY: sk-new/)
  assert.doesNotMatch(text, /version:|refs:/)

  const comments = await tempCredentials('# keep this comment\n')
  await writeCredentialRef(comments.filename, 'COMMENTED_API_KEY', 'sk-commented')
  assert.match(await readFile(comments.filename, 'utf8'), /keep this comment/)
})

test('keeps v1 layout and records during set and unset', async () => {
  const { filename } = await tempCredentials('version: 1\nrefs:\n  A: old\nrecords:\n  test/example:\n    kind: api-key\n')
  await writeCredentialRef(filename, 'B', 'new')
  await writeCredentialRef(filename, 'A', undefined)
  const text = await readFile(filename, 'utf8')
  assert.equal((await loadCredentials(filename)).layout, 'v1')
  assert.doesNotMatch(text, /A: old/)
  assert.match(text, /B: new/)
  assert.match(text, /version: 1/)
  assert.match(text, /records:/)
})

test('does not overwrite an invalid current document', async () => {
  const { filename } = await tempCredentials('version: "1"\nrefs: {}\n')
  const before = await readFile(filename, 'utf8')
  await assert.rejects(() => writeCredentialRef(filename, 'B', 'new'))
  assert.equal(await readFile(filename, 'utf8'), before)
})

test('refresh recognizes an external layout switch and keeps last-good on invalid reload', async () => {
  const { filename } = await tempCredentials('A: old\n')
  const previous = await loadCredentials(filename)
  await writeFile(filename, 'version: 1\nrefs:\n  A: new\n', { mode: 0o600 })
  const next = await refreshCredentials(filename, previous)
  assert.equal(next.layout, 'v1')
  assert.equal(next.refs.get('A'), 'new')
  await writeFile(filename, 'version: "1"\nrefs: {}\n', { mode: 0o600 })
  await assert.rejects(() => refreshCredentials(filename, next))
  assert.equal(next.refs.get('A'), 'new')
})

test('preserves private file and directory modes', async () => {
  const { home, filename } = await tempCredentials('A: old\n')
  await writeCredentialRef(filename, 'B', 'new')
  assert.equal((await stat(filename)).mode & 0o777, 0o600)
  assert.equal((await stat(home)).mode & 0o777, 0o700)
})
