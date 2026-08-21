import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import { win32 as win32Path } from "node:path"
import { Arch, type AfterPackContext, type BuildResult } from "electron-builder"
import { createPackageWithOptions, extractAll, getRawHeader } from "@electron/asar"
import { notarize } from "@electron/notarize"
import * as path from "pathe"
import { parse as parseYaml } from "yaml"
import packageMetadata from "../../package.json"
import { packagedNodeExecutableName } from "../../src/shared/packaged-node-executable"
import { verifyPackagedStartupAssets } from "./verify-packaged-startup-assets.mjs"
import {
	createMacNotarizeOptions,
	isReleaseSigningRequired,
	resolveReleaseTarget,
	resolveWindowsSignLedgerDir,
	resolveWindowsSignMode,
	type ReleaseArchitecture,
	type ReleasePlatform,
	type ReleaseTarget,
} from "./release-config"
import { MAIN_RUNTIME_DEPENDENCIES } from "./runtime-dependencies"
import {
	copyProductionDependencyClosure,
	verifyProductionDependencyClosure,
} from "./runtime-dependency-closure"
import {
	verifyLinuxAppImage,
	verifyLinuxReleaseManifest,
	writeLinuxReleaseManifest,
} from "./verify-linux-appimage.mjs"

interface WindowsSigningPolicy {
	inspectAuthenticode(filePath: string): { Subject?: string; Thumbprint?: string }
	shouldSubmitWindowsFileForSigning(filePath: string): boolean
	signFile(filePath: string): Promise<unknown>
}

const requireFromHere = createRequire(path.resolve("scripts/release/release-hooks.ts"))
const windowsSigningService = requireFromHere("./windows-sign-service.cjs") as WindowsSigningPolicy
const { inspectAuthenticode, shouldSubmitWindowsFileForSigning, signFile } =
	windowsSigningService as WindowsSigningPolicy

const asarRequire = createRequire(path.resolve("scripts/release/release-hooks.ts"))
const { NtExecutable, NtExecutableResource, Resource } = asarRequire("resedit") as {
	NtExecutable: { from(buffer: Buffer): unknown }
	NtExecutableResource: { from(executable: unknown): any }
	Resource: { VersionInfo: { fromEntries(entries: any[]): any } }
}

export interface ReleaseArtifactSet {
	readonly platform: ReleasePlatform
	readonly arch: ReleaseArchitecture
	readonly version: string
	readonly artifacts: readonly string[]
}

export async function hardenBuilderElectron(context: AfterPackContext): Promise<void> {
	const target = resolveContextTarget(context)
	const resourcesRoot = resolvePackagedResourcesRoot(context.appOutDir, target.platform)
	// electron-builder removes default_app.asar during its normal Electron
	// extraction cleanup. The local postinstall hardening still protects the
	// development Electron binary, while Builder's cleanup already prevents the
	// unconfigured welcome app from shipping in release output.
	if (!existsSync(path.join(resourcesRoot, "default_app.asar"))) return
	await runNodeScript("scripts/harden-electron-default-app.mjs", [
		"--resources-root",
		resourcesRoot,
	])
}

export async function stageBuilderApplication(context: AfterPackContext): Promise<void> {
	const target = resolveContextTarget(context)
	assertNativeStagingTarget(target)
	const resourcesRoot = resolvePackagedResourcesRoot(context.appOutDir, target.platform)
	const appStage = await openPackagedAppStage(resourcesRoot, target.platform)
	const appRoot = appStage.appRoot
	verifyBuilderApplicationEntrypoints(appRoot)
	copyProductionDependencyClosure({
		sourceRoot: process.cwd(),
		appRoot,
		dependencies: MAIN_RUNTIME_DEPENDENCIES,
		target,
	})
	verifyProductionDependencyClosure(appRoot, MAIN_RUNTIME_DEPENDENCIES)

	const startupFailureHtml = path.resolve("resources/startup-failure.html")
	if (!existsSync(startupFailureHtml))
		throw new Error(`Startup failure diagnostic page is missing: ${startupFailureHtml}`)
	await fs.mkdir(resourcesRoot, { recursive: true })
	await fs.copyFile(startupFailureHtml, path.join(resourcesRoot, "startup-failure.html"))

	const runtimeArtifact = path.resolve(
		process.env.COCODE_RUNTIME_ARTIFACT_ROOT ??
			path.join(process.cwd(), ".cache", "cocode", "release-runtime"),
	)
	await runNodeScript("scripts/verify-dsh-runtime.mjs", ["--runtime-root", runtimeArtifact])
	await fs.rm(path.join(resourcesRoot, "dsh-runtime"), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	await fs.cp(runtimeArtifact, path.join(resourcesRoot, "dsh-runtime"), { recursive: true })

	const tuiArtifact = path.resolve(
		process.env.COCODE_TUI_ARTIFACT_ROOT ??
			path.join(process.cwd(), ".cache", "cocode", "tui"),
	)
	await verifyTuiArtifact(tuiArtifact)
	await fs.rm(path.join(resourcesRoot, "tui"), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	await fs.cp(tuiArtifact, path.join(resourcesRoot, "tui"), { recursive: true })

	const nodeExecutable = path.join(resourcesRoot, packagedNodeExecutableName(target.platform))
	await fs.copyFile(process.execPath, nodeExecutable)
	await fs.chmod(nodeExecutable, 0o755)
	if (target.platform === "win32" && process.platform === "win32" && isReleaseSigningRequired())
		await signPackagedWindowsExecutables(resourcesRoot, signFile)
	try {
		await closePackagedAppStage(appStage)
		verifyPackagedRuntimeLayout(context.appOutDir, target, appRoot)
	} finally {
		await cleanupPackagedAppStage(appStage)
	}
}

interface PackagedAppStage {
	readonly appRoot: string
	readonly archivePath?: string
	readonly temporaryRoot?: string
	readonly resourcesRoot: string
	readonly platform: ReleasePlatform
}

async function openPackagedAppStage(
	resourcesRoot: string,
	platform: ReleasePlatform,
): Promise<PackagedAppStage> {
	if (platform !== "win32") {
		return { appRoot: path.join(resourcesRoot, "app"), resourcesRoot, platform }
	}
	const archivePath = path.join(resourcesRoot, "app.asar")
	if (!existsSync(archivePath)) {
		return { appRoot: path.join(resourcesRoot, "app"), resourcesRoot, platform }
	}
	const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "cocode-app-asar-"))
	extractAll(archivePath, temporaryRoot)
	const unpackedRoot = archivePath + ".unpacked"
	if (existsSync(unpackedRoot))
		await fs.cp(unpackedRoot, temporaryRoot, { recursive: true, force: true, dereference: false })
	return { appRoot: temporaryRoot, archivePath, temporaryRoot, resourcesRoot, platform }
}

async function closePackagedAppStage(stage: PackagedAppStage): Promise<void> {
	if (!stage.archivePath || !stage.temporaryRoot) return
	const unpackPattern = "**/*.{node,dll,exe}"
	await fs.rm(stage.archivePath + ".unpacked", { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	await fs.rm(stage.archivePath, { force: true })
	await createPackageWithOptions(stage.temporaryRoot, stage.archivePath, { unpack: unpackPattern })
	const executable = path.join(path.dirname(stage.resourcesRoot), "Cocode.exe")
	await updateWindowsAsarIntegrity(executable, stage.archivePath)
}

async function cleanupPackagedAppStage(stage: PackagedAppStage): Promise<void> {
	if (!stage.temporaryRoot) return
	await fs.rm(stage.temporaryRoot, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	})
}

async function updateWindowsAsarIntegrity(executablePath: string, archivePath: string): Promise<void> {
	const { headerString } = getRawHeader(archivePath)
	const hash = createHash("sha256").update(headerString).digest("hex")
	const executable = NtExecutable.from(await fs.readFile(executablePath)) as any
	const resource = NtExecutableResource.from(executable)
	const versionInfo = Resource.VersionInfo.fromEntries(resource.entries)
	if (versionInfo.length !== 1) throw new Error("Failed to parse version info in " + executablePath)
	const languages = versionInfo[0].getAllLanguagesForStringValues()
	if (languages.length !== 1) throw new Error("Failed to locate languages in " + executablePath)
	resource.entries = resource.entries.filter(
		(entry: any) => !(entry.type === "INTEGRITY" && entry.id === "ELECTRONASAR"),
	)
	resource.entries.push({
		type: "INTEGRITY",
		id: "ELECTRONASAR",
		bin: Buffer.from(
			JSON.stringify([
				{ file: win32Path.normalize("resources/app.asar"), alg: "SHA256", value: hash },
			]),
		),
		lang: languages[0].lang,
		codepage: languages[0].codepage,
	})
	resource.outputResource(executable)
	await fs.writeFile(executablePath, Buffer.from(executable.generate()))
}
export async function signPackagedWindowsExecutables(
	resourcesRoot: string,
	sign: (filePath: string) => Promise<unknown> = signFile,
): Promise<string[]> {
	const files = collectFiles(resourcesRoot)
		.filter((file) => shouldSubmitWindowsFileForSigning(file))
		.sort((left, right) => left.localeCompare(right))
	for (const file of files) await sign(file)
	return files
}

export function verifyBuilderApplicationEntrypoints(appRoot: string): void {
	const buildRoot = path.join(appRoot, ".vite", "build")
	const mainPath = path.join(buildRoot, "main.mjs")
	const preloadPath = path.join(buildRoot, "preload.js")
	if (!existsSync(mainPath)) throw new Error(`Packaged main entrypoint is missing: ${mainPath}`)
	if (!existsSync(preloadPath)) {
		const legacyPreloadPath = path.join(buildRoot, "index.mjs")
		if (existsSync(legacyPreloadPath))
			throw new Error(
				`Packaged preload entrypoint has the wrong name: ${legacyPreloadPath}; expected ${preloadPath}.`,
			)
		throw new Error(`Packaged preload entrypoint is missing: ${preloadPath}`)
	}
	const unsupportedRequires = [
		...readFileSync(preloadPath, "utf8").matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
	]
		.map((match) => match[1])
		.filter((dependency): dependency is string => dependency !== undefined && dependency !== "electron")
	if (unsupportedRequires.length > 0) {
		throw new Error(
			`Sandboxed preload bundle contains unsupported external require: ${[
				...new Set(unsupportedRequires),
			]
				.sort()
				.join(", ")}. Bundle preload dependencies instead.`,
		)
	}
}

export async function notarizeBuilderMacApplication(context: AfterPackContext): Promise<void> {
	const target = resolveContextTarget(context)
	if (target.platform !== "darwin") return
	const appPath = resolveMacAppPath(context.appOutDir)
	verifyMacPackagedArchitecture(appPath, target.arch)
	if (!isReleaseSigningRequired()) return
	const credentials = createMacNotarizeOptions()
	if (!credentials) throw new Error("Mac notarization credentials are missing.")
	run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath])
	await notarize({ appPath, ...credentials } as Parameters<typeof notarize>[0])
	run("xcrun", ["stapler", "staple", appPath])
	run("xcrun", ["stapler", "validate", appPath])
	run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath])
}

export async function finalizeBuilderArtifacts(context: BuildResult): Promise<string[]> {
	if (context.artifactPaths.length === 0) return []
	const target = resolveBuilderTarget()
	if (!target) return []
	const artifacts = context.artifactPaths.filter(existsSync)
	const additional: string[] = []

	if (target.platform === "darwin") {
		const appPath = findMacAppWithTui(context.outDir)
		if (!appPath)
			throw new Error(`No packaged macOS App bundle was found under ${context.outDir}.`)
		const pkgPath = await buildAndVerifyMacPkg({
			appPath,
			outDir: context.outDir,
			version: packageMetadata.version,
			arch: target.arch,
		})
		additional.push(pkgPath)
	}
	const finalizedArtifacts = [...artifacts, ...additional]
	verifyBuilderArtifacts({
		platform: target.platform,
		arch: target.arch,
		version: packageMetadata.version,
		artifacts: finalizedArtifacts,
	})

	let windowsSignature: { Subject?: string; Thumbprint?: string } | undefined
	if (target.platform === "win32") {
		const inspect =
			process.platform === "win32" && isReleaseSigningRequired()
				? (file: string) => {
						const signature = verifyWindowsFile(file)
						verifyWindowsSigningLedger([file])
						return signature
					}
				: undefined
		const inventory = writeWindowsPeSigningInventory({
			outDir: context.outDir,
			excludeRoots: [
				process.env.COCODE_RUNTIME_ARTIFACT_ROOT,
				process.env.COCODE_TUI_ARTIFACT_ROOT,
			].filter((root): root is string => Boolean(root)).map((root) => path.resolve(root)),
			inspect,
		})
		additional.push(inventory)
		const installer = selectUpdateArtifact(target.platform, finalizedArtifacts)
		windowsSignature = inspect ? inspect(installer) : undefined
	}
	const updateArtifact = selectUpdateArtifact(target.platform, finalizedArtifacts)
	if (target.platform === "linux") {
		verifyLinuxAppImage({
			appImage: updateArtifact,
			arch: target.arch,
			metadataFile: undefined,
			extract: false,
		})
	}

	const updateMetadata = writeArchitectureUpdateMetadata({
		outDir: context.outDir,
		platform: target.platform,
		arch: target.arch,
		version: packageMetadata.version,
		artifacts: [...artifacts, ...additional],
	})
	additional.push(...updateMetadata)
	for (const metadata of updateMetadata) {
		verifyArchitectureUpdateMetadata(metadata, updateArtifact)
	}
	if (target.platform === "linux") {
		const manifest = writeLinuxReleaseManifest({
			appImage: updateArtifact,
			arch: target.arch,
			version: packageMetadata.version,
			metadataFiles: updateMetadata,
			outDir: context.outDir,
			hostPlatform: process.platform,
			hostArch: process.arch,
		})
		verifyLinuxReleaseManifest(manifest, updateArtifact, target.arch, updateMetadata)
		additional.push(manifest)
	}
	const checksum = appendChecksumManifest(
		context.outDir,
		[...artifacts, ...additional],
		target.platform === "linux" ? `SHA256SUMS-${target.arch}` : undefined,
	)
	additional.push(checksum)
	if (target.platform === "win32") {
		const evidence = writeWindowsReleaseEvidenceManifest({
			outDir: context.outDir,
			arch: target.arch,
			version: packageMetadata.version,
			installer: updateArtifact,
			metadataFiles: updateMetadata,
			hostArch: process.arch,
			createdAt: new Date().toISOString(),
			signature: windowsSignature,
		})
		additional.push(evidence)
	}
	cleanupWindowsSignLedger()
	return additional
}

export async function buildAndVerifyMacPkg(options: {
	readonly appPath: string
	readonly outDir: string
	readonly version: string
	readonly arch: ReleaseArchitecture
}): Promise<string> {
	const outputPath = path.join(
		options.outDir,
		`Cocode-${options.version}-${options.arch}.pkg`,
	)
	run(process.execPath, [
		"scripts/release/build-mac-pkg.mjs",
		options.appPath,
		outputPath,
		options.version,
	])
	run(process.execPath, ["scripts/release/verify-mac-pkg.mjs", outputPath])
	if (!isReleaseSigningRequired()) return outputPath
	const credentials = createMacNotarizeOptions()
	if (!credentials) throw new Error("Mac notarization credentials are missing.")
	await notarize({ appPath: outputPath, ...credentials } as Parameters<typeof notarize>[0])
	run("xcrun", ["stapler", "staple", outputPath])
	run("xcrun", ["stapler", "validate", outputPath])
	run("pkgutil", ["--check-signature", outputPath])
	run(process.execPath, ["scripts/release/verify-mac-pkg.mjs", outputPath])
	return outputPath
}

export function writeArchitectureUpdateMetadata(options: {
	readonly outDir: string
	readonly platform: ReleasePlatform
	readonly arch: ReleaseArchitecture
	readonly version: string
	readonly artifacts: readonly string[]
}): string[] {
	const artifact = selectUpdateArtifact(options.platform, options.artifacts)
	const sha512 = createHash("sha512").update(readFileSync(artifact)).digest("base64")
	const fileName = path.basename(artifact)
	const names =
		options.platform === "linux"
			? [options.arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml"]
			: [
					options.platform === "darwin" ? `${options.arch}-mac.yml` : `${options.arch}.yml`,
					options.platform === "darwin"
						? `latest-mac-${options.arch}.yml`
						: `latest-${options.arch}.yml`,
				]
	const metadata = [
		`version: ${options.version}`,
		"files:",
		`  - url: ${yamlString(fileName)}`,
		`    sha512: ${yamlString(sha512)}`,
		`path: ${yamlString(fileName)}`,
		`sha512: ${yamlString(sha512)}`,
		`releaseName: ${yamlString(`Cocode ${options.version}`)}`,
		`releaseDate: ${yamlString(new Date().toISOString())}`,
		"",
	].join("\n")
	mkdirSync(options.outDir, { recursive: true })
	const files = names.map((name) => path.join(options.outDir, name))
	for (const file of files) writeFileSync(file, metadata)
	return files
}

export function verifyArchitectureUpdateMetadata(metadataFile: string, artifact: string): void {
	const metadata = parseYaml(readFileSync(metadataFile, "utf8")) as {
		files?: Array<{ url?: string; sha512?: string }>
		path?: string
		sha512?: string
	}
	const expectedFile = path.basename(artifact)
	const expectedSha512 = createHash("sha512").update(readFileSync(artifact)).digest("base64")
	const firstFile = metadata.files?.[0]
	if (
		metadata.path !== expectedFile ||
		firstFile?.url !== expectedFile ||
		metadata.sha512 !== expectedSha512 ||
		firstFile?.sha512 !== expectedSha512
	) {
		throw new Error(
			`Updater metadata does not match the final signed artifact: ${metadataFile}`,
		)
	}
}

export function writeWindowsPeSigningInventory(options: {
	readonly outDir: string
	readonly excludeRoots?: readonly string[]
	readonly inspect?: (file: string) => { Subject?: string; Thumbprint?: string }
}): string {
	const excludedRoots = (options.excludeRoots ?? []).map((root) => path.resolve(root))
	const files = collectFiles(options.outDir)
		.filter((file) => {
			if (excludedRoots.some((root) => isPathWithin(root, file))) return false
			return (
				[".exe", ".node", ".dll"].includes(path.extname(file).toLowerCase()) ||
				shouldSubmitWindowsFileForSigning(file)
			)
		})
		.sort((left, right) => left.localeCompare(right))
		.map((file) => {
			const extension = path.extname(file).toLowerCase()
			const required = shouldSubmitWindowsFileForSigning(file)
			const signature = required && options.inspect ? options.inspect(file) : undefined
			return {
				path: path.relative(options.outDir, file).replaceAll("\\", "/"),
				extension,
				signing: required ? "required" : "excluded",
				...(signature
					? { subject: signature.Subject, thumbprint: signature.Thumbprint, status: "Valid" }
					: {}),
			}
		})
	const inventoryPath = path.join(options.outDir, "windows-pe-signing-inventory.json")
	writeFileSync(
		inventoryPath,
		`${JSON.stringify({ schemaVersion: 1, policy: { required: [".exe"], requiredFileNames: ["cocode-node.exe"], excluded: [".node", ".dll"] }, files }, null, 2)}\n`,
	)
	return inventoryPath
}

export function writeWindowsReleaseEvidenceManifest(options: {
	readonly outDir: string
	readonly arch: ReleaseArchitecture
	readonly version: string
	readonly installer: string
	readonly metadataFiles: readonly string[]
	readonly hostArch: string
	readonly createdAt: string
	readonly signature?: { Subject?: string; Thumbprint?: string }
}): string {
	const installer = readFileSync(options.installer)
	const manifestPath = path.join(options.outDir, "release-manifest.json")
	const manifest = {
		schemaVersion: 1,
		product: "Cocode",
		version: options.version,
		target: { platform: "win32", arch: options.arch },
		build: { hostArch: options.hostArch, createdAt: options.createdAt },
		artifact: {
			file: path.basename(options.installer),
			sha256: createHash("sha256").update(installer).digest("hex"),
			sha512: createHash("sha512").update(installer).digest("base64"),
		},
		signature: options.signature
			? {
					status: "Valid",
					subject: options.signature.Subject,
					thumbprint: options.signature.Thumbprint,
				}
			: { status: "Unsigned" },
		metadata: options.metadataFiles.map((file) => path.basename(file)),
	}
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
	return manifestPath
}

export function appendChecksumManifest(
	outDir: string,
	artifacts: readonly string[],
	fileName = "SHA256SUMS",
): string {
	const uniqueArtifacts = [...new Set(artifacts.map((artifact) => path.resolve(artifact)))].filter(
		existsSync,
	)
	const rows = uniqueArtifacts
		.map(
			(artifact) =>
				`${createHash("sha256")
					.update(readFileSync(artifact))
					.digest("hex")}  ${path.relative(outDir, artifact)}`,
		)
		.sort()
	const manifestPath = path.join(outDir, fileName)
	writeFileSync(manifestPath, `${rows.join("\n")}\n`)
	return manifestPath
}

export function verifyBuilderArtifacts(result: ReleaseArtifactSet): void {
	for (const artifact of result.artifacts) {
		if (!existsSync(artifact)) throw new Error(`Builder artifact is missing: ${artifact}`)
		if (result.platform === "darwin" && artifact.toLowerCase().endsWith(".zip")) {
			run("unzip", ["-t", artifact])
			if (isReleaseSigningRequired()) verifySignedMacZip(artifact, result.arch)
		}
		if (result.platform === "darwin" && artifact.toLowerCase().endsWith(".pkg")) {
			run(process.execPath, ["scripts/release/verify-mac-pkg.mjs", artifact])
			if (isReleaseSigningRequired()) {
				run("pkgutil", ["--check-signature", artifact])
				run("xcrun", ["stapler", "validate", artifact])
			}
		}
		if (
			result.platform === "win32" &&
			process.platform === "win32" &&
			artifact.toLowerCase().endsWith(".exe") &&
			isReleaseSigningRequired()
		) {
			verifyWindowsFile(artifact)
			verifyWindowsSigningLedger([artifact])
		}
	}
}

export function findMacAppWithTui(root: string): string | undefined {
	if (!existsSync(root)) return undefined
	if (!statSync(root).isDirectory()) return undefined
	if (root.endsWith(".app")) {
		return existsSync(path.join(root, "Contents", "Resources", "tui", "manifest.json"))
			? root
			: undefined
	}
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const found = findMacAppWithTui(path.join(root, entry.name))
		if (found) return found
	}
	return undefined
}

export function buildWindowsAuthenticodeVerificationScript(): string {
	return [
		"$signature = Get-AuthenticodeSignature -LiteralPath $env:VERIFY_FILE",
		"if ($signature.Status -ne 'Valid') { throw \"Invalid Authenticode signature: $env:VERIFY_FILE\" }",
		"$certificate = $signature.SignerCertificate",
		'if ($null -eq $certificate) { throw "Signer certificate is missing: $env:VERIFY_FILE" }',
		"$subjectUtf8 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$certificate.Subject))",
		"[PSCustomObject]@{ SubjectUtf8=$subjectUtf8; Thumbprint=$certificate.Thumbprint; Status=[string]$signature.Status } | ConvertTo-Json -Compress",
	].join("; ")
}

export function extractWindowsArchiveEntries(options: {
	readonly archivePath: string
	readonly destination: string
	readonly mode: "executables" | "named"
	readonly names?: readonly string[]
}): string[] {
	if (process.platform !== "win32")
		throw new Error("Windows archive extraction requires PowerShell.")
	const archivePath = path.resolve(options.archivePath)
	const destination = path.resolve(options.destination)
	if (!existsSync(archivePath)) throw new Error(`Archive is missing: ${archivePath}`)
	mkdirSync(destination, { recursive: true })
	const script = [
		"$ErrorActionPreference = 'Stop'",
		"Add-Type -AssemblyName System.IO.Compression.FileSystem",
		"New-Item -ItemType Directory -Path $env:ZIP_DIR -Force | Out-Null",
		"$wanted = @()",
		"if ($env:ZIP_ENTRIES_FILE) {",
		"  $wanted = @(Get-Content -LiteralPath $env:ZIP_ENTRIES_FILE -Encoding UTF8 | ForEach-Object { $_.Trim().Replace('\\','/') } | Where-Object { $_ })",
		"}",
		"$zip = [IO.Compression.ZipFile]::OpenRead($env:ZIP_FILE)",
		"try {",
		"  $index = 0",
		"  foreach ($entry in $zip.Entries) {",
		"    if ($entry.FullName.EndsWith('/')) { continue }",
		"    $name = $entry.FullName.Replace('\\','/')",
		"    $include = $false",
		"    if ($env:ZIP_MODE -eq 'executables') { $include = $name -like '*.exe' }",
		"    else { foreach ($want in $wanted) { if ($name -eq $want) { $include = $true; break } } }",
		"    if (-not $include) { continue }",
		"    $leaf = [IO.Path]::GetFileName($entry.FullName)",
		"    if ([string]::IsNullOrWhiteSpace($leaf)) { $leaf = 'entry' }",
		"    $target = Join-Path $env:ZIP_DIR ('{0:D4}-{1}' -f $index, $leaf)",
		"    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)",
		"    Write-Output $target",
		"    $index++",
		"  }",
		"} finally { $zip.Dispose() }",
	].join("\n")
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		ZIP_FILE: archivePath,
		ZIP_DIR: destination,
		ZIP_MODE: options.mode,
	}
	let entriesFile: string | undefined
	if (options.mode === "named") {
		entriesFile = path.join(destination, ".cocode-zip-entries.txt")
		writeFileSync(
			entriesFile,
			(options.names ?? []).map((name) => name.replaceAll("\\", "/")).join("\n"),
		)
		environment.ZIP_ENTRIES_FILE = entriesFile
	}
	try {
		const output = execFileSync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{ env: environment, encoding: "utf8" },
		)
		return output
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && existsSync(line))
	} finally {
		if (entriesFile) rmSync(entriesFile, { force: true })
	}
}

function resolveBuilderTarget(): ReleaseTarget | undefined {
	if (process.env.RELEASE_PLATFORM || process.env.RELEASE_ARCH) return resolveReleaseTarget()
	if (
		(process.platform === "darwin" || process.platform === "win32" || process.platform === "linux") &&
		(process.arch === "x64" || process.arch === "arm64")
	) {
		return { platform: process.platform, arch: process.arch }
	}
	return undefined
}

function resolveContextTarget(context: AfterPackContext): ReleaseTarget {
	const platform = context.electronPlatformName
	const arch = Arch[context.arch]
	if (platform !== "darwin" && platform !== "win32" && platform !== "linux")
		throw new Error(`Unsupported Builder platform: ${platform}.`)
	if (arch !== "x64" && arch !== "arm64")
		throw new Error(`Unsupported Builder architecture: ${arch}.`)
	return { platform, arch }
}

function assertNativeStagingTarget(target: ReleaseTarget): void {
	if (process.env.RELEASE_REQUIRE_NATIVE_ARCH_MATCH !== "1") return
	if (process.platform !== target.platform || process.arch !== target.arch) {
		throw new Error(
			`Native staging requires ${target.platform}/${target.arch}, but this process is ${process.platform}/${process.arch}.`,
		)
	}
}

function resolvePackagedResourcesRoot(appOutDir: string, platform: ReleasePlatform): string {
	if (platform === "win32" || platform === "linux") return path.join(appOutDir, "resources")
	const appPath = resolveMacAppPath(appOutDir)
	return path.join(appPath, "Contents", "Resources")
}

function verifyPackagedRuntimeLayout(
	appOutDir: string,
	target: ReleaseTarget,
	stagedAppRoot?: string,
): void {
	const resourcesRoot = resolvePackagedResourcesRoot(appOutDir, target.platform)
	const appVerification = stagedAppRoot
		? { appRoot: stagedAppRoot }
		: materializePackagedAppForVerification(resourcesRoot)
	try {
		for (const required of [
			path.join(resourcesRoot, "startup-failure.html"),
			path.join(resourcesRoot, packagedNodeExecutableName(target.platform)),
			path.join(resourcesRoot, "dsh-runtime", "runtime-manifest.json"),
			path.join(resourcesRoot, "tui", "manifest.json"),
			...MAIN_RUNTIME_DEPENDENCIES.map((dependency) =>
				path.join(appVerification.appRoot, "node_modules", ...dependency.split("/")),
			),
		]) {
			if (!existsSync(required)) throw new Error("Packaged runtime asset is missing: " + required)
		}
		verifyProductionDependencyClosure(appVerification.appRoot, MAIN_RUNTIME_DEPENDENCIES)
	} finally {
		if (appVerification.temporaryRoot)
			rmSync(appVerification.temporaryRoot, { recursive: true, force: true })
	}
	if (target.platform === "win32") {
		verifyPackagedStartupAssets(appOutDir, {
			...target,
			nodeExecutableName: packagedNodeExecutableName(target.platform),
		})
	}
}

function materializePackagedAppForVerification(resourcesRoot: string): {
	readonly appRoot: string
	readonly temporaryRoot?: string
} {
	const unpackedAppRoot = path.join(resourcesRoot, "app")
	if (existsSync(unpackedAppRoot)) return { appRoot: unpackedAppRoot }
	const archivePath = path.join(resourcesRoot, "app.asar")
	if (!existsSync(archivePath))
		throw new Error("Packaged application root is missing: " + unpackedAppRoot)
	const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "cocode-app-verify-"))
	extractAll(archivePath, temporaryRoot)
	return { appRoot: temporaryRoot, temporaryRoot }
}

async function verifyTuiArtifact(root: string): Promise<void> {
	const entry = path.join(root, "cocode-tui.mjs")
	const cliEntry = path.join(root, "cocode-cli.mjs")
	const cliModule = path.join(root, "cli.mjs")
	const meta = path.join(root, "cocode-tui.meta.json")
	const manifestPath = path.join(root, "manifest.json")
	for (const file of [entry, cliEntry, cliModule, meta, manifestPath]) {
		try {
			await fs.access(file)
		} catch {
			throw new Error(`TUI artifact is missing: ${file}`)
		}
	}
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
		entry?: string
		sha256?: string
		runtimeSha256?: string
		schemaVersion?: number
	}
	if (manifest.schemaVersion !== 1 || manifest.entry !== "tui/cocode-cli.mjs") {
		throw new Error("TUI artifact manifest is invalid.")
	}
	const cliHash = createHash("sha256").update(await fs.readFile(cliEntry)).digest("hex")
	const runtimeHash = createHash("sha256").update(await fs.readFile(entry)).digest("hex")
	if (cliHash !== manifest.sha256 || runtimeHash !== manifest.runtimeSha256) {
		throw new Error("TUI artifact hash does not match its manifest.")
	}
}

function resolveMacAppPath(appOutDir: string): string {
	if (appOutDir.endsWith(".app") && existsSync(appOutDir)) return appOutDir
	const appPath = findFirstByExtension(appOutDir, ".app")
	if (!appPath) throw new Error(`No .app bundle was found under ${appOutDir}.`)
	return appPath
}

function verifySignedMacZip(file: string, arch: ReleaseArchitecture): void {
	const temporary = mkdtempSync(path.join(os.tmpdir(), "cocode-zip-verify-"))
	try {
		run("unzip", ["-q", file, "-d", temporary])
		const appPath = findFirstByExtension(temporary, ".app")
		if (!appPath) throw new Error(`ZIP does not contain a macOS App bundle: ${file}`)
		run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath])
		run("xcrun", ["stapler", "validate", appPath])
		verifyMacPackagedArchitecture(appPath, arch)
	} finally {
		rmSync(temporary, { recursive: true, force: true })
	}
}

function verifyMacPackagedArchitecture(appPath: string, arch: ReleaseArchitecture): void {
	if (process.platform !== "darwin") return
	const candidates = [
		path.join(appPath, "Contents", "MacOS", "Cocode"),
		path.join(appPath, "Contents", "Resources", "cocode-node"),
		...collectFiles(appPath).filter(
			(file) => file.toLowerCase().endsWith(".node") && isMacNativeCandidate(file, arch),
		),
	].filter(existsSync)
	if (candidates.length < 2)
		throw new Error(`Packaged macOS native files were not found under ${appPath}.`)
	for (const file of candidates) {
		const architectures = execFileSync("lipo", ["-archs", file], { encoding: "utf8" })
			.trim()
			.split(/\s+/)
		if (!architectures.includes(arch))
			throw new Error(`Native packaged file architecture mismatch for ${arch}: ${file}`)
	}
}

function isMacNativeCandidate(file: string, arch: ReleaseArchitecture): boolean {
	const normalized = file.toLowerCase().replaceAll("\\", "/")
	const markers = normalized.match(/(?:darwin|win32|linux(?:musl)?)[-_](?:x64|arm64)/g)
	if (!markers) return true
	return markers.every((marker) => marker === `darwin-${arch}`)
}

function selectUpdateArtifact(
	platform: ReleasePlatform,
	artifacts: readonly string[],
): string {
	const extension = platform === "darwin" ? ".zip" : platform === "win32" ? ".exe" : ".appimage"
	const artifact = artifacts.find((candidate) => candidate.toLowerCase().endsWith(extension))
	if (!artifact)
		throw new Error(
			`No ${platform === "darwin" ? "ZIP" : platform === "win32" ? "NSIS" : "AppImage"} update artifact was generated.`,
		)
	return artifact
}

function yamlString(value: string): string {
	return JSON.stringify(value)
}

function verifyWindowsFile(file: string): { Subject?: string; Thumbprint?: string } {
	const signature = inspectAuthenticode(file)
	const expectedSubject = process.env.WINDOWS_SIGN_CERTIFICATE_SUBJECT?.trim()
	const expectedThumbprint = normalizeThumbprint(process.env.WINDOWS_SIGN_CERTIFICATE_SHA1)
	if (expectedSubject && signature.Subject !== expectedSubject)
		throw new Error(`Unexpected Windows signer subject: ${file}`)
	if (expectedThumbprint && normalizeThumbprint(signature.Thumbprint) !== expectedThumbprint)
		throw new Error(`Unexpected Windows signer certificate: ${file}`)
	return signature
}

function verifyWindowsSigningLedger(files: readonly string[]): void {
	if (resolveWindowsSignMode() !== "service") return
	const ledgerDir = resolveWindowsSignLedgerDir()
	for (const file of files) {
		const digest = createHash("sha256").update(readFileSync(file)).digest("hex")
		const ledgerPath = path.join(ledgerDir, `${digest}.json`)
		if (!existsSync(ledgerPath))
			throw new Error(`Windows signing ledger entry is missing: ${file}`)
		const entry = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
			inputSha256?: string
			outputSha256?: string
			status?: string
		}
		if (
			entry.status !== "signed" ||
			!isSha256(entry.inputSha256) ||
			entry.outputSha256 !== digest
		) {
			throw new Error(`Windows signing ledger entry is invalid: ${file}`)
		}
	}
}

function cleanupWindowsSignLedger(): void {
	const target = resolveBuilderTarget()
	if (!target || target.platform !== "win32" || resolveWindowsSignMode() !== "service") return
	const ledgerDir = resolveWindowsSignLedgerDir()
	if (existsSync(ledgerDir)) rmSync(ledgerDir, { recursive: true, force: true })
}

function normalizeThumbprint(value: string | undefined): string {
	return value?.replace(/\s+/g, "").toUpperCase() || ""
}

function isSha256(value: string | undefined): value is string {
	return Boolean(value && /^[a-f0-9]{64}$/i.test(value))
}

function collectFiles(root: string): string[] {
	if (!existsSync(root)) return []
	if (!statSync(root).isDirectory()) return [root]
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(root, entry.name)
		return entry.isDirectory() ? collectFiles(file) : [file]
	})
}

function isPathWithin(root: string, candidate: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate))
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function findFirstByExtension(root: string, extension: string): string | undefined {
	if (!existsSync(root)) return undefined
	if (!statSync(root).isDirectory()) return root.endsWith(extension) ? root : undefined
	if (root.endsWith(extension)) return root
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const found = findFirstByExtension(path.join(root, entry.name), extension)
		if (found) return found
	}
	return undefined
}

function run(command: string, args: readonly string[]): void {
	execFileSync(command, [...args], { stdio: "inherit" })
}

async function runNodeScript(script: string, args: readonly string[]): Promise<void> {
	const { spawn } = await import("node:child_process")
	await new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, [script, ...args], { stdio: "inherit" })
		child.once("error", reject)
		child.once("exit", (code) => {
			if (code === 0) resolve()
			else reject(new Error(`${script} exited with code ${String(code)}`))
		})
	})
}
