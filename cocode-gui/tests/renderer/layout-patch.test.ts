import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const patchPath = "patches/@deepseek-ai__dsh-client-ui-layout@0.1.2-alpha.5.patch"
const patch = readFileSync(patchPath, "utf8")

test("keeps the alpha.5 frame grid and Cocode workbench tracks compatible", () => {
	assert.match(
		patch,
		/function computeColumns\(viewport, sidebar, details, workbench = 0, rail = 56\)/,
	)
	assert.match(patch, /\+\s*workbench: w0,/)
	assert.match(patch, /\+\s*workbench: w1,/)
	assert.match(patch, /\+\s*workbench: 0,/)

	assert.match(patch, /\+\s*"frame": "pI_x6G_frame"/)
	assert.match(patch, /\+\s*"sidebarCol": "pI_x6G_sidebarCol"/)
	assert.match(patch, /\+\s*"centerCol": "pI_x6G_centerCol"/)
	assert.match(patch, /\+\s*"workbenchRight": "pI_x6G_workbenchRight"/)
	assert.match(patch, /\+\s*"workbenchBottom": "pI_x6G_workbenchBottom"/)
	assert.doesNotMatch(patch, /zcJIQq_frame/)

	assert.match(patch, /\.pI_x6G_sidebarCol\{[^}]*grid-row:1\/-1/s)
	assert.match(patch, /\.pI_x6G_centerCol\{grid-area:1\/2\}/)
	assert.match(patch, /\.pI_x6G_detailsCol\{grid-area:1\/3\}/)
	assert.match(patch, /\.pI_x6G_workbenchRight\{[^}]*grid-area:1\/4\/-1/s)
	assert.match(patch, /\.pI_x6G_workbenchBottom\{[^}]*grid-area:2\/2\/auto\/4/s)
})

test("ships the same layout patch in GUI and Host Supervisor", () => {
	const supervisorPatch = readFileSync(
		"../cocode-host-supervisor/patches/@deepseek-ai__dsh-client-ui-layout@0.1.2-alpha.5.patch",
		"utf8",
	)
	assert.equal(supervisorPatch, patch)
})
