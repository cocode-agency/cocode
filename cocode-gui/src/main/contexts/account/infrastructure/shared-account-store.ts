import { constants } from "node:fs"
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises"
import { dirname, join } from "pathe"
import { parse, stringify } from "yaml"
import type { IdentityState } from "../application/account-service"
import { withAccountLock } from "./account-lock"
import { resolveCocodeHome } from "./file-vault"
import { SecureVault, type SecureVaultStatus } from "./secure-vault"

type AccountYaml = {
	origin?: unknown
	access_token?: unknown
	refresh_token?: unknown
	access_expires_at?: unknown
	personal_key_id?: unknown
	personal_key_name?: unknown
	profile?: unknown
	pre_login_default?: unknown
	managed_route?: unknown
}

type LegacyVault = {
	read(): Promise<IdentityState | undefined>
	clear(): Promise<void>
	getStatus?: () => SecureVaultStatus
}

function accountHome(): string {
	return resolveCocodeHome()
}

function accountPath(home: string): string {
	return join(home, "account.yaml")
}

function nonempty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function asIdentity(value: unknown): IdentityState | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
	const row = value as AccountYaml
	const origin = nonempty(row.origin)
	const accessToken = nonempty(row.access_token)
	const refreshToken = nonempty(row.refresh_token)
	const expires = row.access_expires_at
	if (origin === undefined || accessToken === undefined || refreshToken === undefined)
		return undefined
	if (typeof expires !== "number" || !Number.isFinite(expires)) return undefined
	return {
		origin,
		accessToken,
		refreshToken,
		accessExpiresAt: expires,
		...(row.profile !== undefined ? { profile: row.profile as IdentityState["profile"] } : {}),
		...(row.pre_login_default !== undefined
			? { preLoginDefault: row.pre_login_default as IdentityState["preLoginDefault"] }
			: {}),
		...(row.managed_route !== undefined
			? { managedRoute: row.managed_route as IdentityState["managedRoute"] }
			: {}),
		...(nonempty(row.personal_key_id) === undefined
			? {}
			: { personalKeyId: nonempty(row.personal_key_id) }),
		...(nonempty(row.personal_key_name) === undefined
			? {}
			: { personalKeyName: nonempty(row.personal_key_name) }),
	}
}

function toYaml(value: IdentityState): AccountYaml {
	return {
		origin: value.origin,
		access_token: value.accessToken,
		refresh_token: value.refreshToken,
		access_expires_at: value.accessExpiresAt,
		...(value.personalKeyId === undefined ? {} : { personal_key_id: value.personalKeyId }),
		...(value.personalKeyName === undefined
			? {}
			: { personal_key_name: value.personalKeyName }),
		...(value.profile === undefined ? {} : { profile: value.profile }),
		...(value.preLoginDefault === undefined
			? {}
			: { pre_login_default: value.preLoginDefault }),
		...(value.managedRoute === undefined ? {} : { managed_route: value.managedRoute }),
	}
}

export class SharedAccountStore {
	constructor(
		private readonly home = accountHome(),
		private readonly legacy: LegacyVault | undefined = process.platform === "linux"
			? undefined
			: new SecureVault<IdentityState>("cocode-account-identity.bin"),
	) {}

	getStatus(): SecureVaultStatus {
		return this.legacy?.getStatus?.() ?? { state: "unknown" }
	}

	async read(): Promise<IdentityState | undefined> {
		let value: IdentityState | undefined
		try {
			const path = accountPath(this.home)
			const metadata = await lstat(path)
			if (metadata.isSymbolicLink() || !metadata.isFile()) return undefined
			if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) return undefined
			const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
			let text: string
			try {
				text = await handle.readFile("utf8")
			} finally {
				await handle.close()
			}
			value = asIdentity(parse(text))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") value = undefined
		}
		if (value === undefined && this.legacy !== undefined) {
			const legacy = await this.legacy.read()
			if (legacy !== undefined) {
				value = legacy
				await this.write(legacy)
			}
		}
		return value
	}

	async write(value: IdentityState): Promise<void> {
		const path = accountPath(this.home)
		const directory = dirname(path)
		await mkdir(directory, { recursive: true, mode: 0o700 })
		if (process.platform !== "win32") await chmod(directory, 0o700)
		const temporary = join(directory, `.account-${process.pid}-${Date.now()}.tmp`)
		const handle = await open(temporary, "wx", 0o600)
		try {
			await handle.writeFile(stringify(toYaml(value)), "utf8")
			if (process.platform !== "win32") await handle.chmod(0o600)
			await handle.close()
			await rename(temporary, path)
			if (process.platform !== "win32") await chmod(path, 0o600)
		} catch (error) {
			await handle.close().catch(() => undefined)
			await unlink(temporary).catch(() => undefined)
			throw error
		}
	}

	async clear(): Promise<void> {
		await unlink(accountPath(this.home)).catch((error) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		})
		await this.legacy?.clear()
	}

	async withLock<T>(operation: () => Promise<T>): Promise<T> {
		return withAccountLock(accountPath(this.home), operation)
	}
}
