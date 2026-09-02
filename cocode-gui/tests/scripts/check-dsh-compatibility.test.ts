import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import { inspectDshCompatibility } from "../../scripts/check-dsh-compatibility.mjs"

test("the checked-in DSH release train is aligned with every Cocode plugin", () => {
	const report = inspectDshCompatibility()
	assert.equal(report.ok, true, report.errors.join("\n"))
	assert.equal(report.targetVersion, "0.1.2-alpha.5")
	assert.equal(report.pluginNames.length, 10)
	assert.ok(report.checkedDshPackages.length > 0)
	assert.ok(report.checkedInjectedPackages.includes("cocode-shortcuts"))
	assert.match(
		report.notes.join("\n"),
		/dsh-client-runtime remains on 0\.1\.1-rc\.2 as an npm ABI bridge/,
	)
})

test("reports a DSH version drift in a workspace manifest", () => {
	const fixture = createFixture()
	try {
		writeJson(path.join(fixture.guiRoot, "package.json"), {
			name: "@cocode/gui-root",
			dependencies: { "@deepseek-ai/dsh-client-runtime": "0.2.0" },
		})
		const report = inspectFixture(fixture)
		assert.equal(report.ok, false)
		assert.match(
			report.errors.join("\n"),
			/dsh-client-runtime.*expected exact DSH release 0\.1\.1-rc\.2/,
		)
	} finally {
		fixture.cleanup()
	}
})

test("reports an injected package that is not available to a plugin", () => {
	const fixture = createFixture()
	try {
		writeJson(path.join(fixture.pluginRoot, "package.json"), {
			name: "cocode-test",
			private: true,
			cocode: { runtimeDependencies: [] },
			dsh: {
				client: {
					platform: "web",
					inject: ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-missing"],
				},
			},
		})
		const report = inspectFixture(fixture)
		assert.equal(report.ok, false)
		assert.match(
			report.errors.join("\n"),
			/cocode-test: injected package @deepseek-ai\/dsh-client-missing cannot be resolved/,
		)
	} finally {
		fixture.cleanup()
	}
})

function inspectFixture(fixture: ReturnType<typeof createFixture>) {
	const manifests = new Map([
		["@deepseek-ai/dsh", { name: "@deepseek-ai/dsh", version: "0.1.2-alpha.5" }],
		[
			"@deepseek-ai/dsh-client-runtime",
			{ name: "@deepseek-ai/dsh-client-runtime", version: "0.1.1-rc.2" },
		],
	])
	return inspectDshCompatibility({
		guiRoot: fixture.guiRoot,
		supervisorRoot: fixture.supervisorRoot,
		pluginsRoot: fixture.pluginsRoot,
		resolveManifest: (name: string) => manifests.get(name),
	})
}

function createFixture() {
	const root = path.join(os.tmpdir(), `cocode-dsh-compat-${process.pid}-${Date.now()}`)
	const guiRoot = path.join(root, "cocode-gui")
	const supervisorRoot = path.join(root, "cocode-host-supervisor")
	const pluginsRoot = path.join(guiRoot, "packages", "cocode")
	const pluginRoot = path.join(pluginsRoot, "cocode-test")
	mkdirSync(path.join(pluginRoot, "src", "client"), { recursive: true })
	writeJson(path.join(supervisorRoot, "package.json"), {
		name: "@cocode-agency/host-supervisor",
		dependencies: { "@deepseek-ai/dsh": "0.1.2-alpha.5" },
	})
	writeJson(path.join(guiRoot, "package.json"), {
		name: "@cocode/gui-root",
		dependencies: { "@deepseek-ai/dsh-client-runtime": "0.1.1-rc.2" },
	})
	writeJson(path.join(pluginRoot, "package.json"), {
		name: "cocode-test",
		private: true,
		cocode: { runtimeDependencies: [] },
		dsh: {
			client: {
				platform: "web",
				inject: ["@deepseek-ai/dsh-client-runtime"],
			},
		},
	})
	writeFileSync(path.join(pluginRoot, "src", "client", "index.ts"), "export {}\n")
	return {
		guiRoot,
		supervisorRoot,
		pluginsRoot,
		pluginRoot,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	}
}

function writeJson(file: string, value: unknown) {
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
