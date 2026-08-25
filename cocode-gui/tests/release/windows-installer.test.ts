import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
// Windows PATH behavior must be tested with win32 semantics on every host.
// oxlint-disable-next-line no-restricted-imports
import path from "node:path"
import test from "node:test"
import {
	addWindowsPathEntry,
	DesktopCliRegistrationService,
	removeWindowsPathEntry,
} from "../../src/main/contexts/tui/infrastructure/desktop-cli-registration"

test("adds a user Windows PATH entry once without changing existing entries", () => {
	const current = String.raw`C:\Windows\System32;C:\Tools`
	const directory = String.raw`C:\Users\alice\AppData\Local\Cocode\bin`

	assert.deepEqual(addWindowsPathEntry(current, directory), {
		changed: true,
		value: `${current};${directory}`,
	})
	assert.deepEqual(addWindowsPathEntry(`${current};${directory.toUpperCase()}`, directory), {
		changed: false,
		value: `${current};${directory.toUpperCase()}`,
	})
})

test("removes only the exact owned Windows PATH entry", () => {
	const directory = String.raw`C:\Users\alice\AppData\Local\Cocode\bin`
	const current = `${directory};C:\\Tools;${directory}-custom`

	assert.deepEqual(removeWindowsPathEntry(current, directory), {
		changed: true,
		value: String.raw`C:\Tools;C:\Users\alice\AppData\Local\Cocode\bin-custom`,
	})
	assert.deepEqual(removeWindowsPathEntry(String.raw`C:\Tools`, directory), {
		changed: false,
		value: String.raw`C:\Tools`,
	})
})

test("does not remove a user-modified CLI shim or its PATH entry", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-cli-uninstall-"))
	try {
		const shimPath = path.join(root, "cocode.cmd")
		writeFileSync(shimPath, "@echo off\r\necho user-owned\r\n")
		const updates: Array<{ directory: string; operation: string }> = []
		const service = new DesktopCliRegistrationService({
			resolveCandidates: () => [{ shimPath, directory: root, preferred: true }],
			buildInvocation: () => ({ executable: "node.exe", args: ["cli.mjs"], env: {}, cwd: root }),
			updatePersistentPath: async (directory, operation) => {
				updates.push({ directory, operation })
			},
		})

		const result = await service.uninstall()
		assert.equal(result.changed, false)
		assert.equal(readFileSync(shimPath, "utf8"), "@echo off\r\necho user-owned\r\n")
		assert.deepEqual(updates, [])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("NSIS delegates install and uninstall CLI registration to the owned helper", () => {
	const installer = readFileSync("resources/installer.nsh", "utf8")
	const helper = readFileSync("resources/windows-cli-installer.ps1", "utf8")

	assert.match(installer, /!macro customInstall/)
	assert.match(installer, /!macro customUnInstall/)
	assert.match(installer, /windows-cli-installer\.ps1" install/)
	assert.match(installer, /windows-cli-installer\.ps1" uninstall/)
	assert.match(helper, /HKCU:\\Software\\Cocode\\CLI/)
	assert.match(helper, /cocode-node\.exe/)
	assert.match(helper, /cocode-desktop-cli-shim:v1/)
	assert.match(helper, /Get-FileHash[\s\S]+SHA256/)
	assert.match(helper, /WM_SETTINGCHANGE/)
	assert.match(helper, /0x0002,[\s\S]+1000/)
	assert.match(helper, /EnvironmentVariable\("Path", "User"\)/)
	assert.doesNotMatch(helper, /Remove-Item[\s\S]+userData/i)
})
