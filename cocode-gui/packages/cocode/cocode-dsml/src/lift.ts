/**
 * Turn DSML markup that leaked into a model stream into real tool-call blocks.
 *
 * The transform is shape-driven, not model-driven: text carrying no DSML tags
 * passes through untouched, so this can wrap every provider without asking who
 * is on the other end.
 */

import type { FinishReason, StreamChunk, ToolCallId } from "@deepseek-ai/dsh-llm"
import { DsmlExtractor } from "./dsml.ts"
import type { DsmlEvent } from "./dsml.ts"

/** Channels whose text can carry leaked markup. */
type VisibleKind = "reasoning" | "text"

const LIFTED_ID_PREFIX = "dsml-"

/**
 * Rewrite one model stream so leaked invokes become tool calls.
 *
 * Recovered calls are emitted just before `finish` rather than mid-stream: the
 * loop only acts on tool calls once the message is assembled, and waiting until
 * every provider index is known lets new blocks continue that numbering instead
 * of guessing at a free range.
 *
 * @param source - the resolved adapter's chunk stream.
 * @returns the same stream with markup removed from visible text and one
 *   tool-call block per recovered invoke; a `stop` finish that recovered calls
 *   is reported as `tool-calls` so the loop takes another step.
 */
export async function* liftDsmlToolCalls(
  source: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const extractors = new Map<number, DsmlExtractor>()
  const cleaned = new Map<number, string>()
  const lifted: { name: string; arguments: string }[] = []
  let maxIndex = -1
  let heldUsage: StreamChunk | undefined

  function extractorOf(index: number): DsmlExtractor {
    const existing = extractors.get(index)
    if (existing !== undefined) return existing
    const created = new DsmlExtractor()
    extractors.set(index, created)
    return created
  }

  /** Re-emit cleaned text for one block and collect any completed invoke. */
  function* absorb(
    index: number,
    kind: VisibleKind,
    events: DsmlEvent[],
  ): Generator<StreamChunk> {
    for (const event of events) {
      if (event.type === "tool-call") {
        lifted.push({ name: event.name, arguments: event.arguments })
        continue
      }
      cleaned.set(index, (cleaned.get(index) ?? "") + event.text)
      yield kind === "reasoning"
        ? { type: "reasoning-delta", index, text: event.text }
        : { type: "text-delta", index, text: event.text }
    }
  }

  function* emitLifted(reason: FinishReason): Generator<StreamChunk> {
    // An aborted or failed turn has no business gaining tool calls, and a
    // max-tokens turn has its tool calls dropped downstream anyway.
    if (reason.kind !== "stop" && reason.kind !== "tool-calls") return
    for (const call of lifted) {
      const index = ++maxIndex
      // The brand is a compile-time marker over the raw string. Calling the
      // dsh-llm helper instead would turn a type-only import into a runtime
      // dependency that has to be staged into the sidecar.
      const id = `${LIFTED_ID_PREFIX}${index}` as ToolCallId
      yield { type: "block-start", index, blockType: "tool-call" }
      yield {
        type: "tool-call-delta",
        index,
        id,
        name: call.name,
        argumentsDelta: call.arguments,
      }
      yield {
        type: "block-end",
        index,
        block: { type: "tool-call", id, name: call.name, arguments: call.arguments },
      }
    }
  }

  for await (const chunk of source) {
    if ("index" in chunk && chunk.index > maxIndex) maxIndex = chunk.index
    switch (chunk.type) {
      case "reasoning-delta":
        yield* absorb(chunk.index, "reasoning", extractorOf(chunk.index).push(chunk.text))
        break
      case "text-delta":
        yield* absorb(chunk.index, "text", extractorOf(chunk.index).push(chunk.text))
        break
      case "block-end": {
        const extractor = extractors.get(chunk.index)
        const block = chunk.block
        if (extractor === undefined || (block.type !== "reasoning" && block.type !== "text")) {
          yield chunk
          break
        }
        // The closing block carries the whole channel verbatim, so it needs the
        // cleaned text too, or the markup would reach the log and the next turn.
        yield* absorb(chunk.index, block.type, extractor.flush())
        yield {
          type: "block-end",
          index: chunk.index,
          block: { type: block.type, text: cleaned.get(chunk.index) ?? "" },
        }
        break
      }
      case "usage":
        // Held so recovered blocks land before the usage/finish tail.
        heldUsage = chunk
        break
      case "finish":
        yield* emitLifted(chunk.reason)
        if (heldUsage !== undefined) yield heldUsage
        heldUsage = undefined
        yield lifted.length > 0 && chunk.reason.kind === "stop"
          ? { ...chunk, reason: { kind: "tool-calls" } }
          : chunk
        break
      default:
        yield chunk
    }
  }

  // Ending without a finish already breaks the protocol upstream; don't
  // compound it by swallowing the usage that did arrive.
  if (heldUsage !== undefined) yield heldUsage
}
