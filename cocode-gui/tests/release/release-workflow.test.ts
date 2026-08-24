import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"

const repoRoot = path.resolve("..")
const genericReleaseWorkflowPath = path.join(repoRoot, ".github/workflows/cocode-gui-release.yml")
const linuxWorkflowPath = path.join(repoRoot, ".github/workflows/cocode-gui-linux.yml")
const releaseAssetVerifierPath = path.join(
	repoRoot,
	"cocode-gui/scripts/release/verify-github-release-assets.mjs",
)
const linuxReleaseFinalizerPath = path.join(
	repoRoot,
	"cocode-gui/scripts/release/finalize-linux-release-assets.mjs",
)
const checkWorkflowPath = path.join(repoRoot, ".github/workflows/cocode-gui-check.yml")
const guiPackagePath = path.join(repoRoot, "cocode-gui/package.json")
const oxlintConfigPath = path.join(repoRoot, "cocode-gui/.oxlintrc.json")
const lintStagedConfigPath = path.join(repoRoot, "cocode-gui/lint-staged.config.cjs")

test("uses the Linux workflow as the canonical signed DEB/RPM build", () => {
	assert.equal(existsSync(linuxWorkflowPath), true)
	const workflow = readFileSync(linuxWorkflowPath, "utf8")

	assert.match(workflow, /name:\s+Cocode GUI Linux branch draft/)
	assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- ["']?os\/linux["']?/)
	assert.match(workflow, /ubuntu-24\.04/)
	assert.match(workflow, /ubuntu-24\.04-arm/)
	assert.match(workflow, /fail-fast:\s*false/)
	assert.match(workflow, /assert-native-release-host\.mjs/)
	assert.match(workflow, /run release:linux:\$\{\{ matrix\.arch \}\}/)
	assert.match(workflow, /arch: x64/)
	assert.match(workflow, /arch: arm64/)
	assert.match(workflow, /Build Linux packages/)
	assert.match(workflow, /sign-packages:/)
	assert.match(workflow, /generate-metadata:/)
	assert.match(workflow, /verify-repository:/)
	assert.match(workflow, /draft-release:/)
	assert.match(workflow, /LINUX_GPG_PRIVATE_KEY/)
	assert.match(workflow, /LINUX_SIGNING_KEY/)
	assert.match(workflow, /mktemp "\$\{RUNNER_TEMP:-\/tmp\}\/cocode-rpm-key\.XXXXXX"/)
	assert.match(workflow, /gpg --batch --armor --export "\$LINUX_SIGNING_KEY" >"\$rpm_key_file"/)
	assert.match(workflow, /test -s "\$rpm_key_file"/)
	assert.match(workflow, /sudo rpm --import "\$rpm_key_file"/)
	assert.doesNotMatch(workflow, /rpm --import -/)
	assert.match(workflow, /verify-github-release-assets\.mjs/)
	assert.match(workflow, /release-assets\/x64/)
	assert.match(workflow, /release-assets\/arm64/)
	const metadataGenerationBlock = workflow.match(
		/\n  generate-metadata:[\s\S]*?(?=\n  verify-repository:)/,
	)?.[0] ?? ""
	assert.match(metadataGenerationBlock, /finalize-linux-release-assets\.mjs/)
	assert.match(metadataGenerationBlock, /release-assets\/\*\*/)
	assert.doesNotMatch(workflow, /path: cocode-gui\/release\/linux\/\$\{\{ matrix\.arch \}\}\/\s*\n/)
	assert.match(workflow, /contents:\s*write/)
	assert.match(workflow, /gh release upload/)
	assert.match(workflow, /RELEASE_TAG:\s*["']?os-linux["']?/)
	assert.doesNotMatch(workflow, /upload-release:/)
	assert.doesNotMatch(workflow, /draft=false/)
	assert.match(workflow, /release-assets\/repository\/cocode-linux-repository-\$\{version\}\.tar\.gz/)
	assert.match(workflow, /release-assets\/repository\/\*\.tar\.gz/)
	assert.doesNotMatch(workflow, /publish-stable-repository:/)
	assert.doesNotMatch(workflow, /stable-repository/)
	assert.doesNotMatch(workflow, /LINUX_REPOSITORY_SSH_/)
	assert.doesNotMatch(workflow, /rsync --archive --delete --checksum/)
	assert.doesNotMatch(workflow, /Verify stable repository endpoints/)
	assert.match(workflow, /smoke-deb:/)
	assert.match(workflow, /smoke-rpm:/)
	assert.match(workflow, /sign-packages:/)
	assert.match(workflow, /generate-metadata:/)
	assert.match(workflow, /verify-repository:/)
	assert.match(workflow, /verify-installed-linux-package\.sh/)
	assert.match(workflow, /ELECTRON_AUTO_UPDATE:\s*["']off["']/)
	assert.match(workflow, /SMOKE_PRESERVE_ARTIFACTS:\s*["']1["']/)
	assert.match(workflow, /SMOKE_ARTIFACT_ROOT:/)
	assert.match(workflow, /host_uid="\$\(id -u\)"/)
	assert.match(workflow, /host_gid="\$\(id -g\)"/)
	assert.match(workflow, /mkdir -p "\.tmp\/cocode-rpm-smoke\/\$\{\{ matrix\.arch \}\}"/)
	assert.match(workflow, /SMOKE_HOST_UID=/)
	assert.match(workflow, /SMOKE_HOST_GID=/)
	assert.match(workflow, /cocode-linux-deb-smoke-/)
	assert.match(workflow, /cocode-linux-rpm-smoke-/)
	assert.match(workflow, /apt-utils/)
	assert.match(workflow, /createrepo-c/)
	assert.match(workflow, /command -v rpmsign/)
	assert.match(workflow, /linux-repository\.mjs/)
	assert.match(workflow, /LINUX_REPOSITORY_BASE_URL/)
	assert.match(workflow, /cocode-linux-repository-/)
	assert.match(workflow, /Upload verified Linux release snapshot/)
	assert.match(workflow, /needs:\s*\[build, smoke-deb, smoke-rpm\]/)
	assert.ok(workflow.indexOf("\n  build:") < workflow.indexOf("\n  smoke-deb:"))
	assert.ok(workflow.indexOf("\n  smoke-rpm:") < workflow.indexOf("\n  sign-packages:"))
	assert.ok(workflow.indexOf("\n  sign-packages:") < workflow.indexOf("\n  generate-metadata:"))
	assert.ok(workflow.indexOf("\n  generate-metadata:") < workflow.indexOf("\n  verify-repository:"))
	assert.ok(workflow.indexOf("\n  verify-repository:") < workflow.indexOf("\n  draft-release:"))
	assert.doesNotMatch(workflow, /verify:linux:arm64 -- --skip-smoke/)
	assert.doesNotMatch(workflow, /--no-sandbox/)
	assert.doesNotMatch(workflow, /electron-builder[^\n]+--publish always/)

	const verifier = readFileSync(releaseAssetVerifierPath, "utf8")
	assert.match(verifier, /SHA256SUMS-x64/)
	assert.match(verifier, /linux-release-manifest-arm64\.json/)
	const finalizer = readFileSync(linuxReleaseFinalizerPath, "utf8")
	assert.match(finalizer, /SHA256SUMS-\$\{arch\}/)
	assert.match(finalizer, /linux-release-manifest-\$\{arch\}\.json/)
})

test("removes the generic all-platform release workflow", () => {
	assert.equal(existsSync(genericReleaseWorkflowPath), false)
})

test("updates the os-linux draft release from os/linux branch pushes", () => {
	assert.equal(existsSync(linuxWorkflowPath), true)
	const workflow = readFileSync(linuxWorkflowPath, "utf8")

	assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- ["']?os\/linux["']?/)
	assert.doesNotMatch(workflow, /tags:/)
	assert.match(workflow, /build:\s*\n\s+name:[^\n]+\n\s+environment:\s*Linux/)
	assert.match(workflow, /ubuntu-24\.04/)
	assert.match(workflow, /ubuntu-24\.04-arm/)
	assert.match(workflow, /release:linux:\$\{\{ matrix\.arch \}\}/)
	assert.match(workflow, /smoke-deb:/)
	assert.match(workflow, /smoke-rpm:/)
	assert.match(workflow, /verify-installed-linux-package\.sh/)
	assert.match(workflow, /apt-get install/)
	assert.match(workflow, /fedora:42/)
	assert.match(workflow, /install_weak_deps=False/)
	assert.match(workflow, /rpm-prerequisites\.log/)
	assert.match(workflow, /cocode-rpm-smoke\.log/)
	assert.match(workflow, /if docker run/)
	assert.match(workflow, />\"\$docker_log\" 2>&1/)
	assert.match(workflow, /docker_status=\$\?/)
	assert.match(workflow, /tail -n 200/)
	assert.match(workflow, /xvfb-run/)
	assert.doesNotMatch(workflow, /--no-sandbox/)
	assert.match(workflow, /needs:\s*\[build, smoke-deb, smoke-rpm\]/)
	assert.match(workflow, /RELEASE_TAG:\s*["']?os-linux["']?/)
	assert.match(workflow, /gh release create "\$RELEASE_TAG"[\s\\]+--draft/)
	assert.match(workflow, /gh release edit "\$RELEASE_TAG"[\s\\]+--draft=true/)
	assert.match(workflow, /gh release upload "\$RELEASE_TAG"[\s\S]+--clobber/)
	assert.match(workflow, /gh release view "\$RELEASE_TAG" --json isDraft,assets/)
	assert.doesNotMatch(workflow, /draft=false/)
	assert.doesNotMatch(workflow, /electron-builder[^\n]+--publish always/)
})

test("keeps the public GUI workflow limited to checks and rebuildability", () => {
	const workflow = readFileSync(checkWorkflowPath, "utf8")

	assert.match(workflow, /pull_request:/)
	assert.match(workflow, /push:\n\s+paths:/)
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

test("splits GUI tests into common, host, and native platform dimensions", () => {
	const workflow = readFileSync(checkWorkflowPath, "utf8")
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		scripts?: Record<string, string>
	}
	const scripts = packageJson.scripts ?? {}

	for (const name of ["test:common", "test:host", "test:windows", "test:macos", "test:linux"]) {
		assert.match(scripts[name] ?? "", /run-gui-tests\.mjs/)
	}
	assert.equal(scripts.test, "node scripts/run-gui-tests.mjs all")
	assert.equal(scripts["test:all"], undefined)

	assert.match(workflow, /platform: windows/)
	assert.match(workflow, /platform: macos/)
	assert.match(workflow, /platform: linux/)
	assert.match(workflow, /Test GUI common source/)
	assert.match(workflow, /Test GUI host behavior/)
	assert.match(workflow, /Test GUI Windows source/)
	assert.match(workflow, /Test GUI macOS source/)
	assert.match(workflow, /Test GUI Linux source/)
	assert.match(workflow, /matrix\.platform == 'windows'/)
	assert.match(workflow, /matrix\.platform == 'macos'/)
	assert.match(workflow, /matrix\.platform == 'linux'/)
	assert.doesNotMatch(workflow, /- name: Test GUI source\n[\s\S]+run: [^\n]+ run test\s*$/m)

	const pushBlock = workflow.match(/\n  push:\n([\s\S]*?)(?=\n\S|$)/)?.[1] ?? ""
	assert.doesNotMatch(pushBlock, /branches:/)
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
	const buildElectron = packageJson.scripts?.["build:electron"] ?? ""
	const publish = packageJson.scripts?.publish ?? ""
	const prepare = packageJson.scripts?.["prepare:release-assets"] ?? ""

	assert.match(publish, /prepare:release-assets/)
	assert.match(prepare, /harden-electron-default-app\.mjs/)
	assert.match(prepare, /build:runtime/)
	assert.match(prepare, /--clean/)
	assert.match(prepare, /build:tui/)
	assert.equal(buildElectron, "electron-vite build")
	assert.match(publish, /pnpm run build:electron/)
	assert.match(publish, /electron-builder/)
	assert.ok(publish.indexOf("prepare:release-assets") < publish.indexOf("electron-builder"))
})

test("keeps package scripts focused while preserving Host Supervisor checks", () => {
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		scripts?: Record<string, string>
	}
	const scripts = packageJson.scripts ?? {}

	assert.equal(scripts.dev, "node scripts/start-with-dsh-runtime.mjs")
	assert.equal(scripts["test:cocode-plugins"], "node scripts/cocode-plugins.mjs test")
	assert.equal(scripts["typecheck:cocode-plugins"], "node scripts/cocode-plugins.mjs typecheck")
	assert.equal(
		scripts["test:host-supervisor"],
		"pnpm --dir ../cocode-host-supervisor run test",
	)
	assert.equal(
		scripts["typecheck:host-supervisor"],
		"pnpm --dir ../cocode-host-supervisor run typecheck",
	)
	assert.match(scripts.package ?? "", /pnpm run build:electron/)
	assert.match(scripts.make ?? "", /pnpm run build:electron/)
	assert.equal(scripts.release, "tsx scripts/release/build-release.ts")
	const pluginCheck = scripts["check:cocode-plugins"] ?? ""
	assert.ok(pluginCheck.indexOf("build:cocode-plugins") < pluginCheck.indexOf("typecheck:cocode-plugins"))
	assert.ok(pluginCheck.indexOf("typecheck:cocode-plugins") < pluginCheck.indexOf("test:cocode-plugins"))
	const supervisorCheck = scripts["check:host-supervisor"] ?? ""
	assert.ok(
		supervisorCheck.indexOf("typecheck:host-supervisor") <
			supervisorCheck.indexOf("test:host-supervisor"),
	)
	for (const [name, command] of Object.entries(scripts)) {
		assert.doesNotMatch(command, /corepack pnpm@10\.34\.5/, name)
	}
})

test("provides native Linux release scripts and DEB/RPM verification", () => {
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		scripts?: Record<string, string>
	}
	assert.equal(packageJson.scripts?.release, "tsx scripts/release/build-release.ts")
	assert.match(packageJson.scripts?.["release:linux:x64"] ?? "", /--platform linux --arch x64/)
	assert.match(packageJson.scripts?.["release:linux:arm64"] ?? "", /--platform linux --arch arm64/)
	assert.equal(packageJson.scripts?.["build:linux:arm64"], undefined)
	assert.match(packageJson.scripts?.["verify:linux:arm64"] ?? "", /verify-linux-arm64/)
	assert.equal(packageJson.scripts?.["release:linux:arm64:verified"], undefined)
	assert.match(packageJson.scripts?.["verify:linux-packages"] ?? "", /verify-linux-packages/)
	assert.match(packageJson.scripts?.["sign:linux"] ?? "", /sign-linux-packages/)
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
	assert.match(builderConfig, /linux:\s*\{[\s\S]+target:\s*\["deb", "rpm"\]/)
	assert.match(builderConfig, /linux:\s*\{[\s\S]+executableName:\s*"cocode-gui"/)
	assert.match(builderConfig, /recommends:\s*\["libappindicator3-1"\]/)
	assert.doesNotMatch(builderConfig, /libsecret|gnome-keyring|dbus-user-session/)
	assert.match(builderConfig, /linux-after-install\.sh/)
	assert.match(builderConfig, /cocode\.png/)
	const packageJson = JSON.parse(readFileSync(guiPackagePath, "utf8")) as {
		devDependencies?: Record<string, string>
	}
	assert.equal(packageJson.devDependencies?.keytar, undefined)
	const workspace = readFileSync(path.join(repoRoot, "cocode-gui/pnpm-workspace.yaml"), "utf8")
	assert.doesNotMatch(workspace, /keytar/)
})

test("reserves cocode for the installer-managed Linux TUI and separates the GUI command", () => {
	const builderConfig = readFileSync(
		path.join(repoRoot, "cocode-gui/electron-builder.config.ts"),
		"utf8",
	)
	const afterInstall = readFileSync(
		path.join(repoRoot, "cocode-gui/resources/linux-after-install.sh"),
		"utf8",
	)
	const afterRemove = readFileSync(
		path.join(repoRoot, "cocode-gui/resources/linux-after-remove.sh"),
		"utf8",
	)
	const tuiLauncher = readFileSync(
		path.join(repoRoot, "cocode-gui/src/main/contexts/tui/infrastructure/tui-launcher.ts"),
		"utf8",
	)

	assert.match(builderConfig, /executableName:\s*"cocode-gui"/)
	assert.match(afterInstall, /cocode-linux-tui-wrapper:v1/)
	assert.match(afterInstall, /TUI_COMMAND='\/usr\/bin\/cocode'/)
	assert.match(afterInstall, /COCODE_TUI_CLIENT_KIND="standalone-tui"/)
	assert.match(afterInstall, /COCODE_HOME=.*HOME\/\.cocode/)
	assert.match(afterInstall, /COCODE_DSH_HOME=.*HOME\/\.dsh/)
	assert.match(afterInstall, /COCODE_SUPERVISOR_SERVICE_ENTRY/)
	assert.match(afterInstall, /refusing to replace unmanaged/)
	assert.doesNotMatch(afterInstall, /export PATH=/)
	assert.match(afterRemove, /cocode-linux-tui-wrapper:v1/)
	assert.match(afterRemove, /update-alternatives --remove 'cocode'/)
	assert.match(tuiLauncher, /isLinuxInstallerManagedCli/)
	assert.match(tuiLauncher, /registrationSource: "installer"/)
})
