import type { PlanChangeProposalResult, ProposePlanChangeInput } from "./actions";
import type { CoachRunEvent, ToolExecutionIdentity } from "./model";
import type { ShowTodayPlanResult } from "./createCoachApplication";

export interface CoachToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export class ToolSchemaError extends Error {
  constructor(readonly code: "unknown_tool" | "invalid_tool_input" | "missing_tool_result") {
    super(code);
    this.name = "ToolSchemaError";
  }
}

export class CoachToolRegistry {
  constructor(
    private readonly handlers: {
      showToday(
        input: { sessionId: string; date: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowTodayPlanResult>;
      proposePlanChange(
        input: ProposePlanChangeInput,
        execution: ToolExecutionIdentity,
      ): Promise<PlanChangeProposalResult>;
    },
  ) {}

  async invoke(input: {
    sessionId: string;
    runId: string;
    call: CoachToolCall;
  }): Promise<readonly CoachRunEvent[]> {
    if (input.call.toolName === "plan.show_today") {
      const parsed = parseExactObject(input.call.input, ["date"]);
      if (typeof parsed.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.showToday(
        { sessionId: input.sessionId, date: parsed.date },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "plan.propose_change") {
      const parsed = parseExactObject(input.call.input, ["change", "reason"]);
      if (!parsed.change || typeof parsed.change !== "object" || typeof parsed.reason !== "string") {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.proposePlanChange(
        {
          sessionId: input.sessionId,
          change: parsed.change as ProposePlanChangeInput["change"],
          reason: parsed.reason,
        },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    throw new ToolSchemaError("unknown_tool");
  }

  private validateResultIdentity(
    input: { sessionId: string; runId: string; call: CoachToolCall },
    source: readonly CoachRunEvent[],
  ): readonly CoachRunEvent[] {
    const started = source.find((event) => event.type === "tool-started");
    const ready = source.find((event) => event.type === "artifact-ready");
    if (
      !started ||
      started.type !== "tool-started" ||
      !ready ||
      ready.type !== "artifact-ready" ||
      started.sessionId !== input.sessionId ||
      ready.sessionId !== input.sessionId ||
      started.runId !== input.runId ||
      ready.runId !== input.runId ||
      started.toolCallId !== input.call.toolCallId ||
      ready.toolCallId !== input.call.toolCallId
    ) {
      throw new ToolSchemaError("missing_tool_result");
    }
    return source;
  }
}

function parseExactObject(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ToolSchemaError("invalid_tool_input");
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new ToolSchemaError("invalid_tool_input");
  }
  return record;
}
