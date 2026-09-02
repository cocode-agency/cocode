/**
 * Resolve the renderer bundle directory used for one published DSH client
 * package. The Vite emitter and Electron bootstrap share this rule so the
 * local bundle layout cannot drift from the npm package roster.
 */
export function dshClientBundleDirectory(packageId: string): string | undefined {
	if (packageId === "@deepseek-ai/dsh-client-web" || packageId === "@deepseek-ai/dsh-web-app") {
		return undefined
	}
	if (packageId.startsWith("@deepseek-ai/dsh-client-")) {
		const directory = packageId.slice("@deepseek-ai/dsh-client-".length)
		return directory === "ui-permission" ? "ui-permission-presets" : directory
	}
	if (
		packageId.startsWith("@deepseek-ai/dsh-") &&
		packageId.length > "@deepseek-ai/dsh-".length
	) {
		return packageId.slice("@deepseek-ai/".length)
	}
	return undefined
}

/** Explicit browser roster; host-only Cocode packages must never resolve to a client bundle. */
export const COCODE_WEB_CLIENT_PACKAGES = Object.freeze([
	"cocode-workbench",
	"cocode-account",
	"cocode-shortcuts",
	"cocode-brand",
	"cocode-input-history",
	"cocode-appearance",
	"cocode-desktop",
	"cocode-message-feedback",
	"cocode-models",
] as const)

const cocodeWebClientPackages = new Set<string>(COCODE_WEB_CLIENT_PACKAGES)

/** Cocode browser plugins are local workspace packages, not published DSH ids. */
export function cocodeClientBundleDirectory(packageId: string): string | undefined {
	if (!cocodeWebClientPackages.has(packageId)) return undefined
	return `cocode/${packageId}`
}

export function localDshClientBundleDirectory(packageId: string): string | undefined {
	return dshClientBundleDirectory(packageId) ?? cocodeClientBundleDirectory(packageId)
}
