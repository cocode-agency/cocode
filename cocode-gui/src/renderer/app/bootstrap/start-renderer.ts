// The Web boot kernel owns the framework-free entrypoint. React mounting is
// provided later by @deepseek-ai/dsh-client-ui-renderer through the DSH graph.
import { AppWebEntry } from "@deepseek-ai/dsh-client-web"
import type {
	DshRuntimeReboundDto,
	DshRuntimeRecoveryStateDto,
	DshThemePreference,
} from "../../../contracts/ipc/dsh-runtime.contract"
import { createDshBundleLoader } from "./dsh-bundle-loader"
import { selectDshBootBatches, selectDshBootEntries } from "./dsh-boot-entries"
import {
	DSH_CLIENT_MODULES_ID,
	ensureDshModuleLoader,
	type DshModuleLoaderTarget,
} from "./dsh-module-loader"
import { installDshTransport, rebindDshTransport } from "./dsh-transport"
import { spoofFileLoopbackHostname } from "./file-loopback-hostname"
import {
	isDesktopDshBridgeAvailable,
	isElectronDesktopDevelopment,
	loadDshBootstrap,
	resolveRendererRuntimeOrigin,
} from "./load-dsh-bootstrap"
import { resolveLocalDshClientBundleUrl } from "./local-dsh-client-bundles"
import { RendererLogger } from "../../shared/logging/renderer-logger"
import { prepareDshBootManifest } from "./prepare-dsh-boot"

const logger = new RendererLogger()

/**
 * The shared Cocode client runtime is a browser contract library, not a
 * Cordis application plugin. Its factory must be present in the module table
 * so Cocode bundles can require it, but mounting its `apply` face alongside
 * the upstream session/workspace controllers would register duplicate
 * services. The Host advertises the package so it can serve the bundle; the
 * renderer preloads it and removes it from the Loader roster below.
 */
const COCODE_CLIENT_RUNTIME_ID = "@deepseek-ai/dsh-client-runtime"

/** macOS traffic-light strip height; sidebar logo row starts below it. */
const DESKTOP_DARWIN_TITLEBAR_INSET_PX = 32

export async function startRenderer(element: HTMLElement): Promise<void> {
	logger.info("renderer.start.started", { component: "renderer" })
	try {
		spoofFileLoopbackHostname()
		const moduleLoader = ensureDshModuleLoader()
		const bootstrap = await loadDshBootstrap()
		applyInitialTheme(bootstrap.themePreference)
		markDesktopHost()
		markThemeReady()
		const runtimeOrigin = resolveRendererRuntimeOrigin(bootstrap)
		window.__DSH_DESKTOP_RUNTIME_ORIGIN__ = runtimeOrigin
		window.__DSH_DESKTOP_ENDPOINT_GENERATION__ = 0
		if (isDesktopDshBridgeAvailable()) {
			if (!isElectronDesktopDevelopment()) installDshTransport(runtimeOrigin, logger)
			installRuntimeRecoveryListeners()
		}
		const bootEntries = selectDshBootEntries(
			bootstrap.boot.entries,
			window.location.protocol === "file:",
		)
		const runtimeEntry = bootEntries.find((entry) => entry.id === COCODE_CLIENT_RUNTIME_ID)
		const loaderEntries = bootEntries.filter((entry) => entry.id !== COCODE_CLIENT_RUNTIME_ID)
		const bootBatches = selectDshBootBatches(bootstrap.boot.batches, loaderEntries)
		const resolveEntryUrl = (entry: (typeof loaderEntries)[number]): string =>
			withRevision(
				resolveLocalDshClientBundleUrl(entry.id) ?? new URL(entry.url, runtimeOrigin).href,
				entry.rev,
			)
		logger.log("info", "renderer.dsh.boot.graph", {
			component: "renderer",
			attributes: {
				entries: bootEntries.map((entry) => entry.id).join(","),
				runtimeEntry: runtimeEntry?.id ?? "none",
				queue: moduleLoader.pendingQueue.map((registration) => registration.id).join(","),
			},
		})
		window.__DSH_BOOT__ = {
			rev: bootstrap.boot.rev,
			entries: loaderEntries.map((entry) => ({
				...entry,
				url: resolveEntryUrl(entry),
			})),
			batches: localizeDshBootBatches(
				bootBatches,
				loaderEntries,
				resolveEntryUrl,
				runtimeOrigin,
			),
		}
		if (runtimeEntry !== undefined) {
			await createDshBundleLoader()(
				withRevision(
					resolveLocalDshClientBundleUrl(runtimeEntry.id) ??
						new URL(runtimeEntry.url, runtimeOrigin).href,
					runtimeEntry.rev,
				),
			)
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

function localizeDshBootBatches(
	batches: readonly (typeof window.__DSH_BOOT__ extends infer Boot
		? Boot extends { batches: readonly (infer Batch)[] }
			? Batch
			: never
		: never)[],
	entries: readonly { readonly id: string; readonly rev: string; readonly url: string }[],
	resolveEntryUrl: (entry: (typeof entries)[number]) => string,
	runtimeOrigin: string,
): readonly {
	readonly phase: "bootstrap" | "application"
	readonly url: string
	readonly rev: string
	readonly entries: readonly string[]
}[] {
	const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
	const localized: {
		phase: "bootstrap" | "application"
		url: string
		rev: string
		entries: readonly string[]
	}[] = []
	for (const batch of batches) {
		const remoteEntries: string[] = []
		for (const id of batch.entries) {
			const entry = entriesById.get(id)
			if (entry === undefined) continue
			const localUrl = resolveLocalDshClientBundleUrl(id)
			if (localUrl === undefined) {
				remoteEntries.push(id)
				continue
			}
			localized.push({
				phase: batch.phase,
				url: resolveEntryUrl(entry),
				rev: entry.rev,
				entries: [id],
			})
		}
		if (remoteEntries.length > 0) {
			localized.push({
				...batch,
				url: new URL(batch.url, runtimeOrigin).href,
				entries: remoteEntries,
			})
		}
	}
	return localized
}

function withRevision(url: string, revision: string): string {
	const parsed = new URL(url, window.location.href)
	parsed.searchParams.set("rev", revision)
	return parsed.href
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
		const runtimeOrigin = resolveRendererRuntimeOrigin(event.bootstrap)
		if (!isElectronDesktopDevelopment()) rebindDshTransport(runtimeOrigin)
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
