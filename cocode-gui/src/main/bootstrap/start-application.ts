import { app, dialog, type BrowserWindow } from "electron"
import { DshRuntimeProcess } from "../contexts/dsh-runtime/infrastructure/dsh-runtime-process"
import { DshCloudConfigPort } from "../contexts/account/infrastructure/dsh-cloud-config-port"
import { AgencyClient } from "../contexts/account/infrastructure/agency-client"
import { AccountService } from "../contexts/account/application/account-service"
import {
	registerAccountIpc,
	unregisterAccountIpc,
} from "../contexts/account/presentation/ipc/register-account-ipc"
import {
	registerDshRuntimeIpc,
	unregisterDshRuntimeIpc,
} from "../contexts/dsh-runtime/presentation/ipc/register-dsh-runtime-ipc"
import { registerApplicationLifecycle } from "../shell/lifecycle/register-application-lifecycle"
import { acquireSingleInstanceLock } from "../shell/lifecycle/single-instance-guard"
import { runCleanupStep } from "../shell/lifecycle/run-cleanup-step"
import {
	createStartupFailureInjector,
	createStartupFailureError,
	createDshHostReadyAttributes,
	runStartupPhase,
	startupFailurePhaseLabel,
	type StartupFailureRecord,
} from "../shell/lifecycle/startup-failure"
import { registerStartupIpc, unregisterStartupIpc } from "../shell/lifecycle/register-startup-ipc"
import {
	registerApplicationUpdates,
	type ApplicationUpdateRegistration,
} from "../shell/updater/register-application-updates"
import { applyDockIcon } from "../shell/windows/app-icon"
import { createMainWindow } from "../shell/windows/create-main-window"
import { createStartupFailureWindow } from "../shell/windows/create-startup-failure-window"
import {
	registerApplicationMenu,
	type ApplicationMenuRegistration,
} from "../shell/menu/register-application-menu"
import { createDatabaseModule, type DatabaseModule } from "./create-database-module"
import { ShortcutService } from "../contexts/shortcuts/application/shortcut-service"
import {
	registerShortcutsIpc,
	unregisterShortcutsIpc,
} from "../contexts/shortcuts/presentation/ipc/register-shortcuts-ipc"
import {
	registerDiagnosticsIpc,
	unregisterDiagnosticsIpc,
} from "../contexts/diagnostics/presentation/ipc/register-diagnostics-ipc"
import { createDesktopObservability } from "../shared/observability/desktop-observability"
import { createApplicationLocale } from "../shared/locale/application-locale"
import { registerLocaleIpc, unregisterLocaleIpc } from "../shared/locale/register-locale-ipc"
import { registerElectronObservers } from "../shared/observability/register-electron-observers"
import { TuiLauncher } from "../contexts/tui/infrastructure/tui-launcher"
import { registerTuiIpc, unregisterTuiIpc } from "../contexts/tui/presentation/ipc/register-tui-ipc"
import type { SharedDshCatalog } from "../contexts/dsh-runtime/infrastructure/external-dsh-catalog"
import { createSharedDshCatalog } from "../contexts/dsh-runtime/infrastructure/create-external-dsh-catalog"
import {
	registerSharedDshIpc,
	unregisterSharedDshIpc,
} from "../contexts/dsh-runtime/presentation/ipc/register-external-dsh-ipc"
import {
	registerLocalFilesIpc,
	unregisterLocalFilesIpc,
} from "../contexts/local-files/presentation/ipc/register-local-files-ipc"

export const startApplication = (): void => {
	// Claimed before observability, the database and the DSH runtime start, so a
	// duplicate launch never touches state the running instance owns.
	if (!acquireSingleInstanceLock()) return

	const locale = createApplicationLocale()
	const observability = createDesktopObservability(locale)
	registerLocaleIpc(locale)
	const unregisterElectronObservers = registerElectronObservers(observability.logger)
	registerDiagnosticsIpc(observability.diagnostics, observability.logger)
	registerLocalFilesIpc()

	let databaseModule: DatabaseModule | null = null
	let dshRuntime: DshRuntimeProcess | null = null
	let account: AccountService | null = null
	let shortcuts: ShortcutService | null = null
	let mainWindow: BrowserWindow | null = null
	let dshUrl: string | null = null
	let rebindDshRuntimeOrigin: ((origin: string) => void) | null = null
	let disposeAccountCleanupRetry: (() => void) | null = null
	let applicationUpdates: ApplicationUpdateRegistration | null = null
	let applicationMenu: ApplicationMenuRegistration | null = null
	let tuiLauncher: TuiLauncher | null = null
	let sharedDsh: SharedDshCatalog | null = null
	let startupFailureWindow: BrowserWindow | null = null
	let startupFailureFinalized = false
	const injectStartupFailure = createStartupFailureInjector(
		!app.isPackaged || process.env.COCODE_ALLOW_STARTUP_FAILURE_INJECTION === "1"
			? process.env.COCODE_TEST_STARTUP_FAILURE_PHASE
			: undefined,
	)

	const lifecycle = registerApplicationLifecycle({
		logger: observability.logger,
		createWindow: () => {
			try {
				injectStartupFailure("main.window.create")
				if (!dshUrl) throw new Error("DSH runtime URL was not available after startup.")
				observability.logger.log("info", "window.create.started")
				mainWindow = createMainWindow(dshUrl, observability.logger, {
					registerRuntimeOriginRebind: (rebind) => {
						rebindDshRuntimeOrigin = rebind
					},
				})
				mainWindow.once("closed", () => {
					observability.logger.log("info", "window.closed")
					mainWindow = null
				})
			} catch (error) {
				throw createStartupFailureError("main.window.create", error)
			}
		},
		onStartupFailure: (failure: StartupFailureRecord) => {
			const showFallback = (error: unknown): void => {
				if (startupFailureFinalized) return
				startupFailureFinalized = true
				observability.logger.log("fatal", "startup.failure-window.fallback", { error })
				void dialog
					.showMessageBox({
						type: "error",
						title: "Cocode 启动失败",
						message: failure.userMessage,
						detail: `阶段：${startupFailurePhaseLabel(failure.phase)}\n错误代码：${
							failure.failureCode
						}\n版本：${app.getVersion()} / ${process.arch}`,
					})
					.catch(() => undefined)
					.finally(() => app.quit())
			}
			try {
				startupFailureWindow?.close()
				startupFailureWindow = createStartupFailureWindow({
					failure,
					logger: observability.logger,
					onLoadFailure: showFallback,
				})
				startupFailureWindow.once("closed", () => {
					startupFailureWindow = null
					if (startupFailureFinalized) return
					startupFailureFinalized = true
					app.quit()
				})
			} catch (error) {
				observability.logger.log("fatal", "startup.failure-window.failed", { error })
				showFallback(error)
			}
		},
		onReady: async () => {
			observability.logger.log("info", "app.ready.started")
			applyDockIcon()
			try {
				injectStartupFailure("database.initialize")
				databaseModule = createDatabaseModule(app.getPath("home"), observability.logger)
				databaseModule.initialize()
				observability.logger.log("info", "database.opened")
			} catch (error) {
				observability.logger.log("error", "database.open.failed", { error })
				throw createStartupFailureError("database.initialize", error)
			}
			dshRuntime = runStartupPhase(
				"dsh.host.acquire",
				() => new DshRuntimeProcess(observability.logger),
			)
			sharedDsh = runStartupPhase("application.services.register", createSharedDshCatalog)
			tuiLauncher = runStartupPhase("application.services.register", () => new TuiLauncher())
			if (shouldAutoInstallCommandLineTool()) {
				try {
					const result = await tuiLauncher.ensureCommandLineTool()
					const warning =
						result.status.state === "conflict" || result.status.state === "unavailable"
					observability.logger.log(
						warning ? "warn" : "info",
						"tui.cli.ensure.completed",
						{
							attributes: {
								state: result.status.state,
								changed: result.changed,
								directoryOnPath: result.status.directoryOnPath,
								persistentPathConfigured: result.status.persistentPathConfigured,
								registrationSource: result.status.registrationSource,
							},
						},
					)
				} catch (error) {
					observability.logger.log("warn", "tui.cli.ensure.failed", { error })
				}
			}
			try {
				injectStartupFailure("application.services.register")
				registerTuiIpc(tuiLauncher, observability.logger)
				registerDshRuntimeIpc(dshRuntime, observability.logger, {
					onRebound: (origin) => rebindDshRuntimeOrigin?.(origin),
				})
				registerSharedDshIpc(sharedDsh)
			} catch (error) {
				throw createStartupFailureError("application.services.register", error)
			}
			try {
				injectStartupFailure("dsh.host.acquire")
				dshUrl = await dshRuntime.start()
			} catch (error) {
				throw createStartupFailureError("dsh.host.acquire", error)
			}
			observability.resources.setHostPid(dshRuntime.hostPid)
			observability.diagnostics.setHostLogDirectory(dshRuntime.hostLogDirectory)
			observability.logger.log("info", "dsh.host.ready", {
				attributes: createDshHostReadyAttributes(
					redactEndpoint(dshUrl),
					dshRuntime.hostPid,
				),
			})
			try {
				injectStartupFailure("dsh.runtime.bootstrap")
				await dshRuntime.getBootstrap()
			} catch (error) {
				throw createStartupFailureError("dsh.runtime.bootstrap", error)
			}
			account = runStartupPhase(
				"application.services.register",
				() =>
					new AccountService(
						new DshCloudConfigPort(dshRuntime),
						new AgencyClient(undefined, {
							allowOriginOverride: !app.isPackaged,
							allowLocalHttp: !app.isPackaged,
						}),
						{},
					),
			)
			try {
				injectStartupFailure("application.services.register")
				registerAccountIpc(account, observability.logger)
			} catch (error) {
				throw createStartupFailureError("application.services.register", error)
			}
			void account.hydrate().then(
				() => observability.logger.log("info", "account.hydrate.completed"),
				(error) => observability.logger.log("warn", "account.hydrate.failed", { error }),
			)
			// A sign-out whose cloud cleanup failed leaves the managed route in the
			// runtime while the account already reads as signed out. A rebind means
			// the runtime is usable again, so finish that cleanup now instead of
			// waiting for the next launch.
			const accountService = account
			disposeAccountCleanupRetry = dshRuntime.onRebound(() => {
				void accountService.retryPendingCleanup().catch((error: unknown) => {
					observability.logger.log("warn", "account.cleanup.retry.failed", { error })
				})
			})
			shortcuts = runStartupPhase(
				"application.services.register",
				() => new ShortcutService(() => mainWindow),
			)
			try {
				injectStartupFailure("application.services.register")
				registerShortcutsIpc(shortcuts, observability.logger)
				applicationUpdates = registerApplicationUpdates(lifecycle, locale)
				applicationMenu = registerApplicationMenu(applicationUpdates, locale)
			} catch (error) {
				throw createStartupFailureError("application.services.register", error)
			}
			observability.logger.log("info", "app.ready.completed")
		},
		onBeforeQuit: async () => {
			observability.logger.log("info", "app.shutdown.started")
			const reportCleanupFailure = (step: string, error: unknown): void => {
				observability.logger.log("error", "app.shutdown.step.failed", {
					error,
					attributes: { step },
				})
			}
			await runCleanupStep(
				"application-menu",
				() => {
					const resource = applicationMenu
					applicationMenu = null
					resource?.dispose()
				},
				reportCleanupFailure,
			)
			await runCleanupStep(
				"application-updates",
				() => {
					const resource = applicationUpdates
					applicationUpdates = null
					resource?.dispose()
				},
				reportCleanupFailure,
			)
			await runCleanupStep("ipc.startup", unregisterStartupIpc, reportCleanupFailure)
			await runCleanupStep("ipc.locale", unregisterLocaleIpc, reportCleanupFailure)
			await runCleanupStep("ipc.diagnostics", unregisterDiagnosticsIpc, reportCleanupFailure)
			await runCleanupStep("ipc.local-files", unregisterLocalFilesIpc, reportCleanupFailure)
			await runCleanupStep("ipc.tui", unregisterTuiIpc, reportCleanupFailure)
			tuiLauncher = null
			await runCleanupStep("ipc.shortcuts", unregisterShortcutsIpc, reportCleanupFailure)
			await runCleanupStep(
				"shortcuts.dispose",
				() => {
					const resource = shortcuts
					shortcuts = null
					resource?.dispose()
				},
				reportCleanupFailure,
			)
			await runCleanupStep("ipc.account", unregisterAccountIpc, reportCleanupFailure)
			await runCleanupStep(
				"account.cleanup-retry",
				() => {
					const dispose = disposeAccountCleanupRetry
					disposeAccountCleanupRetry = null
					dispose?.()
				},
				reportCleanupFailure,
			)
			await runCleanupStep(
				"account.dispose",
				() => {
					const resource = account
					account = null
					resource?.dispose()
				},
				reportCleanupFailure,
			)
			await runCleanupStep("ipc.dsh-runtime", unregisterDshRuntimeIpc, reportCleanupFailure)
			await runCleanupStep("ipc.shared-dsh", unregisterSharedDshIpc, reportCleanupFailure)
			await runCleanupStep(
				"shared-dsh.dispose",
				async () => {
					const resource = sharedDsh
					sharedDsh = null
					await resource?.dispose()
				},
				reportCleanupFailure,
			)
			await runCleanupStep(
				"database",
				() => {
					const resource = databaseModule
					databaseModule = null
					resource?.dispose()
					observability.logger.log("info", "database.closed")
				},
				reportCleanupFailure,
			)
			await runCleanupStep(
				"dsh-runtime",
				async () => {
					const resource = dshRuntime
					dshRuntime = null
					dshUrl = null
					rebindDshRuntimeOrigin = null
					await resource?.shutdown()
				},
				reportCleanupFailure,
			)
			mainWindow = null
			await runCleanupStep(
				"electron-observers",
				unregisterElectronObservers,
				reportCleanupFailure,
			)
			await runCleanupStep(
				"observability",
				() => observability.dispose(),
				() => undefined,
			)
		},
	})
	registerStartupIpc({
		onRestart: lifecycle.requestRestart,
		onQuit: () => app.quit(),
	})
}

function redactEndpoint(value: string): string {
	try {
		const url = new URL(value)
		return `${url.origin}${url.pathname}`
	} catch {
		return "<invalid-endpoint>"
	}
}

function shouldAutoInstallCommandLineTool(): boolean {
	// Linux DEB/RPM packages install the canonical /usr/bin/cocode wrapper
	// before any Desktop process starts. Do not create a second user-level shim
	// that could shadow the installer-managed TUI command.
	if (process.platform === "linux" && app.isPackaged) return false
	const configured = process.env.COCODE_AUTO_INSTALL_CLI?.trim()
	if (configured === "0") return false
	return app.isPackaged || configured === "1"
}
