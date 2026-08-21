import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const CROSS_COMPILE_OVERRIDE_KEYS = [
	"npm_config_arch",
	"npm_config_platform",
	"npm_config_target_arch",
	"npm_config_target_platform",
	"ELECTRON_BUILDER_ARCH",
	"ELECTRON_BUILDER_PLATFORM",
]

const LINUX_MACHINE_ARCHITECTURES = {
	x64: new Set(["x86_64", "amd64"]),
	arm64: new Set(["aarch64", "arm64"]),
}

export function assertNativeReleaseHost({
	targetPlatform,
	targetArch,
	platform = process.platform,
	arch = process.arch,
	machine = readMachine(),
	environment = process.env,
} = {}) {
	if (targetPlatform !== platform) {
		throw new Error(
			`Release builds must run on ${targetPlatform}; current host is ${platform}.`,
		)
	}
	if (targetArch !== arch) {
		throw new Error(
			`Release builds must run on native ${targetArch}; current process is ${arch}.`,
		)
	}
	for (const key of CROSS_COMPILE_OVERRIDE_KEYS) {
		const value = environment?.[key]?.trim?.()
		if (value) {
			throw new Error(
				`Cross-compilation override ${key}=${value} is not allowed for native release builds.`,
			)
		}
	}
	if (platform === "linux") {
		const normalizedMachine = String(machine).trim().toLowerCase()
		const accepted = LINUX_MACHINE_ARCHITECTURES[targetArch]
		if (!accepted?.has(normalizedMachine)) {
			throw new Error(
				`uname -m reported ${normalizedMachine || "an empty value"}; expected a native ${targetArch} Linux host.`,
			)
		}
	}
	return { platform, arch, machine: String(machine).trim() }
}

export function readMachine() {
	return execFileSync("uname", ["-m"], { encoding: "utf8" }).trim()
}

const invokedPath = process.argv[1]
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
	const platform = option("--platform")
	const arch = option("--arch")
	if (!platform || !arch) {
		throw new Error(
			"Usage: node scripts/release/assert-native-release-host.mjs --platform <platform> --arch <arch>",
		)
	}
	assertNativeReleaseHost({ targetPlatform: platform, targetArch: arch })
}

function option(name) {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}
