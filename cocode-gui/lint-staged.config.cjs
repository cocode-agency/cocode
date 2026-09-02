const isIgnoredByOxlint = (file) => {
	const normalized = file.replace(/\\/g, "/")
	return [".cache/", ".vite/", "dist/", "dist-electron/", "out/", "release/"].some(
		(ignoredPath) => normalized.includes(ignoredPath),
	)
}

module.exports = {
	"*.{js,cjs,mjs,ts,tsx}": (files) => {
		const oxlintFiles = files.filter((file) => !isIgnoredByOxlint(file))
		const commands = []
		if (oxlintFiles.length > 0) {
			commands.push(
				`oxlint --fix --deny-warnings --react-plugin --import-plugin ${oxlintFiles
					.map((file) => JSON.stringify(file))
					.join(" ")}`,
			)
		}
		commands.push(`prettier --write ${files.map((file) => JSON.stringify(file)).join(" ")}`)
		return commands
	},
	"*.{css,html,json,yml,yaml}": "prettier --write",
}
