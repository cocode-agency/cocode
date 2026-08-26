import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"

test("loads runtime verification after the Supervisor build emits generated modules", () => {
	const source = readFileSync(path.resolve(process.cwd(), "scripts/build-runtime.mjs"), "utf8")
	assert.doesNotMatch(source, /import \{ verifyRuntime \} from "\.\/verify-dsh-runtime\.mjs"/)
	const supervisorBuild = source.indexOf("const supervisor = buildSupervisor(")
	const verifierLoad = source.indexOf('await import("./verify-dsh-runtime.mjs")')
	assert.ok(supervisorBuild >= 0, "build-runtime must build the Supervisor")
	assert.ok(
		verifierLoad > supervisorBuild,
		"runtime verification must load after the Supervisor build",
	)
})
