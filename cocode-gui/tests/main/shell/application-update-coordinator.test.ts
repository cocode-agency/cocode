import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import {
	createApplicationUpdateCoordinator,
	type ApplicationUpdateState,
} from "../../../src/main/shell/updater/application-update-coordinator"

class FakeUpdater extends EventEmitter {
	checkCalls = 0
	downloadCalls = 0

	checkForUpdates(): void {
		this.checkCalls += 1
	}

	downloadUpdate(): Promise<void> {
		this.downloadCalls += 1
		return Promise.resolve()
	}
}

class AsyncRejectingUpdater extends EventEmitter {
	checkForUpdates(): Promise<void> {
		return Promise.reject(new Error("network unavailable"))
	}

	downloadUpdate(): Promise<void> {
		return Promise.resolve()
	}
}

test("manual check enters checking and ignores duplicate clicks until a terminal event", () => {
	const updater = new FakeUpdater()
	const states: ApplicationUpdateState[] = []
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: (state) => states.push(state),
		onLatest: () => undefined,
		onError: () => undefined,
		onDownloaded: () => undefined,
	})

	coordinator.checkNow()
	coordinator.checkNow()

	assert.equal(updater.checkCalls, 1)
	assert.deepEqual(states, ["checking"])

	updater.emit("update-not-available")
	coordinator.checkNow()
	assert.equal(updater.checkCalls, 2)
})

test("manual no-update result reports the current version and returns to idle", () => {
	const updater = new FakeUpdater()
	const latestVersions: string[] = []
	const states: ApplicationUpdateState[] = []
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.2.3",
		updater,
		onStateChange: (state) => states.push(state),
		onLatest: (version) => latestVersions.push(version),
		onError: () => undefined,
		onDownloaded: () => undefined,
	})

	coordinator.checkNow()
	updater.emit("update-not-available")

	assert.deepEqual(states, ["checking", "idle"])
	assert.deepEqual(latestVersions, ["1.2.3"])
})

test("automatic no-update results do not show a user dialog", () => {
	const updater = new FakeUpdater()
	let latestCount = 0
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: () => undefined,
		onLatest: () => {
			latestCount += 1
		},
		onError: () => undefined,
		onDownloaded: () => undefined,
	})

	updater.emit("checking-for-update")
	updater.emit("update-not-available")

	assert.equal(latestCount, 0)
	coordinator.dispose()
})

test("available and downloaded events expose downloading state and the existing install prompt", () => {
	const updater = new FakeUpdater()
	const states: ApplicationUpdateState[] = []
	const releaseNames: Array<string | undefined> = []
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: (state) => states.push(state),
		onLatest: () => undefined,
		onError: () => undefined,
		onDownloaded: (releaseName) => releaseNames.push(releaseName),
	})

	updater.emit("update-available", { version: "1.1.0" })
	updater.emit("update-downloaded", { version: "1.1.0", releaseName: "Cocode 1.1.0" })

	assert.deepEqual(states, ["downloading", "idle"])
	assert.deepEqual(releaseNames, ["Cocode 1.1.0"])
	coordinator.dispose()
})

test("downloads only a strictly newer update version", async () => {
	const updater = new FakeUpdater()
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: () => undefined,
		onLatest: () => undefined,
		onError: () => undefined,
		onDownloaded: () => undefined,
	})

	updater.emit("update-available", { version: "1.0.0" })
	updater.emit("update-available", { version: "0.9.9" })
	updater.emit("update-available", { version: "1.1.0" })
	await new Promise<void>((resolve) => setImmediate(resolve))

	assert.equal(updater.downloadCalls, 1)
	coordinator.dispose()
})

test("ignores a downloaded update that is not newer than the current version", () => {
	const updater = new FakeUpdater()
	const releaseNames: string[] = []
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: () => undefined,
		onLatest: () => undefined,
		onError: () => undefined,
		onDownloaded: (releaseName) => {
			if (releaseName) releaseNames.push(releaseName)
		},
	})

	updater.emit("update-downloaded", { version: "0.9.9", releaseName: "Cocode 0.9.9" })
	assert.deepEqual(releaseNames, [])
	coordinator.dispose()
})

test("electron-updater downloaded events expose their release name", () => {
	const updater = new FakeUpdater()
	const releaseNames: Array<string | undefined> = []
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: () => undefined,
		onLatest: () => undefined,
		onError: () => undefined,
		onDownloaded: (releaseName) => releaseNames.push(releaseName),
	})

	updater.emit("update-downloaded", { version: "1.1.0", releaseName: "Cocode 1.1.0" })

	assert.deepEqual(releaseNames, ["Cocode 1.1.0"])
	coordinator.dispose()
})

test("manual errors restore idle and show a user-facing failure", () => {
	const updater = new FakeUpdater()
	const errors: Error[] = []
	const states: ApplicationUpdateState[] = []
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		onStateChange: (state) => states.push(state),
		onLatest: () => undefined,
		onError: (error) => errors.push(error),
		onDownloaded: () => undefined,
		updater,
	})

	coordinator.checkNow()
	updater.emit("error", new Error("network unavailable"))

	assert.deepEqual(states, ["checking", "idle"])
	assert.equal(errors.length, 1)
	assert.equal(errors[0]?.message, "network unavailable")
})

test("manual async updater failures restore idle and show a user-facing failure", async () => {
	const updater = new AsyncRejectingUpdater()
	const errors: Error[] = []
	const states: ApplicationUpdateState[] = []
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: (state) => states.push(state),
		onLatest: () => undefined,
		onError: (error) => errors.push(error),
		onDownloaded: () => undefined,
	})

	coordinator.checkNow()
	await new Promise<void>((resolve) => setImmediate(resolve))

	assert.deepEqual(states, ["checking", "idle"])
	assert.equal(errors.length, 1)
	assert.equal(errors[0]?.message, "network unavailable")
	coordinator.dispose()
})

test("disabled registrations do not call the updater", () => {
	const updater = new FakeUpdater()
	const coordinator = createApplicationUpdateCoordinator({
		enabled: false,
		version: "1.0.0",
		updater,
		onStateChange: () => undefined,
		onLatest: () => undefined,
		onError: () => undefined,
		onDownloaded: () => undefined,
	})

	coordinator.checkNow()
	assert.equal(updater.checkCalls, 0)
	coordinator.dispose()
})

test("dispose removes coordinator listeners and subscribers", () => {
	const updater = new FakeUpdater()
	let latestCount = 0
	let stateCount = 0
	const coordinator = createApplicationUpdateCoordinator({
		enabled: true,
		version: "1.0.0",
		updater,
		onStateChange: () => {
			stateCount += 1
		},
		onLatest: () => {
			latestCount += 1
		},
		onError: () => undefined,
		onDownloaded: () => undefined,
	})
	const unsubscribe = coordinator.subscribe(() => {
		stateCount += 1
	})
	stateCount = 0

	coordinator.dispose()
	unsubscribe()
	updater.emit("checking-for-update")
	updater.emit("update-not-available")

	assert.equal(stateCount, 0)
	assert.equal(latestCount, 0)
})
