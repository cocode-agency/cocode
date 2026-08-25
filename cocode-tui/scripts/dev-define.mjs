import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageJson = JSON.parse(
	readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
)
const versionLiteral = JSON.stringify(packageJson.version ?? '0.0.0-dev')

register(import.meta.url)

export async function load(url, context, nextLoad) {
	const result = await nextLoad(url, context)
	if (result.source == null) return result
	const source = typeof result.source === 'string'
		? result.source
		: Buffer.from(result.source).toString('utf8')
	if (!source.includes('__COCODE_TUI_VERSION__')) return result
	return {
		...result,
		source: source.replaceAll('__COCODE_TUI_VERSION__', versionLiteral),
	}
}
