import { isStrictlyNewerApplicationVersion } from "./application-version-policy"

export type ApplicationUpdateState = "idle" | "checking" | "downloading"

type ApplicationUpdateEventName =
	| "checking-for-update"
	| "update-not-available"
	| "update-available"
	| "update-downloaded"
	| "error"

export interface ApplicationUpdateEventSource {
	on: (event: ApplicationUpdateEventName, listener: (...args: unknown[]) => void) => unknown
	removeListener: (
		event: ApplicationUpdateEventName,
		listener: (...args: unknown[]) => void,
	) => unknown
	checkForUpdates: () => void | PromiseLike<unknown>
	downloadUpdate: () => void | PromiseLike<unknown>
}

export interface ApplicationUpdateCoordinatorOptions {
	readonly enabled: boolean
	readonly version: string
	readonly updater: ApplicationUpdateEventSource
	readonly onStateChange: (state: ApplicationUpdateState) => void
	readonly onLatest: (version: string) => void
	readonly onError: (error: Error) => void
	readonly onDownloaded: (releaseName?: string) => void
}

export interface ApplicationUpdateCoordinator {
	readonly enabled: boolean
	readonly checkNow: () => void
	readonly subscribe: (listener: (state: ApplicationUpdateState) => void) => () => void
	readonly dispose: () => void
}

export function createApplicationUpdateCoordinator({
	enabled,
	version,
	updater,
	onStateChange,
	onLatest,
	onError,
	onDownloaded,
}: ApplicationUpdateCoordinatorOptions): ApplicationUpdateCoordinator {
	let state: ApplicationUpdateState = "idle"
	let manualCheckPending = false
	let disposed = false
	const subscribers = new Set<(state: ApplicationUpdateState) => void>()

	const setState = (next: ApplicationUpdateState): void => {
		if (state === next) return
		state = next
		onStateChange(next)
		for (const listener of subscribers) listener(next)
	}

	const onCheckingForUpdate = (): void => {
		if (disposed) return
		setState("checking")
	}
	const onUpdateNotAvailable = (): void => {
		if (disposed) return
		const showLatest = manualCheckPending
		manualCheckPending = false
		setState("idle")
		if (showLatest) onLatest(version)
	}
	const onUpdateAvailable = (...args: unknown[]): void => {
		if (disposed) return
		const candidateVersion = readUpdateVersion(args)
		if (!isStrictlyNewerApplicationVersion(candidateVersion, version)) {
			manualCheckPending = false
			setState("idle")
			return
		}
		manualCheckPending = false
		setState("downloading")
		try {
			const result = updater.downloadUpdate()
			if (isPromiseLike(result)) void result.then(undefined, onUpdaterError)
		} catch (error) {
			onUpdaterError(error)
		}
	}
	const onUpdateDownloaded = (...args: unknown[]): void => {
		if (disposed) return
		const candidateVersion = readUpdateVersion(args)
		if (!isStrictlyNewerApplicationVersion(candidateVersion, version)) {
			manualCheckPending = false
			setState("idle")
			return
		}
		manualCheckPending = false
		setState("idle")
		const releaseName =
			typeof args[2] === "string"
				? args[2]
				: isDownloadedUpdateEvent(args[0])
				? args[0].releaseName
				: undefined
		onDownloaded(releaseName)
	}
	const onUpdaterError = (value: unknown): void => {
		if (disposed) return
		const showError = manualCheckPending
		manualCheckPending = false
		setState("idle")
		if (showError) onError(toError(value))
	}

	const listeners: readonly [ApplicationUpdateEventName, (...args: unknown[]) => void][] = [
		["checking-for-update", onCheckingForUpdate],
		["update-not-available", onUpdateNotAvailable],
		["update-available", onUpdateAvailable],
		["update-downloaded", onUpdateDownloaded],
		["error", onUpdaterError],
	]
	for (const [event, listener] of listeners) updater.on(event, listener)

	const checkNow = (): void => {
		if (!enabled || disposed || state !== "idle") return
		manualCheckPending = true
		setState("checking")
		try {
			const result = updater.checkForUpdates()
			if (isPromiseLike(result)) void result.then(undefined, onUpdaterError)
		} catch (error) {
			onUpdaterError(error)
		}
	}

	const dispose = (): void => {
		if (disposed) return
		disposed = true
		manualCheckPending = false
		subscribers.clear()
		for (const [event, listener] of listeners) updater.removeListener(event, listener)
	}

	const subscribe = (listener: (next: ApplicationUpdateState) => void): (() => void) => {
		if (disposed) return () => undefined
		subscribers.add(listener)
		listener(state)
		return () => {
			subscribers.delete(listener)
		}
	}

	return { enabled, checkNow, subscribe, dispose }
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value))
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof (value as { then?: unknown }).then === "function"
	)
}

function isDownloadedUpdateEvent(value: unknown): value is { releaseName?: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"releaseName" in value &&
		(typeof (value as { releaseName?: unknown }).releaseName === "string" ||
			(value as { releaseName?: unknown }).releaseName == null)
	)
}

function readUpdateVersion(args: readonly unknown[]): string | undefined {
	const first = args[0]
	if (typeof first === "object" && first !== null && "version" in first) {
		const version = (first as { version?: unknown }).version
		if (typeof version === "string") return version
	}
	if (typeof args[2] === "string") return extractVersion(args[2])
	if (isDownloadedUpdateEvent(first)) return extractVersion(first.releaseName)
	return undefined
}

function extractVersion(value: string | undefined): string | undefined {
	return value?.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/)?.[0]
}
