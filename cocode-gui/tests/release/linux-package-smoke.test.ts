import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"
import {
	resolveLinuxPackageRoot,
	verifyLinuxSandboxPackageListing,
} from "../../scripts/release/verify-linux-packages.mjs"

const repoRoot = path.resolve("..")
const smokeScriptPath = path.join(
	repoRoot,
	"cocode-gui/scripts/release/verify-installed-linux-package.sh",
)

test("resolves the default Linux package verification root without --root", () => {
	assert.equal(
		resolveLinuxPackageRoot(
			["node", "verify-linux-packages.mjs", "--arch", "x64"],
			"x64",
			"/workspace/cocode-gui",
		),
		"/workspace/cocode-gui/release/linux/x64",
	)
})

test("requires root-owned SUID sandbox metadata in DEB and RPM archives", () => {
	assert.doesNotThrow(() =>
		verifyLinuxSandboxPackageListing(
			"-rwsr-xr-x root/root 123 2026-08-23 ./opt/Cocode/chrome-sandbox",
			"deb",
			"Cocode.deb",
		),
	)
	assert.doesNotThrow(() =>
		verifyLinuxSandboxPackageListing(
			"/opt/Cocode/chrome-sandbox 0 0 0 104755 root root 0 0 0",
			"rpm",
			"Cocode.rpm",
		),
	)
	assert.throws(
		() =>
			verifyLinuxSandboxPackageListing(
				"-rwsr-xr-x runner/runner 123 2026-08-23 ./opt/Cocode/chrome-sandbox",
				"deb",
				"Cocode.deb",
			),
		/root-owned.*4755/i,
	)
	assert.throws(
		() =>
			verifyLinuxSandboxPackageListing(
				"/opt/Cocode/chrome-sandbox 0 0 0 104755 runner runner 0 0 0",
				"rpm",
				"Cocode.rpm",
			),
		/root-owned.*4755/i,
	)
})

test("allows package archives to defer sandbox ownership to maintainer scripts", () => {
	assert.doesNotThrow(() =>
		verifyLinuxSandboxPackageListing(
			"-rwxr-xr-x root/root 123 2026-08-23 ./opt/Cocode/chrome-sandbox",
			"deb",
			"Cocode.deb",
			{ requireSuid: false },
		),
	)
})

test("installs a Linux package before ordinary-user runtime smoke", () => {
	assert.equal(existsSync(smokeScriptPath), true)
	const script = readFileSync(smokeScriptPath, "utf8")
	assert.match(script, /apt-get install/)
	assert.match(script, /dnf install/)
	assert.match(script, /package_file="\$\(realpath -- "\$package_file"\)"/)
	assert.match(script, /rpm-install\.log/)
	assert.match(script, /tail -n 200/)
	assert.match(script, /stat .*%u:%g/)
	assert.match(script, /stat .*%a/)
	assert.match(script, /0:0/)
	assert.match(script, /4755/)
	assert.match(script, /runuser|sudo -u/)
	assert.match(script, /xvfb-run/)
	assert.match(script, /app\.ready\.completed/)
	assert.doesNotMatch(script, /--no-sandbox/)
})

test("isolates installed runtime smoke and preserves requested diagnostics", () => {
	assert.equal(existsSync(smokeScriptPath), true)
	const script = readFileSync(smokeScriptPath, "utf8")
	assert.match(script, /ELECTRON_AUTO_UPDATE=off/)
	assert.match(script, /env\s+-u\s+DBUS_SESSION_BUS_ADDRESS/)
	assert.match(script, /SMOKE_PRESERVE_ARTIFACTS/)
	assert.match(script, /SMOKE_ARTIFACT_ROOT/)
	assert.match(script, /Preserved smoke artifacts:/)
	assert.match(script, /output\.log/)
	assert.match(script, /ldd "\$app_path"/)
	assert.match(script, /not found/)
	assert.match(script, /dmesg -T/)
	assert.match(script, /journalctl -k/)
	assert.match(script, /status" -eq 137|status" == "137/)
	assert.match(script, /apt-get remove/)
	assert.match(script, /dnf remove/)
})
