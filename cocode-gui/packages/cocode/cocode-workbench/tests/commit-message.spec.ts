import { describe, expect, it } from "vitest"
import { listModelOptions, resolveCommitRoute } from "../src/commit-message.ts"

function runtime(providers: readonly { id: string; name: string; models: readonly { id: string }[] }[]) {
  return {
    listProviders: () => providers.map(({ id, name }) => ({ id, name })),
    listModels: async (provider: string) => providers.find(entry => entry.id === provider)?.models ?? [],
  } as never
}

describe("resolveCommitRoute", () => {
  it("prefers the signed-in Cocode Flash route over an earlier provider", async () => {
    const llm = runtime([
      { id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-v4-flash" }] },
      { id: "cocode-nut", name: "Cocode", models: [{ id: "deepseek-v4-flash" }] },
    ])

    await expect(resolveCommitRoute(llm, { provider: "", model: "deepseek-v4-flash" }))
      .resolves.toEqual({ provider: "cocode-nut", model: "deepseek-v4-flash" })
  })

  it("keeps an explicit provider selection authoritative", async () => {
    const llm = runtime([
      { id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-v4-flash" }] },
      { id: "cocode-nut", name: "Cocode", models: [{ id: "deepseek-v4-flash" }] },
    ])

    await expect(resolveCommitRoute(llm, { provider: "deepseek-official", model: "deepseek-v4-flash" }))
      .resolves.toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash" })
  })
})

describe("listModelOptions", () => {
  it("uses the unified Cocode label for hosted model options", async () => {
    const llm = runtime([
      { id: "cocode-nut", name: "Cocode Nut", models: [{ id: "cloud-model" }] },
    ])

    await expect(listModelOptions(llm)).resolves.toEqual([
      {
        provider: "cocode-nut",
        providerName: "Cocode",
        model: "cloud-model",
        modelName: "cloud-model",
      },
    ])
  })
})
