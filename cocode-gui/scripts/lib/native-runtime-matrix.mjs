/**
 * Native package contract shared by runtime verification and release tooling.
 *
 * The matrix describes package identities, target variants, and the owning
 * execution boundary. It intentionally keeps the two node-pty copies as one
 * package family; their destination/lineage is resolved by the runtime
 * closure and ownership is derived from the staged package path.
 */

const SUPPORTED_PLATFORMS = new Set(["darwin", "linux", "win32"])
const SUPPORTED_ARCHES = new Set(["x64", "arm64"])

export function resolveNativeRuntimeMatrix({ platform, arch } = {}) {
	assertTarget(platform, arch)
	const abi = platform === "darwin" ? undefined : platform === "linux" ? "gnu" : "msvc"
	const entries = [
		entry({
			packageName: "better-sqlite3",
			platform,
			arch,
			scope: "gui-main",
			owners: ["GUI Main"],
			role: "better-sqlite3",
			files: ["*.node"],
		}),
		entry({
			packageName: "node-pty",
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["Cocode Workbench", "Host Supervisor"],
			role: "node-pty",
			files: ["pty.node", "spawn-helper"],
		}),
		entry({
			packageName: "sharp",
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH attachment"],
			role: "sharp",
			files: ["*.node"],
		}),
		entry({
			packageName: `@img/sharp-${platform}-${arch}`,
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH attachment"],
			role: "sharp-addon",
			files: ["*.node"],
		}),
		...(platform === "win32"
			? []
			: [
					entry({
						packageName: `@img/sharp-libvips-${platform}-${arch}`,
						platform,
						arch,
						scope: "dsh-runtime",
						owners: ["DSH attachment"],
						role: "sharp-libvips",
						files: ["libvips native library"],
					}),
			  ]),
		entry({
			packageName: "koffi",
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH subprocess"],
			role: "koffi-loader",
			files: ["*.js"],
		}),
		entry({
			packageName: `@koromix/koffi-${platform}-${arch}`,
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH subprocess"],
			role: "koffi-native",
			files: ["*.node"],
		}),
		entry({
			packageName: "node-addon-require-builtin",
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH loader"],
			role: "node-addon-require-builtin-loader",
			files: ["*.js"],
		}),
		entry({
			packageName: `node-addon-require-builtin-${platform}-${arch}${abi ? `-${abi}` : ""}`,
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH loader"],
			role: "node-addon-require-builtin-native",
			files: ["*.node"],
		}),
		entry({
			packageName: "@vscode/ripgrep",
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH file search"],
			role: "ripgrep-loader",
			files: ["bin/rg", "bin/rg.exe"],
		}),
		entry({
			packageName: `@vscode/ripgrep-${platform}-${arch}`,
			platform,
			arch,
			scope: "dsh-runtime",
			owners: ["DSH file search"],
			role: "ripgrep-native",
			files: [platform === "win32" ? "bin/rg.exe" : "bin/rg"],
		}),
	]
	if (platform === "linux") {
		entries.push(
			entry({
				packageName: `@deepseek-ai/node-addon-landlock-run-linux-${arch}`,
				platform,
				arch,
				scope: "dsh-runtime",
				owners: ["DSH sandbox"],
				role: "landlock-native",
				files: ["native executable"],
			}),
		)
	}
	return entries
}

export function getNativePackageOwnership({ packageName, packagePath = "" } = {}) {
	if (packageName === "better-sqlite3") return ["GUI Main"]
	if (packageName === "node-pty") {
		const normalizedPath = String(packagePath).replaceAll("\\", "/")
		const nodeModulesSegments = normalizedPath.match(/(?:^|\/)node_modules(?:\/|$)/g) ?? []
		if (nodeModulesSegments.length >= 2 && /(?:^|\/)node-pty(?:\/|$)/.test(normalizedPath))
			return ["DSH subprocess"]
		if (
			/\/node_modules\/node-pty(?:\/|$)/.test(normalizedPath) ||
			normalizedPath === "node_modules/node-pty"
		)
			return ["Cocode Workbench", "Host Supervisor"]
		return ["DSH subprocess"]
	}
	if (packageName === "sharp" || packageName.startsWith("@img/sharp-")) return ["DSH attachment"]
	if (packageName === "koffi" || packageName.startsWith("@koromix/koffi-"))
		return ["DSH subprocess"]
	if (
		packageName === "node-addon-require-builtin" ||
		packageName.startsWith("node-addon-require-builtin-")
	)
		return ["DSH loader"]
	if (packageName === "@vscode/ripgrep" || packageName.startsWith("@vscode/ripgrep-"))
		return ["DSH file search"]
	if (
		packageName === "@deepseek-ai/node-addon-landlock-run" ||
		packageName.startsWith("@deepseek-ai/node-addon-landlock-run-linux-")
	)
		return ["DSH sandbox"]
	return []
}

export function getNativePackageRole({ packageName, file = "" } = {}) {
	const basename = String(file).replaceAll("\\", "/").split("/").pop() ?? ""
	if (packageName === "node-pty") {
		if (basename === "pty.node") return "node-pty-pty"
		if (basename === "spawn-helper") return "node-pty-spawn-helper"
		if (basename === "conpty_console_list.node") return "node-pty-conpty-console-list"
		if (basename === "conpty.node") return "node-pty-conpty"
		return "node-pty-native"
	}
	if (packageName.startsWith("@img/sharp-libvips-")) return "sharp-libvips"
	if (packageName === "sharp" || packageName.startsWith("@img/sharp-")) return "sharp-addon"
	if (packageName === "koffi" || packageName.startsWith("@koromix/koffi-")) return "koffi"
	if (
		packageName === "node-addon-require-builtin" ||
		packageName.startsWith("node-addon-require-builtin-")
	)
		return "node-addon-require-builtin"
	if (packageName === "@vscode/ripgrep" || packageName.startsWith("@vscode/ripgrep-"))
		return "ripgrep"
	if (packageName.startsWith("@deepseek-ai/node-addon-landlock-run")) return "landlock"
	return "native"
}

function entry(value) {
	return Object.freeze({
		...value,
		owners: Object.freeze([...value.owners]),
		files: Object.freeze([...value.files]),
		required: value.required ?? true,
	})
}

function assertTarget(platform, arch) {
	if (!SUPPORTED_PLATFORMS.has(platform))
		throw new Error(`Unsupported native runtime platform: ${platform}`)
	if (!SUPPORTED_ARCHES.has(arch))
		throw new Error(`Unsupported native runtime architecture: ${arch}`)
}
