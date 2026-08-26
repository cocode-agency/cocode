/**
 * Desktop dev runner: DSH client watcher + electron-vite, under one dev lock.
 *
 * The lock is taken first, before any build, so a second `pnpm run dev` in this
 * workspace displaces this one instead of racing it. Everything spawned here is
 * registered with the child supervisor, which guarantees teardown on exit.
 */
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import { shellCommandOptions } from "./lib/child-process-options.mjs"
import { createChildSupervisor } from "./lib/child-supervisor.mjs"
import { forkClientWatcher } from "./lib/client-watcher.mjs"
import { buildDevRuntime } from "./lib/dev-build.mjs"
import { acquireDevLock } from "./lib/dev-lock.mjs"
import { stopProcessesMatching } from "./lib/process-control.mjs"
import { cleanupRuntime, prepareRuntime, resolveRuntimeRoot } from "./lib/runtime-cache.mjs"
import { reconcile as reconcileOwnedProcesses } from "./reconcile-owned-processes.mjs"

const ENTRY_SCRIPT = "start-with-dsh-runtime.mjs"
// Benign macOS IMK / Chromium stderr noise; see electron/electron#45002.
const BENIGN_MACOS_STDERR_PATTERNS = [
	/error messaging the mach port for IMKCFRunLoopWakeUpReliable/,
	/\+\[IMKClient subclass\]: chose IMKClient_Modern/,
	/\+\[IMKInputSession subclass\]: chose IMKInputSession_Modern/,
]

// Windows exposes pnpm as a .cmd shim that spawn cannot execute directly, so
// dev runners go through Corepack at the pinned version like every build script.
const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack"
const pinnedPnpmArgs = ["pnpm@10.34.5"]

const workspace = path.resolve(process.cwd())
const supervisorEntry = path.resolve(
	"../cocode-host-supervisor/packages/host-supervisor/lib/bin.js",
)
const runtime = resolveRuntimeRoot("dsh-desktop-dev-")
const devUserData = resolveDevUserData(workspace)
let devBuildId = "dev"
let devHostConfigFingerprint = ""
let hostLease
const children = createChildSupervisor()
const devLock = await acquireDevLock({ name: "cocode-gui", entryScript: ENTRY_SCRIPT })

try {
	process.exitCode = await run()
} finally {
	await children.stopAll()
	await hostLease?.release().catch(() => undefined)
	// Electron process can outlive electron-vite, so sweep the
	// workspace once more before releasing the lock to the next runner.
	await stopStrayElectron()
	cleanupRuntime(runtime)
	devLock.release()
}

/** Resolves to the exit code this runner should report. */
async function run() {
	// Migration guard for older acceptance runners. Normal DSH Hosts are owned
	// by the Supervisor lease and do not match this narrow legacy signature.
	await reconcileOwnedProcesses({ apply: true })
	await stopStrayElectron()
	buildDevRuntime({ hardenElectron: true })
	prepareRuntime(runtime)
	devBuildId = resolveDevBuildId(workspace, runtime.root)
	devHostConfigFingerprint = resolveDevHostConfigFingerprint(devBuildId)
	if (children.isStopping()) return 0

	const watcher = forkClientWatcher(runtime.root)
	children.track(watcher.child, "DSH client watcher")
	await watcher.ready
	if (children.isStopping()) return 0

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

	const runtimeUrl = await acquireHostEndpoint()
	const exitCode = await waitForExit(startElectron(runtimeUrl))
	if (watcherFailure) throw watcherFailure
	// A shutdown this runner initiated is what the developer asked for, so the
	// signal-derived exit code of the child it killed is not a failure to report.
	return children.isStopping() ? 0 : exitCode
}

async function acquireHostEndpoint() {
	const { createHostSupervisorClient, resolveCocodeHostScope, resolveHostRuntimeEnv } =
		await import("@cocode-agency/host-supervisor")
	const dshHome = resolveCocodeDshHome()
	const hostEnv = {
		...process.env,
		COCODE_DSH_HOME: dshHome,
		DSH_HOME: dshHome,
		DSH_PROFILE: "cocode",
		COCODE_RUNTIME_CHANNEL: "dev",
		COCODE_HOST_CONFIG_FINGERPRINT: devHostConfigFingerprint,
	}
	hostLease = await createHostSupervisorClient({
		nodeExecutable: process.execPath,
		serviceEntry: supervisorEntry,
	}).acquire({
		scope: resolveCocodeHostScope(hostEnv),
		clientKind: "gui",
		requiredServices: ["web"],
		minProtocolRevision: "1.0",
		runtimeEnv: resolveHostRuntimeEnv(hostEnv),
	})
	const web = hostLease.descriptor.services.find((service) => service.service === "web")
	if (web === undefined) throw new Error("development Host did not advertise its Web service")
	const endpoint = web.endpoint.replace(/\/$/, "")
	console.log(
		`[gui-dev] host=${String(hostLease.descriptor.hostPid)} runtime=${
			hostLease.descriptor.runtimeVersion
		} endpoint=${endpoint}`,
	)
	return endpoint
}

function startElectron(runtimeUrl) {
	console.log(
		`[gui-dev] source=${workspace} build=${devBuildId} userData=${devUserData} ` +
			`runtime=${runtimeUrl}`,
	)
	const electron = children.track(
		spawn(
			corepackCommand,
			[...pinnedPnpmArgs, "exec", "electron-vite", "dev"],
			shellCommandOptions({
				stdio: ["inherit", "inherit", process.platform === "darwin" ? "pipe" : "inherit"],
				cwd: workspace,
				env: {
					...process.env,
					COCODE_DEV_MODE: "1",
					COCODE_DEV_USER_DATA_DIR: devUserData,
					COCODE_BUILD_ID: devBuildId,
					COCODE_DSH_RUNTIME_URL: runtimeUrl,
					COCODE_RUNTIME_CHANNEL: "dev",
					COCODE_HOST_CONFIG_FINGERPRINT: devHostConfigFingerprint,
					COCODE_DSH_HOME: resolveCocodeDshHome(),
					DSH_RUNTIME_ROOT: runtime.root,
					COCODE_SUPERVISOR_SERVICE_ENTRY: supervisorEntry,
					COCODE_NODE_EXECUTABLE: process.execPath,
				},
			}),
		),
		"Electron",
	)
	electron.stderr?.on("data", (chunk) => {
		if (BENIGN_MACOS_STDERR_PATTERNS.some((pattern) => pattern.test(chunk.toString()))) return
		process.stderr.write(chunk)
	})
	return electron
}

function resolveDevUserData(workspaceRoot) {
	const workspaceKey = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16)
	return path.join(os.tmpdir(), "cocode-gui-dev", workspaceKey)
}

function resolveDevBuildId(workspaceRoot, runtimeRoot) {
	const configured = process.env.COCODE_BUILD_ID?.trim()
	if (configured) return configured.slice(0, 64)
	const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
		cwd: workspaceRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	})
	const revision = result.status === 0 ? result.stdout.trim() : ""
	let runtimeFingerprint = ""
	try {
		runtimeFingerprint = createHash("sha256")
			.update(readFileSync(path.join(runtimeRoot, ".cocode-runtime-cache.json")))
			.digest("hex")
			.slice(0, 12)
	} catch {
		// Temporary runtimes may not have a cache marker; the revision is still useful.
	}
	const base = revision === "" ? "dev" : revision.slice(0, 12)
	return `${base}-${runtimeFingerprint || "runtime"}`.slice(0, 64)
}

function resolveDevHostConfigFingerprint(buildId) {
	const configured = process.env.COCODE_HOST_CONFIG_FINGERPRINT?.trim()
	const base =
		configured === undefined || configured === "" ? "cocode-web-jsonrpc-v3" : configured
	return `${base}:dev-${buildId}`.slice(0, 120)
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

function stopStrayElectron() {
	const executable =
		process.platform === "darwin"
			? path.join(
					workspace,
					"node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
			  )
			: path.join(workspace, "node_modules/electron/dist/electron")
	return stopProcessesMatching({
		matches: (command) => command.startsWith(`${executable} `),
		workspace,
		label: "orphaned Electron instance",
	})
}

function waitForExit(child) {
	return new Promise((resolve, reject) => {
		child.once("error", reject)
		child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
	})
}
