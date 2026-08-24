import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePlatformGroup, resolveTestFiles } from "./test-manifests/index.mjs"

const guiRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const requestedGroup = process.argv[2] ?? "all"

function groupsForRequest(group) {
	if (group === "all") return ["common", "host", resolvePlatformGroup()]
	if (group === "platform") return [resolvePlatformGroup()]
	if (["common", "host", "windows", "macos", "linux"].includes(group)) return [group]
	throw new Error(`Unknown GUI test command: ${group}`)
}

function assertNativeGroup(group) {
	if (!["windows", "macos", "linux"].includes(group)) return
	const expected = resolvePlatformGroup()
	if (group !== expected) {
		throw new Error(`GUI test group ${group} requires ${group}, current host is ${expected}`)
	}
}

for (const group of groupsForRequest(requestedGroup)) {
	assertNativeGroup(group)
	const files = resolveTestFiles(group)
	if (files.length === 0) throw new Error(`GUI test group ${group} has no test files`)

	console.log(`\n=== GUI ${group} tests (${files.length} files) ===`)
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"./tests/support/register-electron-test-loader.mjs",
			"--import",
			"tsx",
			"--test",
			...files,
		],
		{ cwd: guiRoot, stdio: "inherit" },
	)
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}
