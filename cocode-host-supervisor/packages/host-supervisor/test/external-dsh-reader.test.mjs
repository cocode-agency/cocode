import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import YAML from 'yaml'
import { createExternalDshReadSource, ensureCocodeProfile } from '../lib/index.js'

const roots = []

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('bootstraps an idempotent cocode profile without touching an official profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-profile-'))
  roots.push(root)
  const cocodeHome = join(root, 'cocode-home')
  const profile = ensureCocodeProfile(root, cocodeHome)
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8').includes('.dsh'), false)
  assert.match(readFileSync(join(profile, 'pnpm-workspace.yaml'), 'utf8'), /nodeLinker: hoisted/)
  assert.equal(existsSync(join(cocodeHome, 'runtime')), true)
  for (const directory of ['settings', 'credentials', 'plugins', 'logs', 'sessions']) {
    assert.equal(existsSync(join(cocodeHome, directory)), false, directory)
  }
  const patch = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.deepEqual(parseGeneratedPatch(patch), [{ id: 'attachment-local', config: { dshHome: '<runtime-dsh-home>' } }])
  writeFileSync(join(profile, 'cordis.patch.yml'), `${patch}# user patch\n`)
  ensureCocodeProfile(root, cocodeHome)
  assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), `${patch}# user patch\n`)
})

test('migrates the old empty Cocode patch to configure local attachments', () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-profile-attachment-migration-'))
  roots.push(root)
  const profile = join(root, 'profiles', 'cocode')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'cocode-profile',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  })}\n`)
  writeFileSync(join(profile, 'cordis.patch.yml'), '# Cocode uses the shared DSH settings and credentials paths.\r\n[]\r\n\r\n')

  ensureCocodeProfile(root, join(root, 'cocode-home'))

  assert.deepEqual(parseGeneratedPatch(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')), [
    { id: 'attachment-local', config: { dshHome: '<runtime-dsh-home>' } },
  ])
})

test('removes only the previously generated private settings override', () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-profile-legacy-'))
  roots.push(root)
  const profile = join(root, 'profiles', 'cocode')
  const legacyHome = join(root, 'old-custom-cocode-home')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'cocode-profile',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  })}\n`)
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '# Cocode-owned provider paths. This profile is self-contained.',
    '- id: settings',
    '  config:',
    `    path: ${JSON.stringify(join(legacyHome, 'settings', 'settings.yaml'))}`,
    '- id: credentials',
    '  config:',
    `    path: ${JSON.stringify(join(legacyHome, 'credentials', 'credentials.yaml'))}`,
    '',
  ].join('\n'))

  ensureCocodeProfile(root, join(root, 'new-cocode-home'))

  assert.deepEqual(parseGeneratedPatch(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')), [
    { id: 'attachment-local', config: { dshHome: '<runtime-dsh-home>' } },
  ])
})

function parseGeneratedPatch(content) {
  return YAML.parse(content.replace('!!js dshHomePath()', "'<runtime-dsh-home>'"))
}

test('rejects a Cocode profile whose bundle composition was changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-profile-invalid-'))
  roots.push(root)
  const profile = join(root, 'profiles', 'cocode')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  assert.throws(() => ensureCocodeProfile(root), /bundle composition is incompatible/)
})

test('reads only the shared allowlist and marks the single-writer policy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-external-dsh-'))
  roots.push(root)
  mkdirSync(join(root, 'sessions', 'project', 'session-one'), { recursive: true })
  mkdirSync(join(root, 'storages'), { recursive: true })
  writeFileSync(join(root, 'cordis.patch.yml'), 'must never be read')
  writeFileSync(join(root, 'settings.yaml'), 'must never be read')
  writeFileSync(join(root, '.credentials.yaml'), 'must never be read')
  writeFileSync(join(root, 'sessions', 'project', 'session-one', 'session.jsonl.zstd'), zstdCompressSync([
    JSON.stringify({ type: 'session', version: 1, id: 'session-one', createdAt: 1, cwd: '/tmp/project' }),
    JSON.stringify({ type: 'session/title', seq: 0, time: 2, data: { title: 'Hello' } }),
  ].join('\n') + '\n'))
  writeFileSync(join(root, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { archivedSessionIds: [] },
    tables: { workspaces: { workspace: { path: '/tmp/project', title: 'Project', sessionIds: ['session-one'] } } },
  }))
  const reader = createExternalDshReadSource({ sourceHome: root, watch: false })
  const status = await reader.getStatus()
  assert.equal(status.state, 'available')
  assert.equal(status.canMutate, true)
  assert.equal(status.concurrentMutation, 'unsupported')
  assert.equal(status.homePatch, 'shared')
  assert.equal(status.profileFallback, 'shared')
  const sessions = await reader.listSessions()
  assert.equal(sessions[0].source, 'shared-dsh')
  assert.equal(sessions[0].canMutate, true)
  const history = await reader.readSessionHistory('session-one')
  assert.equal(history.events[0].type, 'session/title')
  assert.equal(history.session.title, 'Hello')
  const workspace = await reader.listWorkspaces()
  assert.equal(workspace.workspaces[0].canMutate, true)
  assert.equal(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), 'must never be read')
  await reader.dispose()
})

test('rejects symlink escapes from the sessions allowlist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-external-dsh-'))
  const outside = mkdtempSync(join(tmpdir(), 'cocode-external-dsh-outside-'))
  roots.push(root, outside)
  mkdirSync(join(root, 'sessions'), { recursive: true })
  mkdirSync(join(outside, 'project'), { recursive: true })
  symlinkSync(join(outside, 'project'), join(root, 'sessions', 'escape'))
  const reader = createExternalDshReadSource({ sourceHome: root, watch: false })
  await assert.rejects(() => reader.listSessions(), /symlink escape/)
  await reader.dispose()
})

test('marks a source that overlaps the Cocode runtime as incompatible without watching it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-overlap-'))
  roots.push(root)
  const reader = createExternalDshReadSource({ sourceHome: root, runtimeHome: root })
  assert.deepEqual(await reader.getStatus(), {
    source: 'shared-dsh',
    sourceHome: root,
    canMutate: false,
    concurrency: 'no-concurrent-writes',
    sharedWritePolicy: 'enabled',
    concurrentMutation: 'unsupported',
    homePatch: 'shared',
    homePatchIsolation: 'unavailable',
    profileFallback: 'shared',
    state: 'incompatible',
    reason: 'source-overlaps-runtime',
  })
  await assert.rejects(() => reader.listSessions(), /overlaps the Cocode runtime home/)
  await reader.dispose()
})

test('rejects nested source/runtime overlap in either direction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-overlap-nested-'))
  roots.push(root)
  const source = join(root, 'official')
  const runtime = join(source, 'runtime')
  mkdirSync(runtime, { recursive: true })
  const reader = createExternalDshReadSource({ sourceHome: source, runtimeHome: runtime, watch: false })
  assert.equal((await reader.getStatus()).reason, 'source-overlaps-runtime')
  await reader.dispose()
})

test('fails soft for an unsupported session format without rewriting the file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-incompatible-session-'))
  roots.push(root)
  const file = join(root, 'sessions', 'project', 'session-new', 'session.jsonl')
  mkdirSync(join(root, 'sessions', 'project', 'session-new'), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ type: 'session', version: 99, id: 'session-new', createdAt: 1 })}\n`)
  const before = readFileSync(file)
  const reader = createExternalDshReadSource({ sourceHome: root, watch: false })
  const sessions = await reader.listSessions()
  assert.equal(sessions[0].status, 'incompatible')
  const history = await reader.readSessionHistory('session-new')
  assert.equal(history.status, 'incompatible')
  assert.equal(history.reason, 'session-format-version')
  assert.deepEqual(readFileSync(file), before)
  await reader.dispose()
})

test('verifies allowlisted image attachments and enforces dimensions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cocode-attachment-'))
  roots.push(root)
  mkdirSync(join(root, 'attachments'), { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  writeFileSync(join(root, 'attachments', 'one.png'), png)
  const reader = createExternalDshReadSource({ sourceHome: root, enableAttachments: true, watch: false })
  const attachment = await reader.readAttachment({ path: 'one.png', mimeType: 'image/png' })
  assert.equal(attachment.width, 1)
  assert.equal(attachment.height, 1)
  assert.equal(attachment.canMutate, true)
  await reader.dispose()

  const oversized = Buffer.alloc(24)
  oversized.set([0x89, 0x50, 0x4e, 0x47], 0)
  oversized.set([0x49, 0x48, 0x44, 0x52], 12)
  oversized[16] = 0x00
  oversized[17] = 0x00
  oversized[18] = 0x4e
  oversized[19] = 0x20
  oversized[23] = 0x01
  writeFileSync(join(root, 'attachments', 'oversized.png'), oversized)
  const limited = createExternalDshReadSource({ sourceHome: root, enableAttachments: true, maxImageDimension: 1000, watch: false })
  await assert.rejects(() => limited.readAttachment({ path: 'oversized.png' }), /dimensions exceed configured limit/)
  await limited.dispose()
})
