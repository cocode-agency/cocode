/**
 * Ownership contract for the browser-facing DSH client layers.
 *
 * dsh-client-web owns the framework-free boot kernel. The React mount and
 * slot renderer live in dsh-client-ui-renderer, while dsh-web-app owns the
 * assembled Web bundle/profile layer. dsh-client-web-react is an upstream
 * legacy package and must never enter the active Electron roster.
 */
export const DSH_CLIENT_OWNERSHIP = Object.freeze({
	webBoot: "@deepseek-ai/dsh-client-web",
	reactRenderer: "@deepseek-ai/dsh-client-ui-renderer",
	webBundle: "@deepseek-ai/dsh-web-app",
	legacy: Object.freeze(["@deepseek-ai/dsh-client-web-react"]),
})

/**
 * @param {string} packageId
 * @returns {"web-boot"|"react-renderer"|"web-app"|"legacy"|"client-bundle"|"other"}
 */
export function classifyDshClientPackage(packageId) {
	if (packageId === DSH_CLIENT_OWNERSHIP.webBoot) return "web-boot"
	if (packageId === DSH_CLIENT_OWNERSHIP.reactRenderer) return "react-renderer"
	if (packageId === DSH_CLIENT_OWNERSHIP.webBundle) return "web-app"
	if (DSH_CLIENT_OWNERSHIP.legacy.includes(packageId)) return "legacy"
	if (packageId.startsWith("@deepseek-ai/dsh-client-")) return "client-bundle"
	return "other"
}

/**
 * Reject legacy package ids at discovery and runtime URL resolution
 * boundaries. An explicit expected role also prevents a caller from silently
 * swapping the Web boot kernel and React renderer owners.
 *
 * @param {string} packageId
 * @param {string} [expectedRole]
 */
export function assertDshClientPackageOwnership(packageId, expectedRole) {
	const role = classifyDshClientPackage(packageId)
	if (role === "legacy") {
		throw new Error(
			`Legacy DSH client package ${packageId} is not part of the active Web roster. ` +
				"Use @deepseek-ai/dsh-client-web for Web boot and " +
				"@deepseek-ai/dsh-client-ui-renderer for the React renderer.",
		)
	}
	if (expectedRole !== undefined && role !== expectedRole) {
		throw new Error(
			`DSH client package ${packageId} has ownership ${role}; expected ${expectedRole}.`,
		)
	}
	return role
}
