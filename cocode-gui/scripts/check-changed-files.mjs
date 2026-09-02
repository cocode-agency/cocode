import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)))
const guiRoot = resolve(scriptDirectory, "..")
const repositoryRoot = resolve(guiRoot, "..")
const mode = process.argv[2]

if (mode !== "format" && mode !== "lint") {
	console.error("Usage: node scripts/check-changed-files.mjs <format|lint>")
	process.exit(2)
}

function changedFiles() {
	const files = new Set()
	const collect = (args) => {
		try {
			execFileSync("git", ["-C", repositoryRoot, "diff", ...args], {
				encoding: "utf8",
			})
				.split(/\r?\n/)
				.map((file) => file.trim())
				.filter(Boolean)
				.forEach((file) => files.add(file))
		} catch (error) {
			if (args.includes("HEAD^")) throw error
		}
	}

	try {
		collect(["--name-only", "--diff-filter=ACMR", "HEAD^", "HEAD"])
		collect(["--name-only", "--diff-filter=ACMR", "HEAD"])
		collect(["--cached", "--name-only", "--diff-filter=ACMR"])
		return [...files]
	} catch (error) {
		console.error("Unable to determine changed files from HEAD^..HEAD.")
		console.error(error)
		process.exit(1)
	}
}

const ignoredPrefixes = [
	"cocode-gui/node_modules/",
	"cocode-gui/scripts/release/",
	"cocode-gui/tests/release/",
	"cocode-gui/.cache/",
	"cocode-gui/.vite/",
	"cocode-gui/dist/",
	"cocode-gui/release/",
]
const prettierExtensions = new Set([
	".cjs",
	".css",
	".html",
	".js",
	".json",
	".mjs",
	".md",
	".scss",
	".ts",
	".tsx",
	".yml",
	".yaml",
])
const lintExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"])

const candidates = changedFiles().filter(
	(file) =>
		file.startsWith("cocode-gui/") &&
		existsSync(resolve(repositoryRoot, file)) &&
		!ignoredPrefixes.some((prefix) => file.startsWith(prefix)) &&
		file !== "cocode-gui/pnpm-lock.yaml",
)
const extensions = mode === "format" ? prettierExtensions : lintExtensions
const files = candidates.filter((file) => extensions.has(extname(file).toLowerCase()))
const relativeFiles = files.map((file) => file.slice("cocode-gui/".length))

if (relativeFiles.length === 0) {
	console.log(`No changed GUI files require ${mode} checking.`)
	process.exit(0)
}

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const command = mode === "format" ? "prettier" : "oxlint"
const args =
	mode === "format"
		? ["exec", command, "--check", ...relativeFiles]
		: [
				"exec",
				command,
				"--deny-warnings",
				"--react-plugin",
				"--import-plugin",
				...relativeFiles,
		  ]

execFileSync(packageManager, args, {
	cwd: guiRoot,
	stdio: "inherit",
})
