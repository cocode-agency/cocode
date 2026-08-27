import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "pathe"

// pathe guarantees forward-slash output on every platform, so the relative
// paths returned here are safe to use as portable manifest keys.
export function listFiles(root, prefix = "") {
	if (!existsSync(root)) return []
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const absolute = path.join(root, entry.name)
		const relative = path.join(prefix, entry.name)
		return entry.isDirectory() ? listFiles(absolute, relative) : [relative]
	})
}

/**
 * @param {string} root
 * @param {{ignore?: (relative: string) => boolean}} [options]
 */
export function hashDirectory(root, { ignore = () => false } = {}) {
	const hash = createHash("sha256")
	for (const relative of listFiles(root).sort()) {
		if (ignore(relative)) continue
		const absolute = path.join(root, relative)
		if (lstatSync(absolute).isSymbolicLink())
			throw new Error(`Symlink found while hashing: ${relative}`)
		// Defensive: keep hash input portable even if a caller passes a
		// Windows-style path.
		hash.update(relative.replaceAll("\\", "/"))
		hash.update("\0")
		hash.update(readFileSync(absolute))
		hash.update("\0")
	}
	return hash.digest("hex")
}

export function hashFiles(root, files) {
	const hash = createHash("sha256")
	for (const relative of [...files].sort()) {
		const absolute = path.join(root, relative)
		if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
		hash.update(relative.replaceAll("\\", "/"))
		hash.update("\0")
		hash.update(readFileSync(absolute))
		hash.update("\0")
	}
	return hash.digest("hex")
}

export function hashJson(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function sha256File(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex")
}

export function readJson(file, label = file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"))
	} catch (error) {
		throw new Error(`Unable to read ${label}: ${String(error)}`)
	}
}
