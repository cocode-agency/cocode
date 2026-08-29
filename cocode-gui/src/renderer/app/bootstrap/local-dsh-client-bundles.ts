import { assertDshClientPackageOwnership } from "../../../../scripts/lib/dsh-client-ownership.mjs"

const CLIENT_PACKAGE_PREFIX = "@deepseek-ai/dsh-client-"

const LOCAL_CLIENT_BUNDLES = new Map<string, string>([
	...[
		"connection",
		"hmr",
		"locale",
		"modules",
		"runtime",
		"ui-agent-preset",
		"ui-commands",
		"ui-conversation",
		"ui-deliverables",
		"ui-directory-picker-browse",
		"ui-directory-picker-native",
		"ui-goal",
		"ui-input-trigger",
		"ui-jobs",
		"ui-layout",
		"ui-message-feedback",
		"ui-model-selection",
		"ui-reference",
		"ui-permission-presets",
		"ui-plan",
		"ui-settings",
		"ui-settings-general",
		"ui-settings-models",
		"ui-settings-plugin-inventory",
		"ui-settings-plugins",
		"ui-sidebar",
		"ui-skill",
		"ui-subagent",
		"ui-theme",
		"ui-tool",
		"ui-trajectory",
		"ui-user-questions",
		"ui-workflow-run",
		"ui-workspace",
	].map((directory) => [`${CLIENT_PACKAGE_PREFIX}${directory}`, directory] as const),
	// The Web roster keeps this short id for compatibility with the permission
	// slot, while the package directory retains its explicit `-presets` name.
	[`${CLIENT_PACKAGE_PREFIX}ui-permission`, "ui-permission-presets"],
	["cocode-workbench", "cocode/cocode-workbench"],
	["cocode-account", "cocode/cocode-account"],
	["cocode-shortcuts", "cocode/cocode-shortcuts"],
	["cocode-brand", "cocode/cocode-brand"],
	["cocode-input-history", "cocode/cocode-input-history"],
	["cocode-appearance", "cocode/cocode-appearance"],
	["cocode-desktop", "cocode/cocode-desktop"],
	["cocode-message-feedback", "cocode/cocode-message-feedback"],
	["cocode-models", "cocode/cocode-models"],
])

export function resolveLocalDshClientBundleUrl(packageId: string): string | undefined {
	assertDshClientPackageOwnership(packageId)
	const directory = LOCAL_CLIENT_BUNDLES.get(packageId)
	if (directory === undefined) return undefined
	return new URL(`./dsh-client/${directory}/client.js`, window.location.href).href
}
