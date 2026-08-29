import { ipcRenderer } from "electron"
import {
	accountChannels,
	type AccountApi,
	type AccountMessageFeedbackList,
	type AccountMessageFeedbackDeleteResult,
	type AccountMessageFeedbackPutResult,
	type AccountSnapshot,
} from "../../contracts/ipc/account.contract"
import { parseAccountSnapshot } from "../../contracts/schemas/account.schema"

function subscribe(listener: (snapshot: AccountSnapshot) => void): () => void {
	const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
		try {
			listener(parseAccountSnapshot(value))
		} catch {
			// Main is the only producer; malformed events are ignored at the bridge.
		}
	}
	ipcRenderer.on(accountChannels.changed, handler)
	return () => ipcRenderer.removeListener(accountChannels.changed, handler)
}

export const accountBridge: AccountApi = {
	snapshot: async () => parseAccountSnapshot(await ipcRenderer.invoke(accountChannels.snapshot)),
	signIn: async () => parseAccountSnapshot(await ipcRenderer.invoke(accountChannels.signIn)),
	cancelSignIn: () => ipcRenderer.invoke(accountChannels.cancelSignIn) as Promise<void>,
	signOut: () => ipcRenderer.invoke(accountChannels.signOut) as Promise<void>,
	onChanged: subscribe,
	messageFeedback: {
		list: (sessionId) =>
			ipcRenderer.invoke(
				accountChannels.messageFeedbackList,
				sessionId,
			) as Promise<AccountMessageFeedbackList>,
		put: (input) =>
			ipcRenderer.invoke(
				accountChannels.messageFeedbackPut,
				input,
			) as Promise<AccountMessageFeedbackPutResult>,
		delete: (input) =>
			ipcRenderer.invoke(accountChannels.messageFeedbackDelete, {
				...input,
			}) as Promise<AccountMessageFeedbackDeleteResult>,
	},
}
