import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import * as path from "pathe"

const PE_MACHINES = new Map([
	[0x8664, "x86_64"],
	[0xaa64, "arm64"],
])
const ELF_MACHINES = new Map([
	[0x3e, "x86_64"],
	[0xb7, "arm64"],
])
const MACHO_CPUS = new Map([
	[0x01000007, "x86_64"],
	[0x0100000c, "arm64"],
])

export function inspectNativeBinary(file) {
	const bytes = Buffer.isBuffer(file) ? file : readFileSync(file)
	if (bytes.length >= 2 && bytes.readUInt16LE(0) === 0x5a4d) return inspectPe(bytes)
	if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "\x7fELF") return inspectElf(bytes)
	if (bytes.length >= 4) {
		const little = bytes.readUInt32LE(0)
		const big = bytes.readUInt32BE(0)
		if ([0xfeedface, 0xfeedfacf].includes(little)) return inspectThinMacho(bytes, true)
		if ([0xfeedface, 0xfeedfacf].includes(big)) return inspectThinMacho(bytes, false)
		if ([0xcafebabe, 0xcafebabf].includes(big))
			return inspectFatMacho(bytes, true, big === 0xcafebabf)
		if ([0xcafebabe, 0xcafebabf].includes(little))
			return inspectFatMacho(bytes, false, little === 0xcafebabf)
	}
	return { format: "unknown", architectures: [] }
}

export function assertNativeBinaryArchitecture(file, { platform, arch }) {
	const inspected = inspectNativeBinary(file)
	const expectedFormat =
		platform === "win32"
			? "pe"
			: platform === "darwin"
			? "macho"
			: platform === "linux"
			? "elf"
			: undefined
	const expectedArchitecture = arch === "x64" ? "x86_64" : arch
	if (!expectedFormat) throw new Error(`Unsupported native inspection platform: ${platform}`)
	if (inspected.format !== expectedFormat)
		throw new Error(
			`Native runtime file format mismatch for ${platform}/${arch}: expected ${expectedFormat}, got ${inspected.format}`,
		)
	if (!inspected.architectures.includes(expectedArchitecture))
		throw new Error(
			`Native runtime file architecture mismatch for ${platform}/${arch}: ${describeFile(
				file,
			)} has ${inspected.architectures.join(", ") || "none"}`,
		)
	return inspected
}

export function collectRuntimeNativeInventory(root, { platform, arch }) {
	validateSharpNativeClosure(root, platform, arch)
	const packages = collectPackageManifests(root)
	const inventory = []
	for (const file of collectNativeFiles(path.join(root, "node_modules"))) {
		const packageRecord = findOwningPackage(file, root, packages)
		if (!packageRecord) continue
		let inspected
		try {
			inspected = assertNativeBinaryArchitecture(file, { platform, arch })
		} catch (error) {
			throw new Error(
				`Native inventory validation failed for ${packageRecord.name}@${
					packageRecord.version
				} at ${path.relative(root, file)} on ${platform}/${arch}: ${error.message}`,
				{ cause: error },
			)
		}
		inventory.push({
			packagePath: packageRecord.relativePath,
			packageName: packageRecord.name,
			packageVersion: packageRecord.version,
			file: path.relative(packageRecord.root, file),
			format: inspected.format,
			architectures: inspected.architectures,
			role: nativeRole(packageRecord.name, path.basename(file)),
		})
	}
	return inventory.sort((left, right) =>
		`${left.packagePath}/${left.file}`.localeCompare(`${right.packagePath}/${right.file}`),
	)
}

function inspectPe(bytes) {
	if (bytes.length < 0x46) return { format: "unknown", architectures: [] }
	const peOffset = bytes.readUInt32LE(0x3c)
	if (peOffset + 6 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0")
		return { format: "unknown", architectures: [] }
	const architecture = PE_MACHINES.get(bytes.readUInt16LE(peOffset + 4))
	return { format: "pe", architectures: architecture ? [architecture] : [] }
}

function inspectElf(bytes) {
	const architecture = ELF_MACHINES.get(bytes.readUInt16LE(18))
	return { format: "elf", architectures: architecture ? [architecture] : [] }
}

function inspectThinMacho(bytes, littleEndian) {
	const cputype = littleEndian ? bytes.readInt32LE(4) : bytes.readInt32BE(4)
	const architecture = MACHO_CPUS.get(cputype)
	return { format: "macho", architectures: architecture ? [architecture] : [] }
}

function inspectFatMacho(bytes, bigEndian, is64 = false) {
	const read = (offset) => (bigEndian ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset))
	const count = read(4)
	const architectures = []
	const entrySize = is64 ? 32 : 20
	for (let index = 0; index < count; index += 1) {
		const offset = 8 + index * entrySize
		if (offset + 4 > bytes.length) break
		const architecture = MACHO_CPUS.get(readSigned(bytes, offset, bigEndian))
		if (architecture && !architectures.includes(architecture)) architectures.push(architecture)
	}
	return { format: "macho", architectures }
}

function readSigned(bytes, offset, bigEndian) {
	return bigEndian ? bytes.readInt32BE(offset) : bytes.readInt32LE(offset)
}

function collectNativeFiles(root, files = []) {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) return files
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const file = path.join(root, entry.name)
		if (entry.isSymbolicLink()) continue
		if (entry.isDirectory()) {
			collectNativeFiles(file, files)
			continue
		}
		const nativeExtension = /\.(?:node|dll|dylib|so|exe)(?:\.\d+)*$/i.test(entry.name)
		const knownExecutable =
			/^(?:spawn-helper|rg|landlock(?:-run)?|node-addon-landlock-run)$/i.test(entry.name)
		const extensionlessLibvips =
			!path.extname(entry.name) && /^libvips(?:[-.]|$)/i.test(entry.name)
		if (nativeExtension || knownExecutable || extensionlessLibvips) files.push(file)
	}
	return files
}

function collectPackageManifests(root, current = path.join(root, "node_modules"), result = []) {
	if (!existsSync(current) || !lstatSync(current).isDirectory()) return result
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue
		const packageRoot = path.join(current, entry.name)
		if (entry.name.startsWith("@")) {
			collectPackageManifests(root, packageRoot, result)
			continue
		}
		const manifestPath = path.join(packageRoot, "package.json")
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
			if (typeof manifest.name === "string")
				result.push({
					root: packageRoot,
					relativePath: path.relative(root, packageRoot),
					name: manifest.name,
					version: String(manifest.version ?? "unknown"),
					manifest,
				})
		}
		collectPackageManifests(root, path.join(packageRoot, "node_modules"), result)
	}
	return result
}

function findOwningPackage(file, root, packages) {
	let current = path.dirname(file)
	while (current.startsWith(root) && current !== root) {
		const match = packages.find((entry) => entry.root === current)
		if (match) return match
		current = path.dirname(current)
	}
	return undefined
}

function nativeRole(packageName, basename) {
	if (packageName === "node-pty") {
		if (basename === "pty.node") return "node-pty-pty"
		if (basename === "spawn-helper") return "node-pty-spawn-helper"
		if (basename === "conpty_console_list.node") return "node-pty-conpty-console-list"
		if (basename === "conpty.node") return "node-pty-conpty"
		return "node-pty-native"
	}
	if (packageName.startsWith("@img/sharp-libvips-")) return "sharp-libvips"
	if (packageName === "sharp" || packageName.startsWith("@img/sharp-")) return "sharp-addon"
	return "native"
}

function validateSharpNativeClosure(root, platform, arch) {
	const packages = collectPackageManifests(root)
	const sharpPackages = packages.filter((entry) => entry.name === "sharp")
	if (sharpPackages.length === 0) return
	const markers = [`${platform}-${arch}`, ...(platform === "linux" ? [`linuxmusl-${arch}`] : [])]
	for (const sharp of sharpPackages) {
		const dependencies = {
			...(sharp.manifest.dependencies ?? {}),
			...(sharp.manifest.optionalDependencies ?? {}),
		}
		const targetName = Object.keys(dependencies).find(
			(name) =>
				name.startsWith("@img/sharp-") &&
				markers.includes(name.slice("@img/sharp-".length)),
		)
		const libvipsName = Object.keys(dependencies).find(
			(name) =>
				name.startsWith("@img/sharp-libvips-") &&
				markers.includes(name.slice("@img/sharp-libvips-".length)),
		)
		const target = targetName ? resolveManifestPackage(sharp.root, targetName) : undefined
		const libvips = libvipsName ? resolveManifestPackage(sharp.root, libvipsName) : undefined
		if (!target || !isCompatible(target.manifest, platform, arch))
			throw new Error(
				`sharp target native package is missing or incompatible for ${platform}/${arch}: ${sharp.root}`,
			)
		if (!libvips || !isCompatible(libvips.manifest, platform, arch))
			throw new Error(
				`sharp libvips native package is missing or incompatible for ${platform}/${arch}: ${sharp.root}`,
			)
		if (!collectNativeFiles(target.root).some((file) => file.endsWith(".node")))
			throw new Error(`sharp native addon is missing for ${platform}/${arch}: ${target.root}`)
		if (!collectNativeFiles(libvips.root).some((file) => /libvips/i.test(path.basename(file))))
			throw new Error(
				`sharp libvips library is missing for ${platform}/${arch}: ${libvips.root}`,
			)
	}
}

function resolveManifestPackage(fromRoot, name) {
	const require = createRequire(path.join(fromRoot, "package.json"))
	for (const searchPath of require.resolve.paths(name) ?? []) {
		const candidate = path.join(searchPath, ...name.split("/"))
		const manifestPath = path.join(candidate, "package.json")
		if (!existsSync(manifestPath)) continue
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		if (manifest.name === name)
			return {
				root: candidate,
				relativePath: "",
				name,
				version: String(manifest.version ?? "unknown"),
				manifest,
			}
	}
	return undefined
}

function isCompatible(manifest, platform, arch) {
	return matches(manifest.os, platform) && matches(manifest.cpu, arch)
}

function matches(value, target) {
	if (value === undefined) return true
	const values = Array.isArray(value) ? value.map(String) : [String(value)]
	if (values.includes(`!${target}`)) return false
	const positive = values.filter((entry) => !entry.startsWith("!"))
	return positive.length === 0 || positive.includes(target)
}

function describeFile(file) {
	return Buffer.isBuffer(file) ? "<buffer>" : file
}
