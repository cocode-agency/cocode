import type {
	DshBootEntryDto,
	DshBootManifestDto,
} from "../../../../contracts/ipc/dsh-runtime.contract"

/** Cocode Web client entries required by the Desktop composition. */
export const REQUIRED_COCODE_WEB_CLIENTS = [
	"cocode-workbench",
	"cocode-account",
	"cocode-shortcuts",
	"cocode-brand",
	"cocode-input-history",
	"cocode-appearance",
	"cocode-desktop",
	"cocode-message-feedback",
	"cocode-models",
] as const

export type DshRuntimeFetch = typeof fetch

export function findDshBootEntry(
	boot: DshBootManifestDto,
	id: string,
): DshBootEntryDto | undefined {
	return boot.entries.find((entry) => entry.id === id)
}

/**
 * Fail before Renderer boot when the Host omitted a required Cocode client
 * entry. An empty footer is a composition failure, not a valid degraded mode
 * for the Desktop shell.
 */
export function assertRequiredCocodeWebEntries(boot: DshBootManifestDto): void {
	const missing = REQUIRED_COCODE_WEB_CLIENTS.filter(
		(id) => findDshBootEntry(boot, id) === undefined,
	)
	if (missing.length === 0) return
	throw new Error(
		`Cocode Web runtime is incomplete; missing boot entr${
			missing.length === 1 ? "y" : "ies"
		}: ${missing.join(", ")}`,
	)
}

/**
 * Verify that every required Cocode client URL advertised by the Host is
 * reachable. This catches a stale graph where an entry exists but its
 * `/plugins/<id>/client.js` route is not actually served.
 */
export async function assertRequiredCocodeWebEndpoints(
	origin: string,
	boot: DshBootManifestDto,
	fetchImpl: DshRuntimeFetch = fetch,
): Promise<void> {
	assertRequiredCocodeWebEntries(boot)
	const checks = REQUIRED_COCODE_WEB_CLIENTS.map(async (id) => {
		const entry = findDshBootEntry(boot, id)
		if (entry === undefined) {
			throw new Error(`Cocode Web client entry ${id} is missing from the DSH boot manifest`)
		}
		const url = new URL(entry.url, origin)
		const response = await fetchImpl(url, { method: "GET" })
		if (response.ok) return
		throw new Error(
			`Cocode Web client entry ${id} is not reachable: GET ${
				url.pathname
			} returned HTTP ${String(response.status)}`,
		)
	})
	await Promise.all(checks)
}
