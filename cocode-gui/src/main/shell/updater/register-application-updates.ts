import { app, dialog } from "electron"
import electronUpdater from "electron-updater"
import packageMetadata from "../../../../package.json"
import {
	createApplicationUpdateCoordinator,
	type ApplicationUpdateCoordinator,
	type ApplicationUpdateEventSource,
	type ApplicationUpdateState,
} from "./application-update-coordinator"
import {
	resolveApplicationUpdateConfig,
	resolveGitHubRepositoryFromUrl,
	type ApplicationUpdateConfig,
} from "./application-update-config"
import { resolveUpdateIntervalMilliseconds } from "./update-interval"
import type { ApplicationLocale } from "../../shared/locale/application-locale"

const { autoUpdater } = electronUpdater

export interface ApplicationUpdateLifecycle {
	readonly requestQuitForUpdate: (installUpdate: () => void) => boolean
}

export type ApplicationUpdateRegistration = ApplicationUpdateCoordinator

export interface ElectronUpdaterFeed {
	readonly provider: "github"
	readonly owner: string
	readonly repo: string
	channel?: "x64" | "arm64"
}

interface ElectronUpdaterAdapter extends ApplicationUpdateEventSource {
	autoDownload: boolean
	autoInstallOnAppQuit: boolean
	channel: string | null
	setFeedURL: (options: ElectronUpdaterFeed) => void
	quitAndInstall: () => void
}

export function configureElectronUpdater(
	updater: Pick<
		ElectronUpdaterAdapter,
		"autoDownload" | "autoInstallOnAppQuit" | "channel" | "setFeedURL"
	>,
	config: Extract<ApplicationUpdateConfig, { enabled: true }>,
): void {
	const [owner, repo] = config.repository.split("/")
	if (!owner || !repo) {
		throw new Error(`GitHub repository must use the owner/name format: ${config.repository}`)
	}
	updater.autoDownload = true
	updater.autoInstallOnAppQuit = false
	updater.channel = config.channel
	const feed: ElectronUpdaterFeed = {
		provider: "github",
		owner,
		repo,
	}
	if (config.channel) feed.channel = config.channel
	updater.setFeedURL(feed)
}

export function registerApplicationUpdates(
	lifecycle: ApplicationUpdateLifecycle,
	locale?: ApplicationLocale,
): ApplicationUpdateRegistration {
	let config: ApplicationUpdateConfig
	try {
		config = resolveApplicationUpdateConfig({
			packaged: app.isPackaged,
			platform: process.platform,
			architecture: process.arch,
			isAppImage: process.platform !== "linux" || Boolean(process.env.APPIMAGE),
			defaultRepository: resolveGitHubRepositoryFromUrl(packageMetadata.repository.url),
		})
	} catch (error) {
		console.error("Automatic updates are disabled because configuration is invalid:", error)
		return createInactiveRegistration()
	}
	if (config.enabled === false) {
		console.info(`Automatic updates are disabled: ${config.reason}.`)
		return createInactiveRegistration()
	}

	const updater = autoUpdater as unknown as ElectronUpdaterAdapter
	try {
		configureElectronUpdater(updater, config)
	} catch (error) {
		console.error("Automatic updates are disabled because the feed is invalid:", error)
		return createInactiveRegistration()
	}

	let promptOpen = false
	const promptForUpdate = (releaseName?: string) => {
		if (promptOpen) return
		promptOpen = true
		void dialog
			.showMessageBox({
				type: "info",
				buttons: locale?.get() === "en" ? ["Restart Now", "Later"] : ["立即重启", "稍后"],
				defaultId: 0,
				cancelId: 1,
				noLink: true,
				title: locale?.get() === "en" ? "Cocode Desktop Update" : "Cocode Desktop 更新",
				message:
					locale?.get() === "en"
						? `New version ${releaseName || "downloaded"}`
						: `新版本 ${releaseName || "已下载"}`,
				detail:
					locale?.get() === "en"
						? "The update will install after restart. DSH runtime and the local database will stop safely first."
						: "重启后将自动安装更新。重启前会安全停止 DSH 运行时并关闭本地数据库。",
			})
			.then(({ response }) => {
				if (response !== 0) return
				lifecycle.requestQuitForUpdate(() => updater.quitAndInstall())
			})
			.catch((error: unknown) =>
				console.error("Failed to show the downloaded update prompt:", error),
			)
			.finally(() => {
				promptOpen = false
			})
	}

	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: app.getVersion(),
		updater,
		onStateChange: () => undefined,
		onLatest: (version) => showLatestVersionDialog(version, locale),
		onError: (error) => handleUpdateError(error, locale),
		onDownloaded: promptForUpdate,
	})
	const stopAutomaticChecks = startAutomaticUpdateChecks(updater, config.updateInterval)
	return {
		enabled: true,
		checkNow: coordinator.checkNow,
		subscribe: coordinator.subscribe,
		dispose: () => {
			stopAutomaticChecks()
			coordinator.dispose()
		},
	}
}

function startAutomaticUpdateChecks(
	updater: Pick<ElectronUpdaterAdapter, "checkForUpdates">,
	interval: string,
): () => void {
	const checkForUpdates = (): void => {
		try {
			const result = updater.checkForUpdates()
			if (isPromiseLike(result)) {
				void result.then(undefined, (error: unknown) =>
					console.error("Automatic application update check failed:", error),
				)
			}
		} catch (error) {
			console.error("Automatic application update check failed:", error)
		}
	}
	checkForUpdates()
	const timer = setInterval(checkForUpdates, resolveUpdateIntervalMilliseconds(interval))
	timer.unref?.()
	return () => clearInterval(timer)
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof (value as { then?: unknown }).then === "function"
	)
}

function createInactiveRegistration(): ApplicationUpdateRegistration {
	return {
		enabled: false,
		checkNow: () => undefined,
		subscribe: (_listener: (state: ApplicationUpdateState) => void) => () => undefined,
		dispose: () => undefined,
	}
}

function showLatestVersionDialog(version: string, locale?: ApplicationLocale): void {
	const english = locale?.get() === "en"
	void dialog
		.showMessageBox({
			type: "info",
			noLink: true,
			title: english ? "Check for Updates" : "检查更新",
			message: english ? "You're up to date" : "当前版本已经是最新",
			detail: english ? `Current version: v${version}` : `当前版本：v${version}`,
		})
		.catch((error: unknown) =>
			console.error("Failed to show the latest-version dialog:", error),
		)
}

function showUpdateErrorDialog(locale?: ApplicationLocale): void {
	const english = locale?.get() === "en"
	void dialog
		.showMessageBox({
			type: "error",
			noLink: true,
			title: english ? "Update Check Failed" : "检查更新失败",
			message: english
				? "Couldn't check for updates. Try again later."
				: "检查更新失败，请稍后重试",
		})
		.catch((error: unknown) => console.error("Failed to show the update-error dialog:", error))
}

function handleUpdateError(error: Error, locale?: ApplicationLocale): void {
	console.error("Application update check failed:", error)
	showUpdateErrorDialog(locale)
}
