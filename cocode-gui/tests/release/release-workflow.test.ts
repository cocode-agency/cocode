import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"

const repoRoot = path.resolve("..")
const releaseWorkflowPath = path.join(repoRoot, ".github/workflows/cocode-gui-release.yml")
const releaseAssetVerifierPath = path.join(
	repoRoot,
	"cocode-gui/scripts/release/verify-github-release-assets.mjs",
)
const checkWorkflowPath = path.join(repoRoot, ".github/workflows/cocode-gui-check.yml")
const guiPackagePath = path.join(repoRoot, "cocode-gui/package.json")
const oxlintConfigPath = path.join(repoRoot, "cocode-gui/.oxlintrc.json")
const lintStagedConfigPath = path.join(repoRoot, "cocode-gui/lint-staged.config.cjs")

test("exposes a Linux AppImage release workflow with native architecture jobs", () => {
	assert.equal(existsSync(releaseWorkflowPath), true)
	const workflow = readFileSync(releaseWorkflowPath, "utf8")

	assert.match(workflow, /ubuntu-24\.04/)
	assert.match(workflow, /ubuntu-24\.04-arm/)
	assert.match(workflow, /fail-fast:\s*false/)
	assert.match(workflow, /assert-native-release-host\.mjs/)
	assert.match(workflow, /release:linux:\$\{\{ matrix\.arch \}\}/)
	assert.match(workflow, /arch: x64/)
	assert.match(workflow, /arch: arm64/)
	assert.match(workflow, /verify-github-release-assets\.mjs/)
	assert.match(workflow, /release-assets\/x64/)
	assert.match(workflow, /release-assets\/arm64/)
	assert.match(workflow, /SHA256SUMS-\$\{\{ matrix\.arch \}\}/)
	assert.match(workflow, /linux-release-manifest-\$\{\{ matrix\.arch \}\}\.json/)
	assert.doesNotMatch(workflow, /path: cocode-gui\/release\/linux\/\$\{\{ matrix\.arch \}\}\/\s*\n/)
	assert.match(workflow, /contents:\s*write/)
	assert.match(workflow, /gh release upload/)
	assert.match(workflow, /gh release edit.*draft=false/)
	assert.doesNotMatch(workflow, /electron-builder[^\n]+--publish always/)

	const verifier = readFileSync(releaseAssetVerifierPath, "utf8")
	assert.match(verifier, /SHA256SUMS-x64/)
	assert.match(verifier, /linux-release-manifest-arm64\.json/)
})

test("keeps the public GUI workflow limited to checks and rebuildability", () => {
	const workflow = readFileSync(checkWorkflowPath, "utf8")

	assert.match(workflow, /pull_request:/)
	assert.match(workflow, /push:[\s\S]+branches:\s+- main/)
	assert.match(workflow, /typecheck:ci/)
	assert.match(workflow, /lint:ci/)
	assert.match(workflow, /build:cocode-plugins/)
	assert.match(workflow, /build:supervisor/)
	assert.match(workflow, /build:runtime/)
	const supervisorInstall = workflow.indexOf("- name: Install Host Supervisor dependencies")
	const supervisorBuild = workflow.indexOf("- name: Build Host Supervisor package")
	const guiTypecheck = workflow.indexOf("- name: Typecheck GUI-owned source")
	assert.ok(supervisorInstall >= 0)
	assert.ok(supervisorBuild > supervisorInstall)
	assert.ok(guiTypecheck > supervisorBuild)
	assert.doesNotMatch(workflow, /RELEASE_REQUIRE_SIGNING/)
	assert.doesNotMatch(workflow, /MAC_SIGNING_IDENTITY/)
	assert.doesNotMatch(workflow, /CSC_LINK|WIN_CSC_LINK|AZURE_KEY_VAULT/)
	assert.doesNotMatch(workflow, /electron-forge (make|publish)|pnpm run (make|publish)/)
	assert.doesNotMatch(workflow, /create-release|upload-release-asset|softprops\/action-gh-release/)
})

test("uses oxlint as the GUI lint engine", () => {
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		scripts?: Record<string, string>
	}
	const oxlintConfig = readFileSync(oxlintConfigPath, "utf8")
	const lintStagedConfig = readFileSync(lintStagedConfigPath, "utf8")

	assert.match(packageJson.scripts?.lint ?? "", /oxlint/)
	assert.match(packageJson.scripts?.["lint:fix"] ?? "", /oxlint/)
	assert.match(packageJson.scripts?.["lint:ci"] ?? "", /check-changed-files\.mjs lint/)
	assert.doesNotMatch(packageJson.scripts?.lint ?? "", /eslint/)
	assert.doesNotMatch(packageJson.scripts?.["lint:fix"] ?? "", /eslint/)
	assert.match(lintStagedConfig, /oxlint --fix --deny-warnings/)
	assert.doesNotMatch(lintStagedConfig, /\beslint\b/)
	assert.match(oxlintConfig, /"typescript"/)
	assert.match(oxlintConfig, /"no-restricted-imports"/)
})

test("publishing stages fresh runtime and TUI artifacts before electron-builder", () => {
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		scripts?: Record<string, string>
	}
	const publish = packageJson.scripts?.publish ?? ""
	const prepare = packageJson.scripts?.["prepare:release-assets"] ?? ""

	assert.match(publish, /prepare:release-assets/)
	assert.match(prepare, /harden-electron-default-app\.mjs/)
	assert.match(prepare, /build:runtime/)
	assert.match(prepare, /--clean/)
	assert.match(prepare, /build:tui/)
	assert.match(publish, /electron-vite build/)
	assert.match(publish, /electron-builder/)
	assert.ok(publish.indexOf("prepare:release-assets") < publish.indexOf("electron-builder"))
})

test("provides native Linux release scripts and AppImage verification", () => {
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		scripts?: Record<string, string>
	}
	assert.match(packageJson.scripts?.["release:linux:x64"] ?? "", /--platform linux --arch x64/)
	assert.match(packageJson.scripts?.["release:linux:arm64"] ?? "", /--platform linux --arch arm64/)
	assert.match(packageJson.scripts?.["verify:linux-appimage"] ?? "", /verify-linux-appimage/)
})

test("builds mirrored DSH client bundles before fingerprinting the release runtime", () => {
	const buildRuntime = readFileSync(
		path.join(repoRoot, "cocode-gui/scripts/build-runtime.mjs"),
		"utf8",
	)
	const stageRuntime = buildRuntime.indexOf("stage-dsh-runtime.mjs")
	const buildClients = buildRuntime.indexOf('"--build-only"')
	const fingerprintRuntime = buildRuntime.indexOf("const manifest =")

	assert.ok(stageRuntime >= 0)
	assert.ok(buildClients > stageRuntime)
	assert.ok(fingerprintRuntime > buildClients)
	assert.match(buildRuntime, /watch-dsh-client\.mjs/)
})
test("keeps local and release builds from implicitly publishing to GitHub", () => {
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		scripts?: Record<string, string>
	}
	const scripts = packageJson.scripts ?? {}

	assert.match(scripts.package ?? "", /--publish never/)
	assert.match(scripts.make ?? "", /--publish never/)
	assert.match(scripts.publish ?? "", /--publish always/)
	const buildRelease = readFileSync(path.join(repoRoot, "cocode-gui/scripts/release/build-release.ts"), "utf8")
	assert.match(buildRelease, /\["--publish", "never"\]/)
	assert.doesNotMatch(buildRelease, /RELEASE_PUBLISH/)
})

test("prepares target-native Windows dependencies before building release assets", () => {
	const buildRelease = readFileSync(
		path.join(repoRoot, "cocode-gui/scripts/release/build-release.ts"),
		"utf8",
	)
	const installAppDeps = buildRelease.indexOf("install-app-deps")
	const runtimeBuild = buildRelease.indexOf('"build:runtime"')

	assert.ok(installAppDeps >= 0)
	assert.ok(runtimeBuild > installAppDeps)
	assert.match(buildRelease, /`--platform=\$\{target\.platform\}`/)
	assert.match(buildRelease, /`--arch=\$\{target\.arch\}`/)
	assert.match(buildRelease, /cleanNativeBuildOutputs/)
	assert.match(buildRelease, /assertNativeReleaseHost/)
})

test("configures signed Windows updates and the Cocode NSIS include", () => {
	const builderConfig = readFileSync(
		path.join(repoRoot, "cocode-gui/electron-builder.config.ts"),
		"utf8",
	)

	assert.match(builderConfig, /verifyUpdateCodeSignature:\s*Boolean\(windowsSign\)/)
	assert.doesNotMatch(builderConfig, /signExts/)
	assert.match(builderConfig, /include:\s*path\.resolve\("resources\/installer\.nsh"\)/)
	assert.match(builderConfig, /deleteAppDataOnUninstall:\s*false/)
	assert.match(builderConfig, /windows-cli-installer\.ps1/)
	assert.match(builderConfig, /linux:\s*\{[\s\S]+target:\s*\["AppImage"\]/)
	assert.match(builderConfig, /cocode\.png/)
})
