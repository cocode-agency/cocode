import { constants } from "node:fs"
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "pathe"
import { parse, stringify } from "yaml"

export type FileVaultStatus =
	| { readonly state: "unknown" }
	| { readonly state: "available"; readonly backend: "file" }
	| {
			readonly state: "unavailable"
			readonly backend: "file"
			readonly reason: "unwritable" | "corrupt"
	  }

export class FileStorageUnavailableError extends Error {
	readonly code = "FILE_STORAGE_UNAVAILABLE"

	constructor(readonly filePath: string, reason: "unwritable" | "corrupt") {
		super(
			reason === "corrupt"
				? `Cocode file storage is corrupt: ${filePath}`
				: `Cocode file storage is unavailable: ${filePath}`,
		)
		this.name = "FileStorageUnavailableError"
	}
}

/**
 * Resolve a Cocode-owned file from the shared, cross-platform logical home.
 * The physical user-directory representation remains platform-specific.
 */
export function resolveCocodeHome(
	environment: NodeJS.ProcessEnv = process.env,
	home = homedir(),
): string {
	const configured = environment.COCODE_HOME?.trim()
	const selected =
		configured === undefined || configured === "" ? join(home, ".cocode") : configured
	return resolve(expandHomePath(selected, home))
}

export function resolveCocodeFile(
	filename: string,
	environment: NodeJS.ProcessEnv = process.env,
	home = homedir(),
): string {
	return join(resolveCocodeHome(environment, home), filename)
}

/**
 * Plain file vault used for Linux Cocode-owned recovery data. It deliberately
 * does not invoke Electron safeStorage or any desktop keyring. Secret files
 * are protected by the current user's home-directory permissions.
 */
export class FileVault<T> {
	private loaded = false
	private value: T | undefined
	private readTask: Promise<T | undefined> | undefined
	private status: FileVaultStatus = { state: "unknown" }

	constructor(private readonly filePath: string) {}

	getStatus(): FileVaultStatus {
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
		const directory = dirname(this.filePath)
		try {
			await ensurePrivateDirectory(directory)
			await assertWritableTarget(this.filePath)
			const temporary = join(
				directory,
				`.${pathBasename(this.filePath)}-${process.pid}-${Date.now()}.tmp`,
			)
			const handle = await open(temporary, "wx", 0o600)
			try {
				await handle.writeFile(stringify(value), "utf8")
				if (process.platform !== "win32") await handle.chmod(0o600)
				await handle.close()
				await rename(temporary, this.filePath)
				if (process.platform !== "win32") await chmod(this.filePath, 0o600)
			} catch (error) {
				await handle.close().catch(() => undefined)
				await unlink(temporary).catch(() => undefined)
				throw error
			}
		} catch (error) {
			if (error instanceof FileStorageUnavailableError) throw error
			this.status = { state: "unavailable", backend: "file", reason: "unwritable" }
			throw new FileStorageUnavailableError(this.filePath, "unwritable")
		}
		this.value = value
		this.loaded = true
		this.status = { state: "available", backend: "file" }
	}

	async clear(): Promise<void> {
		try {
			await unlink(this.filePath)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				this.status = { state: "unavailable", backend: "file", reason: "unwritable" }
				throw new FileStorageUnavailableError(this.filePath, "unwritable")
			}
		}
		this.value = undefined
		this.loaded = true
		this.readTask = undefined
		this.status = { state: "available", backend: "file" }
	}

	private async load(): Promise<T | undefined> {
		try {
			const metadata = await lstat(this.filePath)
			if (metadata.isSymbolicLink() || !metadata.isFile())
				throw new Error("not a regular file")
			if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
				throw new Error("file permissions are too broad")
			const handle = await open(
				this.filePath,
				constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
			)
			let text: string
			try {
				text = await handle.readFile("utf8")
			} finally {
				await handle.close()
			}
			const value = parse(text) as T
			this.value = value
			this.loaded = true
			this.status = { state: "available", backend: "file" }
			return value
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				this.loaded = true
				this.status = { state: "available", backend: "file" }
				return undefined
			}
			if (isRecoverableFileError(error)) {
				// A malformed or unsafe file is treated as an absent cache. This lets
				// the next successful write repair it without preventing application
				// startup. Permission and other I/O failures remain hard errors below.
				this.value = undefined
				this.loaded = true
				this.status = {
					state: "unavailable",
					backend: "file",
					reason: "corrupt",
				}
				return undefined
			}
			this.status = {
				state: "unavailable",
				backend: "file",
				reason: "unwritable",
			}
			throw new FileStorageUnavailableError(this.filePath, "unwritable")
		}
	}
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
	let current = directory
	for (;;) {
		try {
			const metadata = await lstat(current)
			if (metadata.isSymbolicLink() || !metadata.isDirectory())
				throw new Error("invalid directory")
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
			const parent = dirname(current)
			if (parent === current) throw error
			current = parent
		}
	}
	await mkdir(directory, { recursive: true, mode: 0o700 })
	if (process.platform !== "win32") await chmod(directory, 0o700)
}

async function assertWritableTarget(filePath: string): Promise<void> {
	try {
		const metadata = await lstat(filePath)
		if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("invalid target")
		if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
			await chmod(filePath, 0o600)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
}

function pathBasename(filePath: string): string {
	return filePath.split(/[\\/]/).pop() || "cocode-secret"
}

function expandHomePath(value: string, home: string): string {
	if (value === "~") return home
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2))
	return value
}

function isRecoverableFileError(error: unknown): boolean {
	return (
		error instanceof SyntaxError ||
		(error instanceof Error &&
			(error.name === "YAMLParseError" ||
				error.message === "not a regular file" ||
				error.message === "file permissions are too broad"))
	)
}
