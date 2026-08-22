import assert from "node:assert/strict"
import test from "node:test"
import {
	resolveApplicationUpdateConfig,
	resolveGitHubRepositoryFromUrl,
} from "../../../src/main/shell/updater/application-update-config"

const base = {
	packaged: true,
	platform: "darwin" as NodeJS.Platform,
	architecture: "arm64",
	defaultRepository: "cocode-agency/cocode",
}

test("enables packaged macOS updates on the native architecture channel", () => {
	assert.deepEqual(resolveApplicationUpdateConfig(base), {
		enabled: true,
		platform: "darwin",
		repository: "cocode-agency/cocode",
		updateInterval: "10 minutes",
		channel: "arm64",
	})
	assert.equal(resolveApplicationUpdateConfig({ ...base, architecture: "x64" }).channel, "x64")
})

test("honors the repository and interval environment overrides", () => {
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			environment: {
				ELECTRON_UPDATE_REPOSITORY: "acme/desktop",
				ELECTRON_UPDATE_INTERVAL: "1 hour",
			},
		}),
		{
			enabled: true,
			platform: "darwin",
			repository: "acme/desktop",
			updateInterval: "1 hour",
			channel: "arm64",
		},
	)
})

test("enables packaged Windows x64 and arm64 updates on architecture channels", () => {
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			platform: "win32",
			architecture: "x64",
		}),
		{
			enabled: true,
			platform: "win32",
			repository: "cocode-agency/cocode",
			updateInterval: "10 minutes",
			channel: "x64",
		},
	)
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			platform: "win32",
			architecture: "arm64",
		}),
		{
			enabled: true,
			platform: "win32",
			repository: "cocode-agency/cocode",
			updateInterval: "10 minutes",
			channel: "arm64",
		},
	)
})

test("uses the shared repository override for both Windows architectures", () => {
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			platform: "win32",
			architecture: "arm64",
			environment: { ELECTRON_UPDATE_REPOSITORY: "acme/desktop" },
		}),
		{
			enabled: true,
			platform: "win32",
			repository: "acme/desktop",
			updateInterval: "10 minutes",
			channel: "arm64",
		},
	)
})

test("enables packaged Linux updates with the platform default channel", () => {
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			platform: "linux",
			architecture: "x64",
		}),
		{
			enabled: true,
			platform: "linux",
			repository: "cocode-agency/cocode",
			updateInterval: "10 minutes",
			channel: null,
		},
	)
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			platform: "linux",
			architecture: "arm64",
		}).channel,
		null,
	)
})

test("keeps Linux updates enabled for native DEB and RPM packages", () => {
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			platform: "linux",
			architecture: "x64",
		}),
		resolveApplicationUpdateConfig({
			...base,
			platform: "linux",
			architecture: "arm64",
		}),
	)
})

test("disables development, unsupported platforms, and unsupported architectures", () => {
	assert.deepEqual(resolveApplicationUpdateConfig({ ...base, packaged: false }), {
		enabled: false,
		reason: "development",
	})
	assert.deepEqual(resolveApplicationUpdateConfig({ ...base, platform: "freebsd" }), {
		enabled: false,
		reason: "unsupported-platform",
	})
	assert.deepEqual(
		resolveApplicationUpdateConfig({ ...base, platform: "win32", architecture: "ia32" }),
		{ enabled: false, reason: "unsupported-architecture" },
	)
})

test("allows explicit opt-out and rejects unsafe intervals or repository values", () => {
	assert.deepEqual(
		resolveApplicationUpdateConfig({
			...base,
			environment: { ELECTRON_AUTO_UPDATE: "off" },
		}),
		{ enabled: false, reason: "disabled-by-environment" },
	)
	assert.throws(() =>
		resolveApplicationUpdateConfig({
			...base,
			environment: { ELECTRON_UPDATE_INTERVAL: "1 minute" },
		}),
	)
	assert.throws(() =>
		resolveApplicationUpdateConfig({
			...base,
			environment: { ELECTRON_UPDATE_INTERVAL: "0 hours" },
		}),
	)
	assert.throws(() =>
		resolveApplicationUpdateConfig({
			...base,
			environment: { ELECTRON_UPDATE_REPOSITORY: "acme" },
		}),
	)
})

test("normalizes GitHub repository URLs", () => {
	assert.equal(
		resolveGitHubRepositoryFromUrl("git+https://github.com/acme/desktop.git"),
		"acme/desktop",
	)
	assert.equal(resolveGitHubRepositoryFromUrl("https://github.com/acme/desktop"), "acme/desktop")
	assert.throws(() => resolveGitHubRepositoryFromUrl("https://gitlab.com/acme/desktop"))
})
