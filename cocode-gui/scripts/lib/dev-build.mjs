/**
 * Build steps a dev runner needs before it can spawn anything.
 *
 * These used to be `predev`/`prestart` lifecycle scripts, which ran before the
 * dev lock existed and let two concurrent runs overwrite each other's plugin
 * output. Running them from inside the lock makes concurrent starts serialize.
 */
import { spawnSync } from "node:child_process"
import * as path from "pathe"
import { buildSupervisor } from "../build-supervisor.mjs"
import { buildCocodePlugins } from "../cocode-plugins.mjs"

export function buildDevRuntime({ hardenElectron = false } = {}) {
	if (hardenElectron) runScript("scripts/harden-electron-default-app.mjs")
	// The Supervisor build script can compile GUI plugins for release builds,
	// but doing that here would compile every plugin a second time. Development
	// uses the incremental plugin builder above and asks Supervisor to consume
	// those artifacts as-is.
	buildCocodePlugins({ incremental: true })
	buildSupervisor({ buildGuiPlugins: false })
}

function runScript(relativePath, args = []) {
	const result = spawnSync(process.execPath, [path.resolve(relativePath), ...args], {
		stdio: "inherit",
		cwd: process.cwd(),
		env: process.env,
	})
	if (result.error) throw result.error
	if (result.status !== 0) {
		throw new Error(`${relativePath} failed with exit code ${String(result.status)}.`)
	}
}
