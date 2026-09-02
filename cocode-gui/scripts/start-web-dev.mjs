/**
 * Browser dev runner: DSH client watcher + Vite against a shared DSH Host.
 *
 * Unlike the desktop runner there is no Electron to hold the Host lease, so this
 * script acquires one itself and releases it during teardown; the Host then
 * idles out on its own if nothing else is attached.
 */
import { spawn } from "node:child_process"
import os from "node:os"
import * as path from "pathe"
import { shellCommandOptions } from "./lib/child-process-options.mjs"
import { createChildSupervisor } from "./lib/child-supervisor.mjs"
import { forkClientWatcher } from "./lib/client-watcher.mjs"
import { buildDevRuntime } from "./lib/dev-build.mjs"
import { acquireDevLock } from "./lib/dev-lock.mjs"
import { createDevHostEnvironment, resolveDevSupervisorEntry } from "./lib/dev-runtime-entry.mjs"
import { establishDshWebAuth } from "./lib/dsh-web-auth.mjs"
import { cleanupRuntime, prepareRuntime, resolveRuntimeRoot } from "./lib/runtime-cache.mjs"

const ENTRY_SCRIPT = "start-web-dev.mjs"
const VITE_PORT = "5273"

// Windows exposes pnpm as a .cmd shim that spawn cannot execute directly, so
// dev runners go through Corepack at the pinned version like every build script.
const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack"
const pinnedPnpmArgs = ["pnpm@10.34.5"]

const workspace = path.resolve(process.cwd())
const runtime = resolveRuntimeRoot("dsh-web-dev-")
const children = createChildSupervisor()
const devLock = await acquireDevLock({ name: "cocode-gui-web", entryScript: ENTRY_SCRIPT })
let hostLease

try {
	process.exitCode = await run()
} finally {
	await children.stopAll()
	await hostLease?.release().catch(() => undefined)
	cleanupRuntime(runtime)
	devLock.release()
}

/** Resolves to the exit code this runner should report. */
async function run() {
	buildDevRuntime()
	prepareRuntime(runtime)
	const supervisorEntry = resolveDevSupervisorEntry(runtime.root)
	const devHostEnvironment = createDevHostEnvironment(process.env, supervisorEntry)
	if (children.isStopping()) return 0

	const watcher = forkClientWatcher(runtime.root)
	children.track(watcher.child, "DSH client watcher")
	await watcher.ready
	if (children.isStopping()) return 0

	const webRuntime = await acquireHostEndpoint(supervisorEntry, devHostEnvironment)

	let watcherFailure
	watcher.child.once("exit", (code, signal) => {
		if (children.isStopping()) return
		watcherFailure = new Error(
			`DSH client watcher exited unexpectedly (code=${String(code)}, signal=${String(
				signal,
			)}).`,
		)
		void children.stopAll()
	})

	const exitCode = await waitForExit(startVite(webRuntime, devHostEnvironment))
	if (watcherFailure) throw watcherFailure
	// A shutdown this runner initiated is what the developer asked for, so the
	// signal-derived exit code of the child it killed is not a failure to report.
	return children.isStopping() ? 0 : exitCode
}

async function acquireHostEndpoint(supervisorEntry, devHostEnvironment) {
	const { createHostSupervisorClient, resolveCocodeHostScope, resolveHostRuntimeEnv } =
		await import("@cocode-agency/host-supervisor")
	const dshHome = resolveCocodeDshHome()
	const hostEnv = {
		...devHostEnvironment,
		COCODE_DSH_HOME: dshHome,
		DSH_HOME: dshHome,
		DSH_PROFILE: "cocode",
	}
	const lease = await createHostSupervisorClient({
		nodeExecutable: process.execPath,
		serviceEntry: supervisorEntry,
	}).acquire({
		scope: resolveCocodeHostScope(hostEnv),
		clientKind: "gui",
		requiredServices: ["web"],
		minProtocolRevision: "1.0",
		runtimeEnv: resolveHostRuntimeEnv(hostEnv),
	})
	hostLease = lease
	const web = lease.descriptor.services.find((service) => service.service === "web")
	if (web === undefined) throw new Error("shared Host did not advertise its Web service")
	const webRuntime = await establishDshWebAuth(web.endpoint, web.token, "localhost:5273")
	console.log(`[dsh-runtime] web endpoint ${webRuntime.endpoint}`)
	return webRuntime
}

function startVite(webRuntime, devHostEnvironment) {
	return children.track(
		spawn(
			corepackCommand,
			[
				...pinnedPnpmArgs,
				"exec",
				"vite",
				"--config",
				"vite.renderer.config.ts",
				"--port",
				VITE_PORT,
			],
			shellCommandOptions({
				stdio: "inherit",
				cwd: workspace,
				env: {
					...devHostEnvironment,
					DSH_RUNTIME_ROOT: runtime.root,
					COCODE_DSH_RUNTIME_URL: webRuntime.endpoint,
					COCODE_DSH_RUNTIME_COOKIE: webRuntime.cookie,
					COCODE_DSH_RUNTIME_AUTHORITY: webRuntime.authority,
					COCODE_NODE_EXECUTABLE: process.execPath,
				},
			}),
		),
		"Vite",
	)
}

function resolveCocodeDshHome() {
	const configured =
		process.env.COCODE_DSH_HOME?.trim() || process.env.COCODE_DSH_SOURCE_HOME?.trim()
	const selected =
		configured !== undefined && configured.length > 0
			? configured
			: path.join(os.homedir(), ".dsh")
	if (selected === "~") return os.homedir()
	if (selected.startsWith("~/") || selected.startsWith("~\\")) {
		return path.resolve(path.join(os.homedir(), selected.slice(2)))
	}
	return path.resolve(selected)
}

function waitForExit(child) {
	return new Promise((resolve, reject) => {
		child.once("error", reject)
		child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
	})
}
