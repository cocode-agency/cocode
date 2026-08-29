import { ipcMain, webContents } from "electron"
import { accountChannels } from "../../../../../contracts/ipc/account.contract"
import type { AccountService } from "../../application/account-service"
import type { DesktopLogger } from "../../../../shared/logging/desktop-logger"

export function registerAccountIpc(account: AccountService, logger?: DesktopLogger): void {
	ipcMain.handle(accountChannels.snapshot, () =>
		invoke(logger, "account.snapshot", () => account.snapshot()),
	)
	ipcMain.handle(accountChannels.signIn, () =>
		invoke(logger, "account.sign-in", () => account.signIn(), true),
	)
	ipcMain.handle(accountChannels.cancelSignIn, () =>
		invoke(logger, "account.cancel-sign-in", () => account.cancelSignIn(), true),
	)
	ipcMain.handle(accountChannels.signOut, () =>
		invoke(logger, "account.sign-out", () => account.signOut(), true),
	)
	ipcMain.handle(accountChannels.messageFeedbackList, (_event, sessionId: unknown) =>
		invoke(logger, "account.message-feedback-list", () =>
			account.listMessageFeedback(requireIdentifier(sessionId)),
		),
	)
	ipcMain.handle(accountChannels.messageFeedbackPut, (_event, input: unknown) =>
		invoke(logger, "account.message-feedback-put", () =>
			account.putMessageFeedback(parseFeedbackInput(input)),
		),
	)
	ipcMain.handle(accountChannels.messageFeedbackDelete, (_event, input: unknown) =>
		invoke(logger, "account.message-feedback-delete", () => {
			const value = recordOf(input)
			return account.deleteMessageFeedback({
				sessionId: requireIdentifier(value?.sessionId),
				messageId: requireIdentifier(value?.messageId),
				ifVersion: requireVersion(value?.ifVersion),
			})
		}),
	)
	account.onChanged((snapshot) => {
		logger?.log("debug", "account.state.changed", {
			attributes: { phase: snapshot.phase, cloudStatus: snapshot.cloud.status },
		})
		for (const contents of webContents.getAllWebContents()) {
			if (!contents.isDestroyed()) contents.send(accountChannels.changed, snapshot)
		}
	})
}

export function unregisterAccountIpc(): void {
	ipcMain.removeHandler(accountChannels.snapshot)
	ipcMain.removeHandler(accountChannels.signIn)
	ipcMain.removeHandler(accountChannels.cancelSignIn)
	ipcMain.removeHandler(accountChannels.signOut)
	ipcMain.removeHandler(accountChannels.messageFeedbackList)
	ipcMain.removeHandler(accountChannels.messageFeedbackPut)
	ipcMain.removeHandler(accountChannels.messageFeedbackDelete)
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined
}

function requireIdentifier(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.trim() === "" ||
		value.length > 256 ||
		/[\u0000-\u001f\u007f]/u.test(value)
	)
		throw new Error("invalid message feedback identifier")
	return value
}

function parseFeedbackInput(value: unknown): {
	sessionId: string
	messageId: string
	rating: "positive" | "negative"
	note?: string
	ifVersion: string | number | null
} {
	const record = recordOf(value)
	const rating = record?.rating
	const note = record?.note
	if (rating !== "positive" && rating !== "negative")
		throw new Error("invalid message feedback rating")
	if (note !== undefined) requireNote(note)
	const ifVersion = requireVersion(record?.ifVersion, true)
	return {
		sessionId: requireIdentifier(record?.sessionId),
		messageId: requireIdentifier(record?.messageId),
		rating,
		...(typeof note === "string" ? { note } : {}),
		ifVersion,
	}
}

function requireVersion(value: unknown, nullable = false): string | number | null {
	if (nullable && value === null) return null
	if (typeof value === "string" && value.trim() !== "" && value.length <= 256) return value
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value
	throw new Error("invalid message feedback version")
}

function requireNote(value: unknown): asserts value is string {
	if (typeof value !== "string") throw new Error("invalid message feedback note")
	if (new TextEncoder().encode(value).byteLength > 8192)
		throw new Error("message feedback note is too long")
	if (value.trim() === "") throw new Error("message feedback note must not be blank")
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
		throw new Error("message feedback note contains unsupported control characters")
	}
}

function invoke<T>(
	logger: DesktopLogger | undefined,
	eventName: string,
	operation: () => T | Promise<T>,
	audit = false,
): T | Promise<T> {
	const started = Date.now()
	try {
		const result = operation()
		if (result instanceof Promise) {
			return result.then(
				(value) => {
					logger?.log("debug", eventName, {
						outcome: "success",
						durationMs: Date.now() - started,
						audit,
					})
					return value
				},
				(error: unknown) => {
					logger?.log("error", eventName, {
						outcome: "failure",
						durationMs: Date.now() - started,
						error,
						audit,
					})
					throw error
				},
			)
		}
		logger?.log("debug", eventName, {
			outcome: "success",
			durationMs: Date.now() - started,
			audit,
		})
		return result
	} catch (error) {
		logger?.log("error", eventName, {
			outcome: "failure",
			durationMs: Date.now() - started,
			error,
			audit,
		})
		throw error
	}
}
