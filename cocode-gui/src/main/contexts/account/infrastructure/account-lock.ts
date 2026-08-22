import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises"
import { dirname, join } from "pathe"

const STALE_LOCK_MS = 120_000
const LOCK_WAIT_MS = 10_000
const LOCK_POLL_MS = 50
const LOCK_HEARTBEAT_MS = 10_000
const LOCK_OWNER_FILE = "owner.json"
const PROCESS_INSTANCE_ID = randomUUID()

type LockOwner = {
	readonly version: 1
	readonly pid: number
	readonly instanceId: string
	readonly token: string
	readonly createdAt: number
}

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>()
const localQueues = new Map<string, Promise<void>>()
const activeTokens = new Map<string, string>()

export class AccountLockBusyError extends Error {
	readonly code = "ACCOUNT_BUSY"

	constructor() {
		super("Cocode account is busy in another client")
		this.name = "AccountLockBusyError"
	}
}

/**
 * Serialize GUI and TUI account mutations through an owner-aware directory
 * lock. The owner metadata lets a new process recover a lock immediately after
 * a crash, while AsyncLocalStorage makes nested operations in one process
 * reentrant instead of deadlocking against themselves.
 */
export async function withAccountLock<T>(
	accountFile: string,
	operation: () => Promise<T>,
): Promise<T> {
	const lock = `${accountFile}.lock`
	if (heldLocks.getStore()?.has(lock) === true) return operation()
	return withLocalQueue(lock, async () => {
		const token = await acquireLock(lock)
		const inherited = heldLocks.getStore()
		const current = new Set(inherited ?? [])
		current.add(lock)
		const stopHeartbeat = startHeartbeat(lock, token)
		try {
			return await heldLocks.run(current, operation)
		} finally {
			stopHeartbeat()
			await releaseLock(lock, token)
		}
	})
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

async function acquireLock(lock: string): Promise<string> {
	await mkdir(dirname(lock), { recursive: true, mode: 0o700 })
	const deadline = Date.now() + LOCK_WAIT_MS
	for (;;) {
		const token = randomUUID()
		try {
			await mkdir(lock, { mode: 0o700 })
			const owner: LockOwner = {
				version: 1,
				pid: process.pid,
				instanceId: PROCESS_INSTANCE_ID,
				token,
				createdAt: Date.now(),
			}
			try {
				await writeFile(join(lock, LOCK_OWNER_FILE), JSON.stringify(owner), { mode: 0o600 })
			} catch (error) {
				await rm(lock, { recursive: true, force: true })
				throw error
			}
			activeTokens.set(lock, token)
			return token
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		}
		if (await recoverAbandonedLock(lock)) continue
		if (Date.now() >= deadline) throw new AccountLockBusyError()
		await wait(LOCK_POLL_MS)
	}
}

async function recoverAbandonedLock(lock: string): Promise<boolean> {
	let metadata
	try {
		metadata = await stat(lock)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
		throw error
	}
	const owner = await readOwner(lock)
	const stale = Date.now() - metadata.mtimeMs > STALE_LOCK_MS
	// A live owner always wins, even when the heartbeat is delayed by a
	// suspended/event-loop-starved process. The timeout is only a compatibility
	// fallback for locks written by older clients that have no owner metadata.
	if (owner !== undefined) {
		if (ownerIsAlive(lock, owner)) return false
	} else if (!stale) {
		return false
	}

	const abandoned = `${lock}.abandoned-${process.pid}-${randomUUID()}`
	try {
		await rename(lock, abandoned)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
		return false
	}
	await rm(abandoned, { recursive: true, force: true })
	return true
}

function ownerIsAlive(lock: string, owner: LockOwner): boolean {
	if (owner.pid === process.pid) {
		return owner.instanceId === PROCESS_INSTANCE_ID && activeTokens.get(lock) === owner.token
	}
	try {
		process.kill(owner.pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

function startHeartbeat(lock: string, token: string): () => void {
	const timer = setInterval(() => {
		if (activeTokens.get(lock) !== token) return
		void utimes(lock, new Date(), new Date()).catch(() => undefined)
	}, LOCK_HEARTBEAT_MS)
	timer.unref()
	return () => clearInterval(timer)
}

async function releaseLock(lock: string, token: string): Promise<void> {
	activeTokens.delete(lock)
	const owner = await readOwner(lock)
	if (
		owner?.token !== token ||
		owner.pid !== process.pid ||
		owner.instanceId !== PROCESS_INSTANCE_ID
	)
		return
	const released = `${lock}.released-${process.pid}-${randomUUID()}`
	try {
		await rename(lock, released)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
	await rm(released, { recursive: true, force: true })
}

async function readOwner(lock: string): Promise<LockOwner | undefined> {
	try {
		const value = JSON.parse(await readFile(join(lock, LOCK_OWNER_FILE), "utf8")) as unknown
		if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
		const owner = value as Partial<LockOwner>
		if (
			owner.version !== 1 ||
			typeof owner.pid !== "number" ||
			!Number.isSafeInteger(owner.pid) ||
			owner.pid <= 0 ||
			typeof owner.instanceId !== "string" ||
			owner.instanceId === "" ||
			typeof owner.token !== "string" ||
			owner.token === "" ||
			typeof owner.createdAt !== "number" ||
			!Number.isFinite(owner.createdAt)
		)
			return undefined
		return owner as LockOwner
	} catch {
		return undefined
	}
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
