export const sharedDshChannels = {
	// Keep the established wire names during the source-level sharedDsh rename.
	// This lets an older Renderer bundle continue talking to a newer Main.
	status: "external-dsh:status",
	catalog: "external-dsh:catalog",
	sessionHistory: "external-dsh:session-history",
	attachment: "external-dsh:attachment",
	subscribe: "external-dsh:subscribe",
	change: "external-dsh:change",
	conflictStatus: "external-dsh:conflict-status",
} as const

/** @deprecated Use sharedDshChannels. */
export const externalDshChannels = sharedDshChannels

export type ExternalDshStatusDto = {
	readonly source: "shared-dsh"
	readonly sourceHome: string
	readonly canMutate: boolean
	readonly concurrency: "no-concurrent-writes"
	readonly sharedWritePolicy: "enabled"
	readonly concurrentMutation: "unsupported"
	readonly homePatch: "shared"
	readonly homePatchIsolation: "unavailable"
	readonly profileFallback: "shared"
	readonly state: "available" | "unavailable" | "incompatible" | "permission-denied"
	readonly reason?: string
	readonly sessionCount?: number
	readonly workspaceCount?: number
}

export type ExternalSessionSummaryDto = {
	readonly source: "shared-dsh"
	readonly canMutate: true
	readonly concurrency: "no-concurrent-writes"
	readonly id: string
	readonly createdAt: number
	readonly updatedAt?: number
	readonly cwd?: string
	readonly title?: string
	readonly preview?: string
	readonly parentSession?: string
	readonly seedLength?: number
	readonly formatVersion?: number
	readonly status?: "ok" | "incompatible"
	readonly path: string
	readonly tailIncomplete?: boolean
}

export type ExternalWorkspaceDto = {
	readonly source: "shared-dsh"
	readonly canMutate: true
	readonly concurrency: "no-concurrent-writes"
	readonly workspaceId: string
	readonly path: string
	readonly title?: string
	readonly sessionIds: readonly string[]
	readonly archivedSessionIds: readonly string[]
	readonly createdAt?: string
	readonly updatedAt?: string
}

export type ExternalCatalogDto = {
	readonly source: "shared-dsh"
	readonly canMutate: boolean
	readonly concurrency: "no-concurrent-writes"
	readonly status: ExternalDshStatusDto
	readonly sessions: readonly ExternalSessionSummaryDto[]
	readonly workspaces: readonly ExternalWorkspaceDto[]
}

export type ExternalSessionEventDto = {
	readonly type: string
	readonly seq: number
	readonly time: number
	readonly data: unknown
	readonly ignorable?: boolean
}

export type ExternalSessionHistoryDto = {
	readonly source: "shared-dsh"
	readonly canMutate: true
	readonly concurrency: "no-concurrent-writes"
	readonly session: ExternalSessionSummaryDto
	readonly events: readonly ExternalSessionEventDto[]
	readonly tailIncomplete: boolean
	readonly status: "ok" | "incomplete" | "incompatible"
	readonly reason?: string
}

export type ExternalSessionHistoryRequestDto = {
	readonly sessionId: string
	readonly beforeSeq?: number
	readonly limit?: number
}

export type ExternalAttachmentRequestDto = {
	readonly path: string
	readonly digest?: string
	readonly mimeType?: string
	readonly maxBytes?: number
}

export type ExternalAttachmentDto = {
	readonly source: "shared-dsh"
	readonly canMutate: true
	readonly concurrency: "no-concurrent-writes"
	readonly bytes: Uint8Array
	readonly digest: string
	readonly mimeType: string
	readonly width: number
	readonly height: number
}

export type ExternalDshChangeDto = {
	readonly source: "shared-dsh"
	readonly canMutate: true
	readonly concurrency: "no-concurrent-writes"
	readonly kind: "sessions" | "workspace" | "projection-cache" | "attachments"
	readonly path: string
}

export type ExternalDshConflictStatusDto = {
	readonly source: "shared-dsh"
	readonly kind: "session" | "workspace"
	readonly id?: string
	readonly state: "clean" | "conflict" | "unavailable"
	readonly expectedRevision?: string
	readonly currentRevision?: string
}

export type ExternalDshApi = {
	readonly status: () => Promise<ExternalDshStatusDto>
	readonly catalog: () => Promise<ExternalCatalogDto>
	readonly sessionHistory: (
		request: ExternalSessionHistoryRequestDto,
	) => Promise<ExternalSessionHistoryDto>
	readonly attachment: (
		request: ExternalAttachmentRequestDto,
	) => Promise<ExternalAttachmentDto | undefined>
	readonly subscribe: (listener: (change: ExternalDshChangeDto) => void) => () => void
	readonly conflictStatus?: (request: {
		readonly kind: "session" | "workspace"
		readonly id?: string
		readonly expectedRevision: string
	}) => Promise<ExternalDshConflictStatusDto>
}

export type SharedDshStatusDto = ExternalDshStatusDto
export type SharedSessionSummaryDto = ExternalSessionSummaryDto
export type SharedWorkspaceDto = ExternalWorkspaceDto
export type SharedCatalogDto = ExternalCatalogDto
export type SharedSessionEventDto = ExternalSessionEventDto
export type SharedSessionHistoryDto = ExternalSessionHistoryDto
export type SharedSessionHistoryRequestDto = ExternalSessionHistoryRequestDto
export type SharedAttachmentRequestDto = ExternalAttachmentRequestDto
export type SharedAttachmentDto = ExternalAttachmentDto
export type SharedDshChangeDto = ExternalDshChangeDto
export type SharedDshConflictStatusDto = ExternalDshConflictStatusDto
export type SharedDshApi = ExternalDshApi
