import assert from "node:assert/strict"
import test from "node:test"
import { getAllTestFiles, resolveTestFiles } from "../../scripts/test-manifests/index.mjs"

test("assigns every GUI test file to exactly one test dimension", () => {
	const allFiles = getAllTestFiles()
	const groups = ["common", "host", "windows", "macos", "linux"] as const
	const assignments = new Map<string, string[]>()

	for (const group of groups) {
		for (const file of resolveTestFiles(group)) {
			const owners = assignments.get(file) ?? []
			owners.push(group)
			assignments.set(file, owners)
		}
	}

	assert.deepEqual(
		[...assignments.entries()].filter(([, owners]) => owners.length > 1),
		[],
	)
	assert.deepEqual(
		allFiles.filter((file) => !assignments.has(file)),
		[],
	)
})

test("rejects platform test dimensions on a different host", () => {
	assert.throws(() => resolveTestFiles("unknown" as never), /Unknown GUI test group/)
})
