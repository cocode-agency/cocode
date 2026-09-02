import { describe, expect, it } from "vitest"
import type { StreamChunk } from "@deepseek-ai/dsh-llm"
import { liftDsmlToolCalls } from "../src/lift.ts"

async function* feed(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

async function run(chunks: StreamChunk[]): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of liftDsmlToolCalls(feed(chunks))) out.push(chunk)
  return out
}

/** The live leak: markup arrives in the thinking channel, split across deltas. */
const LEAKED = [
  "Need to list the RFCs.\n",
  "<| DSML | tool_calls>\n<| DSML | invoke name=\"bash\">\n",
  "<| DSML | parameter name=\"command\" string=\"true\">ls .dev/rfc</| DSML | parameter>\n",
  "</| DSML | invoke>\n</| DSML | tool_calls>",
]

describe("liftDsmlToolCalls", () => {
  it("leaves a stream without markup byte-for-byte alone", async () => {
    const chunks: StreamChunk[] = [
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "hello" },
      { type: "block-end", index: 0, block: { type: "text", text: "hello" } },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 1 } },
      { type: "finish", reason: { kind: "stop" } },
    ]
    expect(await run(chunks)).toEqual(chunks)
  })

  it("lifts a leaked invoke into a tool call and keeps thinking clean", async () => {
    const out = await run([
      { type: "block-start", index: 0, blockType: "reasoning" },
      ...LEAKED.map((text): StreamChunk => ({ type: "reasoning-delta", index: 0, text })),
      { type: "block-end", index: 0, block: { type: "reasoning", text: LEAKED.join("") } },
      { type: "usage", usage: { inputTokens: 20, outputTokens: 8 } },
      { type: "finish", reason: { kind: "stop" } },
    ])

    // No tag fragment survives anywhere in the visible channel.
    const visible = out
      .filter(chunk => chunk.type === "reasoning-delta")
      .map(chunk => chunk.text)
      .join("")
    expect(visible).toBe("Need to list the RFCs.\n")
    expect(out.find(chunk => chunk.type === "block-end")).toEqual({
      type: "block-end",
      index: 0,
      block: { type: "reasoning", text: "Need to list the RFCs.\n" },
    })

    // The recovered call is a real block the loop can execute, numbered after
    // the provider's own indices, and it turns the turn into another step.
    expect(out.filter(chunk => "index" in chunk && chunk.index === 1)).toEqual([
      { type: "block-start", index: 1, blockType: "tool-call" },
      {
        type: "tool-call-delta",
        index: 1,
        id: "dsml-1",
        name: "bash",
        argumentsDelta: '{"command":"ls .dev/rfc"}',
      },
      {
        type: "block-end",
        index: 1,
        block: {
          type: "tool-call",
          id: "dsml-1",
          name: "bash",
          arguments: '{"command":"ls .dev/rfc"}',
        },
      },
    ])
    expect(out.at(-1)).toEqual({ type: "finish", reason: { kind: "tool-calls" } })
    // Usage still precedes finish, and only once.
    expect(out.filter(chunk => chunk.type === "usage")).toHaveLength(1)
    expect(out.at(-2)?.type).toBe("usage")
  })

  it("never lets a partial tag reach the UI while it streams", async () => {
    const out = await run([
      { type: "block-start", index: 0, blockType: "reasoning" },
      { type: "reasoning-delta", index: 0, text: "thinking <| DS" },
      { type: "finish", reason: { kind: "aborted", reason: "user" } as never },
    ])
    const visible = out
      .filter(chunk => chunk.type === "reasoning-delta")
      .map(chunk => chunk.text)
      .join("")
    expect(visible).toBe("thinking ")
  })

  it("keeps a genuine tool call from the provider untouched", async () => {
    const chunks: StreamChunk[] = [
      { type: "block-start", index: 0, blockType: "tool-call" },
      {
        type: "tool-call-delta",
        index: 0,
        id: "call_1" as never,
        name: "bash",
        argumentsDelta: '{"command":"ls"}',
      },
      {
        type: "block-end",
        index: 0,
        block: { type: "tool-call", id: "call_1" as never, name: "bash", arguments: '{"command":"ls"}' },
      },
      { type: "finish", reason: { kind: "tool-calls" } },
    ]
    expect(await run(chunks)).toEqual(chunks)
  })
})
