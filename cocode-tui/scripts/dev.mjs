#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

loadDotenv(resolve(packageRoot, '.env'))

const result = spawnSync(
	process.execPath,
	[
		'--import',
		'tsx/esm',
		'--import',
		pathToFileURL(resolve(packageRoot, 'scripts/dev-define.mjs')).href,
		resolve(packageRoot, 'src/main.tsx'),
		...process.argv.slice(2),
	],
	{ cwd: packageRoot, env: process.env, stdio: 'inherit' },
)

if (result.error) {
	process.stderr.write(`Cocode TUI failed to start: ${result.error.message}\n`)
	process.exit(1)
}
process.exit(result.status ?? 1)

function loadDotenv(path) {
	let text
	try {
		text = readFileSync(path, 'utf8')
	} catch {
		return
	}
	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		if (trimmed === '' || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq <= 0) continue
		const key = trimmed.slice(0, eq).trim()
		let value = trimmed.slice(eq + 1).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		if (process.env[key] === undefined) process.env[key] = value
	}
}
