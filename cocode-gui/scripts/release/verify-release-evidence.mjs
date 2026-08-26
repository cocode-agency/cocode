import * as path from "pathe"
import {
	assertReleaseEvidenceReady,
	readReleaseEvidenceManifest,
} from "./release-evidence.mjs"

export function verifyReleaseEvidence(
	rootOrManifest,
	{ requireInstallSmoke = false, requireUpdater = false, requirePublication = false } = {},
) {
	if (!rootOrManifest) throw new Error("A release evidence root or manifest path is required.")
	const input = path.resolve(rootOrManifest)
	const file = input.toLowerCase().endsWith(".json") ? input : path.join(input, "release-evidence.json")
	const manifest = readReleaseEvidenceManifest(file)
	assertReleaseEvidenceReady(manifest, { requireInstallSmoke, requireUpdater, requirePublication })
	return manifest
}

function readOption(name) {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === path.resolve(new URL(import.meta.url).pathname)) {
	const root = readOption("--release-root") ?? readOption("--manifest") ?? process.env.RELEASE_OUTPUT_DIR
	if (!root) throw new Error("Usage: node scripts/release/verify-release-evidence.mjs --release-root <directory>")
	const manifest = verifyReleaseEvidence(root, {
		requireInstallSmoke: process.argv.includes("--require-install-smoke"),
		requireUpdater: process.argv.includes("--require-updater"),
		requirePublication: process.argv.includes("--require-publication"),
	})
	console.log(`[release-evidence] valid ${manifest.target.platform}/${manifest.target.arch} ${manifest.version}`)
}
