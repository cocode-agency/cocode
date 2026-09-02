export const dshRuntimeChannels = {
	bootstrap: "dsh-runtime:bootstrap",
	request: "dsh-runtime:request",
	cancelRequest: "dsh-runtime:cancel-request",
	requestRecovery: "dsh-runtime:request-recovery",
	recoveryState: "dsh-runtime:recovery-state",
	rebound: "dsh-runtime:rebound",
} as const

/** Theme preference transferred with the early bootstrap handshake. */
export type DshThemePreference = "light" | "dark" | "system"

export type DshRuntimeRequestMethod = "GET" | "HEAD" | "POST"

export type DshRuntimeRecoveryReason =
	| "host_unreachable"
	| "host_exit"
	| "bootstrap_failed"
	| "health_failed"

export interface DshRuntimeRecoveryRequestDto {
	readonly reason: DshRuntimeRecoveryReason
	readonly endpointGeneration: number
}

export interface DshRuntimeRecoveryStateDto {
	readonly state: "idle" | "recovering" | "ready" | "failed"
	readonly attempt: number
	readonly maxAttempts: number
	readonly reason?: DshRuntimeRecoveryReason
	readonly recoveryId: string
	readonly endpointGeneration: number
	readonly error?: { readonly code: string; readonly message: string }
}

export interface DshRuntimeReboundDto {
	readonly endpointGeneration: number
	readonly bootstrap: DshRuntimeBootstrapDto
}

export interface DshRuntimeRequestDto {
	readonly requestId: string
	readonly path: string
	readonly method: DshRuntimeRequestMethod
	readonly headers: readonly (readonly [string, string])[]
	readonly body?: Uint8Array
}

export interface DshRuntimeResponseDto {
	readonly status: number
	readonly statusText: string
	readonly headers: readonly (readonly [string, string])[]
	readonly body: Uint8Array
}

export interface DshBootEntryDto {
	readonly id: string
	readonly url: string
	readonly rev: string
	readonly inject?: readonly string[]
	readonly external?: readonly string[]
	readonly immediately?: boolean
}

export interface DshBootBatchDto {
	readonly phase: "bootstrap" | "application"
	readonly url: string
	readonly rev: string
	readonly entries: readonly string[]
}

export interface DshBootManifestDto {
	readonly rev: string
	readonly entries: readonly DshBootEntryDto[]
	readonly batches: readonly DshBootBatchDto[]
}

export interface DshRuntimeBootstrapDto {
	readonly origin: string
	readonly boot: DshBootManifestDto
	/** Host-backed preference used before the Renderer client graph mounts. */
	readonly themePreference: DshThemePreference
}

export type DshRuntimeRecoveryStateListener = (state: DshRuntimeRecoveryStateDto) => void
export type DshRuntimeReboundListener = (event: DshRuntimeReboundDto) => void

export interface DshRuntimeApi {
	getBootstrap(): Promise<DshRuntimeBootstrapDto>
	request(request: DshRuntimeRequestDto): Promise<DshRuntimeResponseDto>
	cancelRequest(requestId: string): void
	requestRecovery(request: DshRuntimeRecoveryRequestDto): Promise<DshRuntimeRecoveryStateDto>
	onRecoveryState(listener: DshRuntimeRecoveryStateListener): () => void
	onRebound(listener: DshRuntimeReboundListener): () => void
}
