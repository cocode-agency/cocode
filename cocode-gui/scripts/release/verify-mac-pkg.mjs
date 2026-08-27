import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"

const args = process.argv.slice(2)
const pkgPath = args[0] === "--" ? args[1] : args[0]
if (!pkgPath) throw new Error("Usage: node scripts/release/verify-mac-pkg.mjs <package.pkg>")
if (process.platform !== "darwin") {
	console.log("macOS PKG verification skipped on non-darwin host.")
	process.exit(0)
}
if (!existsSync(pkgPath)) throw new Error(`PKG does not exist: ${pkgPath}`)

// The payload listing can exceed Node's 1MB default maxBuffer (ENOBUFS).
const payload = execFileSync("pkgutil", ["--payload-files", pkgPath], {
	encoding: "utf8",
	maxBuffer: 256 * 1024 * 1024,
})
const required = [
	"Cocode.app/Contents/Resources/cocode-node",
	"Cocode.app/Contents/Resources/tui/cocode-cli.mjs",
	"Cocode.app/Contents/Resources/tui/cli.mjs",
	"Cocode.app/Contents/Resources/tui/headless-run.mjs",
	"Cocode.app/Contents/Resources/tui/cocode-tui.mjs",
	"Cocode.app/Contents/Resources/dsh-runtime/packages/host-supervisor/lib/bin.js",
]
// pkgutil lists payload paths relative to the component install location, so
// entries may or may not carry the "Applications/" prefix depending on macOS.
const entries = new Set(
	payload.split(/\r?\n/).map((entry) =>
		entry
			.trim()
			.replace(/^\.\//, "")
			.replace(/^Applications\//, ""),
	),
)
for (const file of required) {
	if (!entries.has(file)) {
		throw new Error(`PKG payload is missing: ${file}`)
	}
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cocode-pkg-verify-"))
// pkgutil --expand-full refuses to write into an existing directory.
const expanded = path.join(tempRoot, "expanded")
try {
	execFileSync("pkgutil", ["--expand-full", pkgPath, expanded])
	const postinstall = findFile(expanded, "postinstall")
	if (!postinstall) throw new Error("PKG CLI component does not contain a postinstall script.")
	const script = readFileSync(postinstall, "utf8")
	const cliInstallPath = process.env.MAC_CLI_INSTALL_PATH?.trim() || "/usr/local/bin/cocode"
	if (!script.includes("cocode-desktop-cli-shim:v1") || !script.includes(cliInstallPath)) {
		throw new Error("PKG CLI postinstall script does not register the expected Desktop CLI.")
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true })
}

if (process.env.RELEASE_REQUIRE_SIGNING === "1") {
	execFileSync("pkgutil", ["--check-signature", pkgPath], { stdio: "inherit" })
}

console.log(`macOS PKG payload verified: ${pkgPath}`)

function findFile(root, name) {
	if (!existsSync(root)) return undefined
	if (!statSync(root).isDirectory()) return path.basename(root) === name ? root : undefined
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const found = findFile(path.join(root, entry.name), name)
		if (found) return found
	}
	return undefined
}
