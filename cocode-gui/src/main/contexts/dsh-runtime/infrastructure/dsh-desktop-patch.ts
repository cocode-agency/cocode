export const COCODE_WORKBENCH_PACKAGE = "cocode-workbench"
export const COCODE_ACCOUNT_PACKAGE = "cocode-account"
export const COCODE_SHORTCUTS_PACKAGE = "cocode-shortcuts"
export const COCODE_BRAND_PACKAGE = "cocode-brand"
export const COCODE_INPUT_HISTORY_PACKAGE = "cocode-input-history"
export const COCODE_APPEARANCE_PACKAGE = "cocode-appearance"
export const COCODE_DESKTOP_PACKAGE = "cocode-desktop"
export const COCODE_MESSAGE_FEEDBACK_PACKAGE = "cocode-message-feedback"
export const COCODE_MODELS_PACKAGE = "cocode-models"

/** Build the Electron-only overlay in a file owned by the Electron app. */
export function createDshDesktopPatch(noopHmrUrl: string): string {
	return [
		"- id: ui-message-feedback",
		"  disabled: true",
		"- id: ui-settings-models",
		"  disabled: true",
		"- insert:",
		"    - id: dsh-desktop-hmr",
		`      name: ${JSON.stringify(noopHmrUrl)}`,
		"    - id: cocode-workbench",
		`      name: ${JSON.stringify(COCODE_WORKBENCH_PACKAGE)}`,
		"    - id: cocode-account",
		`      name: ${JSON.stringify(COCODE_ACCOUNT_PACKAGE)}`,
		"    - id: cocode-shortcuts",
		`      name: ${JSON.stringify(COCODE_SHORTCUTS_PACKAGE)}`,
		"    - id: cocode-brand",
		`      name: ${JSON.stringify(COCODE_BRAND_PACKAGE)}`,
		"    - id: cocode-input-history",
		`      name: ${JSON.stringify(COCODE_INPUT_HISTORY_PACKAGE)}`,
		"    - id: cocode-appearance",
		`      name: ${JSON.stringify(COCODE_APPEARANCE_PACKAGE)}`,
		"    - id: cocode-desktop",
		`      name: ${JSON.stringify(COCODE_DESKTOP_PACKAGE)}`,
		"    - id: cocode-message-feedback",
		`      name: ${JSON.stringify(COCODE_MESSAGE_FEEDBACK_PACKAGE)}`,
		"    - id: cocode-models",
		`      name: ${JSON.stringify(COCODE_MODELS_PACKAGE)}`,
		"",
	].join("\n")
}
