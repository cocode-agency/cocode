import type { DshRuntimeBootstrapDto } from "../../../contracts/ipc/dsh-runtime.contract"
import { parseDshRuntimeBootstrap } from "../../../contracts/schemas/dsh-runtime.schema"
import { readJsonResponse } from "./read-json-response"

const WEB_BOOTSTRAP_PATH = "/__cocode/dsh-bootstrap"

export function isDesktopDshBridgeAvailable(): boolean {
	return window.desktopApi?.dsh !== undefined
}

/** Electron development renders from Vite over HTTP; production renders from file://. */
export function isElectronDesktopDevelopment(): boolean {
	return isDesktopDshBridgeAvailable() && window.location.protocol !== "file:"
}

function isElectronDesktopRenderer(): boolean {
	return (
		typeof __COCODE_ELECTRON_DESKTOP__ !== "undefined" && __COCODE_ELECTRON_DESKTOP__ === true
	)
}

export async function loadDshBootstrap(): Promise<DshRuntimeBootstrapDto> {
	if (isDesktopDshBridgeAvailable()) {
		return window.desktopApi.dsh.getBootstrap()
	}
	if (isElectronDesktopRenderer()) {
		throw new Error(
			"Electron preload bridge is unavailable. The preload script failed to load.",
		)
	}

	const response = await fetch(WEB_BOOTSTRAP_PATH, { cache: "no-store" })
	return parseDshRuntimeBootstrap(
		await readJsonResponse<{
			readonly origin: string
			readonly boot: unknown
			readonly themePreference: unknown
		}>(response, "DSH web bootstrap request"),
	)
}

/** Desktop rewrites through preload; browser dev proxies DSH routes on the Vite origin. */
export function resolveRendererRuntimeOrigin(bootstrap: DshRuntimeBootstrapDto): string {
	if (isElectronDesktopDevelopment()) return window.location.origin
	if (isDesktopDshBridgeAvailable()) return new URL(bootstrap.origin).origin
	return window.location.origin
}
