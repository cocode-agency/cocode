import { assertDshClientPackageOwnership } from "../../../../scripts/lib/dsh-client-ownership.mjs"
import { localDshClientBundleDirectory } from "../../../shared/dsh-runtime/dsh-client-bundle-path"

export function resolveLocalDshClientBundleUrl(packageId: string): string | undefined {
	assertDshClientPackageOwnership(packageId)
	const directory = localDshClientBundleDirectory(packageId)
	if (directory === undefined) return undefined
	return new URL(`./dsh-client/${directory}/client.js`, window.location.href).href
}
