import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import {
	alphaBounds,
	compositeRgba,
	cropRgbaImage,
	decodeRgbaPng,
	encodeRgbaPng,
	makeSolidRgbaImage,
	resizeRgbaImage,
} from "./png-rgba.mjs"

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..")
export const ICON_ROOT = path.join(PROJECT_ROOT, "resources", "icons")
export const SOURCE_PATH = path.join(ICON_ROOT, "source", "cocode-mark.png")
export const GENERATED_ROOT = path.join(ICON_ROOT, "generated", "macos")
export const ICNS_PATH = path.join(ICON_ROOT, "cocode.icns")
export const DOCK_PATH = path.join(ICON_ROOT, "cocode-dock.png")
export const LEGACY_DOCK_ALIAS_PATH = path.join(ICON_ROOT, "cocode.png")

export const MAC_ICONSET_ENTRIES = Object.freeze([
	["icon_16x16.png", 16],
	["icon_16x16@2x.png", 32],
	["icon_32x32.png", 32],
	["icon_32x32@2x.png", 64],
	["icon_128x128.png", 128],
	["icon_128x128@2x.png", 256],
	["icon_256x256.png", 256],
	["icon_256x256@2x.png", 512],
	["icon_512x512.png", 512],
	["icon_512x512@2x.png", 1024],
])

export function validateCanonicalSource(image) {
	if (!image || image.width !== 1024 || image.height !== 1024) {
		throw new Error("Canonical icon source must be exactly 1024 x 1024 pixels.")
	}
	if (image.bitDepth !== 8 || image.colorType !== 6) {
		throw new Error("Canonical icon source must be an 8-bit RGBA PNG.")
	}
	const bounds = alphaBounds(image)
	if (!bounds) throw new Error("Canonical icon source must contain a visible mark.")
	if (bounds.left === 0 || bounds.top === 0 || bounds.right === 1023 || bounds.bottom === 1023) {
		throw new Error("Canonical icon source must keep transparent pixels around the mark.")
	}
	return bounds
}

export function makeDockImage(
	mark,
	{
		canvas = 512,
		contentScale = 0.82,
		backgroundColor = undefined,
		backgroundCornerRadius = Math.round(canvas * 0.22),
	} = {},
) {
	if (!Number.isInteger(canvas) || canvas < 1)
		throw new Error("Dock canvas must be a positive integer.")
	if (!(contentScale > 0 && contentScale <= 1))
		throw new Error("Dock contentScale must be in (0, 1].")
	if (backgroundColor && backgroundColor.length !== 3)
		throw new Error("Dock backgroundColor must contain exactly three channels.")
	if (
		!Number.isInteger(backgroundCornerRadius) ||
		backgroundCornerRadius < 0 ||
		backgroundCornerRadius > canvas / 2
	)
		throw new Error("Dock backgroundCornerRadius must be within the canvas bounds.")
	const cropped = cropRgbaImage(mark)
	const target = Math.max(1, Math.round(canvas * contentScale))
	const scale = Math.min(target / cropped.width, target / cropped.height)
	const resized = resizeRgbaImage(
		cropped,
		Math.max(1, Math.round(cropped.width * scale)),
		Math.max(1, Math.round(cropped.height * scale)),
	)
	const foreground = makeSolidRgbaImage(canvas, canvas, [0, 0, 0, 0])
	const left = Math.floor((canvas - resized.width) / 2)
	const top = Math.floor((canvas - resized.height) / 2)
	for (let y = 0; y < resized.height; y += 1) {
		for (let x = 0; x < resized.width; x += 1) {
			const sourceOffset = (y * resized.width + x) * 4
			const destinationX = left + x
			const destinationY = top + y
			if (
				destinationX < 0 ||
				destinationY < 0 ||
				destinationX >= canvas ||
				destinationY >= canvas
			)
				continue
			const destinationOffset = (destinationY * canvas + destinationX) * 4
			foreground.data.set(
				resized.data.subarray(sourceOffset, sourceOffset + 4),
				destinationOffset,
			)
		}
	}
	if (!backgroundColor) return foreground
	const background = makeRoundedBackground(canvas, backgroundColor, backgroundCornerRadius)
	return compositeRgba(background, foreground)
}

function makeRoundedBackground(canvas, [red, green, blue], cornerRadius) {
	const background = makeSolidRgbaImage(canvas, canvas, [red, green, blue, 0])
	const right = canvas - 1
	const bottom = canvas - 1
	for (let y = 0; y < canvas; y += 1) {
		for (let x = 0; x < canvas; x += 1) {
			const inMiddleX = x >= cornerRadius && x <= right - cornerRadius
			const inMiddleY = y >= cornerRadius && y <= bottom - cornerRadius
			let coverage = 1
			if (!inMiddleX && !inMiddleY) {
				const cornerCenterX = x < cornerRadius ? cornerRadius : right - cornerRadius
				const cornerCenterY = y < cornerRadius ? cornerRadius : bottom - cornerRadius
				const distance = Math.hypot(x + 0.5 - cornerCenterX, y + 0.5 - cornerCenterY)
				coverage = Math.max(0, Math.min(1, cornerRadius + 0.5 - distance))
			}
			background.data[(y * canvas + x) * 4 + 3] = Math.round(coverage * 255)
		}
	}
	return background
}

export function macIconsetEntries() {
	return MAC_ICONSET_ENTRIES.map(([name, size]) => [name, size])
}

export async function bootstrapCanonicalSource(inputPath, { force = false } = {}) {
	const destination = SOURCE_PATH
	if (existsSync(destination) && !force) {
		throw new Error(
			`Canonical icon source already exists: ${destination}; pass --force to replace it.`,
		)
	}
	const legacy = decodeRgbaPng(await fs.readFile(path.resolve(inputPath)))
	if (legacy.width !== 512 || legacy.height !== 512) {
		throw new Error("Legacy icon source must be exactly 512 x 512 pixels.")
	}
	const extracted = makeSolidRgbaImage(legacy.width, legacy.height, [255, 255, 255, 0])
	for (let offset = 0; offset < legacy.data.length; offset += 4) {
		const red = legacy.data[offset]
		const green = legacy.data[offset + 1]
		const blue = legacy.data[offset + 2]
		const luminance = Math.max(red, green, blue)
		const alpha = Math.max(0, Math.min(255, Math.round(((luminance - 32) * 255) / 220)))
		extracted.data[offset] = 255
		extracted.data[offset + 1] = 255
		extracted.data[offset + 2] = 255
		extracted.data[offset + 3] = alpha
	}
	const bounds = alphaBounds(extracted)
	if (!bounds) throw new Error("Legacy icon did not contain a bright foreground mark.")
	const source = resizeRgbaImage(extracted, 1024, 1024)
	validateCanonicalSource(source)
	await fs.mkdir(path.dirname(destination), { recursive: true })
	await fs.writeFile(destination, encodeRgbaPng(source))
	return destination
}

export async function generateMacIcons({ verifyIconComposer = false } = {}) {
	const source = decodeRgbaPng(await fs.readFile(SOURCE_PATH))
	validateCanonicalSource(source)
	await fs.mkdir(GENERATED_ROOT, { recursive: true })

	const background = makeSolidRgbaImage(1024, 1024, [17, 17, 19, 255])
	const flattened = compositeRgba(background, source)
	const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cocode-mac-icons-"))
	const temporaryIconset = path.join(temporaryRoot, "Cocode.iconset")
	const generatedIconset = path.join(GENERATED_ROOT, "Cocode.iconset")
	try {
		await fs.mkdir(temporaryIconset, { recursive: true })
		for (const [name, size] of MAC_ICONSET_ENTRIES) {
			const resized = resizeRgbaImage(flattened, size, size)
			await fs.writeFile(path.join(temporaryIconset, name), encodeRgbaPng(resized))
		}
		await replaceDirectory(generatedIconset, temporaryIconset)

		const composerDirectory = path.join(GENERATED_ROOT, "Cocode.icon")
		await writeIconComposerDocument(composerDirectory, source)
		await fs.writeFile(
			path.join(GENERATED_ROOT, "cocode-flat-1024.png"),
			encodeRgbaPng(flattened),
		)

		const temporaryIcns = path.join(temporaryRoot, "cocode.icns")
		await writeIcnsFromIconset(temporaryIconset, temporaryIcns)
		await atomicWrite(ICNS_PATH, await fs.readFile(temporaryIcns))
		await verifyIcnsWithIconUtil(ICNS_PATH, temporaryRoot)

		const dock = makeDockImage(source, {
			contentScale: 0.6,
			backgroundColor: [17, 17, 19],
		})
		const dockBytes = encodeRgbaPng(dock)
		await atomicWrite(DOCK_PATH, dockBytes)
		await atomicWrite(LEGACY_DOCK_ALIAS_PATH, dockBytes)

		const composerValid = await verifyIconComposerDocument(composerDirectory)
		if (verifyIconComposer && !composerValid) {
			throw new Error(
				"Icon Composer validation was requested but ictool could not render the document.",
			)
		}
		return {
			source: SOURCE_PATH,
			iconComposer: composerDirectory,
			iconset: generatedIconset,
			icns: ICNS_PATH,
			dock: DOCK_PATH,
			composerValid,
		}
	} finally {
		await fs.rm(temporaryRoot, { recursive: true, force: true })
	}
}

async function writeIconComposerDocument(destination, source) {
	const assetsDirectory = path.join(destination, "Assets")
	await fs.rm(destination, { recursive: true, force: true })
	await fs.mkdir(assetsDirectory, { recursive: true })
	const background = makeSolidRgbaImage(1024, 1024, [17, 17, 19, 255])
	await fs.writeFile(
		path.join(assetsDirectory, "background.svg"),
		pngAsSvg(encodeRgbaPng(background)),
	)
	await fs.writeFile(
		path.join(assetsDirectory, "foreground.svg"),
		pngAsSvg(encodeRgbaPng(source)),
	)
	const manifest = {
		fill: { solid: "extended-srgb:0.06667,0.06667,0.07451,1.00000" },
		groups: [
			{
				layers: [
					{
						name: "Background",
						"image-name": "background.svg",
						glass: false,
						hidden: false,
						position: { scale: 1, "translation-in-points": [0, 0] },
					},
					{
						name: "Foreground",
						"image-name": "foreground.svg",
						glass: false,
						hidden: false,
						position: { scale: 1, "translation-in-points": [0, 0] },
					},
				],
				shadow: { kind: "layer-color", opacity: 0 },
				specular: false,
				translucency: { enabled: false, value: 0 },
			},
		],
		"supported-platforms": { circles: ["watchOS"], squares: "shared" },
	}
	await fs.writeFile(
		path.join(destination, "icon.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	)
}

async function verifyIconComposerDocument(documentPath) {
	const ictool = resolveIcTool()
	if (!ictool) {
		console.warn("Icon Composer ictool is unavailable; skipping .icon render verification.")
		return false
	}
	const previewPath = path.join(os.tmpdir(), `cocode-icon-composer-${process.pid}.png`)
	try {
		execFileSync(
			ictool,
			[
				documentPath,
				"--export-image",
				"--output-file",
				previewPath,
				"--platform",
				"macOS",
				"--rendition",
				"Default",
				"--width",
				"1024",
				"--height",
				"1024",
				"--scale",
				"1",
			],
			{ stdio: "pipe" },
		)
		const preview = decodeRgbaPng(await fs.readFile(previewPath))
		return preview.width === 1024 && preview.height === 1024
	} catch (error) {
		console.warn(
			`Icon Composer render verification failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
		return false
	} finally {
		await fs.rm(previewPath, { force: true })
	}
}

async function writeIcnsFromIconset(iconsetPath, outputPath) {
	const entries = [
		["icp4", "icon_16x16.png"],
		["ic11", "icon_16x16@2x.png"],
		["icp5", "icon_32x32.png"],
		["ic12", "icon_32x32@2x.png"],
		["ic07", "icon_128x128.png"],
		["ic13", "icon_128x128@2x.png"],
		["ic08", "icon_256x256.png"],
		["ic14", "icon_256x256@2x.png"],
		["ic09", "icon_512x512.png"],
		["ic10", "icon_512x512@2x.png"],
	]
	const chunks = []
	for (const [type, filename] of entries) {
		const data = await fs.readFile(path.join(iconsetPath, filename))
		const header = Buffer.alloc(8)
		header.write(type, 0, 4, "ascii")
		header.writeUInt32BE(data.length + 8, 4)
		chunks.push(header, data)
	}
	const totalLength = 8 + chunks.reduce((length, chunk) => length + chunk.length, 0)
	const header = Buffer.alloc(8)
	header.write("icns", 0, 4, "ascii")
	header.writeUInt32BE(totalLength, 4)
	await fs.writeFile(outputPath, Buffer.concat([header, ...chunks]))
}

async function verifyIcnsWithIconUtil(icnsPath, temporaryRoot) {
	const iconutil = resolveBinary("iconutil", "/usr/bin/iconutil")
	if (!iconutil) throw new Error("macOS iconutil is required to validate the ICNS output.")
	const extracted = path.join(temporaryRoot, "verified.iconset")
	execFileSync(iconutil, ["-c", "iconset", icnsPath, "-o", extracted], { stdio: "pipe" })
	const files = (await fs.readdir(extracted)).filter((name) => name.endsWith(".png")).sort()
	const expected = MAC_ICONSET_ENTRIES.map(([name]) => name).sort()
	if (JSON.stringify(files) !== JSON.stringify(expected)) {
		throw new Error(`ICNS validation returned an unexpected iconset: ${files.join(", ")}`)
	}
}

function resolveIcTool() {
	const candidates = [
		process.env.ICON_COMPOSER_ICTOOL,
		"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool",
	]
	return candidates.find((candidate) => candidate && existsSync(candidate))
}

function resolveBinary(name, fallback) {
	if (fallback && existsSync(fallback)) return fallback
	try {
		return execFileSync("xcrun", ["--find", name], { encoding: "utf8" }).trim() || undefined
	} catch {
		return undefined
	}
}

function pngAsSvg(png) {
	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024"><image width="1024" height="1024" preserveAspectRatio="none" href="data:image/png;base64,${png.toString(
		"base64",
	)}" xlink:href="data:image/png;base64,${png.toString("base64")}" /></svg>\n`
}

async function atomicWrite(destination, bytes) {
	const temporary = `${destination}.tmp-${process.pid}`
	await fs.mkdir(path.dirname(destination), { recursive: true })
	await fs.writeFile(temporary, bytes)
	await fs.rename(temporary, destination)
}

async function replaceDirectory(destination, source) {
	const temporaryDestination = `${destination}.tmp-${process.pid}`
	await fs.rm(temporaryDestination, { recursive: true, force: true })
	await fs.cp(source, temporaryDestination, { recursive: true })
	await fs.rm(destination, { recursive: true, force: true })
	await fs.rename(temporaryDestination, destination)
}

function parseArguments(argumentsList) {
	const options = { bootstrapSource: undefined, force: false, verifyIconComposer: false }
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index]
		if (argument === "--") continue
		if (argument === "--bootstrap-source") options.bootstrapSource = argumentsList[++index]
		else if (argument === "--force") options.force = true
		else if (argument === "--verify-icon-composer") options.verifyIconComposer = true
		else if (argument === "--help") return { help: true }
		else throw new Error(`Unknown argument: ${argument}`)
	}
	return options
}

async function main() {
	const options = parseArguments(process.argv.slice(2))
	if (options.help) {
		console.log(
			"Usage: node scripts/icons/generate-macos-icons.mjs [--bootstrap-source <png> --force] [--verify-icon-composer]",
		)
		return
	}
	if (options.bootstrapSource) {
		console.log(
			`Canonical icon source written to ${await bootstrapCanonicalSource(
				options.bootstrapSource,
				options,
			)}`,
		)
		return
	}
	if (process.platform !== "darwin") {
		console.log(`Skipping macOS icon generation on ${process.platform}.`)
		return
	}
	const result = await generateMacIcons(options)
	console.log(`Generated macOS icon assets: ${JSON.stringify(result)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
