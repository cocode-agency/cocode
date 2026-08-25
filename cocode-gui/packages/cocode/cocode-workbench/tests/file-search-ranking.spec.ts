import { describe, expect, it } from "vitest"
import { rankFilePaths, rankFilePathsCooperatively } from "../src/file-search-ranking.ts"

describe("file mention path ranking", () => {
  it("prefers exact directories and basename prefixes over path-only matches", () => {
    expect(rankFilePaths([
      "docs/src-guide.md",
      "packages/src-runtime.ts",
      "src/index.ts",
      "src/",
    ], "src", 20)).toEqual([
      "src/",
      "docs/src-guide.md",
      "packages/src-runtime.ts",
      "src/index.ts",
    ])
  })

  it("keeps the exact directory candidate when the query has a trailing slash", () => {
    expect(rankFilePaths([
      "src/",
      "src/main.ts",
      "src/components/",
      "src/components/button.tsx",
    ], "src/", 20)).toEqual([
      "src/",
      "src/main.ts",
      "src/components/",
      "src/components/button.tsx",
    ])

    expect(rankFilePaths([
      "src/components/",
      "src/components/button.tsx",
    ], "src\\components\\", 20)).toEqual([
      "src/components/",
      "src/components/button.tsx",
    ])
  })

  it("keeps fuzzy matches deterministic and applies the requested limit", () => {
    expect(rankFilePaths([
      "src/components/file-mention.tsx",
      "src/client/file-menu.ts",
      "tests/files-menu.spec.ts",
      "README.md",
    ], "flmn", 2)).toEqual([
      "src/client/file-menu.ts",
      "tests/files-menu.spec.ts",
    ])
  })

  it("keeps cooperative Worker ranking identical to synchronous compatibility ranking", async () => {
    const paths = [
      "src/components/file-mention.tsx",
      "src/client/file-menu.ts",
      "tests/files-menu.spec.ts",
      "README.md",
    ]
    await expect(rankFilePathsCooperatively(paths, "flmn", 2, {
      chunkSize: 1,
      yieldControl: async () => {},
    })).resolves.toEqual(rankFilePaths(paths, "flmn", 2))
  })
})
