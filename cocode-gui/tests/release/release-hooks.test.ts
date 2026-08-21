import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
		existsSync,
		lstatSync,
		mkdirSync,
		mkdtempSync,
		readFileSync,
		rmSync,
		writeFileSync,
	} from "node:fs"
import os from "node:os"
import * as path from "pathe"
import test from "node:test"
import {
	appendChecksumManifest,
	buildWindowsAuthenticodeVerificationScript,
	findMacAppWithTui,
	signPackagedWindowsExecutables,
	verifyBuilderApplicationEntrypoints,
	verifyArchitectureUpdateMetadata,
	writeArchitectureUpdateMetadata,
	writeWindowsPeSigningInventory,
	writeWindowsReleaseEvidenceManifest,
} from "../../scripts/release/release-hooks"
import {
	copyProductionDependencyClosure,
	verifyProductionDependencyClosure,
} from "../../scripts/release/runtime-dependency-closure"
import { verifyPackagedStartupAssets } from "../../scripts/release/verify-packaged-startup-assets.mjs"

test("writes isolated macOS updater metadata for each architecture", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-update-metadata-"))
	try {
		const zip = path.join(root, "Cocode-1.2.3-arm64.zip")
		writeFileSync(zip, "arm64-zip")
		const files = writeArchitectureUpdateMetadata({
			outDir: root,
			platform: "darwin",
			arch: "arm64",
			version: "1.2.3",
			artifacts: [zip],
		})
		assert.deepEqual(files, [
			path.join(root, "arm64-mac.yml"),
			path.join(root, "latest-mac-arm64.yml"),
		])
		const expectedSha512 = createHash("sha512").update("arm64-zip").digest("base64")
		for (const file of files) {
			const metadata = readFileSync(file, "utf8")
			assert.match(metadata, /^version: 1\.2\.3$/m)
			assert.match(metadata, /url: "Cocode-1\.2\.3-arm64\.zip"/)
			assert.match(metadata, new RegExp(`sha512: "${expectedSha512}"`))
			assert.doesNotMatch(metadata, /x64/)
		}
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("writes isolated Windows updater metadata for each architecture", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-update-metadata-"))
	try {
		const installer = path.join(root, "Cocode-1.2.3-x64.exe")
		writeFileSync(installer, "x64-installer")
		const files = writeArchitectureUpdateMetadata({
			outDir: root,
			platform: "win32",
			arch: "x64",
			version: "1.2.3",
			artifacts: [installer],
		})
		assert.deepEqual(files, [
			path.join(root, "x64.yml"),
			path.join(root, "latest-x64.yml"),
		])
		for (const file of files) {
			const metadata = readFileSync(file, "utf8")
			assert.match(metadata, /url: "Cocode-1\.2\.3-x64\.exe"/)
			assert.doesNotMatch(metadata, /arm64/)
			assert.doesNotThrow(() => verifyArchitectureUpdateMetadata(file, installer))
		}
		writeFileSync(installer, "installer-modified-after-metadata")
		assert.throws(
			() => verifyArchitectureUpdateMetadata(files[0] as string, installer),
			/does not match the final signed artifact/,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("writes Linux AppImage updater metadata with electron-updater channel names", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-linux-update-metadata-"))
	try {
		const appImage = path.join(root, "Cocode-1.2.3-x86_64.AppImage")
		writeFileSync(appImage, "x64-appimage")
		const x64Files = writeArchitectureUpdateMetadata({
			outDir: root,
			platform: "linux",
			arch: "x64",
			version: "1.2.3",
			artifacts: [appImage],
		})
		assert.deepEqual(x64Files, [path.join(root, "latest-linux.yml")])
		assert.doesNotThrow(() => verifyArchitectureUpdateMetadata(x64Files[0] as string, appImage))

		const armImage = path.join(root, "Cocode-1.2.3-arm64.AppImage")
		writeFileSync(armImage, "arm64-appimage")
		const armFiles = writeArchitectureUpdateMetadata({
			outDir: root,
			platform: "linux",
			arch: "arm64",
			version: "1.2.3",
			artifacts: [armImage],
		})
		assert.deepEqual(armFiles, [path.join(root, "latest-linux-arm64.yml")])
		assert.doesNotThrow(() => verifyArchitectureUpdateMetadata(armFiles[0] as string, armImage))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("writes a Windows PE inventory with explicit required and excluded signing scope", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-pe-inventory-"))
	try {
		const executable = path.join(root, "Cocode.exe")
		const bundledNode = path.join(root, "resources", "cocode-node.exe")
		const nativeAddon = path.join(root, "resources", "better-sqlite3.node")
		const library = path.join(root, "resources", "libvips.dll")
		writeFixture(executable, createPeFixture())
		writeFixture(bundledNode, createPeFixture())
		writeFixture(nativeAddon, createPeFixture())
		writeFixture(library, createPeFixture())
		const inspected: string[] = []
		const inventoryPath = writeWindowsPeSigningInventory({
			outDir: root,
			inspect: (file) => {
				inspected.push(file)
				return { Subject: "CN=Cocode", Thumbprint: "AABB" }
			},
		})

		assert.deepEqual(inspected, [bundledNode, executable].sort())
		const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as {
			files: Array<{ path: string; signing: string; extension: string }>
		}
		assert.deepEqual(
			inventory.files.map(({ path: file, signing, extension }) => ({ file, signing, extension })),
			[
				{ file: "Cocode.exe", signing: "required", extension: ".exe" },
				{ file: "resources/better-sqlite3.node", signing: "excluded", extension: ".node" },
				{ file: "resources/cocode-node.exe", signing: "required", extension: ".exe" },
				{ file: "resources/libvips.dll", signing: "excluded", extension: ".dll" },
			],
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("excludes runtime and TUI staging artifacts from the final Windows signing inventory", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-pe-inventory-staging-"))
	try {
		const installer = path.join(root, "Cocode-1.2.3-x64.exe")
		const packagedExecutable = path.join(root, "win-unpacked", "Cocode.exe")
		const runtimeExecutable = path.join(root, "runtime", "node_modules", "@vscode", "ripgrep-win32-x64", "bin", "rg.exe")
		const tuiExecutable = path.join(root, "tui", "bin", "helper.exe")
		for (const file of [installer, packagedExecutable, runtimeExecutable, tuiExecutable]) {
			writeFixture(file, createPeFixture())
		}
		const inspected: string[] = []
		writeWindowsPeSigningInventory({
			outDir: root,
			excludeRoots: [path.join(root, "runtime"), path.join(root, "tui")],
			inspect: (file) => {
				inspected.push(file)
				return { Subject: "CN=Cocode", Thumbprint: "AABB" }
			},
		})

		assert.deepEqual(inspected, [installer, packagedExecutable].sort())
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("signs Windows executables added under packaged resources afterPack", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-packaged-signing-"))
	try {
		const nestedExecutable = path.join(root, "dsh-runtime", "bin", "rg.exe")
		const bundledNode = path.join(root, "cocode-node.exe")
		const excludedLibrary = path.join(root, "dsh-runtime", "bin", "helper.dll")
		writeFixture(nestedExecutable, createPeFixture())
		writeFixture(bundledNode, createPeFixture())
		writeFixture(excludedLibrary, createPeFixture())
		const signed: string[] = []

		const files = await signPackagedWindowsExecutables(root, async (file) => {
			signed.push(file)
		})

		assert.deepEqual(files, [bundledNode, nestedExecutable].sort())
		assert.deepEqual(signed, [bundledNode, nestedExecutable].sort())
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("writes Windows release evidence from the final signed installer", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-release-evidence-"))
	try {
		const installer = path.join(root, "Cocode-1.2.3-arm64.exe")
		const metadata = path.join(root, "latest-arm64.yml")
		writeFileSync(installer, "final-signed-installer")
		writeFileSync(metadata, "metadata")
		const manifestPath = writeWindowsReleaseEvidenceManifest({
			outDir: root,
			arch: "arm64",
			version: "1.2.3",
			installer,
			metadataFiles: [metadata],
			hostArch: "arm64",
			createdAt: "2026-08-20T10:00:00.000Z",
			signature: { Subject: "CN=Cocode", Thumbprint: "AABBCC" },
		})
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, any>

		assert.equal(manifest.version, "1.2.3")
		assert.deepEqual(manifest.target, { platform: "win32", arch: "arm64" })
		assert.equal("gitCommit" in manifest, false)
		assert.equal(manifest.build.hostArch, "arm64")
		assert.equal(manifest.build.createdAt, "2026-08-20T10:00:00.000Z")
		assert.equal(manifest.artifact.file, "Cocode-1.2.3-arm64.exe")
		assert.equal(
			manifest.artifact.sha256,
			createHash("sha256").update("final-signed-installer").digest("hex"),
		)
		assert.equal(
			manifest.artifact.sha512,
			createHash("sha512").update("final-signed-installer").digest("base64"),
		)
		assert.deepEqual(manifest.signature, {
			status: "Valid",
			subject: "CN=Cocode",
			thumbprint: "AABBCC",
		})
		assert.deepEqual(manifest.metadata, ["latest-arm64.yml"])
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects updater metadata generation without the platform update artifact", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-update-metadata-"))
	try {
		const pkg = path.join(root, "Cocode-1.2.3-arm64.pkg")
		writeFileSync(pkg, "pkg")
		assert.throws(
			() =>
				writeArchitectureUpdateMetadata({
					outDir: root,
					platform: "darwin",
					arch: "arm64",
					version: "1.2.3",
					artifacts: [pkg],
				}),
			/No ZIP update artifact/,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("writes one deterministic SHA256 manifest without duplicate artifacts", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-checksums-"))
	try {
		const zip = path.join(root, "Cocode.zip")
		const pkg = path.join(root, "Cocode.pkg")
		writeFileSync(zip, "zip")
		writeFileSync(pkg, "pkg")
		const manifest = appendChecksumManifest(root, [pkg, zip, pkg])
		assert.equal(manifest, path.join(root, "SHA256SUMS"))
		const expectedRows = [
			`${createHash("sha256").update("pkg").digest("hex")}  Cocode.pkg`,
			`${createHash("sha256").update("zip").digest("hex")}  Cocode.zip`,
		].sort()
		assert.equal(readFileSync(manifest, "utf8"), `${expectedRows.join("\n")}\n`)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("supports architecture-scoped checksum manifest names", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-checksums-"))
	try {
		const appImage = path.join(root, "Cocode-x86_64.AppImage")
		writeFileSync(appImage, "appimage")
		const manifest = appendChecksumManifest(root, [appImage], "SHA256SUMS-x64")
		assert.equal(manifest, path.join(root, "SHA256SUMS-x64"))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("finds the packaged macOS App only when the staged TUI is present", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-release-hooks-"))
	try {
		writeFixture(path.join(root, "README.md"), "not an app")
		const incompleteApp = path.join(root, "Incomplete.app")
		mkdirSync(path.join(incompleteApp, "Contents", "Resources"), { recursive: true })
		const appPath = path.join(root, "nested", "Cocode.app")
		writeFixture(path.join(appPath, "Contents", "Resources", "tui", "manifest.json"), "{}")
		assert.equal(findMacAppWithTui(root), appPath)
		assert.equal(findMacAppWithTui(path.join(root, "README.md")), undefined)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("accepts the stable Electron main and preload entrypoint names", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-builder-entrypoints-"))
	try {
		writeFixture(path.join(root, ".vite", "build", "main.mjs"), "")
		writeFixture(path.join(root, ".vite", "build", "preload.js"), "")

		assert.doesNotThrow(() => verifyBuilderApplicationEntrypoints(root))
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects the legacy electron-vite preload filename", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-builder-entrypoints-"))
	try {
		const legacyPreload = path.join(root, ".vite", "build", "index.mjs")
		const expectedPreload = path.join(root, ".vite", "build", "preload.js")
		writeFixture(path.join(root, ".vite", "build", "main.mjs"), "")
		writeFixture(legacyPreload, "")

		assert.throws(
			() => verifyBuilderApplicationEntrypoints(root),
			(error: unknown) => {
				assert.ok(error instanceof Error)
				assert.match(error.message, /wrong name/)
				assert.match(error.message, new RegExp(escapeRegExp(legacyPreload)))
				assert.match(error.message, new RegExp(escapeRegExp(expectedPreload)))
				return true
			},
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("rejects external dependencies in the sandboxed preload bundle", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-builder-entrypoints-"))
	try {
		writeFixture(path.join(root, ".vite", "build", "main.mjs"), "")
		writeFixture(
			path.join(root, ".vite", "build", "preload.js"),
			'const electron = require("electron")\nconst zod = require("zod")\n',
		)

		assert.throws(
			() => verifyBuilderApplicationEntrypoints(root),
			/Sandboxed preload bundle contains unsupported external require: zod/,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("keeps Windows Authenticode verification statements and UTF-8 certificate subjects", () => {
	const script = buildWindowsAuthenticodeVerificationScript()
	assert.match(script, /\$env:VERIFY_FILE;\s+if/)
	assert.doesNotMatch(script, /\$env:VERIFY_FILE\s+if/)
	assert.match(script, /SubjectUtf8/)
	assert.match(script, /UTF8\.GetBytes/)
})

test("verifies the staged Windows runtime and fails on a missing DSH entry", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-packaged-assets-"))
	try {
		const resources = path.join(root, "resources")
		const runtime = path.join(resources, "dsh-runtime")
		const pty = path.join(runtime, "node_modules", "node-pty", "build", "Release")
		const sqlite = path.join(resources, "app", "node_modules", "better-sqlite3", "build", "Release")
		const sharp = path.join(runtime, "node_modules", "sharp")
		const sharpNative = path.join(runtime, "node_modules", "@img", "sharp-win32-x64", "lib")
		writeFixture(path.join(resources, "cocode-node.exe"), createPeFixture())
		writeFixture(path.join(resources, "startup-failure.html"), "<html />")
		writeFixture(
			path.join(runtime, "runtime-manifest.json"),
			JSON.stringify({
				platform: "win32",
				arch: "x64",
				dsh: { entry: "node_modules/@deepseek-ai/dsh/lib/bin.js" },
			}),
		)
		writeFixture(path.join(runtime, "packages", "host-supervisor", "lib", "bin.js"), "")
		writeFixture(
			path.join(runtime, "package.json"),
			JSON.stringify({ name: "@cocode-agency/host-supervisor" }),
		)
		writeFixture(
			path.join(runtime, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
			"",
		)
		for (const packageName of ["dsh-host-webserver", "dsh-host-frontend-static"]) {
			const packageRoot = path.join(runtime, "node_modules", "@deepseek-ai", packageName)
			writeFixture(
				path.join(packageRoot, "package.json"),
				JSON.stringify({ name: `@deepseek-ai/${packageName}` }),
			)
			writeFixture(path.join(packageRoot, "lib", "index.js"), "")
		}
		for (const name of ["pty.node", "winpty-agent.exe", "conpty.node"])
			writeFixture(path.join(pty, name), createPeFixture())
		for (const name of ["conpty.dll", "OpenConsole.exe"])
			writeFixture(path.join(pty, "conpty", name), createPeFixture())
		writeFixture(
			path.join(runtime, "node_modules", "node-pty", "prebuilds", "darwin-arm64", "pty.node"),
			Buffer.from("not-a-pe"),
		)
		writeFixture(
			path.join(runtime, "node_modules", "node-pty", "prebuilds", "win32-x64", "pty.node"),
			createPeFixture(),
		)
		writeFixture(path.join(sqlite, "better_sqlite3.node"), createPeFixture())
		writeFixture(
			path.join(resources, "app", "node_modules", "better-sqlite3", "prebuilds", "darwin-arm64.node"),
			Buffer.from("not-a-pe"),
		)
		writeFixture(
			path.join(resources, "app", "node_modules", "better-sqlite3", "prebuilds", "win32-x64.node"),
			createPeFixture(),
		)
		writeFixture(path.join(sharp, "package.json"), JSON.stringify({ name: "sharp" }))
		writeFixture(path.join(sharpNative, "sharp-win32-x64.node"), createPeFixture())
		writeFixture(path.join(sharpNative, "libvips-42.dll"), createPeFixture())
		writeFixture(path.join(sharpNative, "libvips-cpp-8.18.3.dll"), createPeFixture())

		const result = verifyPackagedStartupAssets(root, { platform: "win32", arch: "x64" })
		assert.equal(result.appRoot, path.join(resources, "app"))
		assert.equal(
			result.betterSqliteNative,
			path.join(
				resources,
				"app",
				"node_modules",
				"better-sqlite3",
				"prebuilds",
				"win32-x64.node",
			),
		)
		rmSync(path.join(runtime, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"))
		assert.throws(
			() => verifyPackagedStartupAssets(root, { platform: "win32", arch: "x64" }),
			/packaged DSH Web entry is missing/,
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("copies a self-contained production dependency closure without pnpm links", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-runtime-closure-"))
	try {
		const source = path.join(root, "source")
		const appRoot = path.join(root, "app")
		writePackage(source, "cocode-gui", { dependencies: { "runtime-root": "1.0.0" } })
		writePackage(path.join(source, "node_modules", "runtime-root"), "runtime-root", {
			dependencies: { "runtime-leaf": "1.0.0" },
			exports: { ".": { import: "./index.js" } },
		})
		writePackage(path.join(source, "node_modules", "runtime-leaf"), "runtime-leaf")
		writeFixture(path.join(appRoot, ".vite", "build", "main.js"), "")

		const copied = copyProductionDependencyClosure({
			sourceRoot: source,
			appRoot,
			dependencies: ["runtime-root"],
		})

		assert.deepEqual(copied, ["runtime-root", "runtime-leaf"])
		assert.ok(existsSync(path.join(appRoot, "node_modules", "runtime-root", "package.json")))
		assert.ok(existsSync(path.join(appRoot, "node_modules", "runtime-leaf", "package.json")))
		assert.equal(
			lstatSync(path.join(appRoot, "node_modules", "runtime-root")).isSymbolicLink(),
			false,
		)
		verifyProductionDependencyClosure(appRoot, ["runtime-root"])
		assert.throws(() => verifyProductionDependencyClosure(appRoot, ["missing-runtime"]), /missing-runtime/)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("prunes Windows development files without changing macOS staging", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cocode-runtime-closure-prune-"))
  try {
    const source = path.join(root, "source")
    const winAppRoot = path.join(root, "win-app")
    const macAppRoot = path.join(root, "mac-app")
    writePackage(source, "cocode-gui", { dependencies: { "runtime-root": "1.0.0" } })
    const runtimeRoot = path.join(source, "node_modules", "runtime-root")
    writePackage(runtimeRoot, "runtime-root")
    for (const file of ["runtime.js", "debug.map", "source.ts", "symbols.pdb", "native.cpp", "project.vcxproj"])
      writeFixture(path.join(runtimeRoot, file), "")
    writeFixture(path.join(runtimeRoot, "docs", "README.md"), "")

    copyProductionDependencyClosure({
      sourceRoot: source,
      appRoot: winAppRoot,
      dependencies: ["runtime-root"],
      target: { platform: "win32", arch: "x64" },
    })
    assert.ok(existsSync(path.join(winAppRoot, "node_modules", "runtime-root", "runtime.js")))
    for (const file of ["debug.map", "source.ts", "symbols.pdb", "native.cpp", "project.vcxproj", "docs"])
      assert.equal(existsSync(path.join(winAppRoot, "node_modules", "runtime-root", file)), false, file)

    copyProductionDependencyClosure({
      sourceRoot: source,
      appRoot: macAppRoot,
      dependencies: ["runtime-root"],
      target: { platform: "darwin", arch: "arm64" },
    })
    for (const file of ["debug.map", "source.ts", "symbols.pdb", "native.cpp", "project.vcxproj", "docs", "runtime.js"])
      assert.equal(existsSync(path.join(macAppRoot, "node_modules", "runtime-root", file)), true, file)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test("keeps only the target platform and architecture native prebuild", () => {
	for (const arch of ["x64", "arm64"] as const) {
		const root = mkdtempSync(path.join(os.tmpdir(), "cocode-runtime-closure-native-"))
		try {
			const source = path.join(root, "source")
			const appRoot = path.join(root, "app")
			writePackage(source, "cocode-gui", { dependencies: { "runtime-root": "1.0.0" } })
			const runtimeRoot = path.join(source, "node_modules", "runtime-root")
			writePackage(runtimeRoot, "runtime-root")
			for (const name of [
				"darwin-arm64.node",
				"darwin-x64.node",
				"linux-x64.node",
				"win32-arm64.node",
				"win32-x64.node",
			])
				writeFixture(path.join(runtimeRoot, "prebuilds", name), "native")

			copyProductionDependencyClosure({
				sourceRoot: source,
				appRoot,
				dependencies: ["runtime-root"],
				target: { platform: "win32", arch },
			})

			const prebuilds = path.join(appRoot, "node_modules", "runtime-root", "prebuilds")
			assert.ok(existsSync(path.join(prebuilds, `win32-${arch}.node`)))
			for (const name of [
				"darwin-arm64.node",
				"darwin-x64.node",
				"linux-x64.node",
				"win32-arm64.node",
				"win32-x64.node",
			]) {
				assert.equal(name === `win32-${arch}.node`, existsSync(path.join(prebuilds, name)), name)
			}
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	}
})

test("preserves nested production dependency versions instead of flattening conflicts", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "cocode-runtime-closure-nested-"))
	try {
		const source = path.join(root, "source")
		const appRoot = path.join(root, "app")
		writePackage(source, "cocode-gui", {
			dependencies: {
				"runtime-root": "1.0.0",
				shared: "2.0.0",
			},
		})
		writePackage(path.join(source, "node_modules", "runtime-root"), "runtime-root", {
			dependencies: { shared: "1.0.0" },
		})
		writePackage(path.join(source, "node_modules", "shared"), "shared", {})
		writeFileSync(
			path.join(source, "node_modules", "shared", "package.json"),
			JSON.stringify({ name: "shared", version: "2.0.0" }),
		)
		writePackage(
			path.join(source, "node_modules", "runtime-root", "node_modules", "shared"),
			"shared",
			{},
		)
		writeFileSync(
			path.join(
				source,
				"node_modules",
				"runtime-root",
				"node_modules",
				"shared",
				"package.json",
			),
			JSON.stringify({ name: "shared", version: "1.0.0" }),
		)

		copyProductionDependencyClosure({
			sourceRoot: source,
			appRoot,
			dependencies: ["runtime-root", "shared"],
		})

		assert.ok(
			existsSync(
				path.join(appRoot, "node_modules", "runtime-root", "node_modules", "shared", "package.json"),
			),
		)
		assert.equal(
			JSON.parse(
				readFileSync(
					path.join(appRoot, "node_modules", "runtime-root", "node_modules", "shared", "package.json"),
					"utf8",
				),
			).version,
			"1.0.0",
		)
		assert.equal(
			JSON.parse(
				readFileSync(path.join(appRoot, "node_modules", "shared", "package.json"), "utf8"),
			).version,
			"2.0.0",
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

function writeFixture(file: string, contents: string | Buffer): void {
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, contents)
}

function writePackage(
	root: string,
	name: string,
	manifest: { dependencies?: Record<string, string>; exports?: unknown } = {},
): void {
	writeFixture(path.join(root, "package.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }))
	writeFixture(path.join(root, "index.js"), "module.exports = {}\n")
}

function createPeFixture(): Buffer {
	const bytes = Buffer.alloc(0x90)
	bytes.writeUInt16LE(0x5a4d, 0)
	bytes.writeUInt32LE(0x80, 0x3c)
	bytes.write("PE\0\0", 0x80, "ascii")
	bytes.writeUInt16LE(0x8664, 0x84)
	return bytes
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
