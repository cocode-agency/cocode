import { execFile } from "node:child_process"
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
// Registers CLI shims into the OS PATH (path.delimiter, native separators), so
// keep node:path semantics.
// oxlint-disable-next-line no-restricted-imports
import path from "node:path"
import type {
	TuiCommandLineToolResult,
	TuiCommandLineToolState,
	TuiCommandLineToolStatus,
	TuiCommandLineToolRegistrationSource,
} from "../../../../contracts/ipc/tui.contract"

const execFileAsync = promisify(execFile)

export const DESKTOP_SHIM_MARKER = "# cocode-desktop-cli-shim:v1"
export const WINDOWS_DESKTOP_SHIM_MARKER = "REM cocode-desktop-cli-shim:v1"
const SOURCE_MARKER = "cocode-desktop-cli-source:"

export type TuiInvocation = {
	readonly executable: string
	readonly args: readonly string[]
	readonly env: NodeJS.ProcessEnv
	readonly cwd: string
}

export type DesktopCliPathCandidate = {
	readonly shimPath: string
	readonly directory: string
	readonly preferred?: boolean
}

export type DesktopCliRuntimeMetadata = {
	readonly runtimeValid: boolean
	readonly runtimeVersion?: string
	readonly tuiVersion?: string
	readonly supervisorVersion?: string
	readonly manifestFingerprint?: string
}

export type DesktopCliRegistrationServiceOptions = {
	readonly resolveCandidates: () => readonly DesktopCliPathCandidate[]
	readonly buildInvocation: () => TuiInvocation
	readonly getRuntimeMetadata?: () => Promise<DesktopCliRuntimeMetadata>
	readonly getPersistentPath?: () => Promise<string>
	readonly updatePersistentPath?: (
		directory: string,
		operation: "add" | "remove",
	) => Promise<void>
	readonly currentPath?: () => string
}

export class DesktopCliRegistrationService {
	private readonly options: DesktopCliRegistrationServiceOptions

	public constructor(options: DesktopCliRegistrationServiceOptions) {
		this.options = options
	}

	public async getStatus(): Promise<TuiCommandLineToolStatus> {
		const candidates = this.options.resolveCandidates()
		if (candidates.length === 0) {
			return createStatus(
				"",
				"",
				false,
				false,
				"unavailable",
				false,
				false,
				"No Desktop CLI installation path is configured.",
			)
		}

		let firstMissing: DesktopCliCommandState | undefined
		let metadata: DesktopCliRuntimeMetadata = { runtimeValid: false }
		try {
			metadata = (await this.options.getRuntimeMetadata?.()) ?? { runtimeValid: true }
		} catch (error) {
			return createStatus(
				candidates[0].shimPath,
				candidates[0].directory,
				false,
				false,
				"unavailable",
				false,
				false,
				errorMessage(error),
				metadata,
			)
		}

		const persistentPath = await this.readPersistentPath()
		for (const candidate of candidates) {
			const existing = await readExistingShim(candidate.shimPath)
			if (existing === undefined) {
				firstMissing ??= { candidate, persistentPath }
				continue
			}
			if (!isManagedShim(existing.contents)) {
				return createStatus(
					candidate.shimPath,
					candidate.directory,
					isDirectoryOnPath(candidate.directory, this.options.currentPath?.()),
					persistentPathIncludes(persistentPath, candidate.directory),
					"conflict",
					false,
					false,
					"An unmanaged executable already exists at the Cocode CLI path.",
					metadata,
				)
			}

			const expected = renderShim(
				this.options.buildInvocation(),
				parseSource(existing.contents),
			)
			const shimCurrent = stripSourceMarker(existing.contents) === stripSourceMarker(expected)
			const installed = shimCurrent && existing.executable && metadata.runtimeValid
			return createStatus(
				candidate.shimPath,
				candidate.directory,
				isDirectoryOnPath(candidate.directory, this.options.currentPath?.()),
				persistentPathIncludes(persistentPath, candidate.directory),
				installed ? "installed" : "stale",
				true,
				true,
				installed
					? undefined
					: staleDetail(shimCurrent, existing.executable, metadata.runtimeValid),
				metadata,
				parseSource(existing.contents),
			)
		}

		const missing = firstMissing ?? { candidate: candidates[0], persistentPath }
		return createStatus(
			missing.candidate.shimPath,
			missing.candidate.directory,
			isDirectoryOnPath(missing.candidate.directory, this.options.currentPath?.()),
			persistentPathIncludes(missing.persistentPath, missing.candidate.directory),
			"missing",
			false,
			true,
			undefined,
			metadata,
		)
	}

	public async ensure(
		source: TuiCommandLineToolRegistrationSource = "desktop-startup",
	): Promise<TuiCommandLineToolResult> {
		const before = await this.getStatus()
		if (before.state !== "missing" && before.state !== "stale") {
			return { changed: false, status: before }
		}
		await this.writeCommandLineTool(source)
		return { changed: true, status: await this.getStatus() }
	}

	public async repair(
		source: TuiCommandLineToolRegistrationSource = "manual",
	): Promise<TuiCommandLineToolResult> {
		const before = await this.getStatus()
		if (before.state === "conflict" || before.state === "unavailable") {
			return { changed: false, status: before }
		}
		await this.writeCommandLineTool(source)
		return { changed: true, status: await this.getStatus() }
	}

	public async uninstall(): Promise<TuiCommandLineToolResult> {
		let changed = false
		for (const candidate of this.options.resolveCandidates()) {
			const existing = await readExistingShim(candidate.shimPath)
			if (existing !== undefined && !isManagedShim(existing.contents)) continue
			if (existing !== undefined) {
				await unlink(candidate.shimPath)
				changed = true
			}
			await this.options.updatePersistentPath?.(candidate.directory, "remove")
		}
		return { changed, status: await this.getStatus() }
	}

	private async writeCommandLineTool(
		source: TuiCommandLineToolRegistrationSource,
	): Promise<void> {
		const invocation = this.options.buildInvocation()
		let lastError: unknown
		for (const candidate of orderCandidates(this.options.resolveCandidates())) {
			const existing = await readExistingShim(candidate.shimPath)
			if (existing !== undefined && !isManagedShim(existing.contents)) {
				if (candidate.preferred)
					throw new Error(
						"An unmanaged executable already exists at the Cocode CLI path.",
					)
				continue
			}
			try {
				await mkdir(candidate.directory, { recursive: true, mode: 0o755 })
				const contents = renderShim(invocation, source)
				await writeFile(candidate.shimPath, contents, { mode: 0o755 })
				if (process.platform !== "win32") await chmod(candidate.shimPath, 0o755)
				await this.options.updatePersistentPath?.(candidate.directory, "add")
				return
			} catch (error) {
				lastError = error
			}
		}
		throw new Error(`Unable to install the Desktop CLI shim: ${errorMessage(lastError)}`)
	}

	private async readPersistentPath(): Promise<string> {
		try {
			return (
				(await this.options.getPersistentPath?.()) ??
				this.options.currentPath?.() ??
				process.env.PATH ??
				""
			)
		} catch {
			return this.options.currentPath?.() ?? process.env.PATH ?? ""
		}
	}
}

type DesktopCliCommandState = {
	readonly candidate: DesktopCliPathCandidate
	readonly persistentPath: string
}

type ExistingShim = {
	readonly contents: string
	readonly executable: boolean
}

function createStatus(
	shimPath: string,
	directory: string,
	directoryOnPath: boolean,
	persistentPathConfigured: boolean,
	state: TuiCommandLineToolState,
	managedByDesktop: boolean,
	canRepair: boolean,
	detail?: string,
	metadata: DesktopCliRuntimeMetadata = { runtimeValid: false },
	registrationSource: TuiCommandLineToolRegistrationSource = "unknown",
): TuiCommandLineToolStatus {
	return {
		state,
		path: shimPath,
		directory,
		managedByDesktop,
		directoryOnPath,
		persistentPathConfigured,
		canRepair,
		registrationSource,
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
		...(detail === undefined ? {} : { detail }),
	}
}

function staleDetail(shimCurrent: boolean, executable: boolean, runtimeValid: boolean): string {
	const reasons: string[] = []
	if (!shimCurrent) reasons.push("the CLI shim points to an older Desktop installation")
	if (!executable) reasons.push("the CLI shim is not executable")
	if (!runtimeValid) reasons.push("the bundled runtime integrity check failed")
	return reasons.length === 0
		? "The Desktop CLI needs repair."
		: `The Desktop CLI needs repair because ${reasons.join(
				" and ",
		  )}. This is not a version upgrade.`
}

async function readExistingShim(file: string): Promise<ExistingShim | undefined> {
	try {
		const fileStat = await stat(file)
		return {
			contents: await readFile(file, "utf8"),
			executable: process.platform === "win32" || (fileStat.mode & 0o111) !== 0,
		}
	} catch (error) {
		if (isMissingFileError(error)) return undefined
		throw error
	}
}

function orderCandidates(
	candidates: readonly DesktopCliPathCandidate[],
): DesktopCliPathCandidate[] {
	return [...candidates].sort(
		(left, right) => Number(right.preferred === true) - Number(left.preferred === true),
	)
}

function renderShim(
	invocation: TuiInvocation,
	source: TuiCommandLineToolRegistrationSource,
): string {
	return process.platform === "win32"
		? windowsShim(invocation, source)
		: posixShim(invocation, source)
}

export function posixShim(
	invocation: TuiInvocation,
	source: TuiCommandLineToolRegistrationSource = "unknown",
): string {
	const env = invocation.env
	const configuredHome = env.COCODE_HOME?.trim()
	return [
		"#!/bin/sh",
		DESKTOP_SHIM_MARKER,
		`# ${SOURCE_MARKER}${source}`,
		"set -eu",
		configuredHome === undefined
			? 'export COCODE_HOME="${COCODE_HOME:-$HOME/.cocode}"'
			: `export COCODE_HOME=${shellQuote(configuredHome)}`,
		'export COCODE_DSH_HOME="${COCODE_DSH_HOME:-$HOME/.dsh}"',
		'export DSH_HOME="$COCODE_DSH_HOME"',
		`export COCODE_NODE_EXECUTABLE=${shellQuote(
			env.COCODE_NODE_EXECUTABLE ?? invocation.executable,
		)}`,
		`export COCODE_SUPERVISOR_SERVICE_ENTRY=${shellQuote(
			env.COCODE_SUPERVISOR_SERVICE_ENTRY ?? "",
		)}`,
		`export COCODE_TUI_CLIENT_KIND=${shellQuote(env.COCODE_TUI_CLIENT_KIND ?? "desktop-tui")}`,
		`export DSH_PROFILE=${shellQuote("cocode")}`,
		`export COCODE_HOST_CONFIG_FINGERPRINT=${shellQuote(
			env.COCODE_HOST_CONFIG_FINGERPRINT ?? "cocode-web-jsonrpc-v3",
		)}`,
		`export COCODE_RUNTIME_CHANNEL=${shellQuote(env.COCODE_RUNTIME_CHANNEL ?? "stable")}`,
		`exec ${shellQuote(invocation.executable)} ${shellQuote(invocation.args[0] ?? "")} "$@"`,
		"",
	].join("\n")
}

export function windowsShim(
	invocation: TuiInvocation,
	source: TuiCommandLineToolRegistrationSource = "unknown",
): string {
	const env = invocation.env
	return [
		"@echo off",
		WINDOWS_DESKTOP_SHIM_MARKER,
		`REM ${SOURCE_MARKER}${source}`,
		env.COCODE_HOME?.trim() === undefined
			? 'if not defined COCODE_HOME set "COCODE_HOME=%USERPROFILE%\\.cocode"'
			: `set "COCODE_HOME=${env.COCODE_HOME.trim()}"`,
		env.COCODE_DSH_HOME?.trim() === undefined
			? 'if not defined COCODE_DSH_HOME set "COCODE_DSH_HOME=%USERPROFILE%\\.dsh"'
			: `set "COCODE_DSH_HOME=${env.COCODE_DSH_HOME.trim()}"`,
		'set "DSH_HOME=%COCODE_DSH_HOME%"',
		`set "COCODE_NODE_EXECUTABLE=${env.COCODE_NODE_EXECUTABLE ?? invocation.executable}"`,
		`set "COCODE_SUPERVISOR_SERVICE_ENTRY=${env.COCODE_SUPERVISOR_SERVICE_ENTRY ?? ""}"`,
		`set "COCODE_TUI_CLIENT_KIND=${env.COCODE_TUI_CLIENT_KIND ?? "desktop-tui"}"`,
		'set "DSH_PROFILE=cocode"',
		`set "COCODE_HOST_CONFIG_FINGERPRINT=${
			env.COCODE_HOST_CONFIG_FINGERPRINT ?? "cocode-web-jsonrpc-v3"
		}"`,
		`set "COCODE_RUNTIME_CHANNEL=${env.COCODE_RUNTIME_CHANNEL ?? "stable"}"`,
		`"${invocation.executable}" "${invocation.args[0] ?? ""}" %*`,
		"",
	].join("\r\n")
}

export function isManagedShim(contents: string | undefined): boolean {
	if (contents === undefined) return false
	return (
		contents.includes(DESKTOP_SHIM_MARKER) ||
		contents.includes(WINDOWS_DESKTOP_SHIM_MARKER) ||
		(contents.includes("COCODE_TUI_CLIENT_KIND") &&
			contents.includes("desktop-tui") &&
			contents.includes("COCODE_NODE_EXECUTABLE") &&
			(contents.includes("cocode-cli.mjs") || contents.includes("cocode-tui.mjs")))
	)
}

export function parseSource(contents: string): TuiCommandLineToolRegistrationSource {
	const match = contents.match(
		new RegExp(`${SOURCE_MARKER}(installer|desktop-startup|manual|unknown)`),
	)
	return (match?.[1] as TuiCommandLineToolRegistrationSource | undefined) ?? "unknown"
}

function stripSourceMarker(contents: string): string {
	return contents
		.split(/\r?\n/)
		.filter((line) => !line.includes(SOURCE_MARKER))
		.join("\n")
}

function isDirectoryOnPath(directory: string, configuredPath = process.env.PATH ?? ""): boolean {
	const normalizedDirectory = normalizePathForComparison(directory)
	return configuredPath
		.split(path.delimiter)
		.filter(Boolean)
		.some((entry) => normalizePathForComparison(entry) === normalizedDirectory)
}

function persistentPathIncludes(configuredPath: string, directory: string): boolean {
	return isDirectoryOnPath(directory, configuredPath)
}

function normalizePathForComparison(value: string): string {
	const normalized = path.normalize(path.resolve(value))
	return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function normalizeWindowsPathForComparison(value: string): string {
	return path.win32
		.normalize(value.trim().replace(/^"|"$/g, ""))
		.replace(/[\\/]+$/, "")
		.toLowerCase()
}

export function addWindowsPathEntry(
	current: string,
	directory: string,
): { readonly value: string; readonly changed: boolean } {
	const normalized = normalizeWindowsPathForComparison(directory)
	const exists = current
		.split(";")
		.some((entry) => normalizeWindowsPathForComparison(entry) === normalized)
	if (exists) return { value: current, changed: false }
	return {
		value: current ? `${current}${current.endsWith(";") ? "" : ";"}${directory}` : directory,
		changed: true,
	}
}

export function removeWindowsPathEntry(
	current: string,
	directory: string,
): { readonly value: string; readonly changed: boolean } {
	const normalized = normalizeWindowsPathForComparison(directory)
	const entries = current.split(";")
	const retained = entries.filter(
		(entry) => normalizeWindowsPathForComparison(entry) !== normalized,
	)
	return {
		value: retained.join(";"),
		changed: retained.length !== entries.length,
	}
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`
}

export function createWindowsPersistentPathStore(): {
	readonly get: () => Promise<string>
	readonly update: (directory: string, operation: "add" | "remove") => Promise<void>
} {
	return {
		get: async () => {
			if (process.platform !== "win32") return process.env.PATH ?? ""
			try {
				const { stdout } = await execFileAsync("reg.exe", [
					"query",
					"HKCU\\Environment",
					"/v",
					"Path",
				])
				const line = stdout.split(/\r?\n/).find((entry) => /\bPath\b/.test(entry))
				return line?.split(/\s+REG_[A-Z_]+\s+/)[1]?.trim() ?? ""
			} catch {
				return process.env.PATH ?? ""
			}
		},
		update: async (directory, operation) => {
			if (process.platform !== "win32") return
			const current = await thisPathFromRegistry()
			const normalized = normalizeWindowsPathForComparison(directory)
			const statePath = windowsCliStatePath()
			const state = await readWindowsCliState(statePath)
			const owned = new Set(state.ownedDirectories)
			if (operation === "remove" && !owned.has(normalized)) return
			const result =
				operation === "add"
					? addWindowsPathEntry(current, directory)
					: removeWindowsPathEntry(current, directory)
			if (!result.changed) {
				owned.delete(normalized)
				await writeWindowsCliState(statePath, { ownedDirectories: [...owned] })
				return
			}
			await execFileAsync("reg.exe", [
				"add",
				"HKCU\\Environment",
				"/v",
				"Path",
				"/t",
				"REG_EXPAND_SZ",
				"/d",
				result.value,
				"/f",
			])
			if (operation === "add") owned.add(normalized)
			else owned.delete(normalized)
			await writeWindowsCliState(statePath, { ownedDirectories: [...owned] })
			try {
				await execFileAsync("rundll32.exe", ["user32.dll,UpdatePerUserSystemParameters"])
			} catch {
				// New terminals read the registry directly; broadcasting is best effort.
			}
		},
	}
}

type WindowsCliState = {
	readonly ownedDirectories: readonly string[]
}

function windowsCliStatePath(): string {
	const root =
		process.env.LOCALAPPDATA?.trim() || process.env.USERPROFILE?.trim() || process.cwd()
	return path.join(root, "Cocode", "cli-registration.json")
}

async function readWindowsCliState(file: string): Promise<WindowsCliState> {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<WindowsCliState>
		return {
			ownedDirectories: Array.isArray(parsed.ownedDirectories)
				? parsed.ownedDirectories.filter(
						(value): value is string => typeof value === "string",
				  )
				: [],
		}
	} catch {
		return { ownedDirectories: [] }
	}
}

async function writeWindowsCliState(file: string, state: WindowsCliState): Promise<void> {
	if (state.ownedDirectories.length === 0) {
		try {
			await unlink(file)
		} catch {
			// The state file is optional and may already be absent.
		}
		return
	}
	await mkdir(path.dirname(file), { recursive: true, mode: 0o755 })
	await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

async function thisPathFromRegistry(): Promise<string> {
	try {
		const { stdout } = await execFileAsync("reg.exe", [
			"query",
			"HKCU\\Environment",
			"/v",
			"Path",
		])
		const line = stdout.split(/\r?\n/).find((entry) => /\bPath\b/.test(entry))
		return line?.split(/\s+REG_[A-Z_]+\s+/)[1]?.trim() ?? ""
	} catch {
		return process.env.PATH ?? ""
	}
}
