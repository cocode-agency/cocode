export const COCODE_BRAND_PLUGIN = "cocode-brand"

/** Host-side identity used by the DSH Loader when the package is included in boot. */
export const name = COCODE_BRAND_PLUGIN

/** Brand UI is client-only; the host entry has no service dependencies. */
export const inject: readonly string[] = []

/**
 * Keep a valid Cordis host-plugin entry for the package. Occupants live in
 * the browser client bundle; this hook only makes the package loadable.
 */
export function apply(): void {
	// Intentionally empty.
}
