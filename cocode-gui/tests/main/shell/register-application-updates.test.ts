import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import {
	configureElectronUpdater,
	type ElectronUpdaterFeed,
} from "../../../src/main/shell/updater/register-application-updates"

class FakeElectronUpdater extends EventEmitter {
	autoDownload = false
	autoInstallOnAppQuit = true
	channel: string | null = null
	feed: ElectronUpdaterFeed | null = null

	setFeedURL(feed: ElectronUpdaterFeed): void {
		this.feed = feed
	}

	checkForUpdates(): void {
		// The registration path is covered by the coordinator tests; this fake
		// only verifies the electron-updater configuration boundary.
	}

	quitAndInstall(): void {
		// noop
	}
}

test("configures electron-updater with the GitHub repository and architecture channel", () => {
	const updater = new FakeElectronUpdater()

	configureElectronUpdater(updater, {
		enabled: true,
		platform: "win32",
		repository: "acme/desktop",
		updateInterval: "10 minutes",
		channel: "arm64",
	})

	assert.deepEqual(updater.feed, {
		provider: "github",
		owner: "acme",
		repo: "desktop",
		channel: "arm64",
	})
	assert.equal(updater.channel, "arm64")
	assert.equal(updater.autoDownload, true)
	assert.equal(updater.autoInstallOnAppQuit, false)
})
