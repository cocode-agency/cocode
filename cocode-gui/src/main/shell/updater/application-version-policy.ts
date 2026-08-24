interface ParsedApplicationVersion {
	readonly core: readonly [number, number, number]
	readonly prerelease: readonly (number | string)[]
}

/** Returns true only for a valid semantic version strictly newer than current. */
export function isStrictlyNewerApplicationVersion(
	candidate: string | undefined,
	current: string,
): boolean {
	const candidateVersion = parseApplicationVersion(candidate)
	const currentVersion = parseApplicationVersion(current)
	if (!candidateVersion || !currentVersion) return false

	for (let index = 0; index < candidateVersion.core.length; index += 1) {
		if (candidateVersion.core[index] !== currentVersion.core[index]) {
			return candidateVersion.core[index] > currentVersion.core[index]
		}
	}

	if (candidateVersion.prerelease.length === 0 && currentVersion.prerelease.length > 0)
		return true
	if (candidateVersion.prerelease.length > 0 && currentVersion.prerelease.length === 0)
		return false

	for (
		let index = 0;
		index < Math.max(candidateVersion.prerelease.length, currentVersion.prerelease.length);
		index += 1
	) {
		const candidatePart = candidateVersion.prerelease[index]
		const currentPart = currentVersion.prerelease[index]
		if (candidatePart === undefined) return false
		if (currentPart === undefined) return true
		if (candidatePart === currentPart) continue
		if (typeof candidatePart === "number" && typeof currentPart === "string") return false
		if (typeof candidatePart === "string" && typeof currentPart === "number") return true
		return candidatePart > currentPart
	}

	return false
}

function parseApplicationVersion(value: string | undefined): ParsedApplicationVersion | undefined {
	if (typeof value !== "string") return undefined
	const match = value
		.trim()
		.match(
			/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
		)
	if (!match) return undefined

	const prereleaseParts = match[4]?.split(".") ?? []
	if (
		prereleaseParts.some(
			(part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
		)
	) {
		return undefined
	}
	const prerelease = prereleaseParts.map((part) => (/^\d+$/.test(part) ? Number(part) : part))
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease,
	}
}
