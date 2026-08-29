export const MESSAGE_FONT_SIZES = ["14", "16", "18", "20"] as const

export type MessageFontSize = typeof MESSAGE_FONT_SIZES[number]

export const DEFAULT_MESSAGE_FONT_SIZE: MessageFontSize = "14"

export const MESSAGE_FONT_SIZE_VARIABLE = "--dsw-conversation-message-font-size"

export const FONT_SIZE_STORAGE_KEY = "cocode.message.fontSize"

export function isMessageFontSize(value: unknown): value is MessageFontSize {
	return MESSAGE_FONT_SIZES.some((size) => size === value)
}

export function readStoredMessageFontSize(): MessageFontSize {
	if (typeof localStorage === "undefined") return DEFAULT_MESSAGE_FONT_SIZE
	try {
		const value = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
		return isMessageFontSize(value) ? value : DEFAULT_MESSAGE_FONT_SIZE
	} catch {
		return DEFAULT_MESSAGE_FONT_SIZE
	}
}

export function hasStoredMessageFontSize(): boolean {
	if (typeof localStorage === "undefined") return false
	try {
		return localStorage.getItem(FONT_SIZE_STORAGE_KEY) !== null
	} catch {
		return false
	}
}

export function writeStoredMessageFontSize(size: MessageFontSize): void {
	if (typeof localStorage === "undefined") return
	try {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, size)
	} catch {
		// A private or locked-down browser can deny storage; the live choice still applies.
	}
}

/** Project the selected message-list size onto the document. */
export function applyMessageFontSize(size: MessageFontSize): void {
	if (typeof document === "undefined") return
	document.body.style.setProperty(MESSAGE_FONT_SIZE_VARIABLE, `${size}px`)
}

export function clearMessageFontSize(): void {
	if (typeof document === "undefined") return
	document.body.style.removeProperty(MESSAGE_FONT_SIZE_VARIABLE)
}
