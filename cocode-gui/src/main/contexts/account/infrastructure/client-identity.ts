import { app } from "electron"
import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { arch, platform } from "node:os"
import { FileVault, resolveCocodeFile } from "./file-vault"
import { SecureVault } from "./secure-vault"

export type CocodeClientIdentity = {
	readonly product: "cocode"
	readonly surface: "gui" | "tui"
	readonly version: string
	readonly build: string
	readonly os: "darwin" | "linux" | "windows"
	readonly arch: "arm64" | "x64"
	readonly installation_id: string
}

type SharedInstallation = { readonly installation_id: string }

const sharedInstallation = new FileVault<SharedInstallation>(resolveCocodeFile("installation.yaml"))
const legacyInstallation =
	process.platform === "linux" ? undefined : new SecureVault<string>("installation-id.bin")
let processInstallationId: string | undefined

function validInstallationId(value: unknown): string | undefined {
	return typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
		? value.toLowerCase()
		: undefined
}

async function legacyInstallationId(): Promise<string | undefined> {
	const encrypted = validInstallationId(await legacyInstallation?.read())
	if (encrypted !== undefined) return encrypted
	try {
		return validInstallationId(
			(await readFile(`${app.getPath("userData")}/installation-id.txt`, "utf8")).trim(),
		)
	} catch {
		return undefined
	}
}

async function persistInstallationId(installationId: string): Promise<void> {
	try {
		await sharedInstallation.write({ installation_id: installationId })
		return
	} catch {
		// A read-only COCODE_HOME must not make authentication unusable. Keep the
		// prior app-local fallback so this process and later launches remain stable.
	}
	try {
		if (legacyInstallation !== undefined) await legacyInstallation.write(installationId)
		else throw new Error("Linux uses the file-backed installation identity")
	} catch {
		await writeFile(`${app.getPath("userData")}/installation-id.txt`, installationId, {
			mode: 0o600,
		})
	}
}

export async function guiClientIdentity(): Promise<CocodeClientIdentity> {
	let installationId = processInstallationId
	if (installationId === undefined) {
		const shared = await sharedInstallation.read()
		installationId =
			validInstallationId(shared?.installation_id) ??
			(await legacyInstallationId()) ??
			randomUUID()
		await persistInstallationId(installationId)
	}
	processInstallationId = installationId
	const currentPlatform = platform()
	const currentArch = arch()
	return {
		product: "cocode",
		surface: "gui",
		version: app.getVersion() || "0.0.0-dev",
		build: process.env.COCODE_BUILD_ID?.trim().slice(0, 64) || "dev",
		os:
			currentPlatform === "win32"
				? "windows"
				: currentPlatform === "linux"
				? "linux"
				: "darwin",
		arch: currentArch === "arm64" ? "arm64" : "x64",
		installation_id: installationId,
	}
}

export function harnessClientIdentity(identity: CocodeClientIdentity): Record<string, string> {
	return {
		product: identity.product,
		surface: identity.surface,
		version: identity.version,
		build: identity.build,
		os: identity.os,
		arch: identity.arch,
		installationId: identity.installation_id,
	}
}
