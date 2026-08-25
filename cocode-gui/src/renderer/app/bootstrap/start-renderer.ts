import { AppWebEntry } from "@deepseek-ai/dsh-client-web"
import type {
	DshRuntimeReboundDto,
	DshRuntimeRecoveryStateDto,
	DshThemePreference,
} from "../../../contracts/ipc/dsh-runtime.contract"
import { createDshBundleLoader } from "./dsh-bundle-loader"
import { selectDshBootEntries } from "./dsh-boot-entries"
import {
	DSH_CLIENT_MODULES_ID,
	ensureDshModuleLoader,
	type DshModuleLoaderTarget,
} from "./dsh-module-loader"
import { installDshTransport, rebindDshTransport } from "./dsh-transport"
import {
	isDesktopDshBridgeAvailable,
	loadDshBootstrap,
	resolveRendererRuntimeOrigin,
} from "./load-dsh-bootstrap"
import { resolveLocalDshClientBundleUrl } from "./local-dsh-client-bundles"
import { RendererLogger } from "../../shared/logging/renderer-logger"
import { prepareDshBootManifest } from "./prepare-dsh-boot"

const logger = new RendererLogger()

/** macOS traffic-light strip height; sidebar logo row starts below it. */
const DESKTOP_DARWIN_TITLEBAR_INSET_PX = 32

export async function startRenderer(element: HTMLElement): Promise<void> {
	logger.info("renderer.start.started", { component: "renderer" })
	try {
		const moduleLoader = ensureDshModuleLoader()
		const bootstrap = await loadDshBootstrap()
		applyInitialTheme(bootstrap.themePreference)
		markDesktopHost()
		markThemeReady()
		const runtimeOrigin = resolveRendererRuntimeOrigin(bootstrap)
		window.__DSH_DESKTOP_RUNTIME_ORIGIN__ = runtimeOrigin
		window.__DSH_DESKTOP_ENDPOINT_GENERATION__ = 0
		if (isDesktopDshBridgeAvailable()) {
			installDshTransport(runtimeOrigin, logger)
			installRuntimeRecoveryListeners()
		}
		const bootEntries = selectDshBootEntries(
			bootstrap.boot.entries,
			window.location.protocol === "file:",
		)
		window.__DSH_BOOT__ = {
			rev: bootstrap.boot.rev,
			entries: bootEntries.map((entry) => ({
				...entry,
				url:
					resolveLocalDshClientBundleUrl(entry.id) ??
					new URL(entry.url, runtimeOrigin).href,
			})),
		}
		await preloadDshModuleSystem(moduleLoader, window.__DSH_BOOT__.entries)

		await new AppWebEntry(element, {
			loadBundle: createDshBundleLoader(),
		}).run()
		logger.info("renderer.start.completed", { component: "renderer" })
	} catch (error) {
		markThemeReady()
		logger.error("renderer.start.failed", error, { component: "renderer" })
		element.replaceChildren(createFailureView(error))
	}
}

/** Load the bootstrap bundle that the Host normally parser-preloads in HTML. */
async function preloadDshModuleSystem(
	target: DshModuleLoaderTarget,
	entries: readonly { readonly id: string; readonly url: string }[],
): Promise<void> {
	if (target.mode !== "queue") {
		throw new Error(
			"web boot: DSH module loader was already activated before the shell started",
		)
	}
	if (target.pendingQueue.some((registration) => registration.id === DSH_CLIENT_MODULES_ID))
		return
	const modulesEntry = entries.find((entry) => entry.id === DSH_CLIENT_MODULES_ID)
	if (modulesEntry === undefined) {
		throw new Error(`web boot: ${DSH_CLIENT_MODULES_ID} is missing from the bootstrap graph`)
	}
	await createDshBundleLoader()(modulesEntry.url)
}

function installRuntimeRecoveryListeners(): void {
	window.desktopApi.dsh.onRecoveryState((state: DshRuntimeRecoveryStateDto) => {
		// Main's ready means the new Runtime passed bootstrap/health checks. The
		// renderer stays degraded until the fresh connection handshake and
		// snapshot resync complete (runtime/index.ts publishes the final ready).
		if (state.state === "ready") return
		document.documentElement.dataset.dshRuntimeState = state.state
		window.dispatchEvent(
			new CustomEvent("cocode:dsh-runtime-recovery-state", { detail: state }),
		)
	})
	window.desktopApi.dsh.onRebound((event: DshRuntimeReboundDto) => {
		const runtimeOrigin = new URL(event.bootstrap.origin).origin
		rebindDshTransport(runtimeOrigin)
		window.__DSH_DESKTOP_RUNTIME_ORIGIN__ = runtimeOrigin
		window.__DSH_DESKTOP_ENDPOINT_GENERATION__ = event.endpointGeneration
		document.documentElement.dataset.dshRuntimeState = "degraded"
		prepareDshBootManifest(event.bootstrap, runtimeOrigin)
		window.dispatchEvent(
			new CustomEvent("cocode:dsh-runtime-recovery-state", {
				detail: {
					state: "degraded",
					attempt: 0,
					maxAttempts: 3,
					recoveryId: "renderer-resync",
					endpointGeneration: event.endpointGeneration,
				},
			}),
		)
		window.dispatchEvent(new CustomEvent("cocode:dsh-runtime-rebound", { detail: event }))
	})
}

function markThemeReady(): void {
	document.documentElement.dataset.dshThemeReady = "true"
}

/** Reveal desktop titlebar geometry before the client plugin graph paints. */
function markDesktopHost(): void {
	if (!isDesktopDshBridgeAvailable()) return
	const html = document.documentElement
	const platform = resolveDesktopPlatform()
	html.dataset.dshDesktop = "true"
	html.dataset.dshDesktopPlatform = platform
	if (platform === "darwin") {
		html.style.setProperty(
			"--dsh-desktop-titlebar-inset",
			`${String(DESKTOP_DARWIN_TITLEBAR_INSET_PX)}px`,
		)
	}
}

function resolveDesktopPlatform(): "darwin" | "linux" | "win32" {
	if (navigator.userAgent.includes("Windows")) return "win32"
	if (navigator.userAgent.includes("Mac")) return "darwin"
	return "linux"
}

/** Apply the host preference before React or the client plugin graph paints. */
function applyInitialTheme(preference: DshThemePreference): void {
	const dark =
		preference === "dark" ||
		(preference === "system" &&
			typeof matchMedia !== "undefined" &&
			matchMedia("(prefers-color-scheme: dark)").matches)
	const scheme = dark ? "dark" : "light"
	document.documentElement.style.colorScheme = scheme
	document.documentElement.dataset.theme = scheme
	document.documentElement.classList.toggle("dark", dark)
	document.body.toggleAttribute("data-ds-dark-theme", dark)
}

function createFailureView(error: unknown): HTMLElement {
	const container = document.createElement("main")
	container.className = "dsh-desktop-startup-error"
	const heading = document.createElement("h1")
	const chinese = typeof navigator !== "undefined" && /^zh(?:-|$)/i.test(navigator.language)
	heading.textContent = chinese ? "DeepSeek Harness 启动失败" : "DeepSeek Harness failed to start"
	const message = document.createElement("p")
	message.textContent = error instanceof Error ? error.message : String(error)
	container.append(heading, message)
	return container
}
