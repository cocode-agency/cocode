import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { patchCredential } from '../../../src/runtime/auth/credentials.ts'
import { deviceKeyName } from '../../../src/runtime/auth/device-name.ts'
import { resolveAuth } from '../../../src/runtime/auth/resolve.ts'
import { settingsPath } from '../../../src/runtime/auth/paths.ts'
import { patchCloudRoute } from '../../../src/runtime/auth/settings.ts'

const homes: string[] = []

async function writeSettings(home: string, contents: string): Promise<void> {
  const path = settingsPath(home)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'cocode-resolve-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('resolveAuth', () => {
  it('uses deterministic device-oriented API key names', () => {
    expect(deviceKeyName('  my   laptop  ')).toBe('Cocode Device — my laptop')
    expect(deviceKeyName('   ')).toBe('Cocode Device')
    expect(deviceKeyName('x'.repeat(100))).toHaveLength('Cocode Device — '.length + 80)
  })
  it('prefers process env over the credential file', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-file')
    const result = await resolveAuth({
      home,
      env: { DEEPSEEK_API_KEY: 'sk-env' },
      cwd: '/work',
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.auth.mode).toBe('byok')
    expect(result.auth.env.DEEPSEEK_API_KEY).toBe('sk-env')
    expect(result.auth.env.COCODE_HOME).toBe(join(homedir(), '.cocode'))
    expect(result.auth.env.COCODE_DSH_HOME).toBe(join(homedir(), '.dsh'))
    expect(result.auth.env.DSH_HOME).toBe(join(homedir(), '.dsh'))
    expect(result.auth.env.DSH_PROFILE).toBe('cocode')
  })

  it('skips the gate when a shared DeepSeek key exists', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-file')
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.auth.provider).toBe('deepseek-official')
    expect(result.auth.env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('uses cloud when the account and key are both present', async () => {
    const home = await tempHome()
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    await expect(readFile(join(home, 'settings.yaml'), 'utf8')).resolves.toContain(
      'api: openai-responses',
    )
    await expect(readFile(join(home, 'settings.yaml'), 'utf8')).resolves.toContain(
      'maxRetries: 5',
    )
    const result = await resolveAuth({
      home,
      env: {},
      cwd: '/work',
      accountHome: home,
      cloudAccount: true,
      cloudModels: [{ id: 'cloud-1', name: 'Cloud' }],
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.auth.mode).toBe('cocode')
    expect(result.auth.provider).toBe('cocode-nut')
    const providers = JSON.parse(result.auth.env.COCODE_LLM_PROVIDERS ?? '{}')
    expect(providers['cocode-nut'].retryPolicy).toEqual({ mode: 'normal', maxRetries: 5 })
  })

  it('opens the gate when nothing is configured', async () => {
    const home = await tempHome()
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result).toMatchObject({ status: 'gate', home })
  })

  it('does not treat a cloud key without a route as ready', async () => {
    const home = await tempHome()
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result.status).toBe('gate')
  })

  it('does not trust a persisted cloud route without an account', async () => {
    const home = await tempHome()
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result.status).toBe('gate')
  })

  it('uses the configured credential ref for a non-DeepSeek provider', async () => {
    const home = await tempHome()
    await writeSettings(
      home,
      [
        'agent-default-model:',
        '  provider: ai-gateway',
        '  model: gateway-model',
        'llm-pi-ai:',
        '  providers:',
        '    ai-gateway:',
        '      apiKeyEnv: AI_GATEWAY_API_KEY',
        '      baseURL: https://gateway.example/v1',
        '      api: openai-responses',
        '      models:',
        '        - id: gateway-model',
      ].join('\n'),
    )
    await patchCredential(home, 'AI_GATEWAY_API_KEY', 'gateway-secret')
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.auth.provider).toBe('ai-gateway')
    expect(result.auth.env.AI_GATEWAY_API_KEY).toBeUndefined()
    expect(result.auth.env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('does not use a DeepSeek key for a configured non-DeepSeek provider', async () => {
    const home = await tempHome()
    await writeSettings(
      home,
      'agent-default-model:\n  provider: ai-gateway\n  model: gateway-model\n',
    )
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-wrong-provider')
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result.status).toBe('gate')
  })

  it('accepts a route explicitly locked by the environment', async () => {
    const home = await tempHome()
    await writeSettings(
      home,
      [
        'agent-default-model:',
        '  provider: ai-gateway',
        '  model: gateway-model',
        'llm-pi-ai:',
        '  providers:',
        '    ai-gateway:',
        '      apiKeyEnv: AI_GATEWAY_API_KEY',
        '      writable: false',
      ].join('\n'),
    )
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.auth.provider).toBe('ai-gateway')
  })

  it('prefers agent-default-model when both channels are configured', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-file')
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await writeSettings(
      home,
      [
        'agent-default-model:',
        '  provider: deepseek-official',
        '  model: deepseek-v4-flash',
        'llm-pi-ai:',
        '  providers:',
        '    cocode-nut:',
        '      apiKeyEnv: COCODE_NUT_API_KEY',
        '      baseURL: https://cocode.agency/v1',
      ].join('\n'),
    )
    const result = await resolveAuth({
      home,
      env: { DEEPSEEK_API_KEY: 'sk-env', COCODE_NUT_API_KEY: 'ck_env' },
      cwd: '/work',
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.auth.mode).toBe('byok')
    expect(result.auth.provider).toBe('deepseek-official')
    expect(result.auth.env.DEEPSEEK_API_KEY).toBe('sk-env')
    expect(result.auth.env.COCODE_NUT_API_KEY).toBeUndefined()
  })

  it('falls back to BYOK when the preferred Cloud channel is gone', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-file')
    await writeSettings(
      home,
      'agent-default-model:\n  provider: cocode-nut\n  model: cloud-1\n',
    )
    const result = await resolveAuth({ home, env: {}, cwd: '/work' })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.auth.mode).toBe('byok')
  })

  it('fails explicitly for an invalid agency origin', async () => {
    const home = await tempHome()
    await expect(
      resolveAuth({
        home,
        env: { COCODE_AGENCY_ORIGIN: 'http://evil.example' },
        cwd: '/work',
      }),
    ).rejects.toThrow(/AUTH_ORIGIN_HTTPS/)
  })
})
