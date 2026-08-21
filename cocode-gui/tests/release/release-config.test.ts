import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import {
	createMacNotarizeOptions,
	createMacSignOptions,
	createWindowsSignOptions,
	requireReleaseCredentials,
	resolveGitHubReleaseRepository,
	resolveMacCliInstallPath,
	resolveMacInstallerSigningIdentity,
	resolveReleaseTarget,
	validateReleaseEnvFile,
	resolveWindowsSignMode,
	resolveWindowsSignServiceOptions,
} from "../../scripts/release/release-config"

test("resolves supported desktop release targets including Linux", () => {
	assert.deepEqual(resolveReleaseTarget({ RELEASE_PLATFORM: "darwin", RELEASE_ARCH: "x64" }), {
		platform: "darwin",
		arch: "x64",
	})
	assert.deepEqual(resolveReleaseTarget({ RELEASE_PLATFORM: "win32", RELEASE_ARCH: "arm64" }), {
		platform: "win32",
		arch: "arm64",
	})
	assert.deepEqual(resolveReleaseTarget({ RELEASE_PLATFORM: "linux", RELEASE_ARCH: "x64" }), {
		platform: "linux",
		arch: "x64",
	})
	assert.throws(() => resolveReleaseTarget({ RELEASE_PLATFORM: "darwin", RELEASE_ARCH: "ia32" }))
})

test("Linux release credentials are intentionally a no-op", () => {
	assert.doesNotThrow(() =>
		requireReleaseCredentials(
			{ platform: "linux", arch: "arm64" },
			{ RELEASE_REQUIRE_SIGNING: "1" },
		),
	)
})

test("uses one GitHub repository for every architecture", () => {
	assert.deepEqual(resolveGitHubReleaseRepository({ GITHUB_REPOSITORY: "acme/cocode" }), {
		owner: "acme",
		name: "cocode",
	})
	assert.throws(() => resolveGitHubReleaseRepository({ GITHUB_REPOSITORY: "invalid" }))
})

test("rejects the removed RELEASE_GIT_COMMIT environment variable", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-release-env-"))
	const file = path.join(root, ".env.release")
	try {
		writeFileSync(file, "RELEASE_GIT_COMMIT=0123456789abcdef\n")
		assert.throws(() => validateReleaseEnvFile(file), /uses unknown key RELEASE_GIT_COMMIT/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("creates strict macOS signing options with per-file entitlement inputs", () => {
	const options = createMacSignOptions({
		MAC_SIGNING_IDENTITY: "Developer ID Application: Test",
		MAC_SIGNING_KEYCHAIN: "/tmp/release.keychain-db",
	})
	assert.deepEqual(options, {
		identity: "Test",
		keychain: "/tmp/release.keychain-db",
		entitlements: path.resolve("resources/entitlements.mac.plist"),
		entitlementsInherit: path.resolve("resources/entitlements.mac.plugin.plist"),
		hardenedRuntime: true,
		preAutoEntitlements: true,
		strictVerify: true,
	})
	assert.equal(createMacSignOptions({}), undefined)
})

test("accepts complete Apple notarization credential strategies", () => {
	assert.deepEqual(
		createMacNotarizeOptions({
			APPLE_API_KEY: "key",
			APPLE_API_KEY_ID: "id",
			APPLE_API_ISSUER: "issuer",
		}),
		{ appleApiKey: "key", appleApiKeyId: "id", appleApiIssuer: "issuer" },
	)
	assert.deepEqual(
		createMacNotarizeOptions({
			APPLE_KEYCHAIN_PROFILE: "cocode-notary",
			APPLE_KEYCHAIN: "/tmp/release.keychain-db",
		}),
		{ keychainProfile: "cocode-notary", keychain: "/tmp/release.keychain-db" },
	)
	assert.throws(() => createMacNotarizeOptions({ APPLE_API_KEY: "key" }))
})

test("requires Application, Installer and notarization credentials for signed macOS releases", () => {
	assert.throws(() =>
		requireReleaseCredentials(
			{ platform: "darwin", arch: "arm64" },
			{
				RELEASE_REQUIRE_SIGNING: "1",
				MAC_SIGNING_IDENTITY: "Developer ID Application: Test",
			},
		),
	)
	assert.doesNotThrow(() =>
		requireReleaseCredentials(
			{ platform: "darwin", arch: "arm64" },
			{
				RELEASE_REQUIRE_SIGNING: "1",
				MAC_SIGNING_IDENTITY: "Developer ID Application: Test",
				MAC_INSTALLER_SIGNING_IDENTITY: "Developer ID Installer: Test",
				APPLE_KEYCHAIN_PROFILE: "cocode-notary",
			},
		),
	)
})

test("keeps the custom macOS installer identity and CLI location", () => {
	assert.equal(
		resolveMacInstallerSigningIdentity({
			MAC_SIGNING_IDENTITY: "Developer ID Application: Test",
		}),
		undefined,
	)
	assert.equal(
		resolveMacInstallerSigningIdentity({
			MAC_INSTALLER_SIGNING_IDENTITY: "Developer ID Installer: Test",
		}),
		"Developer ID Installer: Test",
	)
	assert.equal(resolveMacCliInstallPath({}), "/usr/local/bin/cocode")
	assert.equal(
		resolveMacCliInstallPath({ MAC_CLI_INSTALL_PATH: "/custom/bin/cocode" }),
		"/custom/bin/cocode",
	)
})

test("treats empty Windows certificate values as unconfigured", () => {
	const environment = {
		WINDOWS_CERTIFICATE_FILE: "",
		WINDOWS_CERTIFICATE_PASSWORD: "",
	}
	assert.equal(resolveWindowsSignMode(environment), undefined)
	assert.equal(createWindowsSignOptions(environment), undefined)
})

test("uses the electron-builder adapter for team-service Windows signing", () => {
	const options = createWindowsSignOptions({
		RELEASE_REQUIRE_SIGNING: "1",
		WINDOWS_SIGN_MODE: "service",
		WINDOWS_SIGN_SERVICE_URL: "https://signing.example.test",
		WINDOWS_SIGN_CERTIFICATE_SUBJECT: "Cocode Agency, Inc.",
		WINDOWS_TIMESTAMP_SERVER: "https://timestamp.example.test",
	})
	assert.deepEqual(options, {
		sign: path.resolve("scripts/release/windows-sign-builder.cjs"),
		signingHashAlgorithms: ["sha256"],
		rfc3161TimeStampServer: "https://timestamp.example.test",
		publisherName: "Cocode Agency, Inc.",
	})
})

test("defaults Windows service signing to the Magic RFC3161 timestamp server", () => {
	const options = createWindowsSignOptions({
		WINDOWS_SIGN_MODE: "service",
		WINDOWS_SIGN_SERVICE_URL: "https://signing.example.test",
	})
	assert.equal(options?.rfc3161TimeStampServer, "http://timestamp.digicert.com")
})

test("allows first signed Windows releases without a pre-known certificate subject", () => {
	assert.doesNotThrow(() =>
		requireReleaseCredentials(
			{ platform: "win32", arch: "x64" },
			{
				RELEASE_REQUIRE_SIGNING: "1",
				WINDOWS_SIGN_MODE: "service",
				WINDOWS_SIGN_SERVICE_URL: "https://signing.example.test",
			},
		),
	)
})

test("signed Windows releases require the existing team signing service", () => {
	assert.throws(() =>
		requireReleaseCredentials(
			{ platform: "win32", arch: "x64" },
			{ RELEASE_REQUIRE_SIGNING: "1" },
		),
	)
	assert.throws(() =>
		requireReleaseCredentials(
			{ platform: "win32", arch: "x64" },
			{
				RELEASE_REQUIRE_SIGNING: "1",
				WINDOWS_SIGN_MODE: "pfx",
				WINDOWS_CERTIFICATE_FILE: "C:\\certificate.pfx",
				WINDOWS_CERTIFICATE_PASSWORD: "secret",
			},
		),
	)
	assert.doesNotThrow(() =>
		requireReleaseCredentials(
			{ platform: "win32", arch: "arm64" },
			{
				RELEASE_REQUIRE_SIGNING: "1",
				WINDOWS_SIGN_MODE: "service",
				WINDOWS_SIGN_SERVICE_URL: "https://signing.example.test",
				WINDOWS_SIGN_CERTIFICATE_SUBJECT: "Cocode Agency, Inc.",
			},
		),
	)
})

test("validates signing service URL and ignores unsupported website sign options", () => {
	assert.deepEqual(
		resolveWindowsSignServiceOptions({
			WINDOWS_SIGN_SERVICE_URL: "https://signing.example.test/",
			WINDOWS_SIGN_CREDENTIAL_TARGET: "team/windows-sign",
			WINDOWS_SIGN_DESCRIPTION: "Cocode Desktop",
			WINDOWS_SIGN_WEBSITE: "https://cocode.example.test",
			WINDOWS_SIGN_TIMEOUT_MS: "45000",
			WINDOWS_SIGN_RETRY_COUNT: "3",
		}),
		{
			serviceUrl: "https://signing.example.test",
			credentialTarget: "team/windows-sign",
			description: "Cocode Desktop",
			hashAlgorithm: "sha256",
			timeoutMs: 45000,
			retryCount: 3,
		},
	)
	assert.throws(() =>
		resolveWindowsSignServiceOptions({ WINDOWS_SIGN_SERVICE_URL: "file:///tmp/sign" }),
	)
	assert.throws(() =>
		resolveWindowsSignServiceOptions({
			WINDOWS_SIGN_SERVICE_URL: "https://signing.example.test",
			WINDOWS_SIGN_TIMEOUT_MS: "0",
		}),
	)
})
