import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { defineConfig, type Plugin, type ProxyOptions } from "vite"
import {
	extractDshBootManifest,
	extractDshThemePreference,
} from "./src/shared/dsh-runtime/bootstrap-html"
import {
	assertDshClientPackageOwnership,
	DSH_CLIENT_OWNERSHIP,
} from "./scripts/lib/dsh-client-ownership.mjs"

assertDshClientPackageOwnership(DSH_CLIENT_OWNERSHIP.webBoot, "web-boot")
assertDshClientPackageOwnership(DSH_CLIENT_OWNERSHIP.reactRenderer, "react-renderer")
assertDshClientPackageOwnership(DSH_CLIENT_OWNERSHIP.webBundle, "web-app")

// electron-vite resolves this config from the GUI package root. Keep paths
// independent of CommonJS-only __dirname so the config is also importable as ESM.
const projectRoot = path.resolve()
const dshClientRoot = path.join(projectRoot, "packages/client")
const cocodeClientRoot = path.join(projectRoot, "packages/cocode")
const dshSource = (relativePath: string): string => path.join(projectRoot, relativePath)
const localClient = (relativePath: string): string => path.join(dshClientRoot, relativePath)
const dshClientBundleDiscovery = findDshClientBundles()
const dshClientBundles = dshClientBundleDiscovery.bundles
const dshRuntimeUrl = normalizeRuntimeUrl(process.env.COCODE_DSH_RUNTIME_URL)

// https://vitejs.dev/config
export default defineConfig({
	base: "./",
	plugins: [dshClientBundlePlugin(), dshWebDevPlugin()],
	server:
		dshRuntimeUrl === undefined ? undefined : { proxy: createDshRuntimeProxy(dshRuntimeUrl) },
	resolve: {
		alias: [
			{ find: "@", replacement: path.join(projectRoot, "src/renderer") },
			{
				find: /^node:module$/,
				replacement: path.join(
					projectRoot,
					"src/renderer/app/bootstrap/node-module-stub.ts",
				),
			},
			{
				find: /^@deepseek-ai\/dsh-client-web$/,
				replacement: localClient("client/web/src/index.ts"),
			},
			{
				find: /^@deepseek-ai\/dsh-client-ui-slots$/,
				replacement: localClient("client/ui-slots/src/index.ts"),
			},
			{
				find: /^@deepseek-ai\/dsh-client-ui-primitives$/,
				replacement: localClient("client/ui-primitives/src/index.ts"),
			},
			{
				find: /^@deepseek-ai\/dsh-client-ui-attachment$/,
				replacement: localClient("client/ui-attachment/src/index.ts"),
			},
			{
				find: /^@deepseek-ai\/dsh-client-ui-theme\/styles\/(.+)$/,
				replacement: `${localClient("client/ui-theme/src/styles")}/$1`,
			},
			{
				find: /^@deepseek-ai\/dsh-client-modules\/client$/,
				replacement: localClient("client/modules/src/client/index.ts"),
			},
			{
				find: /^@deepseek-ai\/cordis$/,
				replacement: dshSource("vendor/cordis/src/index.ts"),
			},
			{
				find: /^@deepseek-ai\/cordis-plugin-loader$/,
				replacement: dshSource("vendor/loader/src/index.ts"),
			},
			{
				find: /^@deepseek-ai\/cosmokit$/,
				replacement: dshSource("vendor/cosmokit/src/index.ts"),
			},
			{
				find: /^@deepseek-ai\/schemastery$/,
				replacement: dshSource("vendor/schemastery/src/index.ts"),
			},
		],
	},
	define: {
		"process.versions.node": '"0.0.0"',
		"process.execArgv": "[]",
		"process.env.CORDIS_SHARED": "undefined",
	},
})

export function normalizeRuntimeUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	if (trimmed === undefined || trimmed.length === 0) return undefined
	return trimmed.replace(/\/$/, "")
}

export function createDshRuntimeProxy(runtimeUrl: string): Record<string, ProxyOptions> {
	// changeOrigin must stay false: the /api trust fence (client-connection)
	// requires the request Host header to match the browser's Origin host, and
	// the page always calls same-origin through this proxy (localhost:5273).
	// Rewriting Host to the target would 403 every /api RPC — pickDirectory
	// and the other loopback-pinned methods fail first, then the rest.
	const proxy: ProxyOptions = {
		target: runtimeUrl,
		changeOrigin: false,
		ws: true,
	}
	return {
		"/api": proxy,
		"/cocode": proxy,
		"/sidebar": proxy,
		"/plugins": proxy,
	}
}

function dshWebDevPlugin(): Plugin {
	return {
		name: "cocode-dsh-web-dev",
		configureServer(server) {
			if (dshRuntimeUrl === undefined) return
			server.middlewares.use(async (request, response, next) => {
				const pathname = new URL(request.url ?? "/", "http://renderer.local").pathname
				if (pathname !== "/__cocode/dsh-bootstrap") {
					next()
					return
				}
				try {
					const runtimeResponse = await fetch(dshRuntimeUrl)
					if (!runtimeResponse.ok) {
						throw new Error(
							`DSH runtime bootstrap request failed with HTTP ${String(
								runtimeResponse.status,
							)}.`,
						)
					}
					const html = await runtimeResponse.text()
					const body = JSON.stringify({
						origin: new URL(dshRuntimeUrl).origin,
						boot: extractDshBootManifest(html),
						themePreference: extractDshThemePreference(html),
					})
					response.statusCode = 200
					response.setHeader("content-type", "application/json; charset=utf-8")
					response.setHeader("cache-control", "no-store")
					response.end(body)
				} catch (error) {
					response.statusCode = 503
					response.setHeader("content-type", "application/json; charset=utf-8")
					response.setHeader("cache-control", "no-store")
					response.end(
						JSON.stringify({
							error: error instanceof Error ? error.message : String(error),
						}),
					)
				}
			})
		},
	}
}

export function findDshClientBundles(
	sources: readonly { readonly root: string; readonly prefix: string }[] = [
		{ root: dshClientRoot, prefix: "" },
		{ root: cocodeClientRoot, prefix: "cocode" },
	],
): {
	readonly bundles: ReadonlyMap<string, string>
	readonly missing: readonly string[]
} {
	const bundles = new Map<string, string>()
	const missing: string[] = []
	for (const source of sources) {
		if (!existsSync(source.root)) continue
		visitDshClientPackages(source.root, source, source.root, bundles, missing)
	}
	return { bundles, missing }
}

function visitDshClientPackages(
	directory: string,
	source: { readonly root: string; readonly prefix: string },
	root: string,
	bundles: Map<string, string>,
	missing: string[],
): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "lib") continue
		const packageRoot = path.join(directory, entry.name)
		const manifestPath = path.join(packageRoot, "package.json")
		if (!existsSync(manifestPath)) {
			visitDshClientPackages(packageRoot, source, root, bundles, missing)
			continue
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			name?: string
			dsh?: { client?: { platform?: string } }
		}
		if (manifest.dsh?.client?.platform !== "web" || typeof manifest.name !== "string") {
			visitDshClientPackages(packageRoot, source, root, bundles, missing)
			continue
		}
		assertDshClientPackageOwnership(manifest.name)
		const relativeDirectory = path.relative(root, packageRoot).split(path.sep).join("/")
		const bundleDirectory = source.prefix
			? path.posix.join(source.prefix, relativeDirectory)
			: clientBundleDirectory(manifest.name, relativeDirectory)
		const clientBundle = path.join(packageRoot, "lib", "client.js")
		if (!existsSync(clientBundle)) {
			missing.push(bundleDirectory)
			continue
		}
		bundles.set(bundleDirectory, clientBundle)
	}
}

function clientBundleDirectory(packageName: string, relativeDirectory: string): string {
	const prefix = "@deepseek-ai/dsh-client-"
	if (packageName.startsWith(prefix)) return packageName.slice(prefix.length)
	return relativeDirectory
}

function dshClientBundlePlugin(): Plugin {
	let productionBuild = false
	return {
		name: "dsh-local-client-bundles",
		configResolved(config) {
			productionBuild = config.command === "build"
		},
		buildStart() {
			if (!productionBuild || dshClientBundleDiscovery.missing.length === 0) return
			this.error(
				`Missing DSH client bundles: ${dshClientBundleDiscovery.missing.join(", ")}. ` +
					"Run pnpm run build:runtime before electron-vite build.",
			)
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const pathname = new URL(request.url ?? "/", "http://renderer.local").pathname
				const bundleRequest = parseDshClientBundleRequest(pathname)
				const bundle =
					bundleRequest === undefined
						? undefined
						: dshClientBundles.get(bundleRequest.directory)
				const source =
					bundle === undefined
						? undefined
						: `${bundle}${bundleRequest?.sourceMap === true ? ".map" : ""}`
				if (source === undefined || !existsSync(source)) {
					next()
					return
				}
				response.statusCode = 200
				response.setHeader(
					"content-type",
					bundleRequest?.sourceMap === true
						? "application/json; charset=utf-8"
						: "text/javascript; charset=utf-8",
				)
				response.setHeader("cache-control", "no-store")
				response.end(readFileSync(source))
			})
		},
		generateBundle() {
			for (const [directory, source] of dshClientBundles) {
				this.emitFile({
					type: "asset",
					fileName: `dsh-client/${directory}/client.js`,
					source: readFileSync(source),
				})
			}
		},
	}
}

export function parseDshClientBundleRequest(
	pathname: string,
): { readonly directory: string; readonly sourceMap: boolean } | undefined {
	const match = pathname.match(/^\/dsh-client\/(.+)\/client\.js(\.map)?$/)
	if (match?.[1] === undefined) return undefined
	return { directory: match[1], sourceMap: match[2] !== undefined }
}
