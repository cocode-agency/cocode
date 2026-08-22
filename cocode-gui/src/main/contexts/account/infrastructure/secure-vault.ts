import { app, safeStorage } from "electron"
import { readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "pathe"
import { secureStorageUnavailableMessage } from "./secure-storage-policy"

const STORAGE_RETRY_DELAYS_MS = [0, 250, 1_000, 2_000] as const
const STORAGE_OPERATION_TIMEOUT_MS = 5_000

export type SecureStorageBackend =
	| "basic_text"
	| "gnome_libsecret"
	| "kwallet"
	| "kwallet5"
	| "kwallet6"
	| "unknown"

type SafeStorageApi = {
	readonly isEncryptionAvailable?: () => boolean
	readonly isAsyncEncryptionAvailable?: () => Promise<boolean>
	readonly getSelectedStorageBackend?: () => SecureStorageBackend
	readonly decryptString?: (encrypted: Buffer) => string
	readonly decryptStringAsync?: (
		encrypted: Buffer,
	) => Promise<{ readonly shouldReEncrypt: boolean; readonly result: string }>
	readonly encryptString?: (plainText: string) => Buffer
	readonly encryptStringAsync?: (plainText: string) => Promise<Buffer>
}

type ResolvedStorage = {
	readonly api: SafeStorageApi
	readonly mode: "async" | "sync"
}

export type SecureVaultStatus =
	| { readonly state: "unknown" }
	| {
			readonly state: "available"
			readonly backend: SecureStorageBackend
	  }
	| {
			readonly state: "unavailable"
			readonly backend: SecureStorageBackend
			readonly reason: "missing-keyring" | "unsupported"
	  }

export class SecureStorageUnavailableError extends Error {
	readonly code = "SECURE_STORAGE_UNAVAILABLE"
	readonly backend: SecureStorageBackend

	constructor(backend: SecureStorageBackend) {
		super(secureStorageUnavailableMessage(backend))
		this.name = "SecureStorageUnavailableError"
		this.backend = backend
	}
}

export class SecureVault<T> {
	private loaded = false
	private value: T | undefined
	private readTask: Promise<T | undefined> | undefined
	private status: SecureVaultStatus = { state: "unknown" }
	private unavailableReported = false

	constructor(private readonly filename: string) {}

	getStatus(): SecureVaultStatus {
		return this.status
	}

	async read(): Promise<T | undefined> {
		if (this.loaded) return this.value
		if (this.readTask !== undefined) return this.readTask
		const task = this.load()
		this.readTask = task
		try {
			return await task
		} finally {
			if (this.readTask === task) this.readTask = undefined
		}
	}

	async write(value: T): Promise<void> {
		const storage = await this.resolveStorage()
		if (storage === undefined) throw new SecureStorageUnavailableError(this.backend())
		const plainText = JSON.stringify(value)
		let encrypted: Buffer
		try {
			encrypted = await encryptStorage(storage, plainText)
		} catch (error) {
			if (storage.mode === "async") {
				this.markUnavailable()
				throw new SecureStorageUnavailableError(this.backend())
			}
			throw error
		}
		await writeFile(join(app.getPath("userData"), this.filename), encrypted, { mode: 0o600 })
		this.value = value
		this.loaded = true
	}

	async clear(): Promise<void> {
		this.value = undefined
		this.loaded = true
		this.readTask = undefined
		try {
			await unlink(join(app.getPath("userData"), this.filename))
		} catch {
			// Idempotent cleanup.
		}
	}

	private async load(): Promise<T | undefined> {
		const storage = await this.resolveStorage()
		// Do not set `loaded` here. A keyring can become available later in the
		// same process, and a subsequent read should retry instead of being
		// permanently stuck at an empty value.
		if (storage === undefined) return undefined
		let encrypted: Buffer
		try {
			encrypted = await readFile(join(app.getPath("userData"), this.filename))
		} catch {
			this.value = undefined
			this.loaded = true
			return this.value
		}
		let plainText: string
		try {
			plainText =
				storage.mode === "async"
					? (
							await withTimeout(
								storage.api.decryptStringAsync!(encrypted),
								STORAGE_OPERATION_TIMEOUT_MS,
							)
					  ).result
					: storage.api.decryptString!(encrypted)
		} catch {
			if (storage.mode === "async") {
				this.markUnavailable()
				return undefined
			}
			this.value = undefined
			this.loaded = true
			return this.value
		}
		try {
			this.value = JSON.parse(plainText) as T
		} catch {
			this.value = undefined
		}
		this.loaded = true
		return this.value
	}

	private async resolveStorage(): Promise<ResolvedStorage | undefined> {
		// Linux Cocode account data uses the shared file contract. SecureVault is
		// retained for non-Linux private/legacy data and must not initialize a
		// desktop keyring as a hidden Linux prerequisite.
		if (process.platform === "linux") {
			this.status = {
				state: "unavailable",
				backend: "unknown",
				reason: "unsupported",
			}
			this.reportUnavailable()
			return undefined
		}
		await app.whenReady()
		const storage = safeStorage as SafeStorageApi | undefined
		if (
			storage === undefined ||
			(typeof storage.isEncryptionAvailable !== "function" &&
				typeof storage.isAsyncEncryptionAvailable !== "function")
		) {
			this.status = {
				state: "unavailable",
				backend: "unknown",
				reason: "unsupported",
			}
			this.reportUnavailable()
			return undefined
		}

		for (const delay of STORAGE_RETRY_DELAYS_MS) {
			if (delay > 0) await wait(delay)
			const backend = this.backend()
			const mode = await availableStorageMode(storage)
			if (mode !== undefined) {
				this.status = {
					state: "available",
					backend,
				}
				return { api: storage, mode }
			}
		}

		this.status = {
			state: "unavailable",
			backend: this.backend(),
			reason: "missing-keyring",
		}
		this.reportUnavailable()
		return undefined
	}

	private backend(): SecureStorageBackend {
		const storage = safeStorage as SafeStorageApi | undefined
		try {
			return storage?.getSelectedStorageBackend?.() ?? "unknown"
		} catch {
			return "unknown"
		}
	}

	private reportUnavailable(): void {
		if (this.unavailableReported) return
		this.unavailableReported = true
		console.warn(
			`[secure-vault:${this.filename}] ${secureStorageUnavailableMessage(this.backend())}`,
		)
	}

	private markUnavailable(): void {
		this.status = {
			state: "unavailable",
			backend: this.backend(),
			reason: "missing-keyring",
		}
		this.reportUnavailable()
	}
}

async function availableStorageMode(
	storage: SafeStorageApi,
): Promise<"async" | "sync" | undefined> {
	if (
		typeof storage.isAsyncEncryptionAvailable === "function" &&
		typeof storage.encryptStringAsync === "function" &&
		typeof storage.decryptStringAsync === "function"
	) {
		try {
			if (
				await withTimeout(
					storage.isAsyncEncryptionAvailable(),
					STORAGE_OPERATION_TIMEOUT_MS,
				)
			)
				return "async"
		} catch {
			// Fall back to the synchronous probe below.
		}
	}
	try {
		if (
			typeof storage.isEncryptionAvailable === "function" &&
			storage.isEncryptionAvailable() === true &&
			typeof storage.encryptString === "function" &&
			typeof storage.decryptString === "function"
		)
			return "sync"
	} catch {
		// Continue with the unavailable path below.
	}
	return undefined
}

async function encryptStorage(storage: ResolvedStorage, plainText: string): Promise<Buffer> {
	return storage.mode === "async"
		? withTimeout(storage.api.encryptStringAsync!(plainText), STORAGE_OPERATION_TIMEOUT_MS)
		: storage.api.encryptString!(plainText)
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("secure storage operation timed out")),
					milliseconds,
				)
			}),
		])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}
