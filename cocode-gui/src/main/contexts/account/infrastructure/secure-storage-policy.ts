export function secureStorageUnavailableMessage(backend: string | undefined): string {
	const selected = backend === undefined || backend === "unknown" ? "unknown" : backend
	return [
		"Electron secure storage is unavailable.",
		`Selected backend: ${selected}. Restart the desktop session and retry.`,
	].join(" ")
}
