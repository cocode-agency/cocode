import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "pathe"

export const RELEASE_EVIDENCE_STAGES = Object.freeze([
	"source",
	"staging",
	"native",
	"electronPackage",
	"installSmoke",
	"updater",
	"publication",
])

const VALID_STATUSES = new Set(["not-run", "passed", "failed", "not-applicable"])

export function createReleaseEvidence({
	platform,
	arch,
	nativeHost,
	version,
	createdAt = new Date().toISOString(),
	ownership = {},
	hashes = {},
	stages = {},
} = {}) {
	if (!platform || !arch || !nativeHost || !version)
		throw new Error("Release evidence requires platform, arch, nativeHost and version.")
	const normalizedStages = Object.fromEntries(
		RELEASE_EVIDENCE_STAGES.map((stage) => [
			stage,
			normalizeStage(stage, stages[stage] ?? { status: "not-run" }),
		]),
	)
	return {
		schemaVersion: 1,
		product: "Cocode",
		version: String(version),
		target: { platform: String(platform), arch: String(arch) },
		build: { nativeHost: String(nativeHost), createdAt: String(createdAt) },
		stages: normalizedStages,
		ownership: {
			guiMain: [...(ownership.guiMain ?? [])],
			dshRuntime: [...(ownership.dshRuntime ?? [])],
		},
		hashes: { ...hashes },
	}
}

export function updateReleaseEvidenceStage(manifest, stage, update = {}) {
	assertManifestShape(manifest)
	if (!RELEASE_EVIDENCE_STAGES.includes(stage))
		throw new Error(`Unknown release evidence stage: ${String(stage)}`)
	return {
		...manifest,
		stages: {
			...manifest.stages,
			[stage]: normalizeStage(stage, { ...manifest.stages[stage], ...update }),
		},
	}
}

export function writeReleaseEvidenceManifest({ outDir, manifest, fileName = "release-evidence.json" } = {}) {
	if (!outDir) throw new Error("Release evidence output directory is required.")
	assertManifestShape(manifest)
	const output = path.join(path.resolve(outDir), fileName)
	mkdirSync(path.dirname(output), { recursive: true })
	writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
	return output
}

export function readReleaseEvidenceManifest(file) {
	if (!file || !existsSync(file)) throw new Error(`Release evidence manifest is missing: ${file}`)
	const manifest = JSON.parse(readFileSync(file, "utf8"))
	assertManifestShape(manifest)
	return manifest
}

export function assertReleaseEvidenceReady(
	manifest,
	{ requireInstallSmoke = false, requireUpdater = false, requirePublication = false } = {},
) {
	assertManifestShape(manifest)
	if (requireInstallSmoke) {
		assertPassed(manifest, "installSmoke")
		for (const stage of ["source", "staging", "native", "electronPackage", "installSmoke"])
			if (stage !== "installSmoke") assertPassed(manifest, stage)
	}
	if (requireUpdater) assertPassed(manifest, "updater")
	if (requirePublication) assertPassed(manifest, "publication")
	return manifest
}

function assertManifestShape(manifest) {
	if (!manifest || manifest.schemaVersion !== 1 || manifest.product !== "Cocode")
		throw new Error("Invalid release evidence manifest schema.")
	if (!manifest.target?.platform || !manifest.target?.arch)
		throw new Error("Release evidence target is missing platform or architecture.")
	if (!manifest.build?.nativeHost || !manifest.build?.createdAt)
		throw new Error("Release evidence build metadata is incomplete.")
	if (!manifest.stages || typeof manifest.stages !== "object")
		throw new Error("Release evidence stages are missing.")
	for (const stage of RELEASE_EVIDENCE_STAGES) {
		if (!(stage in manifest.stages)) throw new Error(`Release evidence stage is missing: ${stage}`)
		normalizeStage(stage, manifest.stages[stage])
	}
	return manifest
}

function normalizeStage(stage, value) {
	if (!value || typeof value !== "object") throw new Error(`Invalid release evidence stage: ${stage}`)
	const status = value.status ?? "not-run"
	if (!VALID_STATUSES.has(status)) throw new Error(`Invalid release evidence status for ${stage}: ${status}`)
	if (status === "passed" && !hasDetails(value))
		throw new Error(`Missing ${stage} evidence details.`)
	return { ...value, status }
}

function hasDetails(value) {
	return ["command", "summary", "artifacts", "evidence", "log", "details"].some((key) => {
		const candidate = value[key]
		return candidate !== undefined && candidate !== null && candidate !== ""
	})
}

function assertPassed(manifest, stage) {
	if (manifest.stages[stage]?.status !== "passed")
		throw new Error(`${stage} evidence is not passed.`)
}
