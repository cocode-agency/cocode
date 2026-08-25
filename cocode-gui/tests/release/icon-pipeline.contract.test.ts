import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import path from "node:path"
import {
	alphaBounds,
	makeSolidRgbaImage,
	resizeRgbaImage,
} from "../../scripts/icons/png-rgba.mjs"
import {
	MAC_ICONSET_ENTRIES,
	DOCK_PATH,
	GENERATED_ROOT,
	SOURCE_PATH,
	makeDockImage,
	validateCanonicalSource,
} from "../../scripts/icons/generate-macos-icons.mjs"
import { decodeRgbaPng } from "../../scripts/icons/png-rgba.mjs"

test("rejects a canonical source that is not 1024 x 1024 RGBA", () => {
	assert.throws(
		() => validateCanonicalSource({ width: 512, height: 512, colorType: 6, data: new Uint8Array(4) }),
		/1024/,
	)
})

test("builds the expected ten macOS iconset representations", () => {
	assert.deepEqual(MAC_ICONSET_ENTRIES, [
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
})

test("keeps the Dock artwork inside the configured safety region", () => {
	const source = makeSolidRgbaImage(32, 32, [255, 255, 255, 255])
	const image = makeDockImage(source, { canvas: 512, contentScale: 0.82 })
	const bounds = alphaBounds(image)
	assert.deepEqual(bounds, { left: 46, top: 46, right: 465, bottom: 465 })
})

test("resizing keeps RGBA image metadata and data length consistent", () => {
	const source = makeSolidRgbaImage(2, 2, [255, 255, 255, 255])
	const resized = resizeRgbaImage(source, 8, 4)
	assert.equal(resized.width, 8)
	assert.equal(resized.height, 4)
	assert.equal(resized.data.length, 8 * 4 * 4)
})

test("generated canonical source and Dock asset satisfy their pixel contracts", () => {
	const source = decodeRgbaPng(readFileSync(SOURCE_PATH))
	const dock = decodeRgbaPng(readFileSync(DOCK_PATH))
	assert.deepEqual(source && { width: source.width, height: source.height }, { width: 1024, height: 1024 })
	assert.deepEqual(dock && { width: dock.width, height: dock.height }, { width: 512, height: 512 })
	validateCanonicalSource(source)
	const dockBounds = alphaBounds(dock)
	assert.ok(dockBounds)
	assert.ok(dockBounds.left >= 40 && dockBounds.top >= 40)
	assert.ok(dockBounds.right <= 471 && dockBounds.bottom <= 471)
})

test("flattened macOS artwork has opaque square corners without a baked rounded mask", () => {
	const flat = decodeRgbaPng(readFileSync(path.join(GENERATED_ROOT, "cocode-flat-1024.png")))
	for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) {
		const offset = (y * flat.width + x) * 4
		assert.equal(flat.data[offset + 3], 255)
	}
})

test("runtime and Builder keep stable generated icon paths", () => {
	const runtimeSource = readFileSync(path.resolve("src/main/shell/windows/app-icon.ts"), "utf8")
	const builderSource = readFileSync(path.resolve("electron-builder.config.ts"), "utf8")
	assert.match(runtimeSource, /cocode-dock\.png/)
	assert.match(builderSource, /cocode\.icns/)
})
