import { BrowserWindow, ipcMain } from "electron"
import { sharedDshChannels } from "../../../../../contracts/ipc/external-dsh.contract"
import type { SharedDshCatalog } from "../../infrastructure/external-dsh-catalog"

let disposeSubscription: (() => void) | undefined

export function registerSharedDshIpc(catalog: SharedDshCatalog): void {
	ipcMain.handle(sharedDshChannels.status, () => catalog.status())
	ipcMain.handle(sharedDshChannels.catalog, () => catalog.catalog())
	ipcMain.handle(sharedDshChannels.sessionHistory, (_event, request: unknown) => {
		if (!isRecord(request) || typeof request.sessionId !== "string")
			throw new Error("invalid external session history request")
		return catalog.sessionHistory({
			sessionId: request.sessionId,
			...(typeof request.beforeSeq === "number" ? { beforeSeq: request.beforeSeq } : {}),
			...(typeof request.limit === "number" ? { limit: request.limit } : {}),
		})
	})
	ipcMain.handle(sharedDshChannels.attachment, (_event, request: unknown) => {
		if (!isRecord(request) || typeof request.path !== "string")
			throw new Error("invalid external attachment request")
		return catalog.attachment({
			path: request.path,
			...(typeof request.digest === "string" ? { digest: request.digest } : {}),
			...(typeof request.mimeType === "string" ? { mimeType: request.mimeType } : {}),
			...(typeof request.maxBytes === "number" ? { maxBytes: request.maxBytes } : {}),
		})
	})
	ipcMain.handle(sharedDshChannels.conflictStatus, (_event, request: unknown) => {
		if (
			!isRecord(request) ||
			(request.kind !== "session" && request.kind !== "workspace") ||
			typeof request.expectedRevision !== "string"
		)
			throw new Error("invalid shared DSH conflict request")
		return catalog.conflictStatus({
			kind: request.kind,
			...(typeof request.id === "string" ? { id: request.id } : {}),
			expectedRevision: request.expectedRevision,
		})
	})
	const unsubscribe = catalog.subscribe((change) => {
		for (const window of BrowserWindow.getAllWindows())
			if (!window.isDestroyed()) window.webContents.send(sharedDshChannels.change, change)
	})
	ipcMain.handle(sharedDshChannels.subscribe, () => true)
	disposeSubscription?.()
	disposeSubscription = unsubscribe
}

export function unregisterSharedDshIpc(): void {
	ipcMain.removeHandler(sharedDshChannels.status)
	ipcMain.removeHandler(sharedDshChannels.catalog)
	ipcMain.removeHandler(sharedDshChannels.sessionHistory)
	ipcMain.removeHandler(sharedDshChannels.attachment)
	ipcMain.removeHandler(sharedDshChannels.conflictStatus)
	ipcMain.removeHandler(sharedDshChannels.subscribe)
	disposeSubscription?.()
	disposeSubscription = undefined
}

/** @deprecated Use registerSharedDshIpc. */
export const registerExternalDshIpc = registerSharedDshIpc
/** @deprecated Use unregisterSharedDshIpc. */
export const unregisterExternalDshIpc = unregisterSharedDshIpc

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
