import type { PlanChangeProposalResult, ProposePlanChangeInput } from "./actions";
import type { CoachRunEvent, PlanEditChange, ToolExecutionIdentity } from "./model";
import type { ShowArtifactResult, ShowTodayPlanResult } from "./createCoachApplication";

export interface CoachToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface CoachToolManifest {
  name: string;
  schemaVersion: 1;
  accessClass: "read" | "proposal" | "human_input";
  executionMode: "local_deterministic" | "policy_gated" | "human_in_loop";
  offlineAvailable: boolean;
  permissionScopes: readonly string[];
  riskCeiling: "none" | "review" | "confirmation_required";
  evidenceRequirements: readonly string[];
  output: "artifact_ref" | "pending_human_action";
  outputLimit: number;
  inputSchema: Readonly<Record<string, unknown>>;
}

/**
 * Narrow, source-labelled facts that a Coach may record only after the user
 * has stated them in the current conversation. Coach estimates have their
 * own explicit field and are always held behind a confirmation boundary.
 */
export type UserStatedRecordInput =
  | {
      kind: "training";
      summary?: string;
      durationMinutes?: number;
      note?: string;
      /** Exact performance values only when the person stated them in this conversation. */
      exercises?: readonly {
        name: string;
        sets?: readonly { reps?: number; loadKg?: number; rir?: number }[];
      }[];
    }
  | {
      kind: "activity";
      activityType: string;
      durationMinutes?: number;
      intensity?: "easy" | "moderate" | "hard" | "unknown";
      /** A value the person explicitly reported (for example, from their watch). */
      energyKcal?: number;
      /** A Coach estimate. This always creates a confirmation draft before it can be recorded. */
      energyEstimateKcal?: number;
    }
  | { kind: "sleep"; durationMinutes?: number; quality?: number }
  | { kind: "recovery"; perceivedRecovery?: number }
  | { kind: "body"; metric: "body_weight" | "body_fat_percentage"; value: number };

const EXACT_EMPTY_OBJECT = Object.freeze({ type: "object", additionalProperties: false });
const AGENT_ADJUST_TASK_CHANGE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["kind", "taskId"],
  properties: {
    kind: { const: "adjust_task" },
    taskId: { type: "string", minLength: 1, maxLength: 160 },
    sets: { type: "integer", minimum: 1, maximum: 20 },
    reps: { type: "string", pattern: "^\\d+(?:-\\d+)?$", maxLength: 16 },
    loadKg: { type: "number", minimum: 0, maximum: 1000 },
    targetRir: { type: "integer", minimum: 0, maximum: 10 },
    restSeconds: { type: "integer", minimum: 0, maximum: 3600 },
    scope: { enum: ["this_session_only", "future_preference", "lock"] },
  },
});

/**
 * This is the whole agent-visible tool catalog. It is intentionally closed
 * and versioned here rather than synthesized from prompts or provider SDKs.
 */
const COACH_TOOL_MANIFEST: readonly CoachToolManifest[] = Object.freeze([
  {
    name: "plan.show_today", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["current_local_plan"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["date"], properties: { date: { type: "string", format: "date" } } },
  },
  {
    name: "plan.show_current", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["current_materialized_plan", "committed_nutrition_strategy"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
  },
  {
    name: "coach.show_weekly_report", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["confirmed_timeline_or_workout_facts"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["weekStart", "weekEnd"], properties: { weekStart: { type: "string", format: "date" }, weekEnd: { type: "string", format: "date" } } },
  },
  {
    name: "coach.show_mesocycle_review", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["committed_goal_cycle", "confirmed_workout_or_timeline_facts"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
  },
  {
    name: "forecast.show_latest", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["registered_local_replan_evaluation"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
  },
  {
    name: "recovery.show_brief", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["confirmed_recovery_constraint"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
  },
  {
    name: "recovery.evaluate_timeline", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["confirmed_timeline", "selected_health_source_or_manual_checkin"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
  },
  {
    name: "safety.show_hold", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "review", evidenceRequirements: ["confirmed_safety_constraint"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
  },
  {
    name: "nutrition.show_strategy", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["committed_nutrition_strategy"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
  },
  {
    name: "nutrition.propose_change_from_timeline", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["committed_nutrition_strategy", "confirmed_timeline", "nutrition_review_window"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["nutritionStrategyId"], properties: { nutritionStrategyId: { type: "string", minLength: 1 } } },
  },
  {
    name: "nutrition.propose_plan_coordination", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["committed_nutrition_strategy", "current_materialized_plan", "active_recovery_constraint"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["nutritionStrategyId"], properties: { nutritionStrategyId: { type: "string", minLength: 1 } } },
  },
  {
    name: "plan.propose_change", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["current_plan", "mandate", "fact_frontier"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["change", "reason"], properties: { change: AGENT_ADJUST_TASK_CHANGE_SCHEMA, reason: { type: "string", minLength: 1, maxLength: 480 } } },
  },
  {
    name: "ui.request_choice", schemaVersion: 1, accessClass: "human_input", executionMode: "human_in_loop", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "confirmation_required", evidenceRequirements: ["explicit_user_choice"], output: "pending_human_action", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["prompt", "options", "risk"], properties: { prompt: { type: "string" }, options: { type: "array" }, risk: { enum: ["low", "review", "high"] } } },
  },
]);

/**
 * 知识检索工具（ticket 06）：默认禁用，由 eval 门槛（ticket 10）翻转启用。
 * 只读、离线可用；查无结果时 facade 返回 typed unknown artifact，绝不返回空内容。
 */
const KNOWLEDGE_TOOL_MANIFEST: readonly CoachToolManifest[] = Object.freeze([
  {
    name: "knowledge.lookup_exercise", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["installed_knowledge_pack"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 120 } } },
  },
  {
    name: "knowledge.explain_rule", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["installed_knowledge_pack"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["ruleId"], properties: { ruleId: { type: "string", minLength: 1, maxLength: 160 } } },
  },
  {
    name: "knowledge.search", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["installed_knowledge_pack"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 2, maxLength: 200 }, topic: { enum: ["training", "nutrition", "recovery", "exercise", "any"] } } },
  },
]);

/**
 * Agent actions are typed and policy-gated. Clear user-stated reports may be
 * delegated to Coach; proposals and inferred values retain a confirmation
 * boundary.
 */
const ACTION_TOOL_MANIFEST: readonly CoachToolManifest[] = Object.freeze([
  {
    name: "timeline.record_user_report", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "review", evidenceRequirements: ["current_user_statement"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { enum: ["training", "activity", "sleep", "recovery", "body"] }, summary: { type: "string", maxLength: 240 }, note: { type: "string", maxLength: 480 }, exercises: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, sets: { type: "array", maxItems: 99, items: { type: "object", additionalProperties: false, properties: { reps: { type: "integer", minimum: 0, maximum: 200 }, loadKg: { type: "number", minimum: 0, maximum: 1000 }, rir: { type: "number", minimum: 0, maximum: 10 } } } } } } }, activityType: { type: "string", maxLength: 120 }, durationMinutes: { type: "number", minimum: 0, maximum: 1440 }, intensity: { enum: ["easy", "moderate", "hard", "unknown"] }, energyKcal: { type: "number", minimum: 0, maximum: 10000 }, energyEstimateKcal: { type: "number", minimum: 0, maximum: 10000 }, quality: { type: "integer", minimum: 1, maximum: 5 }, perceivedRecovery: { type: "integer", minimum: 1, maximum: 5 }, metric: { enum: ["body_weight", "body_fat_percentage"] }, value: { type: "number", minimum: 0, maximum: 1000 } } },
  },
  {
    name: "nutrition.record_observation", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["user_stated_items"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", minItems: 1, maxItems: 20 }, mealSlot: { type: "string" }, note: { type: "string", maxLength: 240 } } },
  },
  {
    name: "plan.substitute_exercise", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["current_plan", "stimulus_equivalence_check"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["taskId", "reason"], properties: { taskId: { type: "string", minLength: 1 }, replacementExerciseId: { type: "string" }, reason: { type: "string", minLength: 1, maxLength: 240 } } },
  },
  {
    name: "workout.report_set", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["active_workout_session", "user_stated_performance"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["workoutId", "actualReps"], properties: { workoutId: { type: "string", minLength: 1 }, actualReps: { type: "integer", minimum: 0, maximum: 200 }, actualLoadKg: { type: "number", minimum: 0, maximum: 1000 }, actualRir: { type: "integer", minimum: 0, maximum: 10 } } },
  },
  {
    name: "plan.trigger_replan_with_context", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["user_stated_context"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["contextType"], properties: { contextType: { enum: ["progress_plateau", "goal_shift", "schedule_change", "feeling_stalled", "other"] }, note: { type: "string", maxLength: 240 } } },
  },
]);

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
      showCurrentPlan(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      showWeeklyReport(
        input: { sessionId: string; weekStart: string; weekEnd: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      showMesocycleReview(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      showGoalForecast(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      showRecoveryBrief(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      evaluateRecoveryTimeline(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      showSafetyHold(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      showNutritionStrategy(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      proposeNutritionChangeFromTimeline(
        input: { sessionId: string; nutritionStrategyId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      proposeNutritionPlanCoordination(
        input: { sessionId: string; nutritionStrategyId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      proposePlanChange(
        input: ProposePlanChangeInput,
        execution: ToolExecutionIdentity,
      ): Promise<PlanChangeProposalResult>;
      lookupExerciseKnowledge(
        input: { sessionId: string; query: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      explainKnowledgeRule(
        input: { sessionId: string; ruleId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      searchKnowledgeBase(
        input: { sessionId: string; query: string; topic?: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      recordNutritionObservation(
        input: { sessionId: string; items: readonly string[]; mealSlot?: string; note?: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      recordUserStatedReport(
        input: { sessionId: string; report: UserStatedRecordInput },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      substituteExercise(
        input: { sessionId: string; taskId: string; replacementExerciseId?: string; reason: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      reportWorkoutSet(
        input: { sessionId: string; workoutId: string; actualReps: number; actualLoadKg?: number; actualRir?: number },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      triggerReplanWithContext(
        input: { sessionId: string; contextType: string; note?: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
    },
    private readonly options: { knowledgeToolsEnabled?: boolean; actionToolsEnabled?: boolean } = {},
  ) {}

  manifest(): readonly CoachToolManifest[] {
    const base = this.options.knowledgeToolsEnabled
      ? [...COACH_TOOL_MANIFEST, ...KNOWLEDGE_TOOL_MANIFEST]
      : [...COACH_TOOL_MANIFEST];
    return this.options.actionToolsEnabled ? [...base, ...ACTION_TOOL_MANIFEST] : base;
  }

  async invoke(input: {
    sessionId: string;
    runId: string;
    call: CoachToolCall;
  }): Promise<readonly CoachRunEvent[]> {
    if (input.call.toolName === "knowledge.lookup_exercise") {
      if (!this.options.knowledgeToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["query"]);
      if (typeof parsed.query !== "string" || !parsed.query.trim() || parsed.query.length > 120) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.lookupExerciseKnowledge(
        { sessionId: input.sessionId, query: parsed.query.trim() },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "knowledge.explain_rule") {
      if (!this.options.knowledgeToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["ruleId"]);
      if (typeof parsed.ruleId !== "string" || !parsed.ruleId.trim() || parsed.ruleId.length > 160) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.explainKnowledgeRule(
        { sessionId: input.sessionId, ruleId: parsed.ruleId.trim() },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "timeline.record_user_report") {
      if (!this.options.actionToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const report = parseUserStatedRecord(input.call.input);
      const result = await this.handlers.recordUserStatedReport(
        { sessionId: input.sessionId, report },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "knowledge.search") {
      if (!this.options.knowledgeToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["query", "topic"]);
      if (typeof parsed.query !== "string" || parsed.query.trim().length < 2) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.searchKnowledgeBase(
        {
          sessionId: input.sessionId,
          query: parsed.query.trim(),
          ...(typeof parsed.topic === "string" ? { topic: parsed.topic } : {}),
        },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "nutrition.record_observation") {
      if (!this.options.actionToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["items", "mealSlot", "note"]);
      if (!Array.isArray(parsed.items) || !parsed.items.length || parsed.items.some((item) => typeof item !== "string" || !item.trim())) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.recordNutritionObservation(
        {
          sessionId: input.sessionId,
          items: parsed.items.map((item) => String(item).trim()),
          ...(typeof parsed.mealSlot === "string" ? { mealSlot: parsed.mealSlot } : {}),
          ...(typeof parsed.note === "string" ? { note: parsed.note } : {}),
        },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "plan.substitute_exercise") {
      if (!this.options.actionToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["taskId", "replacementExerciseId", "reason"]);
      if (typeof parsed.taskId !== "string" || !parsed.taskId || typeof parsed.reason !== "string" || !parsed.reason.trim()) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.substituteExercise(
        {
          sessionId: input.sessionId,
          taskId: parsed.taskId,
          ...(typeof parsed.replacementExerciseId === "string" ? { replacementExerciseId: parsed.replacementExerciseId } : {}),
          reason: parsed.reason.trim(),
        },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "workout.report_set") {
      if (!this.options.actionToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["workoutId", "actualReps", "actualLoadKg", "actualRir"]);
      if (typeof parsed.workoutId !== "string" || !parsed.workoutId || typeof parsed.actualReps !== "number" || !Number.isInteger(parsed.actualReps)) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.reportWorkoutSet(
        {
          sessionId: input.sessionId,
          workoutId: parsed.workoutId,
          actualReps: parsed.actualReps,
          ...(typeof parsed.actualLoadKg === "number" ? { actualLoadKg: parsed.actualLoadKg } : {}),
          ...(typeof parsed.actualRir === "number" ? { actualRir: parsed.actualRir } : {}),
        },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "plan.trigger_replan_with_context") {
      if (!this.options.actionToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["contextType", "note"]);
      const allowed = ["progress_plateau", "goal_shift", "schedule_change", "feeling_stalled", "other"];
      if (typeof parsed.contextType !== "string" || !allowed.includes(parsed.contextType)) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.triggerReplanWithContext(
        {
          sessionId: input.sessionId,
          contextType: parsed.contextType,
          ...(typeof parsed.note === "string" ? { note: parsed.note } : {}),
        },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
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
    if (input.call.toolName === "plan.show_current") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.showCurrentPlan(
        { sessionId: input.sessionId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "plan.propose_change") {
      const parsed = parseExactObject(input.call.input, ["change", "reason"]);
      if (typeof parsed.reason !== "string" || !parsed.reason.trim() || parsed.reason.length > 480) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const change = parseAgentAdjustTaskChange(parsed.change);
      const result = await this.handlers.proposePlanChange(
        {
          sessionId: input.sessionId,
          change,
          reason: parsed.reason,
        },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "coach.show_weekly_report") {
      const parsed = parseExactObject(input.call.input, ["weekStart", "weekEnd"]);
      if (
        typeof parsed.weekStart !== "string" ||
        typeof parsed.weekEnd !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(parsed.weekStart) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(parsed.weekEnd) ||
        parsed.weekEnd < parsed.weekStart
      ) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.showWeeklyReport(
        { sessionId: input.sessionId, weekStart: parsed.weekStart, weekEnd: parsed.weekEnd },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "coach.show_mesocycle_review") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.showMesocycleReview(
        { sessionId: input.sessionId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "forecast.show_latest") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.showGoalForecast(
        { sessionId: input.sessionId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "recovery.show_brief") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.showRecoveryBrief(
        { sessionId: input.sessionId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "recovery.evaluate_timeline") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.evaluateRecoveryTimeline(
        { sessionId: input.sessionId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "safety.show_hold") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.showSafetyHold(
        { sessionId: input.sessionId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "nutrition.show_strategy") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.showNutritionStrategy(
        { sessionId: input.sessionId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "nutrition.propose_change_from_timeline") {
      const parsed = parseExactObject(input.call.input, ["nutritionStrategyId"]);
      if (typeof parsed.nutritionStrategyId !== "string" || !parsed.nutritionStrategyId.trim()) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.proposeNutritionChangeFromTimeline(
        { sessionId: input.sessionId, nutritionStrategyId: parsed.nutritionStrategyId },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "nutrition.propose_plan_coordination") {
      const parsed = parseExactObject(input.call.input, ["nutritionStrategyId"]);
      if (typeof parsed.nutritionStrategyId !== "string" || !parsed.nutritionStrategyId.trim()) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      const result = await this.handlers.proposeNutritionPlanCoordination(
        { sessionId: input.sessionId, nutritionStrategyId: parsed.nutritionStrategyId },
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

function parseUserStatedRecord(input: unknown): UserStatedRecordInput {
  const parsed = parseExactObject(input, ["kind", "summary", "note", "exercises", "activityType", "durationMinutes", "intensity", "energyKcal", "energyEstimateKcal", "quality", "perceivedRecovery", "metric", "value"]);
  const durationMinutes = optionalBoundedNumber(parsed.durationMinutes, 0, 1440);
  if (parsed.durationMinutes !== undefined && durationMinutes === undefined) throw new ToolSchemaError("invalid_tool_input");
  const note = optionalString(parsed.note, 480);
  if (parsed.note !== undefined && note === undefined) throw new ToolSchemaError("invalid_tool_input");
  if (parsed.kind === "training") {
    const summary = optionalString(parsed.summary, 240);
    const exercises = parseUserReportedExercises(parsed.exercises);
    if (!summary && !note && durationMinutes === undefined && !exercises?.length) throw new ToolSchemaError("invalid_tool_input");
    return { kind: "training", ...(summary === undefined ? {} : { summary }), ...(durationMinutes === undefined ? {} : { durationMinutes }), ...(note ? { note } : {}), ...(exercises?.length ? { exercises } : {}) };
  }
  if (parsed.kind === "activity") {
    const activityType = optionalString(parsed.activityType, 120);
    const intensity = parsed.intensity;
    const energyKcal = optionalBoundedNumber(parsed.energyKcal, 0, 10_000);
    const energyEstimateKcal = optionalBoundedNumber(parsed.energyEstimateKcal, 0, 10_000);
    if (!activityType || (intensity !== undefined && intensity !== "easy" && intensity !== "moderate" && intensity !== "hard" && intensity !== "unknown") || (parsed.energyKcal !== undefined && energyKcal === undefined) || (parsed.energyEstimateKcal !== undefined && energyEstimateKcal === undefined) || (energyKcal !== undefined && energyEstimateKcal !== undefined)) {
      throw new ToolSchemaError("invalid_tool_input");
    }
    return { kind: "activity", activityType, ...(durationMinutes === undefined ? {} : { durationMinutes }), ...(intensity === undefined ? {} : { intensity }), ...(energyKcal === undefined ? {} : { energyKcal }), ...(energyEstimateKcal === undefined ? {} : { energyEstimateKcal }) };
  }
  if (parsed.kind === "sleep") {
    const quality = optionalBoundedInteger(parsed.quality, 1, 5);
    if (parsed.quality !== undefined && quality === undefined) throw new ToolSchemaError("invalid_tool_input");
    if (durationMinutes === undefined && quality === undefined) throw new ToolSchemaError("invalid_tool_input");
    return { kind: "sleep", ...(durationMinutes === undefined ? {} : { durationMinutes }), ...(quality === undefined ? {} : { quality }) };
  }
  if (parsed.kind === "recovery") {
    const perceivedRecovery = optionalBoundedInteger(parsed.perceivedRecovery, 1, 5);
    if (perceivedRecovery === undefined) throw new ToolSchemaError("invalid_tool_input");
    return { kind: "recovery", perceivedRecovery };
  }
  if (parsed.kind === "body") {
    const metric = parsed.metric;
    const value = optionalBoundedNumber(parsed.value, 0, 1000);
    if ((metric !== "body_weight" && metric !== "body_fat_percentage") || value === undefined || (metric === "body_fat_percentage" && value > 100)) throw new ToolSchemaError("invalid_tool_input");
    return { kind: "body", metric, value };
  }
  throw new ToolSchemaError("invalid_tool_input");
}

function parseUserReportedExercises(value: unknown): readonly NonNullable<Extract<UserStatedRecordInput, { kind: "training" }>["exercises"]>[number][] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new ToolSchemaError("invalid_tool_input");
  return value.map((rawExercise) => {
    const exercise = parseExactObject(rawExercise, ["name", "sets"]);
    const name = optionalString(exercise.name, 120);
    if (!name) throw new ToolSchemaError("invalid_tool_input");
    if (exercise.sets === undefined) return { name };
    if (!Array.isArray(exercise.sets) || exercise.sets.length > 99) throw new ToolSchemaError("invalid_tool_input");
    const sets = exercise.sets.map((rawSet) => {
      const set = parseExactObject(rawSet, ["reps", "loadKg", "rir"]);
      const reps = optionalBoundedInteger(set.reps, 0, 200);
      const loadKg = optionalBoundedNumber(set.loadKg, 0, 1_000);
      const rir = optionalBoundedNumber(set.rir, 0, 10);
      if ((set.reps !== undefined && reps === undefined) || (set.loadKg !== undefined && loadKg === undefined) || (set.rir !== undefined && rir === undefined) || (reps === undefined && loadKg === undefined && rir === undefined)) {
        throw new ToolSchemaError("invalid_tool_input");
      }
      return { ...(reps === undefined ? {} : { reps }), ...(loadKg === undefined ? {} : { loadKg }), ...(rir === undefined ? {} : { rir }) };
    });
    return { name, ...(sets.length ? { sets } : {}) };
  });
}

function optionalString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim() && value.trim().length <= maximum ? value.trim() : undefined;
}

function optionalBoundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function optionalBoundedInteger(value: unknown, min: number, max: number): number | undefined {
  const number = optionalBoundedNumber(value, min, max);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

/**
 * The language provider may recommend only a bounded adjustment to an
 * existing task. Structural task management stays in the user-facing plan
 * editor and deterministic substitution flow, where catalog identity and
 * stimulus constraints can be checked. This prevents a provider from
 * smuggling an arbitrary PlanTask/JSON payload through a generic tool call.
 */
function parseAgentAdjustTaskChange(value: unknown): Extract<PlanEditChange, { kind: "adjust_task" }> {
  const parsed = parseExactObject(value, ["kind", "taskId", "sets", "reps", "loadKg", "targetRir", "restSeconds", "scope"]);
  if (parsed.kind !== "adjust_task" || typeof parsed.taskId !== "string" || !parsed.taskId.trim() || parsed.taskId.length > 160) {
    throw new ToolSchemaError("invalid_tool_input");
  }
  const change: Extract<PlanEditChange, { kind: "adjust_task" }> = {
    kind: "adjust_task",
    taskId: parsed.taskId,
  };
  if (parsed.sets !== undefined) {
    if (typeof parsed.sets !== "number" || !Number.isInteger(parsed.sets) || parsed.sets < 1 || parsed.sets > 20) throw new ToolSchemaError("invalid_tool_input");
    change.sets = parsed.sets;
  }
  if (parsed.reps !== undefined) {
    if (typeof parsed.reps !== "string" || !/^\d+(?:-\d+)?$/.test(parsed.reps) || parsed.reps.length > 16) throw new ToolSchemaError("invalid_tool_input");
    change.reps = parsed.reps;
  }
  if (parsed.loadKg !== undefined) {
    if (typeof parsed.loadKg !== "number" || !Number.isFinite(parsed.loadKg) || parsed.loadKg < 0 || parsed.loadKg > 1000) throw new ToolSchemaError("invalid_tool_input");
    change.loadKg = parsed.loadKg;
  }
  if (parsed.targetRir !== undefined) {
    if (typeof parsed.targetRir !== "number" || !Number.isInteger(parsed.targetRir) || parsed.targetRir < 0 || parsed.targetRir > 10) throw new ToolSchemaError("invalid_tool_input");
    change.targetRir = parsed.targetRir;
  }
  if (parsed.restSeconds !== undefined) {
    if (typeof parsed.restSeconds !== "number" || !Number.isInteger(parsed.restSeconds) || parsed.restSeconds < 0 || parsed.restSeconds > 3600) throw new ToolSchemaError("invalid_tool_input");
    change.restSeconds = parsed.restSeconds;
  }
  if (parsed.scope !== undefined) {
    if (parsed.scope !== "this_session_only" && parsed.scope !== "future_preference" && parsed.scope !== "lock") {
      throw new ToolSchemaError("invalid_tool_input");
    }
    change.scope = parsed.scope;
  }
  if (change.sets === undefined && change.reps === undefined && change.loadKg === undefined && change.targetRir === undefined && change.restSeconds === undefined) {
    throw new ToolSchemaError("invalid_tool_input");
  }
  return change;
}
