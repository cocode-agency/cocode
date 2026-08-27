import { useSyncExternalStore } from "react"

export const LOGO_PREFERENCES = ["cocode", "deepseek"] as const
export type LogoPreference = typeof LOGO_PREFERENCES[number]

export const DEFAULT_LOGO_PREFERENCE: LogoPreference = "cocode"
export const LOGO_STORAGE_KEY = "cocode.logo.preference"
export const LOGO_DATASET_KEY = "cocodeLogo"

const listeners = new Set<() => void>()
let preference = readStoredLogoPreference()

export function isLogoPreference(value: unknown): value is LogoPreference {
	return LOGO_PREFERENCES.some((item) => item === value)
}

export function getLogoPreference(): LogoPreference {
	return preference
}

export function subscribeLogoPreference(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** Device-local logo choice; unavailable storage falls back to Cocode. */
export function readStoredLogoPreference(): LogoPreference {
	if (typeof localStorage === "undefined") return DEFAULT_LOGO_PREFERENCE
	try {
		const value = localStorage.getItem(LOGO_STORAGE_KEY)
		return isLogoPreference(value) ? value : DEFAULT_LOGO_PREFERENCE
	} catch {
		return DEFAULT_LOGO_PREFERENCE
	}
}

function writeStoredLogoPreference(next: LogoPreference): void {
	if (typeof localStorage === "undefined") return
	try {
		localStorage.setItem(LOGO_STORAGE_KEY, next)
	} catch {
		// A private or locked-down browser can deny storage; the live choice still applies.
	}
}

function publishDataset(next: LogoPreference): void {
	if (typeof document === "undefined") return
	document.documentElement.dataset[LOGO_DATASET_KEY] = next
}

/** Apply the live choice to `<html data-cocode-logo>` so CSS can hide DSH chrome. */
export function syncLogoDataset(): void {
	publishDataset(preference)
}

export function setLogoPreference(next: LogoPreference): void {
	if (preference === next) return
	preference = next
	writeStoredLogoPreference(next)
	publishDataset(next)
	for (const listener of listeners) listener()
}

export function useLogoPreference(): LogoPreference {
	return useSyncExternalStore(subscribeLogoPreference, getLogoPreference, getLogoPreference)
}
