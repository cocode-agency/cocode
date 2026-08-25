import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
// Exercises the native CLI registration (PATH entries, path.delimiter), so it
// must match the OS semantics used by the implementation under test.
// oxlint-disable-next-line no-restricted-imports
import path from "node:path"
import test from "node:test"
import { TuiLauncher } from "../../../src/main/contexts/tui/infrastructure/tui-launcher"
import { packagedNodeExecutableName } from "../../../src/shared/packaged-node-executable"

const ENVIRONMENT_KEYS = [
	"COCODE_CLI_BIN_DIR",
	"COCODE_TUI_RESOURCES_ROOT",
	"COCODE_NODE_EXECUTABLE",
	"COCODE_SUPERVISOR_SERVICE_ENTRY",
	"COCODE_TUI_CLIENT_KIND",
	"COCODE_HOME",
	"COCODE_DSH_HOME",
	"COCODE_HOST_CONFIG_FINGERPRINT",
	"COCODE_RUNTIME_CHANNEL",
	"DSH_HOME",
	"DSH_PROFILE",
	"PATH",
] as const

test("Desktop CLI installation is idempotent and preserves unmanaged commands", async (t) => {
	await t.test("installs a missing shim once", async () => {
		const fixture = createFixture()
		try {
			const launcher = new TuiLauncher()
			const first = await launcher.ensureCommandLineTool()
			assert.equal(first.changed, true)
			assert.equal(first.status.state, "installed")
			assert.equal(first.status.managedByDesktop, true)
			assert.equal(first.status.directoryOnPath, true)
			assert.equal(first.status.persistentPathConfigured, true)
			assert.equal(first.status.registrationSource, "desktop-startup")
			assert.equal(first.status.runtimeValid, true)
			const shim = readFileSync(fixture.shimPath, "utf8")
			if (process.platform === "win32") assert.match(shim, /set "DSH_PROFILE=cocode"/i)
			else assert.match(shim, /DSH_PROFILE='cocode'/)
			assert.doesNotMatch(shim, /DSH_PROFILE=web/)
			assert.match(shim, /cocode-desktop-cli-shim:v1/)

			const second = await launcher.ensureCommandLineTool()
			assert.equal(second.changed, false)
			assert.equal(second.status.state, "installed")
		} finally {
			fixture.dispose()
		}
	})

	await t.test("records installer ownership and removes only the managed shim", async () => {
		const fixture = createFixture()
		try {
			const launcher = new TuiLauncher()
			const installed = await launcher.ensureCommandLineTool("installer")
			assert.equal(installed.status.registrationSource, "installer")
			const removed = await launcher.uninstallCommandLineTool()
			assert.equal(removed.changed, true)
			assert.equal(removed.status.state, "missing")
		} finally {
			fixture.dispose()
		}
	})

	await t.test("updates an older Desktop-managed shim", async () => {
		const fixture = createFixture()
		try {
			writeFileSync(
				fixture.shimPath,
				[
					"#!/bin/sh",
					"export COCODE_NODE_EXECUTABLE='/old/cocode-node'",
					"export COCODE_TUI_CLIENT_KIND='desktop-tui'",
					"exec '/old/cocode-node' '/old/tui/cocode-tui.mjs' \"$@\"",
					"",
				].join("\n"),
			)
			chmodSync(fixture.shimPath, 0o755)

			const launcher = new TuiLauncher()
			assert.equal((await launcher.getCommandLineToolStatus()).state, "stale")
			const result = await launcher.ensureCommandLineTool()
			assert.equal(result.changed, true)
			assert.equal(result.status.state, "installed")
			assert.match(readFileSync(fixture.shimPath, "utf8"), /cocode-desktop-cli-shim:v1/)
		} finally {
			fixture.dispose()
		}
	})

	await t.test("does not overwrite an unmanaged cocode command", async () => {
		const fixture = createFixture()
		try {
			const externalCommand = "#!/bin/sh\necho external-cocode\n"
			writeFileSync(fixture.shimPath, externalCommand)
			chmodSync(fixture.shimPath, 0o755)

			const launcher = new TuiLauncher()
			const result = await launcher.ensureCommandLineTool()
			assert.equal(result.changed, false)
			assert.equal(result.status.state, "conflict")
			assert.equal(result.status.canRepair, false)
			assert.equal(readFileSync(fixture.shimPath, "utf8"), externalCommand)
		} finally {
			fixture.dispose()
		}
	})
})

function createFixture(): {
	readonly shimPath: string
	readonly dispose: () => void
} {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-tui-launcher-"))
	const resources = path.join(root, "resources")
	const bin = path.join(root, "bin")
	const entry = path.join(resources, "tui", "cocode-cli.mjs")
	const runtimeEntry = path.join(resources, "tui", "cocode-tui.mjs")
	const node = path.join(resources, packagedNodeExecutableName(process.platform))
	const supervisor = path.join(
		resources,
		"dsh-runtime",
		"packages",
		"host-supervisor",
		"lib",
		"bin.js",
	)
	mkdirSync(path.dirname(entry), { recursive: true })
	mkdirSync(path.dirname(supervisor), { recursive: true })
	mkdirSync(bin, { recursive: true })
	writeFileSync(entry, "export {}\n")
	writeFileSync(runtimeEntry, "export {}\n")
	writeFileSync(node, "")
	writeFileSync(supervisor, "export {}\n")
	chmodSync(node, 0o755)

	const previous = Object.fromEntries(
		ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
	) as Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>
	process.env.COCODE_CLI_BIN_DIR = bin
	process.env.COCODE_TUI_RESOURCES_ROOT = resources
	process.env.DSH_HOME = path.join(root, "dsh-home")
	delete process.env.COCODE_HOME
	delete process.env.COCODE_HOST_CONFIG_FINGERPRINT
	process.env.PATH = [bin, previous.PATH ?? ""].filter(Boolean).join(path.delimiter)
	delete process.env.COCODE_NODE_EXECUTABLE
	delete process.env.COCODE_SUPERVISOR_SERVICE_ENTRY
	delete process.env.COCODE_RUNTIME_CHANNEL

	const shimPath = path.join(bin, process.platform === "win32" ? "cocode.cmd" : "cocode")
	return {
		shimPath,
		dispose: () => {
			for (const key of ENVIRONMENT_KEYS) {
				const value = previous[key]
				if (value === undefined) delete process.env[key]
				else process.env[key] = value
			}
			rmSync(root, { recursive: true, force: true })
		},
	}
}
