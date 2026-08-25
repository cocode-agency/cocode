import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('ui-theme production apply wiring', () => {
  it('mounts the global theme sheets from the plugin lifecycle', () => {
    const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/import\s+\{\s*installThemeStyles\s*\}\s+from ['"]\.\/styles\.ts['"]/)
    expect(source).toMatch(/export function apply\(ctx: ClientContext\): void \{[\s\S]*?installThemeStyles\(ctx\)/)
  })
})
