import { AsyncLocalStorage } from 'node:async_hooks'
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const LOCK_WAIT_MS = 30_000
const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200
const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>()
const localQueues = new Map<string, Promise<void>>()

/**
 * Serialize writes with the same `<file>.lock` protocol used by DSH.
 */
export async function withFileLock<T>(
  filename: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = `${filename}.lock`
  if (heldLocks.getStore()?.has(lock) === true) return operation()
  return withLocalQueue(lock, async () => {
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
    await acquireFileLock(lock)
    const current = new Set(heldLocks.getStore() ?? [])
    current.add(lock)
    try {
      return await heldLocks.run(current, operation)
    } finally {
      await rm(lock, { force: true })
    }
  })
}

async function acquireFileLock(lock: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS
  let delay = LOCK_RETRY_INITIAL_MS

  for (;;) {
    try {
      await writeFile(lock, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
      break
    } catch (error) {
      if (!(await isLockContention(error, lock))) throw error
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the credential lock at ${lock}`)
    }
    await wait(delay)
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
  }
}

async function withLocalQueue<T>(lock: string, operation: () => Promise<T>): Promise<T> {
  const previous = localQueues.get(lock) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  localQueues.set(lock, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (localQueues.get(lock) === tail) localQueues.delete(lock)
  }
}

async function isLockContention(error: unknown, lock: string): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') return true
  if (code !== 'EPERM') return false
  try {
    await lstat(lock)
    return true
  } catch {
    return false
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
