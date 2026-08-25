import type {
	DshBootManifestDto,
	DshThemePreference,
} from "../../contracts/ipc/dsh-runtime.contract"
import { parseDshBootManifest } from "../../contracts/schemas/dsh-runtime.schema"

export function extractDshBootManifest(html: string): DshBootManifestDto {
	const match = html.match(
		/<script\b[^>]*>\s*(?:window\.__DSH_BOOT__|(?:window|globalThis)\s*\[\s*["']__DSH_BOOT__["']\s*\])\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
	)
	if (match?.[1] === undefined) {
		throw new Error("DSH runtime index did not contain window.__DSH_BOOT__.")
	}

	let value: unknown
	try {
		value = JSON.parse(match[1])
	} catch (error) {
		throw new Error(`DSH runtime boot manifest is not valid JSON: ${String(error)}`)
	}
	return parseDshBootManifest(value)
}

/**
 * Read the host-injected preference that the local Electron page needs before
 * the remote client graph is available. Older sidecars may not have the meta
 * tag yet, so the safe default remains the system scheme.
 */
export function extractDshThemePreference(html: string): DshThemePreference {
	for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
		const attributes = match[1] ?? ""
		const name = attributes.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1]
		if (name?.toLowerCase() !== "dsh-theme-preference") continue
		const preference = attributes.match(/\bcontent\s*=\s*["'](light|dark|system)["']/i)?.[1]
		if (preference !== undefined) return preference.toLowerCase() as DshThemePreference
	}
	return "system"
}
