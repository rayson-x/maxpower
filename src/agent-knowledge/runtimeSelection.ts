export interface KnowledgeVersionPin {
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

export type ExclusiveKnowledgeSelection =
  | {
      readonly backend: "legacy";
      readonly legacyPackPin: KnowledgeVersionPin;
    }
  | {
      readonly backend: "agent_knowledge";
      readonly agentKnowledgeReleasePin: KnowledgeVersionPin;
    };

/**
 * Runtime guard for the deployment selection contract. It deliberately does
 * not adapt, merge, cascade, or fall back between knowledge backends.
 */
export function assertExclusiveKnowledgeSelection(
  input: unknown,
): asserts input is ExclusiveKnowledgeSelection {
  if (!input || typeof input !== "object") {
    throw new Error("knowledge_backend_selection_invalid");
  }
  const selection = input as Record<string, unknown>;
  const hasLegacy = selection.legacyPackPin !== undefined;
  const hasAgentKnowledge = selection.agentKnowledgeReleasePin !== undefined;
  if (selection.backend === "legacy") {
    if (!hasLegacy || hasAgentKnowledge) throw new Error("knowledge_backend_not_exclusive");
    return;
  }
  if (selection.backend === "agent_knowledge") {
    if (!hasAgentKnowledge || hasLegacy) throw new Error("knowledge_backend_not_exclusive");
    return;
  }
  throw new Error("knowledge_backend_selection_invalid");
}
