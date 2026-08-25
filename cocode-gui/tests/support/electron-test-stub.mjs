import { EventEmitter } from "node:events"
import { mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const testRoot = path.join(os.tmpdir(), "cocode-electron-test", String(process.pid))
mkdirSync(testRoot, { recursive: true })

export const app = {
	isPackaged: false,
	getAppPath: () => process.cwd(),
	getPath: (name) => (name === "home" ? os.homedir() : testRoot),
	getVersion: () => "0.0.0-test",
	whenReady: async () => undefined,
}

export const safeStorage = {
	isEncryptionAvailable: () => true,
	getSelectedStorageBackend: () => "basic_text",
	encryptString: (value) => Buffer.from(value, "utf8"),
	decryptString: (value) => value.toString("utf8"),
}

export const shell = {
	openExternal: async () => undefined,
	openPath: async () => "",
	showItemInFolder: () => undefined,
}

export const dialog = {
	showMessageBox: async () => ({ response: 1 }),
	showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
}

export const globalShortcut = {
	register: () => true,
	unregister: () => undefined,
	isRegistered: () => false,
}

export class BrowserWindow extends EventEmitter {
	static getAllWindows() {
		return []
	}
}

export const ipcMain = new EventEmitter()
export const webContents = { fromId: () => undefined }
export const crashReporter = { start: () => undefined }
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) }
export const Menu = { buildFromTemplate: () => ({}) }
