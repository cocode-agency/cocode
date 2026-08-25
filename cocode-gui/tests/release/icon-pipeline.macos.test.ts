import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readdirSync, rmSync } from "node:fs"
import test from "node:test"
import path from "node:path"
import {
	MAC_ICONSET_ENTRIES,
	ICNS_PATH,
} from "../../scripts/icons/generate-macos-icons.mjs"

test("generated ICNS round-trips to the complete legacy iconset", () => {
	const destination = path.join(process.env.TMPDIR ?? "/tmp", `cocode-icon-test-${process.pid}.iconset`)
	try {
		execFileSync("iconutil", ["-c", "iconset", ICNS_PATH, "-o", destination])
		const actual = readdirSync(destination).filter((name) => name.endsWith(".png")).sort()
		assert.deepEqual(actual, MAC_ICONSET_ENTRIES.map(([name]) => name).sort())
	} finally {
		rmSync(destination, { recursive: true, force: true })
	}
})
