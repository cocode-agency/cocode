import {
  CredentialsError,
  moveCredentialRef as moveHostCredentialRef,
  patchCredential as patchHostCredential,
  readCredentials as readHostCredentials,
  withCredentialsLock,
} from '@cocode-agency/host-supervisor'
import { credentialsPath } from './paths.ts'
import { TuiError } from '../errors/index.ts'
import { randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'

export async function readCredentials(home: string): Promise<Record<string, string>> {
  try {
    const credentials = await readHostCredentials(credentialsPath(home))
    const legacyKey = credentials.COCODE_CLOUD_API_KEY
    if (legacyKey !== undefined && credentials.COCODE_NUT_API_KEY === undefined) {
      await moveHostCredentialRef(credentialsPath(home), 'COCODE_CLOUD_API_KEY', 'COCODE_NUT_API_KEY')
      return await readHostCredentials(credentialsPath(home))
    }
    return credentials
  } catch (error) {
    throw toTuiCredentialError(error)
  }
}

/**
 * Read credentials for an interactive channel transition.
 *
 * A stale or hand-edited credentials document must not prevent a user from
 * signing in again. Preserve the invalid secret file under a private backup
 * name, then let the next write create a clean document.
 */
export async function readCredentialsRecovering(home: string): Promise<Record<string, string>> {
  return withCredentialsLock(credentialsPath(home), async () => {
    try {
      return await readCredentials(home)
    } catch (error) {
      if (!isRecoverableCredentialError(error)) throw error
      const path = credentialsPath(home)
      await rename(path, `${path}.invalid-${Date.now()}-${randomUUID()}`)
      return {}
    }
  })
}

export async function patchCredential(
  home: string,
  ref: string,
  value: string | undefined,
): Promise<void> {
  try {
    if (value !== undefined && value.trim() === '') throw new TuiError('AUTH_CREDENTIAL_EMPTY')
    await patchHostCredential(credentialsPath(home), ref, value === undefined ? undefined : value.trim())
  } catch (error) {
    if (error instanceof TuiError) throw error
    throw toTuiCredentialError(error)
  }
}

function toTuiCredentialError(error: unknown): TuiError {
  if (error instanceof CredentialsError) {
    if (error.code === 'CREDENTIALS_INVALID_REF') return new TuiError('AUTH_CREDENTIAL_REF')
    if (error.code === 'CREDENTIALS_EMPTY_VALUE') return new TuiError('AUTH_CREDENTIAL_EMPTY')
    if (error.code === 'CREDENTIALS_INVALID_YAML') return new TuiError('IO_PARSE')
    if (error.code === 'CREDENTIALS_PERMISSION_INVALID') return new TuiError('IO_MODE')
    if (error.code === 'CREDENTIALS_SYMLINK_REJECTED') return new TuiError('IO_SYMLINK')
    if (error.code === 'CREDENTIALS_NOT_A_FILE') return new TuiError('IO_NOT_FILE')
  }
  return new TuiError('AUTH_CREDENTIALS_PARSE')
}

function isRecoverableCredentialError(error: unknown): boolean {
  return error instanceof TuiError && (
    error.code === 'AUTH_CREDENTIALS_PARSE'
    || error.code === 'AUTH_CREDENTIAL_EMPTY'
    || error.code === 'IO_PARSE'
  )
}
