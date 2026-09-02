import type { DshBootManifestDto } from "../../contracts/ipc/dsh-runtime.contract"

declare global {
	const __COCODE_ELECTRON_DESKTOP__: boolean | undefined

	interface Window {
		__DSH_DESKTOP_RUNTIME_ORIGIN__?: string
		__DSH_DESKTOP_ENDPOINT_GENERATION__?: number
		__DSH_BOOT__?: DshBootManifestDto
	}
}

export {}
