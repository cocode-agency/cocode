/** Minimal resolved theme shape needed by the renderer shell projection. */
export interface ShellThemeSnapshot {
	readonly active: {
		readonly colorScheme: "light" | "dark"
	}
}

/** Project a resolved theme onto the renderer shell's native theme hooks. */
export function applyShellTheme(snapshot: ShellThemeSnapshot): void {
	const scheme = snapshot.active.colorScheme
	const html = document.documentElement
	html.dataset.theme = scheme
	html.classList.toggle("dark", scheme === "dark")
	html.style.colorScheme = scheme
}
