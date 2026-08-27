import { existsSync, readFileSync } from "node:fs"
import * as path from "pathe"

const root = process.cwd()
const example = path.join(root, ".env.release.example")
const allowed = new Set([
	"ELECTRON_APP_ID",
	"RELEASE_COPYRIGHT",
	"RELEASE_DESCRIPTION",
	"RELEASE_HOMEPAGE",
	"ELECTRON_UPDATE_REPOSITORY",
	"ELECTRON_AUTO_UPDATE",
	"ELECTRON_UPDATE_INTERVAL",
	"RELEASE_REQUIRE_SIGNING",
	"MACOS_ICON_PATH",
	"WINDOWS_ICON_PATH",
	"MAC_SIGNING_IDENTITY",
	"MAC_INSTALLER_SIGNING_IDENTITY",
	"MAC_INSTALLER_APP_IDENTIFIER",
	"MAC_INSTALLER_CLI_IDENTIFIER",
	"MAC_CLI_INSTALL_PATH",
	"MAC_SIGNING_KEYCHAIN",
	"MAC_ENTITLEMENTS_PATH",
	"MAC_PLUGIN_ENTITLEMENTS_PATH",
	"APPLE_API_KEY",
	"APPLE_API_KEY_ID",
	"APPLE_API_ISSUER",
	"APPLE_KEYCHAIN_PROFILE",
	"APPLE_KEYCHAIN",
	"APPLE_ID",
	"APPLE_APP_SPECIFIC_PASSWORD",
	"APPLE_TEAM_ID",
	"SIGN_CERTIFICATE",
	"WINDOWS_SIGN_MODE",
	"WINDOWS_SIGN_SERVICE_URL",
	"WINDOWS_SIGN_CREDENTIAL_TARGET",
	"WINDOWS_SIGN_DESCRIPTION",
	"WINDOWS_SIGN_WEBSITE",
	"WINDOWS_SIGN_TIMEOUT_MS",
	"WINDOWS_SIGN_RETRY_COUNT",
	"WINDOWS_SIGN_CERTIFICATE_SUBJECT",
	"WINDOWS_SIGN_CERTIFICATE_SHA1",
	"WINDOWS_TIMESTAMP_SERVER",
	"LINUX_SIGNING_KEY",
	"LINUX_SIGNING_PASSPHRASE",
	"LINUX_GPG_HOME",
	"LINUX_GPG_PRIVATE_KEY",
	"LINUX_REPOSITORY_BASE_URL",
])

function parse(file) {
	const rows = []
	for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) continue
		const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
		if (!match) throw new Error(`${file}:${index + 1} must use KEY=value syntax.`)
		if (!allowed.has(match[1]))
			throw new Error(`${file}:${index + 1} uses unknown key ${match[1]}.`)
		rows.push(match)
	}
	return rows
}

if (!existsSync(example)) throw new Error(".env.release.example is required.")
const rows = parse(example)
console.log(`Release env schema OK: ${rows.length} variables.`)
