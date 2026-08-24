import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"
import {
	createStartupFailure,
	createStartupFailureInjector,
	createStartupFailureError,
	createDshHostReadyAttributes,
	runStartupPhase,
	STARTUP_FAILURE_PHASES,
	startupFailurePhaseLabel,
	type StartupFailurePhase,
} from "../../../src/main/shell/lifecycle/startup-failure"
import { createStartupFailureWindowQuery } from "../../../src/main/shell/windows/create-startup-failure-window"

test("creates a stable, user-safe failure record for a startup phase", () => {
	const error = Object.assign(new Error("cannot open C:\\Users\\secret\\global.db"), {
		code: "SQLITE_CANTOPEN",
	})
	const failure = createStartupFailure("database.initialize", error)

	assert.equal(failure.phase, "database.initialize")
	assert.equal(failure.failureCode, "SQLITE_CANTOPEN")
	assert.equal(failure.userMessage, "Cocode 无法初始化本地数据。")
	assert.doesNotMatch(failure.userMessage, /Users|global\.db|secret/)
})

test("falls back to a bounded failure code and unknown phase", () => {
	const failure = createStartupFailure("unknown", new Error("boom"))

	assert.equal(failure.phase, "unknown")
	assert.equal(failure.failureCode, "STARTUP_FAILED")
	assert.equal(failure.userMessage, "Cocode 在启动阶段遇到异常。")
})

test("uses a stable phase-specific code when the underlying error has no code", () => {
	assert.equal(
		createStartupFailure("dsh.host.acquire", new Error("host unavailable")).failureCode,
		"DSH_HOST_ACQUIRE_FAILED",
	)
	assert.equal(
		createStartupFailure("main.window.create", new Error("window unavailable")).failureCode,
		"MAIN_WINDOW_CREATE_FAILED",
	)
})

test("keeps the startup phase list stable for lifecycle logging", () => {
	const phases: readonly StartupFailurePhase[] = STARTUP_FAILURE_PHASES
	assert.deepEqual(phases, [
		"database.initialize",
		"dsh.host.acquire",
		"dsh.runtime.bootstrap",
		"application.services.register",
		"main.window.create",
		"unknown",
	])
})

test("maps internal startup phases to user-readable labels", () => {
	assert.equal(startupFailurePhaseLabel("database.initialize"), "初始化本地数据库")
	assert.equal(startupFailurePhaseLabel("dsh.runtime.bootstrap"), "检查本地运行时")
})

test("provides an opt-in startup failure injection seam for failure builds", () => {
	const inject = createStartupFailureInjector("dsh.host.acquire")
	inject("database.initialize")
	assert.throws(
		() => inject("dsh.host.acquire"),
		(error: unknown) =>
			error instanceof Error &&
			"failure" in error &&
			typeof error.failure === "object" &&
			error.failure !== null &&
			(error.failure as { failureCode?: string }).failureCode === "TEST_STARTUP_FAILURE",
	)
	assert.throws(() => createStartupFailureInjector("not-a-phase"), /Unsupported startup failure/i)
})

test("preserves an existing startup failure when a phase boundary catches it", () => {
	const inject = createStartupFailureInjector("database.initialize")

	assert.throws(
		() => {
			try {
				inject("database.initialize")
			} catch (error) {
				throw createStartupFailureError("database.initialize", error)
			}
		},
		(error: unknown) =>
			error instanceof Error &&
			"failure" in error &&
			typeof error.failure === "object" &&
			error.failure !== null &&
			(error.failure as { failureCode?: string }).failureCode === "TEST_STARTUP_FAILURE",
	)
})

test("keeps dsh host readiness attributes smoke-test safe", () => {
	assert.deepEqual(createDshHostReadyAttributes("http://127.0.0.1:3080", 4321), {
		endpoint: "http://127.0.0.1:3080",
		hostPid: 4321,
	})
	assert.deepEqual(createDshHostReadyAttributes("http://127.0.0.1:3080", undefined), {
		endpoint: "http://127.0.0.1:3080",
	})
	assert.deepEqual(createDshHostReadyAttributes("http://127.0.0.1:3080", 0), {
		endpoint: "http://127.0.0.1:3080",
	})
})

test("wraps synchronous service construction in its startup phase", () => {
	assert.throws(
		() =>
			runStartupPhase("application.services.register", () => {
				throw new Error("service")
			}),
		(error: unknown) =>
			error instanceof Error &&
			"failure" in error &&
			typeof error.failure === "object" &&
			error.failure !== null &&
			(error.failure as { phase?: string }).phase === "application.services.register",
	)
})

test("diagnostic window query excludes the raw exception", () => {
	const failure = createStartupFailure(
		"database.initialize",
		new Error("cannot open C:\\Users\\alice\\secret.db Authorization: Bearer token"),
	)
	const query = createStartupFailureWindowQuery(failure, {
		version: "1.0.2",
		platform: "win32",
		architecture: "x64",
		logRoot: "%LOCALAPPDATA%\\Cocode\\Logs",
	})

	assert.equal(query.failureCode, "DATABASE_INITIALIZE_FAILED")
	assert.equal(query.logRoot, "%LOCALAPPDATA%\\Cocode\\Logs")
	assert.doesNotMatch(JSON.stringify(query), /alice|secret\.db|Authorization|Bearer|token/i)
})

test("diagnostic window is a local-only surface with no network dependency", () => {
	const html = readFileSync(path.resolve("resources/startup-failure.html"), "utf8")
	assert.match(html, /default-src\s+'none'/i)
	assert.match(html, /window\.desktopApi\.diagnostics\.openLogFolder/)
	assert.match(html, /window\.desktopApi\.startup\.restart/)
	assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/)
})
