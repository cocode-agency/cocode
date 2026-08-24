import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as common from "./common.mjs"
import * as host from "./host.mjs"
import * as linux from "./linux.mjs"
import * as macos from "./macos.mjs"
import * as windows from "./windows.mjs"

const guiRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const testRoot = path.join(guiRoot, "tests")

export const groups = { common, host, windows, macos, linux }

function patternToRegex(pattern) {
	let source = "^"
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index]
		if (character === "*" && pattern[index + 1] === "*") {
			index += 1
			if (pattern[index + 1] === "/") {
				index += 1
				source += "(?:.*/)?"
			} else {
				source += ".*"
			}
		} else if (character === "*") {
			source += "[^/]*"
		} else if (character === "?") {
			source += "[^/]"
		} else {
			source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		}
	}
	return new RegExp(`${source}$`)
}

function collectTestFiles(directory, prefix = "") {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) return collectTestFiles(absolute, relative)
		return entry.isFile() && relative.endsWith(".test.ts") ? [relative] : []
	})
}

export function getAllTestFiles() {
	return collectTestFiles(testRoot)
		.map((file) => `tests/${file}`)
		.sort()
}

export function resolveTestFiles(groupName) {
	const manifest = groups[groupName]
	if (!manifest) throw new Error(`Unknown GUI test group: ${groupName}`)

	const include = manifest.patterns.map(patternToRegex)
	const exclude = manifest.excludes.map(patternToRegex)
	return getAllTestFiles()
		.filter((file) => include.some((pattern) => pattern.test(file)))
		.filter((file) => !exclude.some((pattern) => pattern.test(file)))
}

export function resolvePlatformGroup(platform = process.platform) {
	const group = { win32: "windows", darwin: "macos", linux: "linux" }[platform]
	if (!group) throw new Error(`Unsupported GUI test platform: ${platform}`)
	return group
}
