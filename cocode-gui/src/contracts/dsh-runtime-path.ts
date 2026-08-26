const DSH_HTTP_PATH_PREFIXES = [
	"/api",
	"/sidebar",
	"/cocode/shortcuts",
	"/cocode/workbench",
] as const

export function isDshHttpPath(pathname: string): boolean {
	return DSH_HTTP_PATH_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	)
}

export function isDshRuntimeRequestPath(path: string): boolean {
	return DSH_HTTP_PATH_PREFIXES.some(
		(prefix) =>
			path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
	)
}
