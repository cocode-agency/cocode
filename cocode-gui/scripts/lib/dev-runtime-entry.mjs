import * as path from "pathe"

/**
 * Resolve the Host Supervisor entry from the exact staged runtime used by the
 * dev client watcher. The sibling checkout is only a build input; using its
 * entry at runtime bypasses freshly synchronized DSH client bundles.
 */
export function resolveDevSupervisorEntry(runtimeRoot) {
	return path.join(runtimeRoot, "packages", "host-supervisor", "lib", "bin.js")
}

/**
 * Development runtimes must not reuse a stable Host that was started by an
 * installed app or an older checkout. The dev channel is part of the Host
 * scope key, so changing it forces the Supervisor to materialize the staged
 * runtime that the watcher just synchronized.
 */
export function createDevHostEnvironment(environment, supervisorEntry) {
	return {
		...environment,
		COCODE_RUNTIME_CHANNEL: "dev",
		COCODE_SUPERVISOR_SERVICE_ENTRY: supervisorEntry,
	}
}
