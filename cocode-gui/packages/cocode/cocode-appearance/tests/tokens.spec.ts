// @vitest-environment node
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/styles/tokens.css"),
  "utf8",
)

describe("Cocode appearance tokens", () => {
  it("maps the Cocode palette onto the DSH token contract", () => {
    expect(css).toContain("--cocode-surface-raised: #161619;")
    expect(css).toContain("--dsw-specific-menu: var(--cocode-surface-raised);")
    expect(css).toContain("--dsw-specific-sidebar-fill: color-mix(in srgb, var(--cocode-surface) 88%, transparent);")
    expect(css).toContain("--dsw-alias-button-elevated-fill: var(--cocode-surface-raised);")
    expect(css).toContain("--cocode-background: #0a0a0b;")
    expect(css).toContain("--cocode-primary: #f4f4f5;")
    expect(css).toContain("--cocode-input: #121215;")
    expect(css).toContain("--dsw-alias-bg-base: var(--cocode-background);")
    expect(css).toContain("--dsw-alias-button-primary-fill: var(--cocode-primary);")
    expect(css).toContain("--dsw-specific-input-major: var(--cocode-input);")
  })
})
