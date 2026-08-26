import { app } from "electron"
import { mkdirSync } from "node:fs"
import * as path from "pathe"

const isDevelopmentLaunch = (): boolean => process.env.COCODE_DEV_MODE?.trim() === "1"

/**
 * Keep a source checkout's Electron state and single-instance lock separate
 * from an installed Cocode build. The dev runner sets this before Electron
 * reaches `app.whenReady`, which is early enough for Electron to key the lock
 * and all userData-backed stores consistently.
 */
export const configureDevelopmentUserData = (): string | undefined => {
	if (!isDevelopmentLaunch()) return undefined
	const configured = process.env.COCODE_DEV_USER_DATA_DIR?.trim()
	if (configured === undefined || configured === "") {
		throw new Error("COCODE_DEV_USER_DATA_DIR is required for a development launch.")
	}
	const userData = path.resolve(configured)
	mkdirSync(userData, { recursive: true, mode: 0o700 })
	app.setPath("userData", userData)
	return userData
}

/**
 * Electron keys the lock on the `userData` directory, so a development run and
 * an installed build of the same app compete for the same lock. The escape
 * hatch keeps both runnable side by side while debugging.
 */
const isMultipleInstancesAllowed = (): boolean =>
	process.env.COCODE_ALLOW_MULTIPLE_INSTANCES?.trim() === "1"

/**
 * Claims the desktop-wide single-instance lock. A losing instance MUST return
 * from bootstrap immediately: the Host lease, the SQLite files and the rotating
 * log sink all assume a single owner, so any work done before quitting would
 * corrupt state that the running instance still holds.
 */
export const acquireSingleInstanceLock = (): boolean => {
	if (isMultipleInstancesAllowed()) return true
	if (app.requestSingleInstanceLock()) return true
	app.quit()
	return false
}
