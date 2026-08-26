import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAccount, writeAccount } from '../../../src/runtime/auth/account.ts'
import { patchCredential, readCredentials } from '../../../src/runtime/auth/credentials.ts'
import { createAuthStore } from '../../../src/runtime/auth/store.ts'
import { patchCloudRoute, readSettings } from '../../../src/runtime/auth/settings.ts'
import { registerLiveInstance } from '../../../src/runtime/auth/live-instances.ts'
import type { AuthSnapshot } from '../../../src/runtime/auth/types.ts'

const homes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'cocode-store-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

function waitFor(
  store: { snapshot(): AuthSnapshot; subscribe(listener: () => void): () => void },
  match: (snapshot: AuthSnapshot) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (match(store.snapshot())) {
      resolve()
      return
    }
    const timeout = setTimeout(() => {
      stop()
      reject(new Error(`timed out in phase ${store.snapshot().phase}`))
    }, 2000)
    const stop = store.subscribe(() => {
      if (!match(store.snapshot())) return
      clearTimeout(timeout)
      stop()
      resolve()
    })
  })
}

describe('AuthStore', () => {
  it('keeps Cocode account data separate from the DSH home', async () => {
    const accountHome = await tempHome()
    const dshHome = await tempHome()
    await patchCredential(dshHome, 'DEEPSEEK_API_KEY', 'sk-dsh')

    const store = await createAuthStore({ accountHome, dshHome, env: {} })

    expect(store.snapshot().phase).toBe('ready')
    expect(store.resolved()).toMatchObject({ accountHome, dshHome })
    expect(await readAccount(accountHome)).toBeUndefined()
    expect(await readCredentials(dshHome)).toEqual({ DEEPSEEK_API_KEY: 'sk-dsh' })
  })

  it('rebuilds a runtime provider when a legacy cloud route is present', async () => {
    const accountHome = await tempHome()
    const dshHome = await tempHome()
    await writeAccount(accountHome, {
      origin: 'https://cocode.agency',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: Date.now() + 60_000,
      personalKeyId: 'key-1',
    })
    await patchCredential(dshHome, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(dshHome, 'https://cocode.agency', [
      { id: 'cloud-1', name: 'Cloud 1' },
    ])
    const store = await createAuthStore({
      accountHome,
      dshHome,
      env: {},
      client: {
        fetch: async (input) =>
          String(input).endsWith('/v1/me/models')
            ? json(200, {
                data: [
                  { id: 'cloud-1', name: 'Cloud 1' },
                  { id: 'cloud-2', name: 'Cloud 2' },
                ],
              })
            : json(404, { title: 'missing' }),
      },
    })

    expect(store.snapshot().mode).toBe('cocode')
    expect((await readSettings(dshHome)).hasCloudRoute).toBe(true)
    const providerConfig = JSON.parse(store.resolved().env.COCODE_LLM_PROVIDERS ?? '{}')
    expect(providerConfig['cocode-nut'].api).toBe('openai-responses')
    expect(providerConfig['cocode-nut'].reasoning).toBe('high')
    expect(providerConfig['cocode-nut'].retryPolicy).toEqual({ mode: 'normal', maxRetries: 5 })
    expect(providerConfig['cocode-nut'].models).toHaveLength(2)
  })

  it('starts at the gate with an empty home', async () => {
    const store = await createAuthStore({ home: await tempHome(), env: {} })
    expect(store.snapshot().phase).toBe('gate')
    expect(() => store.resolved()).toThrow(/AUTH_NOT_READY/)
  })

  it('writes a BYOK key in harness mapping form', async () => {
    const accountHome = await tempHome()
    const dshHome = await tempHome()
    const store = await createAuthStore({ accountHome, dshHome, env: {} })
    store.dispatch({
      type: 'submitByok',
      provider: 'deepseek-official',
      key: 'sk-user',
    })
    await store.waitUntilReady()
    expect(store.snapshot().phase).toBe('ready')
    expect(store.snapshot().mode).toBe('byok')
    expect(JSON.stringify(store.snapshot())).not.toMatch(/sk-user/)
    expect(await readAccount(accountHome)).toBeUndefined()
    expect(await readCredentials(dshHome)).toEqual({
      DEEPSEEK_API_KEY: 'sk-user',
    })
    expect(store.resolved().env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('logs in with device flow and keeps an existing BYOK key', async () => {
    const home = await tempHome()
    const byokStore = await createAuthStore({ home, env: {} })
    byokStore.dispatch({
      type: 'submitByok',
      provider: 'deepseek-official',
      key: 'sk-keep',
    })
    await byokStore.waitUntilReady()

    let tokenCalls = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/auth/device/authorizations')) {
        return json(201, {
          device_code: 'dc',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://cocode.agency/device',
          verification_uri_complete: 'https://cocode.agency/device?user_code=ABCD-EFGH',
          expires_in: 600,
          interval: 1,
        })
      }
      if (url.endsWith('/v1/auth/device/token')) {
        tokenCalls += 1
        return json(200, {
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          expires_in: 900,
        })
      }
      if (url.endsWith('/v1/me') && !url.includes('api-keys') && !url.includes('models')) {
        return json(200, {
          user: { display_name: 'Ada', email: 'ada@example.com' },
        })
      }
      if (url.endsWith('/v1/me/api-keys')) {
        return json(201, { secret: 'ck_live_new', id: 'key-1' })
      }
      if (url.endsWith('/v1/me/models')) {
        return json(200, {
          data: [
            { id: 'cloud-1', name: 'Cloud 1' },
            { id: 'cloud-2', name: 'Cloud 2' },
          ],
        })
      }
      if (url.endsWith('/v1/auth/token/revoke')) {
        return new Response(null, { status: 204 })
      }
      return json(404, { title: 'missing' })
    }

    const opened: string[] = []
    const store = await createAuthStore({
      home,
      env: {},
      client: { fetch: fetchImpl, delay: async () => undefined },
      openUrl: (url) => opened.push(url),
    })
    expect(store.snapshot().phase).toBe('ready')
    store.dispatch({ type: 'chooseCocode' })
    await waitFor(store, (snap) => snap.mode === 'cocode' && snap.phase === 'ready')
    const ready = store.resolved()
    expect(ready.mode).toBe('cocode')
    expect(store.snapshot().device).toBeUndefined()
    expect(JSON.stringify(store.snapshot())).not.toMatch(/access-secret|ck_live/)
    expect(opened[0]).toContain('user_code=ABCD-EFGH')
    expect((await readCredentials(home)).DEEPSEEK_API_KEY).toBe('sk-keep')
    expect((await readCredentials(home)).COCODE_NUT_API_KEY).toBe('ck_live_new')
    expect((await readSettings(home)).hasCloudRoute).toBe(true)
    expect(await readAccount(home)).toMatchObject({ personalKeyId: 'key-1' })
    const providerConfig = JSON.parse(store.resolved().env.COCODE_LLM_PROVIDERS ?? '{}')
    expect(providerConfig['cocode-nut'].api).toBe('openai-responses')
    expect(providerConfig['cocode-nut'].reasoning).toBe('high')
    expect(providerConfig['cocode-nut'].retryPolicy).toEqual({ mode: 'normal', maxRetries: 5 })
    expect(providerConfig['cocode-nut'].models).toEqual([
      { id: 'cloud-1', name: 'Cloud 1' },
      { id: 'cloud-2', name: 'Cloud 2' },
    ])
    expect(tokenCalls).toBe(1)
  })

  it('keeps BYOK ready after logout when a key remains', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-keep')
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    await writeAccount(home, {
      origin: 'https://cocode.agency',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: Date.now() + 60_000,
      personalKeyId: 'key-1',
    })
    const store = await createAuthStore({
      home,
      env: {},
      client: { fetch: async () => new Response(null, { status: 204 }) },
    })
    expect(store.snapshot().mode).toBe('cocode')
    await store.logout()
    expect(store.snapshot().phase).toBe('ready')
    expect(store.snapshot().mode).toBe('byok')
    expect(await readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-keep' })
    expect(store.resolved().env.COCODE_NUT_API_KEY).toBeUndefined()
    expect((await readSettings(home)).provider).toBe('deepseek-official')
  })

  it('selectMode switches the default provider without dropping the other secret', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-keep')
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    await writeAccount(home, {
      origin: 'https://cocode.agency',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: Date.now() + 60_000,
      personalKeyId: 'key-1',
    })
    const store = await createAuthStore({ home, env: {} })
    expect(store.snapshot().mode).toBe('cocode')
    const used = await store.selectMode('byok')
    expect(used).toEqual({ status: 'ready' })
    expect(store.snapshot().mode).toBe('byok')
    expect((await readSettings(home)).provider).toBe('deepseek-official')
    expect(await readCredentials(home)).toMatchObject({
      DEEPSEEK_API_KEY: 'sk-keep',
      COCODE_NUT_API_KEY: 'ck_live_x',
    })
    expect(store.resolved().env.COCODE_NUT_API_KEY).toBeUndefined()
  })

  it('selectMode asks for a key when BYOK is missing', async () => {
    const home = await tempHome()
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    await writeAccount(home, {
      origin: 'https://cocode.agency',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: Date.now() + 60_000,
      personalKeyId: 'key-1',
    })
    const store = await createAuthStore({ home, env: {} })
    expect(await store.selectMode('byok')).toEqual({ status: 'need-byok' })
    expect(store.snapshot().mode).toBe('cocode')
  })

  it('requires a Cocode account when only a legacy route exists', async () => {
    const home = await tempHome()
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    const store = await createAuthStore({ home, env: {} })
    expect(store.snapshot().phase).toBe('gate')
    expect(await store.selectMode('cocode')).toEqual({ status: 'need-login' })
  })

  it('uses a hosted model when switching back from BYOK', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-keep')
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await writeAccount(home, {
      origin: 'https://cocode.agency',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: Date.now() + 60_000,
      personalKeyId: 'key-1',
    })
    const store = await createAuthStore({
      home,
      env: {},
      client: {
        fetch: async (input) =>
          String(input).endsWith('/v1/me/models')
            ? json(200, { data: [{ id: 'cloud-1', name: 'Cloud 1' }] })
            : json(404, { title: 'missing' }),
      },
    })

    expect(await store.selectMode('byok')).toEqual({ status: 'ready' })
    expect(await store.selectMode('cocode')).toEqual({ status: 'ready' })
    expect(store.resolved().model).toBe('cloud-1')
    expect((await readSettings(home)).model).toBe('cloud-1')
  })

  it('selectMode refuses when COCODE_PROVIDER is set', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-keep')
    const store = await createAuthStore({
      home,
      env: { COCODE_PROVIDER: 'deepseek-official' },
    })
    expect(await store.selectMode('cocode')).toEqual({ status: 'env-locked' })
  })

  it('selectMode refuses when another TUI shares the home', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-keep')
    const live = {
      pid: 99,
      isAlive: (pid: number) => pid === 7 || pid === 99,
    }
    await registerLiveInstance(join(home, 'runtime'), { pid: 7, isAlive: live.isAlive })
    const store = await createAuthStore({ home, env: {}, live })
    expect(await store.selectMode('byok')).toEqual({ status: 'home-busy' })
  })

  it('keeps TUI live-instance markers in the Cocode account home', async () => {
    const accountHome = await tempHome()
    const dshHome = await tempHome()
    await patchCredential(dshHome, 'DEEPSEEK_API_KEY', 'sk-keep')
    const live = {
      pid: 99,
      isAlive: (pid: number) => pid === 7 || pid === 99,
    }
    await registerLiveInstance(join(accountHome, 'runtime'), { pid: 7, isAlive: live.isAlive })
    const store = await createAuthStore({ accountHome, dshHome, env: {}, live })

    expect(await store.selectMode('byok')).toEqual({ status: 'home-busy' })
  })

  it('logout refuses when another TUI shares the home', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-keep')
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_x')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    const live = {
      pid: 99,
      isAlive: (pid: number) => pid === 7 || pid === 99,
    }
    await registerLiveInstance(join(home, 'runtime'), { pid: 7, isAlive: live.isAlive })
    const store = await createAuthStore({
      home,
      env: {},
      live,
      client: { fetch: async () => new Response(null, { status: 204 }) },
    })
    await expect(store.logout()).rejects.toMatchObject({ code: 'AUTH_HOME_BUSY' })
    expect((await readCredentials(home)).COCODE_NUT_API_KEY).toBe('ck_live_x')
  })

  it('refreshes an expiring Cloud account before resolving it', async () => {
    const home = await tempHome()
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_existing')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    await writeAccount(home, {
      origin: 'https://cocode.agency',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      accessExpiresAt: Date.now() + 1_000,
      personalKeyId: 'key-1',
      personalKeyName: 'Cocode Device — test-host',
    })
    let refreshCalls = 0
    const store = await createAuthStore({
      home,
      env: {},
      client: {
        fetch: async (input) => {
          expect(String(input)).toContain('/v1/auth/token/refresh')
          refreshCalls += 1
          return json(200, {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 900,
          })
        },
      },
    })
    expect(store.snapshot().phase).toBe('ready')
    expect(refreshCalls).toBe(1)
    expect((await readAccount(home))?.accessToken).toBe('new-access')
  })

  it('clears failed Cloud refresh state while preserving BYOK', async () => {
    const home = await tempHome()
    await patchCredential(home, 'DEEPSEEK_API_KEY', 'sk-keep')
    await patchCredential(home, 'COCODE_NUT_API_KEY', 'ck_live_existing')
    await patchCloudRoute(home, 'https://cocode.agency', [{ id: 'cloud-1', name: 'Cloud' }])
    await writeAccount(home, {
      origin: 'https://cocode.agency',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      accessExpiresAt: Date.now() + 1_000,
      personalKeyId: 'key-1',
    })
    const store = await createAuthStore({
      home,
      env: {},
      client: {
        fetch: async () => json(401, { code: 'invalid_grant' }),
      },
    })
    expect(store.snapshot().mode).toBe('byok')
    expect(await readAccount(home)).toBeUndefined()
    expect(await readCredentials(home)).toEqual({ DEEPSEEK_API_KEY: 'sk-keep' })
    expect((await readSettings(home)).hasCloudRoute).toBe(false)
  })

  it('does not persist a Cloud key when model validation fails', async () => {
    const home = await tempHome()
    const store = await createAuthStore({
      home,
      env: {},
      client: {
        fetch: async (input) => {
          const url = String(input)
          if (url.endsWith('/v1/auth/device/authorizations')) {
            return json(201, {
              device_code: 'dc',
              user_code: 'ABCD-EFGH',
              verification_uri: 'https://cocode.agency/device',
              verification_uri_complete: 'https://cocode.agency/device?user_code=ABCD-EFGH',
              expires_in: 600,
              interval: 1,
            })
          }
          if (url.endsWith('/v1/auth/device/token')) {
            return json(200, {
              access_token: 'access',
              refresh_token: 'refresh',
              expires_in: 900,
            })
          }
          if (url.endsWith('/v1/me')) {
            return json(200, { user: { display_name: 'Ada' } })
          }
          if (url.endsWith('/v1/me/api-keys')) {
            return json(201, { secret: 'ck_live_new', id: 'key-1' })
          }
          if (url.endsWith('/v1/me/models')) return json(200, { data: [] })
          return json(404, { title: 'missing' })
        },
        delay: async () => undefined,
      },
      openUrl: () => undefined,
    })
    store.dispatch({ type: 'chooseCocode' })
    await waitFor(store, (snap) => snap.phase === 'failed')
    expect((await readCredentials(home)).COCODE_NUT_API_KEY).toBeUndefined()
    expect(await readAccount(home)).toBeUndefined()
  })

  it('does not continue a device operation after cancellation', async () => {
    const home = await tempHome()
    const store = await createAuthStore({
      home,
      env: {},
      client: {
        fetch: async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
          }),
      },
    })
    store.dispatch({ type: 'chooseCocode' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.dispatch({ type: 'cancel' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.snapshot().phase).toBe('gate')
    expect(await readCredentials(home)).toEqual({})
    expect(await readAccount(home)).toBeUndefined()
  })
})
