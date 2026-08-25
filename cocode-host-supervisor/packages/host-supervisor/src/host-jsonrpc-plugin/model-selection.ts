import {
  installModelSelection,
  type ModelSelection,
  type ModelSelectionRef,
} from "@deepseek-ai/dsh-agent";
import type { ReasoningEffortId } from "@deepseek-ai/dsh-llm/brand";
import type { Agent } from "./types.js";

type AgentWithContext = Agent & { ctx?: unknown };

const selections = new WeakMap<Agent, ModelSelectionRef>();

export function brandReasoningEffort(value: unknown): ReasoningEffortId | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? (value as ReasoningEffortId)
    : undefined;
}

export function installAgentModelSelection(
  agent: Agent,
  fallback: ModelSelection,
): ModelSelectionRef {
  const existing = selections.get(agent);
  if (existing !== undefined) return existing;
  const agentContext = (agent as AgentWithContext).ctx;
  if (agentContext === undefined) {
    throw new Error("session model selection requires an agent-scoped context");
  }
  let picked: ModelSelection | undefined;
  const selection: ModelSelectionRef = {
    get current(): ModelSelection | undefined {
      if (picked !== undefined) return picked;
      const session = agent.session as Agent["session"] & {
        requestHeader?: () => {
          config?: {
            provider?: unknown;
            model?: unknown;
            reasoningEffort?: unknown;
          };
        };
      };
      const logged = session.requestHeader?.()?.config;
      if (
        typeof logged?.provider === "string" &&
        typeof logged.model === "string"
      ) {
        const reasoningEffort = brandReasoningEffort(logged.reasoningEffort);
        return {
          provider: logged.provider,
          model: logged.model,
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        };
      }
      const configured = agent.options as Agent["options"] & {
        agentOptions?: { provider?: unknown; model?: unknown };
      };
      return {
        provider:
          typeof configured.provider === "string"
            ? configured.provider
            : typeof configured.agentOptions?.provider === "string"
              ? configured.agentOptions.provider
              : fallback.provider,
        model:
          typeof configured.model === "string"
            ? configured.model
            : typeof configured.agentOptions?.model === "string"
              ? configured.agentOptions.model
              : fallback.model,
      };
    },
    set current(next: ModelSelection | undefined) {
      picked = next;
    },
    assembled: undefined,
  };
  installModelSelection(
    agentContext as Parameters<typeof installModelSelection>[0],
    selection,
  );
  selections.set(agent, selection);
  return selection;
}
