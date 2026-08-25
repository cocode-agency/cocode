/**
 * Desktop/browser-dev adapter for the DSH HTML bootstrap protocol.
 *
 * The managed Electron page starts from the GUI's Vite index instead of the
 * Host WebServer's rendered index, so it cannot receive the parser-installed
 * registration queue. Keep the same queue contract here; the actual module
 * system still comes from the preloaded DSH client bundle.
 */

export const DSH_CLIENT_MODULES_ID = "@deepseek-ai/dsh-client-modules"

export interface DshClientBundleRegistration {
	readonly id: string
	readonly factory: (
		require: (specifier: string) => unknown,
	) => Record<string, unknown>
}

export interface DshModuleCreateOptions {
	readonly boot: unknown
	readonly staticModules: Record<string, unknown>
	readonly loadBundle?: (url: string) => Promise<void>
}

export interface DshClientModuleSystem {
	readonly manifest: { readonly rev: string; readonly plugins: readonly unknown[] }
	readonly loadCache: Map<string, unknown>
	import(specifier: string, parentUrl: string, attrs: Record<string, unknown>): Promise<unknown>
	prefetch(id: string): Promise<void>
	invalidate(id: string): void
}

export interface DshModuleLoaderTarget {
	mode: "queue" | "live"
	pendingQueue: DshClientBundleRegistration[]
	load(registration: DshClientBundleRegistration): void
	create(options: DshModuleCreateOptions): DshClientModuleSystem
}

interface DshWindowModuleLoader {
	__ModuleLoader__?: DshModuleLoaderTarget
}

interface DshBootstrapModuleFace {
	createClientModuleSystem(
		target: DshModuleLoaderTarget,
		bootstrapModule: {
			readonly id: string
			readonly exports: Record<string, unknown>
		},
		options: DshModuleCreateOptions,
	): DshClientModuleSystem
	apply: (context: unknown) => void
}

/** Install the stable queue facade unless the Host already installed it. */
export function ensureDshModuleLoader(): DshModuleLoaderTarget {
	const win = globalThis as DshWindowModuleLoader
	const existing = win.__ModuleLoader__
	if (existing !== undefined) return existing

	const pendingQueue: DshClientBundleRegistration[] = []
	const target = {} as DshModuleLoaderTarget
	target.mode = "queue"
	target.pendingQueue = pendingQueue
	target.load = (registration) => {
		pendingQueue.push(registration)
	}
	target.create = (options) => {
		if (target.mode !== "queue") {
			throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
		}
		const index = pendingQueue.findIndex((registration) => registration.id === DSH_CLIENT_MODULES_ID)
		const registration = pendingQueue[index]
		if (registration === undefined) {
			throw new Error(
				`client-modules: HTML did not preload ${DSH_CLIENT_MODULES_ID}/client.js`,
			)
		}
		pendingQueue.splice(index, 1)
		const exports = registration.factory((specifier) => {
			throw new Error(
				`client-modules: ${DSH_CLIENT_MODULES_ID}/client.js requested external "${specifier}" before the module system existed`,
			)
		})
		const face = exports as Partial<DshBootstrapModuleFace>
		if (
			typeof face.createClientModuleSystem !== "function" ||
			typeof face.apply !== "function"
		) {
			throw new Error(
				`client-modules: ${DSH_CLIENT_MODULES_ID}/client.js did not export the bootstrap module face`,
			)
		}
		return face.createClientModuleSystem(
			target,
			{ id: registration.id, exports },
			options,
		)
	}
	win.__ModuleLoader__ = target
	return target
}
