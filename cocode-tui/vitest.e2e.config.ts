import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version?: string }

export default defineConfig({
  define: {
    __COCODE_TUI_VERSION__: JSON.stringify(packageJson.version ?? '0.0.0-dev'),
  },
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 180_000,
  },
})
