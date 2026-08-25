import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as path from "pathe"
import test from "node:test"

const repoRoot = path.resolve("..")

test("Linux package maintainer scripts provide a self-contained TUI command", () => {
	const install = readFileSync(path.join(repoRoot, "cocode-gui/resources/linux-after-install.sh"), "utf8")
	const remove = readFileSync(path.join(repoRoot, "cocode-gui/resources/linux-after-remove.sh"), "utf8")

	assert.match(install, /APP_ROOT='\/opt\/\$\{sanitizedProductName\}'/)
	assert.match(install, /GUI_COMMAND='\$\{executable\}'/)
	assert.match(install, /TUI_COMMAND='\/usr\/bin\/cocode'/)
	assert.match(install, /exec "\\\$COCODE_NODE_EXECUTABLE" "\\\$TUI_ENTRY" "\\\$@"/)
	assert.match(install, /export COCODE_TUI_CLIENT_KIND="standalone-tui"/)
	assert.match(install, /rm -f "\$PROFILE"/)
	assert.match(remove, /update-alternatives --remove "\$GUI_COMMAND"/)
	assert.match(remove, /grep -qF "\$TUI_MARKER" "\$TUI_COMMAND"/)
})

test("Linux ARM64 verification follows the cocode-gui executable and installer wrapper", () => {
	const verifier = readFileSync(
		path.join(repoRoot, "cocode-gui/scripts/release/verify-linux-arm64.mjs"),
		"utf8",
	)

	assert.match(verifier, /cocode-linux-tui-wrapper:v1/)
	assert.match(verifier, /COCODE_TUI_CLIENT_KIND=\\\"standalone-tui\\\"/)
	assert.match(verifier, /path\.join\(root, "cocode-gui"\)/)
	assert.doesNotMatch(verifier, /"\/etc\/profile\.d\/cocode\.sh"/)
})
