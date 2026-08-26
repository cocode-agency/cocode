import { describe, expect, it } from 'vitest'
import {
  mintPersonalKey,
  pollDeviceToken,
  revokeToken,
  startDeviceAuthorization,
} from '../../../src/runtime/auth/device-flow.ts'
import { KEY_NAME } from '../../../src/runtime/auth/types.ts'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('device-flow', () => {
  it('classifies agency transport failures and keeps the underlying cause', async () => {
    await expect(
      startDeviceAuthorization('https://cocode.agency', {
        fetch: async () => {
          throw new TypeError('fetch failed', { cause: new Error('connect ECONNRESET') })
        },
      }),
    ).rejects.toThrow(
      'AUTH_NETWORK_FAILED · Could not reach Cocode Agency: fetch failed: connect ECONNRESET.',
    )
  })

  it('starts an authorization', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return json(201, {
        device_code: 'dc',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://cocode.agency/device',
        verification_uri_complete: 'https://cocode.agency/device?user_code=WDJB-MJHT',
        expires_in: 600,
        interval: 1,
      })
    }
    const started = await startDeviceAuthorization('https://cocode.agency', {
      fetch: fetchImpl,
    })
    expect(started.user_code).toBe('WDJB-MJHT')
    expect(requestBody?.device_label).toBe(KEY_NAME)
    expect(String(requestBody?.device_label)).toMatch(/^Cocode Device(?: — .+)?$/)
  })

  it('polls until a token arrives', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) {
        return json(400, { code: 'authorization_pending' })
      }
      return json(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 900,
      })
    }
    const token = await pollDeviceToken(
      'https://cocode.agency',
      'dc',
      1,
      600,
      new AbortController().signal,
      { fetch: fetchImpl, delay: async () => undefined },
    )
    expect(token.access_token).toBe('at')
    expect(calls).toBe(2)
  })

  it('treats the agency pending code as still waiting', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) {
        return json(428, { code: 'device_authorization_pending' })
      }
      return json(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 900,
      })
    }
    const token = await pollDeviceToken(
      'https://cocode.agency',
      'dc',
      1,
      600,
      new AbortController().signal,
      { fetch: fetchImpl, delay: async () => undefined },
    )
    expect(token.access_token).toBe('at')
    expect(calls).toBe(2)
  })

  it('stops when the agency denies the device', async () => {
    await expect(
      pollDeviceToken('https://cocode.agency', 'dc', 1, 600, new AbortController().signal, {
        delay: async () => undefined,
        fetch: async () => json(403, { code: 'device_authorization_denied' }),
      }),
    ).rejects.toThrow(/AUTH_DEVICE_DENIED/)
  })

  it('stops when the agency reports the device code expired', async () => {
    await expect(
      pollDeviceToken('https://cocode.agency', 'dc', 1, 600, new AbortController().signal, {
        delay: async () => undefined,
        fetch: async () => json(401, { code: 'token_expired' }),
      }),
    ).rejects.toThrow(/AUTH_DEVICE_EXPIRED/)
  })

  it('slows down when asked', async () => {
    let calls = 0
    let lastWait = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return json(400, { error: 'slow_down' })
      return json(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 1,
      })
    }
    await pollDeviceToken('https://cocode.agency', 'dc', 2, 600, new AbortController().signal, {
      fetch: fetchImpl,
      delay: async (ms) => {
        lastWait = ms
      },
    })
    expect(lastWait).toBe(7000)
  })

  it('stops polling when the device authorization expires', async () => {
    let now = 0
    await expect(
      pollDeviceToken('https://cocode.agency', 'dc', 1, 1, new AbortController().signal, {
        now: () => {
          const value = now
          now = 1001
          return value
        },
        delay: async () => undefined,
        fetch: async () => json(400, { code: 'authorization_pending' }),
      }),
    ).rejects.toThrow(/AUTH_DEVICE_EXPIRED/)
  })

  it('returns the minted secret once', async () => {
    let requestBody: Record<string, unknown> | undefined
    const minted = await mintPersonalKey('https://cocode.agency', 'at', {
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return json(201, { secret: 'ck_live_secret', id: 'key-1' })
      },
    })
    expect(minted).toEqual({ secret: 'ck_live_secret', id: 'key-1' })
    expect(requestBody?.name).toBe(KEY_NAME)
  })

  it('rejects unsafe verification URLs', async () => {
    await expect(
      startDeviceAuthorization('https://cocode.agency', {
        fetch: async () =>
          json(201, {
            device_code: 'dc',
            user_code: 'CODE',
            verification_uri: 'javascript:alert(1)',
            verification_uri_complete: 'https://cocode.agency/device?code=CODE',
            expires_in: 600,
            interval: 1,
          }),
      }),
    ).rejects.toThrow(/AUTH_VERIFY_URL_HTTPS/)
  })

  it('revoke failures still resolve', async () => {
    await expect(
      revokeToken('https://cocode.agency', 'rt', {
        fetch: async () => {
          throw new Error('offline')
        },
      }),
    ).resolves.toBeUndefined()
  })
})
