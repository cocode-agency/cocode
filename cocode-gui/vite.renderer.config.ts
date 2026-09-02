import http from "node:http"
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
import {
	cocodeClientBundleDirectory,
	dshClientBundleDirectory,
} from "./src/shared/dsh-runtime/dsh-client-bundle-path"

assertDshClientPackageOwnership(DSH_CLIENT_OWNERSHIP.webBoot, "web-boot")
assertDshClientPackageOwnership(DSH_CLIENT_OWNERSHIP.reactRenderer, "react-renderer")
assertDshClientPackageOwnership(DSH_CLIENT_OWNERSHIP.webBundle, "web-app")

// electron-vite resolves this config from the GUI package root. Keep paths
// independent of CommonJS-only __dirname so the config is also importable as ESM.
const projectRoot = path.resolve()
const cocodeClientRoot = path.join(projectRoot, "packages/cocode")
const dshClientBundleDiscovery = findDshClientBundles()
const dshClientBundles = dshClientBundleDiscovery.bundles
const dshRuntimeUrl = normalizeRuntimeUrl(process.env.COCODE_DSH_RUNTIME_URL)
const dshRuntimeCookie = process.env.COCODE_DSH_RUNTIME_COOKIE?.trim()
const dshRuntimeAuthority = process.env.COCODE_DSH_RUNTIME_AUTHORITY?.trim()

// https://vitejs.dev/config
export default defineConfig({
	base: "./",
	plugins: [dshClientBundlePlugin(), dshWebDevPlugin(dshRuntimeCookie, dshRuntimeAuthority)],
	server:
		dshRuntimeUrl === undefined
			? undefined
			: { proxy: createDshRuntimeProxy(dshRuntimeUrl, dshRuntimeCookie) },
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

export function createDshRuntimeProxy(
	runtimeUrl: string,
	runtimeCookie?: string,
): Record<string, ProxyOptions> {
	// changeOrigin must stay false: the /api trust fence (client-connection)
	// requires the request Host header to match the browser's Origin host, and
	// the page always calls same-origin through this proxy (localhost:5273).
	// Rewriting Host to the target would 403 every /api RPC — pickDirectory
	// and the other loopback-pinned methods fail first, then the rest.
	const target = cleanRuntimeUrl(runtimeUrl)
	const proxy: ProxyOptions = {
		target,
		changeOrigin: false,
		ws: true,
		...(runtimeCookie === undefined ? {} : { headers: { Cookie: runtimeCookie } }),
	}
	return {
		"/api": proxy,
		"/cocode": proxy,
		"/sidebar": proxy,
		"/plugins": proxy,
	}
}

function dshWebDevPlugin(runtimeCookie?: string, runtimeAuthority?: string): Plugin {
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
					const runtimeResponse = await fetchDshRuntime(
						dshRuntimeUrl,
						runtimeAuthority,
						runtimeCookie,
					)
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

function fetchDshRuntime(
	runtimeUrl: string,
	runtimeAuthority: string | undefined,
	runtimeCookie: string | undefined,
): Promise<Response> {
	if (runtimeAuthority === undefined) {
		return fetch(
			runtimeUrl,
			runtimeCookie === undefined ? undefined : { headers: { Cookie: runtimeCookie } },
		)
	}
	const parsed = new URL(runtimeUrl)
	if (parsed.protocol !== "http:") {
		throw new Error("DSH Web bootstrap requires an HTTP loopback endpoint")
	}
	return new Promise((resolve, reject) => {
		const request = http.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: `${parsed.pathname}${parsed.search}`,
				method: "GET",
				headers: {
					Host: runtimeAuthority,
					...(runtimeCookie === undefined ? {} : { Cookie: runtimeCookie }),
				},
			},
			(response) => {
				const chunks: Buffer[] = []
				response.on("data", (chunk: Buffer) => chunks.push(chunk))
				response.on("end", () => {
					const headers = new Headers()
					for (const [name, value] of Object.entries(response.headers)) {
						if (Array.isArray(value)) {
							for (const item of value) headers.append(name, item)
						} else if (value !== undefined) {
							headers.set(name, value)
						}
					}
					resolve(
						new Response(Buffer.concat(chunks), {
							status: response.statusCode ?? 0,
							statusText: response.statusMessage,
							headers,
						}),
					)
				})
			},
		)
		request.once("error", reject)
		request.end()
	})
}

function cleanRuntimeUrl(runtimeUrl: string): string {
	const parsed = new URL(runtimeUrl)
	parsed.search = ""
	parsed.hash = ""
	return parsed.href.replace(/\/$/, "")
}

export function findDshClientBundles(
	sources: readonly { readonly root: string; readonly prefix: string }[] = [
		{ root: path.join(projectRoot, "node_modules/@deepseek-ai"), prefix: "" },
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
			: dshClientBundleDirectory(manifest.name) ??
			  cocodeClientBundleDirectory(manifest.name) ??
			  relativeDirectory
		const clientBundle = path.join(packageRoot, "lib", "client.js")
		if (!existsSync(clientBundle)) {
			missing.push(bundleDirectory)
			continue
		}
		bundles.set(bundleDirectory, clientBundle)
	}
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
