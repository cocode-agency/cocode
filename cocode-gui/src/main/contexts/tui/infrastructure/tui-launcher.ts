import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
// Paths here end up in shell command strings and escaping, so keep OS separators.
// eslint-disable-next-line no-restricted-imports
import path from "node:path"
import { app } from "electron"
import { packagedNodeExecutableName } from "../../../../shared/packaged-node-executable"
import { resolveCocodeDshHome, resolveCocodeHome } from "../../dsh-runtime/infrastructure/dsh-home"
import type {
	TuiCommandLineToolResult,
	TuiCommandLineToolRegistrationSource,
	TuiCommandLineToolStatus,
} from "../../../../contracts/ipc/tui.contract"
import {
	createWindowsPersistentPathStore,
	DesktopCliRegistrationService,
	type DesktopCliRuntimeMetadata,
	type TuiInvocation,
} from "./desktop-cli-registration"

export { type TuiInvocation } from "./desktop-cli-registration"

export class TuiLauncher {
	private readonly registration: DesktopCliRegistrationService

	public constructor() {
		const persistentPathStore = createWindowsPersistentPathStore()
		this.registration = new DesktopCliRegistrationService({
			resolveCandidates: () => resolveShimCandidates(),
			buildInvocation: () => this.buildInvocation(),
			getRuntimeMetadata: () => this.getRuntimeMetadata(),
			getPersistentPath: persistentPathStore.get,
			updatePersistentPath: persistentPathStore.update,
			currentPath: () => process.env.PATH ?? process.env.Path ?? "",
		})
	}

	public buildInvocation(args: readonly string[] = []): TuiInvocation {
		const resourcesRoot = resolveResourcesRoot()
		const executable =
			process.env.COCODE_NODE_EXECUTABLE?.trim() ||
			path.join(resourcesRoot, packagedNodeExecutableName(process.platform))
		const entry = path.join(resourcesRoot, "tui", "cocode-cli.mjs")
		const supervisorEntry = path.join(
			resourcesRoot,
			"dsh-runtime",
			"packages",
			"host-supervisor",
			"lib",
			"bin.js",
		)
		if (!existsSync(entry)) throw new Error(`Packaged TUI entry is missing: ${entry}`)
		if (!existsSync(executable))
			throw new Error(`Packaged Node executable is missing: ${executable}`)
		if (!process.env.COCODE_SUPERVISOR_SERVICE_ENTRY?.trim() && !existsSync(supervisorEntry)) {
			throw new Error(`Packaged Supervisor service entry is missing: ${supervisorEntry}`)
		}
		const env: NodeJS.ProcessEnv = {
			...process.env,
			COCODE_NODE_EXECUTABLE: executable,
			COCODE_SUPERVISOR_SERVICE_ENTRY:
				process.env.COCODE_SUPERVISOR_SERVICE_ENTRY?.trim() || supervisorEntry,
			COCODE_TUI_CLIENT_KIND: "desktop-tui",
			COCODE_HOME: resolveCocodeHome(),
			COCODE_DSH_HOME: resolveCocodeDshHome(),
			DSH_HOME: resolveCocodeDshHome(),
			DSH_PROFILE: "cocode",
			COCODE_HOST_CONFIG_FINGERPRINT:
				process.env.COCODE_HOST_CONFIG_FINGERPRINT?.trim() || "cocode-web-jsonrpc-v3",
			COCODE_RUNTIME_CHANNEL: resolveRuntimeChannel(process.env.COCODE_RUNTIME_CHANNEL),
		}
		return { executable, args: [entry, ...args], env, cwd: process.cwd() }
	}

	public getCommandLineToolStatus(): Promise<TuiCommandLineToolStatus> {
		if (isLinuxInstallerManagedCli()) return this.getLinuxInstallerStatus()
		return this.registration.getStatus()
	}

	public ensureCommandLineTool(
		source: TuiCommandLineToolRegistrationSource = "desktop-startup",
	): Promise<TuiCommandLineToolResult> {
		if (isLinuxInstallerManagedCli()) return this.installerManagedResult()
		return this.registration.ensure(source)
	}

	public repairCommandLineTool(): Promise<TuiCommandLineToolResult> {
		if (isLinuxInstallerManagedCli()) return this.installerManagedResult()
		return this.registration.repair("manual")
	}

	public uninstallCommandLineTool(): Promise<TuiCommandLineToolResult> {
		if (isLinuxInstallerManagedCli()) return this.installerManagedResult()
		return this.registration.uninstall()
	}

	private async installerManagedResult(): Promise<TuiCommandLineToolResult> {
		return { changed: false, status: await this.getLinuxInstallerStatus() }
	}

	private async getLinuxInstallerStatus(): Promise<TuiCommandLineToolStatus> {
		const shimPath = resolveLinuxInstallerCommandPath()
		const directory = path.dirname(shimPath)
		let metadata: DesktopCliRuntimeMetadata = { runtimeValid: false }
		try {
			metadata = await this.getRuntimeMetadata()
		} catch {
			// The wrapper can still be diagnosed when the packaged runtime metadata
			// is unavailable; the status below will report it as stale.
		}
		try {
			const contents = await readFile(shimPath, "utf8")
			const fileStat = await stat(shimPath)
			const managed = contents.includes(LINUX_INSTALLER_TUI_MARKER)
			const executable = (fileStat.mode & 0o111) !== 0
			if (!managed) {
				return {
					state: "conflict",
					path: shimPath,
					directory,
					managedByDesktop: false,
					directoryOnPath: directoryOnPath(directory),
					persistentPathConfigured: directoryOnPath(directory),
					canRepair: false,
					registrationSource: "installer",
					runtimeValid: metadata.runtimeValid,
					detail: "An unmanaged executable already exists at the installer-managed Cocode CLI path.",
				}
			}
			const installed = executable && metadata.runtimeValid
			return {
				state: installed ? "installed" : "stale",
				path: shimPath,
				directory,
				managedByDesktop: false,
				directoryOnPath: directoryOnPath(directory),
				persistentPathConfigured: directoryOnPath(directory),
				canRepair: false,
				registrationSource: "installer",
				runtimeValid: metadata.runtimeValid,
				...(metadata.runtimeVersion === undefined
					? {}
					: { runtimeVersion: metadata.runtimeVersion }),
				...(metadata.tuiVersion === undefined ? {} : { tuiVersion: metadata.tuiVersion }),
				...(metadata.supervisorVersion === undefined
					? {}
					: { supervisorVersion: metadata.supervisorVersion }),
				...(metadata.manifestFingerprint === undefined
					? {}
					: { manifestFingerprint: metadata.manifestFingerprint }),
				...(installed
					? {}
					: { detail: "The installer-managed TUI wrapper or bundled runtime is stale." }),
			}
		} catch (error) {
			if (!isMissingFileError(error)) throw error
			return {
				state: "unavailable",
				path: shimPath,
				directory,
				managedByDesktop: false,
				directoryOnPath: directoryOnPath(directory),
				persistentPathConfigured: directoryOnPath(directory),
				canRepair: false,
				registrationSource: "installer",
				runtimeValid: metadata.runtimeValid,
				detail: "The Linux TUI command is missing. Reinstall the Cocode package.",
			}
		}
	}

	public async openInTerminal(): Promise<void> {
		const invocation = this.buildInvocation()
		if (process.platform === "darwin") {
			const command = shellCommand(invocation)
			await spawnAndWait(
				"/usr/bin/osascript",
				["-e", `tell application "Terminal" to do script ${appleScriptString(command)}`],
				{ ...process.env, ...invocation.env },
			)
			return
		}
		if (process.platform === "win32") {
			await spawnAndWait(
				"cmd.exe",
				["/c", "start", "", "cmd.exe", "/k", windowsCommand(invocation)],
				invocation.env,
			)
			return
		}
		const terminal = process.env.COCODE_TERMINAL?.trim() || process.env.TERMINAL?.trim()
		if (!terminal)
			throw new Error("No terminal executable configured. Set COCODE_TERMINAL or TERMINAL.")
		spawn(terminal, ["-e", invocation.executable, ...invocation.args], {
			cwd: invocation.cwd,
			env: invocation.env,
			stdio: "ignore",
			detached: true,
		}).unref()
	}

	public async readManifest(): Promise<Record<string, unknown> | null> {
		try {
			const resourcesRoot = resolveResourcesRoot()
			return JSON.parse(
				await readFile(path.join(resourcesRoot, "tui", "manifest.json"), "utf8"),
			)
		} catch {
			return null
		}
	}

	private async getRuntimeMetadata(): Promise<DesktopCliRuntimeMetadata> {
		const manifest = await this.readManifest()
		const runtimeVersion =
			typeof manifest?.dshRuntimeVersion === "string"
				? manifest.dshRuntimeVersion
				: await readDevelopmentDshVersion()
		let runtimeValid = true
		if (manifest !== null) {
			try {
				const resourcesRoot = resolveResourcesRoot()
				const cliEntry = path.join(resourcesRoot, "tui", "cocode-cli.mjs")
				const runtimeEntry = path.join(resourcesRoot, "tui", "cocode-tui.mjs")
				const cliHash = createHash("sha256")
					.update(await readFile(cliEntry))
					.digest("hex")
				const runtimeHash = createHash("sha256")
					.update(await readFile(runtimeEntry))
					.digest("hex")
				runtimeValid =
					manifest.schemaVersion === 1 &&
					manifest.entry === "tui/cocode-cli.mjs" &&
					manifest.sha256 === cliHash &&
					manifest.runtimeSha256 === runtimeHash
			} catch {
				runtimeValid = false
			}
		}
		return {
			runtimeValid,
			...(runtimeVersion === undefined ? {} : { runtimeVersion }),
			...(typeof manifest?.tuiVersion === "string"
				? { tuiVersion: manifest.tuiVersion }
				: {}),
			...(typeof manifest?.supervisorVersion === "string"
				? { supervisorVersion: manifest.supervisorVersion }
				: {}),
			...(manifest === null ? {} : { manifestFingerprint: tuiManifestFingerprint(manifest) }),
		}
	}
}

/** Read the DSH package version when the desktop is running from source. */
async function readDevelopmentDshVersion(): Promise<string | undefined> {
	try {
		if (app.isPackaged) return undefined
		const packagePath = path.resolve(
			app.getAppPath(),
			"../cocode-harness/apps/cli/package.json",
		)
		const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown }
		return typeof packageJson.version === "string" ? packageJson.version : undefined
	} catch {
		return undefined
	}
}

function resolveResourcesRoot(): string {
	if (process.env.COCODE_TUI_RESOURCES_ROOT?.trim())
		return process.env.COCODE_TUI_RESOURCES_ROOT.trim()
	if (app.isPackaged && typeof process.resourcesPath === "string") return process.resourcesPath
	return path.resolve(app.getAppPath(), ".cache", "cocode")
}

const LINUX_INSTALLER_TUI_MARKER = "# cocode-linux-tui-wrapper:v1"

function isLinuxInstallerManagedCli(): boolean {
	return process.platform === "linux" && app.isPackaged && !process.env.COCODE_CLI_BIN_DIR?.trim()
}

function resolveLinuxInstallerCommandPath(): string {
	return process.env.COCODE_LINUX_TUI_COMMAND?.trim() || "/usr/bin/cocode"
}

function directoryOnPath(directory: string): boolean {
	const configuredPath = process.env.PATH ?? ""
	return configuredPath
		.split(path.delimiter)
		.filter(Boolean)
		.some(
			(entry) =>
				path.normalize(path.resolve(entry)) === path.normalize(path.resolve(directory)),
		)
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function resolveShimCandidates(): readonly {
	shimPath: string
	directory: string
	preferred?: boolean
}[] {
	const configured = process.env.COCODE_CLI_BIN_DIR?.trim()
	if (configured) {
		const directory = path.resolve(configured)
		return [{ directory, shimPath: path.join(directory, shimName()) }]
	}
	if (process.platform === "win32") {
		const localAppData = process.env.LOCALAPPDATA?.trim() || app.getPath("appData")
		const directory = path.join(localAppData, "Cocode", "bin")
		return [{ directory, shimPath: path.join(directory, shimName()), preferred: true }]
	}
	if (process.platform === "darwin" && app.isPackaged) {
		const fallback = path.join(app.getPath("home"), ".local", "bin")
		return [
			{ directory: "/usr/local/bin", shimPath: "/usr/local/bin/cocode", preferred: true },
			{ directory: fallback, shimPath: path.join(fallback, "cocode") },
		]
	}
	const directory = path.join(app.getPath("home"), ".local", "bin")
	return [{ directory, shimPath: path.join(directory, shimName()), preferred: true }]
}

function shimName(): string {
	return process.platform === "win32" ? "cocode.cmd" : "cocode"
}

function resolveRuntimeChannel(value: string | undefined): "stable" | "preview" | "dev" {
	return value === "preview" || value === "dev" ? value : "stable"
}

function shellCommand(invocation: TuiInvocation): string {
	const exported = [
		"COCODE_NODE_EXECUTABLE",
		"COCODE_SUPERVISOR_SERVICE_ENTRY",
		"COCODE_TUI_CLIENT_KIND",
		"COCODE_HOME",
		"COCODE_DSH_HOME",
		"DSH_HOME",
		"DSH_PROFILE",
		"COCODE_HOST_CONFIG_FINGERPRINT",
		"COCODE_RUNTIME_CHANNEL",
	]
		.filter((key) => invocation.env[key] !== undefined)
		.map((key) => `export ${key}=${shellQuote(invocation.env[key] ?? "")}`)
	return [
		...exported,
		["exec", shellQuote(invocation.executable), ...invocation.args.map(shellQuote)].join(" "),
	].join(" ")
}

function windowsCommand(invocation: TuiInvocation): string {
	const exported = [
		"COCODE_NODE_EXECUTABLE",
		"COCODE_SUPERVISOR_SERVICE_ENTRY",
		"COCODE_TUI_CLIENT_KIND",
		"COCODE_HOME",
		"COCODE_DSH_HOME",
		"DSH_HOME",
		"DSH_PROFILE",
		"COCODE_HOST_CONFIG_FINGERPRINT",
		"COCODE_RUNTIME_CHANNEL",
	]
		.filter((key) => invocation.env[key] !== undefined)
		.map((key) => `set "${key}=${cmdValue(invocation.env[key] ?? "")}"`)
	return [
		...exported,
		`"${cmdValue(invocation.executable)}" "${cmdValue(invocation.args[0] ?? "")}"`,
	].join(" && ")
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`
}

function appleScriptString(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function cmdValue(value: string): string {
	return value.replaceAll('"', '""')
}

function spawnAndWait(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { env, stdio: "ignore" })
		child.once("error", reject)
		child.once("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${command} exited with code ${String(code)}`)),
		)
	})
}

export function tuiManifestFingerprint(manifest: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
}
