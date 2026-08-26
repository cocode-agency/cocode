import type { DshRuntimeBootstrapDto } from "../../../contracts/ipc/dsh-runtime.contract"
import { selectDshBootEntries } from "./dsh-boot-entries"
import { resolveLocalDshClientBundleUrl } from "./local-dsh-client-bundles"

export function prepareDshBootManifest(
	bootstrap: DshRuntimeBootstrapDto,
	runtimeOrigin: string,
): void {
	const bootEntries = selectDshBootEntries(
		bootstrap.boot.entries,
		window.location.protocol === "file:",
	)
	window.__DSH_BOOT__ = {
		rev: bootstrap.boot.rev,
		entries: bootEntries.map((entry) => ({
			...entry,
			url: resolveLocalDshClientBundleUrl(entry.id) ?? new URL(entry.url, runtimeOrigin).href,
		})),
	}
}
