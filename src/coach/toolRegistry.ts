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
  /** Concise model-facing intent boundary; providers must preserve it. */
  description?: string;
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
  | { kind: "body"; metric: "body_weight" | "body_fat_percentage"; value: number }
  | { kind: "schedule"; summary: string }
  | { kind: "rest"; summary: string };

/**
 * A conversational execution-time change.  It deliberately contains only
 * what the person said, rather than a model-generated diagnosis or a target
 * training prescription.  The local rules decide whether the fact warrants
 * a future-plan preview.
 */
export type AdaptivePlanReportInput =
  | {
      kind: "recovery";
      summary: string;
      perceivedRecovery?: number;
      fatigue?: number;
      sorenessArea?: string;
      sorenessSeverity?: number;
      /** 只允许规则引擎从明确的定性组合中生成；不把它伪装成用户评分。 */
      qualitativeAssessment?: "poor_sleep_localized_lower_soreness";
      /** 用户明确提出的下一节换课目标；当前仅支持可恢复性最高的肩部课。 */
      requestedTrainingFocus?: "shoulders";
    }
  | { kind: "schedule"; summary: string; unavailableDates: readonly string[] }
  | { kind: "missed_training"; summary: string; missedDates: readonly string[] }
  | {
      kind: "activity";
      summary: string;
      activityType: string;
      durationMinutes?: number;
      intensity?: "easy" | "moderate" | "hard" | "unknown";
    };

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
    description: "plan.show_today: Read an already-materialized plan for one date. Use only when the user asks what is planned; do not use for a reported schedule change, unavailable date, missed training, recovery change, or a request to adjust future sessions.",
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["current_local_plan"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["date"], properties: { date: { type: "string", format: "date" } } },
  },
  {
    name: "plan.show_current", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    description: "plan.show_current: Read the current materialized plan without changing it. Do not use when the user reports a new execution-time fact and asks to adjust the plan.",
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
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt", "options", "risk"],
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 320 },
        options: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              label: { type: "string", minLength: 1, maxLength: 120 },
            },
          },
        },
        risk: { enum: ["low", "review", "high"] },
      },
    },
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
    description: "timeline.record_user_report: Record a clear current-conversation user report as a Timeline fact. Use for completed training, activity, sleep, recovery, body, schedule, or rest facts when no future-plan adjustment is requested.",
    permissionScopes: ["coaching_mandate"], riskCeiling: "review", evidenceRequirements: ["current_user_statement"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { enum: ["training", "activity", "sleep", "recovery", "body", "schedule", "rest"] }, summary: { type: "string", maxLength: 240 }, note: { type: "string", maxLength: 480 }, exercises: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, sets: { type: "array", maxItems: 99, items: { type: "object", additionalProperties: false, properties: { reps: { type: "integer", minimum: 0, maximum: 200 }, loadKg: { type: "number", minimum: 0, maximum: 1000 }, rir: { type: "number", minimum: 0, maximum: 10 } } } } } } }, activityType: { type: "string", maxLength: 120 }, durationMinutes: { type: "number", minimum: 0, maximum: 1440 }, intensity: { enum: ["easy", "moderate", "hard", "unknown"] }, energyKcal: { type: "number", minimum: 0, maximum: 10000 }, energyEstimateKcal: { type: "number", minimum: 0, maximum: 10000 }, quality: { type: "integer", minimum: 1, maximum: 5 }, perceivedRecovery: { type: "integer", minimum: 1, maximum: 5 }, metric: { enum: ["body_weight", "body_fat_percentage"] }, value: { type: "number", minimum: 0, maximum: 1000 } } },
  },
  {
    name: "plan.adapt_from_user_report", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    description: "plan.adapt_from_user_report: Record an execution-time recovery, unavailable-date/schedule, missed-training, or extra-activity report and create a confirmation-required preview affecting only future sessions. For travel or no availability, use kind=schedule and pass unavailableDates. Prefer this over plan.show_today/current when the user explicitly asks to adjust.",
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["current_materialized_plan", "current_user_statement"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["kind", "summary"], properties: { kind: { enum: ["recovery", "schedule", "missed_training", "activity"] }, summary: { type: "string", minLength: 2, maxLength: 480 }, perceivedRecovery: { type: "integer", minimum: 1, maximum: 5 }, fatigue: { type: "integer", minimum: 1, maximum: 10 }, sorenessArea: { type: "string", maxLength: 120 }, sorenessSeverity: { type: "integer", minimum: 1, maximum: 10 }, qualitativeAssessment: { enum: ["poor_sleep_localized_lower_soreness"] }, requestedTrainingFocus: { enum: ["shoulders"] }, unavailableDates: { type: "array", minItems: 1, maxItems: 14, items: { type: "string", format: "date" } }, missedDates: { type: "array", minItems: 1, maxItems: 14, items: { type: "string", format: "date" } }, activityType: { type: "string", minLength: 1, maxLength: 120 }, durationMinutes: { type: "number", minimum: 0, maximum: 1440 }, intensity: { enum: ["easy", "moderate", "hard", "unknown"] } } },
  },
  {
    name: "nutrition.record_observation", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["user_stated_items"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", minItems: 1, maxItems: 20 }, mealSlot: { type: "string" }, note: { type: "string", maxLength: 240 } } },
  },
  {
    name: "plan.propose_energy_rebalance", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    description: "plan.propose_energy_rebalance: Record a user-reported meal or intake excess and create a gentle, confirmation-required future energy/activity rebalance. Pass excessKcal only when the user states or confirms it; never prescribe punishment, extreme restriction, or high-intensity compensation.",
    permissionScopes: ["coaching_mandate"], riskCeiling: "confirmation_required", evidenceRequirements: ["current_materialized_plan", "current_user_statement"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["description"], properties: { description: { type: "string", minLength: 2, maxLength: 240 }, excessKcal: { type: "number", minimum: 1, maximum: 10000 } } },
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

/**
 * Tools available only while the session is attached to one onboarding draft.
 * The model may choose a catalog field or save facts the person stated; it
 * cannot manufacture a Profile or a Plan from either operation.
 */
const ONBOARDING_TOOL_MANIFEST: readonly CoachToolManifest[] = Object.freeze([
  {
    name: "onboarding.capture_fields", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    description: "onboarding.capture_fields: Normalize values already stated in the current onboarding user message into the same dossier draft. These remain review-needed conversation extractions until the user confirms the dossier. Use instead of requesting a card when the user already gave the answer; do not use it to ask questions.",
    permissionScopes: [], riskCeiling: "review", evidenceRequirements: ["current_user_statement", "active_onboarding_draft"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["captures"], properties: { captures: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["fieldId", "value"], properties: { fieldId: { type: "string", minLength: 1, maxLength: 120 }, value: {} } } } } },
  },
  {
    name: "onboarding.capture_goal_narrative", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    description: "onboarding.capture_goal_narrative: Save a new or corrected goal statement exactly when the user states it in this onboarding conversation. It preserves the original wording and lets local normalization keep target facts separate from current measurements; never invent a target value.",
    permissionScopes: [], riskCeiling: "review", evidenceRequirements: ["current_user_statement", "active_onboarding_draft"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["narrative"], properties: { narrative: { type: "string", minLength: 1, maxLength: 600 } } },
  },
  {
    name: "onboarding.request_form", schemaVersion: 1, accessClass: "human_input", executionMode: "human_in_loop", offlineAvailable: true,
    description: "onboarding.request_form: Ask product-catalog questions as one dynamic form card. Include every currently material independent field selected by the goal frontier; there is no arbitrary field-count limit. Never ask onboarding questions in ordinary text, request a fixed questionnaire, or repeat a captured/explicitly-unknown field.",
    permissionScopes: [], riskCeiling: "confirmation_required", evidenceRequirements: ["active_onboarding_draft"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, required: ["topic", "fieldIds", "reasonCode", "requiredFor"], properties: { topic: { type: "string", minLength: 1, maxLength: 80 }, fieldIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1, maxLength: 120 } }, reasonCode: { enum: ["goal_disambiguation", "planning_gate", "safety_gate", "measurement_quality", "schedule_feasibility", "conflict_resolution"] }, requiredFor: { type: "string", minLength: 1, maxLength: 80 } } },
  },
  {
    name: "onboarding.capture_training_background", schemaVersion: 1, accessClass: "proposal", executionMode: "policy_gated", offlineAvailable: true,
    description: "onboarding.capture_training_background: Extract training facts from the current onboarding user message into a reviewable draft. Use for continuity, recent split, schedule, environment, equipment and exact comparable sets. Do not infer a beginner/intermediate/advanced level; follow with onboarding.assess_training_context when useful.",
    permissionScopes: [], riskCeiling: "review", evidenceRequirements: ["current_user_statement", "active_onboarding_draft"], output: "artifact_ref", outputLimit: 1,
    inputSchema: { type: "object", additionalProperties: false, properties: { cumulativeTrainingMonths: { type: "object", additionalProperties: false, required: ["minimum", "maximum"], properties: { minimum: { type: "integer", minimum: 0, maximum: 1200 }, maximum: { type: "integer", minimum: 0, maximum: 1200 } } }, recentContinuity: { type: "object", additionalProperties: false, properties: { consecutiveWeeks: { type: "integer", minimum: 0, maximum: 520 }, usualSessionsPerWeek: { type: "integer", minimum: 0, maximum: 14 }, timeAwayWeeks: { type: "integer", minimum: 0, maximum: 520 } } }, recentSplit: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 80 } }, exactExerciseFamiliarity: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 120 } }, comparableSets: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, required: ["exerciseVariantId", "loadKg", "reps", "performedOn"], properties: { exerciseVariantId: { type: "string", minLength: 1, maxLength: 120 }, loadKg: { type: "number", minimum: 0, maximum: 1000 }, reps: { type: "integer", minimum: 0, maximum: 200 }, rir: { type: "number", minimum: 0, maximum: 10 }, rpe: { type: "number", minimum: 1, maximum: 10 }, performedOn: { type: "string", format: "date" }, conditions: { type: "string", maxLength: 240 } } } }, environments: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 80 } }, availableEquipment: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 120 } }, schedule: { type: "object", additionalProperties: false, required: ["weeklyFrequency", "sessionDurationMinutes"], properties: { weeklyFrequency: { type: "integer", minimum: 1, maximum: 14 }, sessionDurationMinutes: { type: "integer", minimum: 10, maximum: 360 } } }, executionStability: { enum: ["reported_consistent", "reported_variable", "unknown"] } } },
  },
  {
    name: "onboarding.assess_training_context", schemaVersion: 1, accessClass: "read", executionMode: "local_deterministic", offlineAvailable: true,
    description: "onboarding.assess_training_context: Create a multi-dimensional assessment from the already captured training background. It does not assign a single level and preserves unknown dimensions.",
    permissionScopes: [], riskCeiling: "none", evidenceRequirements: ["active_onboarding_draft"], output: "artifact_ref", outputLimit: 1,
    inputSchema: EXACT_EMPTY_OBJECT,
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
      proposeEnergyRebalance(
        input: { sessionId: string; description: string; excessKcal?: number },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      adaptPlanFromUserReport(
        input: { sessionId: string; report: AdaptivePlanReportInput },
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
      requestOnboardingForm(
        input: { sessionId: string; proposal: import("../onboarding").OnboardingDynamicFormProposal },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      captureOnboardingTrainingBackground(
        input: { sessionId: string; background: Omit<import("../onboarding").TrainingBackgroundDraft, "capturedAt" | "source"> },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      assessOnboardingTrainingContext(
        input: { sessionId: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      captureOnboardingGoalNarrative(
        input: { sessionId: string; narrative: string },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
      captureOnboardingFields(
        input: { sessionId: string; captures: readonly { fieldId: string; value: unknown }[] },
        execution: ToolExecutionIdentity,
      ): Promise<ShowArtifactResult>;
    },
    private readonly options: { knowledgeToolsEnabled?: boolean; actionToolsEnabled?: boolean } = {},
  ) {}

  manifest(input?: { contextKind?: import("./model").CoachContextKind }): readonly CoachToolManifest[] {
    const base = this.options.knowledgeToolsEnabled
      ? [...COACH_TOOL_MANIFEST, ...KNOWLEDGE_TOOL_MANIFEST]
      : [...COACH_TOOL_MANIFEST];
    const withActions = this.options.actionToolsEnabled ? [...base, ...ACTION_TOOL_MANIFEST] : base;
    return input?.contextKind === "onboarding" ? [...withActions, ...ONBOARDING_TOOL_MANIFEST] : withActions;
  }

  async invoke(input: {
    sessionId: string;
    runId: string;
    call: CoachToolCall;
  }): Promise<readonly CoachRunEvent[]> {
    if (input.call.toolName === "onboarding.capture_fields") {
      const parsed = parseExactObject(input.call.input, ["captures"]);
      if (!Array.isArray(parsed.captures) || !parsed.captures.length) throw new ToolSchemaError("invalid_tool_input");
      const captures = parsed.captures.map((raw) => {
        const item = parseExactObject(raw, ["fieldId", "value"]);
        if (typeof item.fieldId !== "string" || !item.fieldId.trim() || item.value === undefined) throw new ToolSchemaError("invalid_tool_input");
        return { fieldId: item.fieldId.trim(), value: item.value };
      });
      if (new Set(captures.map((capture) => capture.fieldId)).size !== captures.length) throw new ToolSchemaError("invalid_tool_input");
      const result = await this.handlers.captureOnboardingFields({ sessionId: input.sessionId, captures }, { runId: input.runId, toolCallId: input.call.toolCallId });
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "onboarding.capture_goal_narrative") {
      const parsed = parseExactObject(input.call.input, ["narrative"]);
      if (typeof parsed.narrative !== "string" || !parsed.narrative.trim() || parsed.narrative.length > 600) throw new ToolSchemaError("invalid_tool_input");
      const result = await this.handlers.captureOnboardingGoalNarrative({ sessionId: input.sessionId, narrative: parsed.narrative.trim() }, { runId: input.runId, toolCallId: input.call.toolCallId });
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "onboarding.request_form") {
      const parsed = parseExactObject(input.call.input, ["topic", "fieldIds", "reasonCode", "requiredFor"]);
      if (typeof parsed.topic !== "string" || !Array.isArray(parsed.fieldIds) || parsed.fieldIds.some((field) => typeof field !== "string") || typeof parsed.reasonCode !== "string" || typeof parsed.requiredFor !== "string") throw new ToolSchemaError("invalid_tool_input");
      const result = await this.handlers.requestOnboardingForm({ sessionId: input.sessionId, proposal: { topic: parsed.topic, fieldIds: parsed.fieldIds, reasonCode: parsed.reasonCode as import("../onboarding").OnboardingQuestionReasonCode, requiredFor: parsed.requiredFor as import("../onboarding").OnboardingActionGate } }, { runId: input.runId, toolCallId: input.call.toolCallId });
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "onboarding.capture_training_background") {
      const background = parseOnboardingTrainingBackground(input.call.input);
      const result = await this.handlers.captureOnboardingTrainingBackground({ sessionId: input.sessionId, background }, { runId: input.runId, toolCallId: input.call.toolCallId });
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "onboarding.assess_training_context") {
      parseExactObject(input.call.input, []);
      const result = await this.handlers.assessOnboardingTrainingContext({ sessionId: input.sessionId }, { runId: input.runId, toolCallId: input.call.toolCallId });
      return this.validateResultIdentity(input, result.events);
    }
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
    if (input.call.toolName === "plan.propose_energy_rebalance") {
      if (!this.options.actionToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const parsed = parseExactObject(input.call.input, ["description", "excessKcal"]);
      const description = optionalString(parsed.description, 240);
      const excessKcal = optionalBoundedNumber(parsed.excessKcal, 1, 10_000);
      if (!description || (parsed.excessKcal !== undefined && excessKcal === undefined)) throw new ToolSchemaError("invalid_tool_input");
      const result = await this.handlers.proposeEnergyRebalance(
        { sessionId: input.sessionId, description, ...(excessKcal === undefined ? {} : { excessKcal }) },
        { runId: input.runId, toolCallId: input.call.toolCallId },
      );
      return this.validateResultIdentity(input, result.events);
    }
    if (input.call.toolName === "plan.adapt_from_user_report") {
      if (!this.options.actionToolsEnabled) throw new ToolSchemaError("unknown_tool");
      const result = await this.handlers.adaptPlanFromUserReport(
        { sessionId: input.sessionId, report: parseAdaptivePlanReport(input.call.input) },
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
  if (parsed.kind === "schedule" || parsed.kind === "rest") {
    const summary = optionalString(parsed.summary, 240) ?? note;
    if (!summary) throw new ToolSchemaError("invalid_tool_input");
    return { kind: parsed.kind, summary };
  }
  throw new ToolSchemaError("invalid_tool_input");
}

function parseAdaptivePlanReport(input: unknown): AdaptivePlanReportInput {
  const parsed = parseExactObject(input, ["kind", "summary", "perceivedRecovery", "fatigue", "sorenessArea", "sorenessSeverity", "qualitativeAssessment", "requestedTrainingFocus", "unavailableDates", "missedDates", "activityType", "durationMinutes", "intensity"]);
  const kind = parsed.kind;
  const summary = optionalString(parsed.summary, 480);
  if (!summary) throw new ToolSchemaError("invalid_tool_input");
  const dates = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value) || !value.length || value.length > 14 || value.some((item) => typeof item !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item))) return undefined;
    return [...new Set(value)].sort();
  };
  if (kind === "recovery") {
    const perceivedRecovery = optionalBoundedInteger(parsed.perceivedRecovery, 1, 5);
    const fatigue = optionalBoundedInteger(parsed.fatigue, 1, 10);
    const sorenessArea = optionalString(parsed.sorenessArea, 120);
    const sorenessSeverity = optionalBoundedInteger(parsed.sorenessSeverity, 1, 10);
    const qualitativeAssessment = parsed.qualitativeAssessment === "poor_sleep_localized_lower_soreness" ? parsed.qualitativeAssessment : undefined;
    const requestedTrainingFocus = parsed.requestedTrainingFocus === "shoulders" ? parsed.requestedTrainingFocus : undefined;
    if ((parsed.perceivedRecovery !== undefined && perceivedRecovery === undefined) || (parsed.fatigue !== undefined && fatigue === undefined) || (parsed.sorenessArea !== undefined && sorenessArea === undefined) || (parsed.sorenessSeverity !== undefined && sorenessSeverity === undefined) || (sorenessArea === undefined && sorenessSeverity !== undefined) || (parsed.qualitativeAssessment !== undefined && qualitativeAssessment === undefined) || (parsed.requestedTrainingFocus !== undefined && requestedTrainingFocus === undefined) || (perceivedRecovery === undefined && fatigue === undefined && sorenessSeverity === undefined && qualitativeAssessment === undefined)) throw new ToolSchemaError("invalid_tool_input");
    return { kind, summary, ...(perceivedRecovery === undefined ? {} : { perceivedRecovery }), ...(fatigue === undefined ? {} : { fatigue }), ...(sorenessArea === undefined ? {} : { sorenessArea }), ...(sorenessSeverity === undefined ? {} : { sorenessSeverity }), ...(qualitativeAssessment === undefined ? {} : { qualitativeAssessment }), ...(requestedTrainingFocus === undefined ? {} : { requestedTrainingFocus }) };
  }
  if (kind === "schedule" || kind === "missed_training") {
    const key = kind === "schedule" ? "unavailableDates" : "missedDates";
    const value = dates(parsed[key]);
    if (!value) throw new ToolSchemaError("invalid_tool_input");
    return kind === "schedule" ? { kind, summary, unavailableDates: value } : { kind, summary, missedDates: value };
  }
  if (kind === "activity") {
    const activityType = optionalString(parsed.activityType, 120);
    const durationMinutes = optionalBoundedNumber(parsed.durationMinutes, 0, 1440);
    const intensity = parsed.intensity;
    if (!activityType || (parsed.durationMinutes !== undefined && durationMinutes === undefined) || (intensity !== undefined && intensity !== "easy" && intensity !== "moderate" && intensity !== "hard" && intensity !== "unknown")) throw new ToolSchemaError("invalid_tool_input");
    return { kind, summary, activityType, ...(durationMinutes === undefined ? {} : { durationMinutes }), ...(intensity === undefined ? {} : { intensity }) };
  }
  throw new ToolSchemaError("invalid_tool_input");
}

function parseOnboardingTrainingBackground(
  input: unknown,
): Omit<import("../onboarding").TrainingBackgroundDraft, "capturedAt" | "source"> {
  const parsed = parseExactObject(input, ["cumulativeTrainingMonths", "recentContinuity", "recentSplit", "exactExerciseFamiliarity", "comparableSets", "environments", "availableEquipment", "schedule", "executionStability"]);
  const stringList = (value: unknown, maximum: number): readonly string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item.trim())) throw new ToolSchemaError("invalid_tool_input");
    return [...new Set(value.map((item) => item.trim()))];
  };
  const months = parsed.cumulativeTrainingMonths === undefined ? undefined : parseExactObject(parsed.cumulativeTrainingMonths, ["minimum", "maximum"]);
  const minimumMonths = months ? optionalBoundedInteger(months.minimum, 0, 1200) : undefined;
  const maximumMonths = months ? optionalBoundedInteger(months.maximum, 0, 1200) : undefined;
  if (months && (minimumMonths === undefined || maximumMonths === undefined || maximumMonths < minimumMonths)) throw new ToolSchemaError("invalid_tool_input");
  const continuity = parsed.recentContinuity === undefined ? undefined : parseExactObject(parsed.recentContinuity, ["consecutiveWeeks", "usualSessionsPerWeek", "timeAwayWeeks"]);
  const consecutiveWeeks = continuity?.consecutiveWeeks === undefined ? undefined : optionalBoundedInteger(continuity.consecutiveWeeks, 0, 520);
  const usualSessionsPerWeek = continuity?.usualSessionsPerWeek === undefined ? undefined : optionalBoundedInteger(continuity.usualSessionsPerWeek, 0, 14);
  const timeAwayWeeks = continuity?.timeAwayWeeks === undefined ? undefined : optionalBoundedInteger(continuity.timeAwayWeeks, 0, 520);
  if (continuity && ((continuity.consecutiveWeeks !== undefined && consecutiveWeeks === undefined) || (continuity.usualSessionsPerWeek !== undefined && usualSessionsPerWeek === undefined) || (continuity.timeAwayWeeks !== undefined && timeAwayWeeks === undefined))) throw new ToolSchemaError("invalid_tool_input");
  const schedule = parsed.schedule === undefined ? undefined : parseExactObject(parsed.schedule, ["weeklyFrequency", "sessionDurationMinutes"]);
  const weeklyFrequency = schedule ? optionalBoundedInteger(schedule.weeklyFrequency, 1, 14) : undefined;
  const sessionDurationMinutes = schedule ? optionalBoundedInteger(schedule.sessionDurationMinutes, 10, 360) : undefined;
  if (schedule && (weeklyFrequency === undefined || sessionDurationMinutes === undefined)) throw new ToolSchemaError("invalid_tool_input");
  const executionStability = parsed.executionStability;
  if (executionStability !== undefined && executionStability !== "reported_consistent" && executionStability !== "reported_variable" && executionStability !== "unknown") throw new ToolSchemaError("invalid_tool_input");
  const comparableSets = parsed.comparableSets === undefined ? undefined : parseOnboardingComparableSets(parsed.comparableSets);
  const background = {
    ...(months ? { cumulativeTrainingMonths: { minimum: minimumMonths!, maximum: maximumMonths! } } : {}),
    ...(continuity ? { recentContinuity: { ...(consecutiveWeeks === undefined ? {} : { consecutiveWeeks }), ...(usualSessionsPerWeek === undefined ? {} : { usualSessionsPerWeek }), ...(timeAwayWeeks === undefined ? {} : { timeAwayWeeks }) } } : {}),
    ...(stringList(parsed.recentSplit, 10) ? { recentSplit: stringList(parsed.recentSplit, 10) } : {}),
    ...(stringList(parsed.exactExerciseFamiliarity, 20) ? { exactExerciseFamiliarity: stringList(parsed.exactExerciseFamiliarity, 20) } : {}),
    ...(comparableSets ? { comparableSets } : {}),
    ...(stringList(parsed.environments, 8) ? { environments: stringList(parsed.environments, 8) } : {}),
    ...(stringList(parsed.availableEquipment, 30) ? { availableEquipment: stringList(parsed.availableEquipment, 30) } : {}),
    ...(schedule ? { schedule: { weeklyFrequency: weeklyFrequency!, sessionDurationMinutes: sessionDurationMinutes! } } : {}),
    ...(executionStability ? { executionStability: executionStability as "reported_consistent" | "reported_variable" | "unknown" } : {}),
  };
  if (!Object.keys(background).length) throw new ToolSchemaError("invalid_tool_input");
  return background;
}

function parseOnboardingComparableSets(value: unknown): NonNullable<import("../onboarding").TrainingBackgroundDraft["comparableSets"]> {
  if (!Array.isArray(value) || !value.length || value.length > 10) throw new ToolSchemaError("invalid_tool_input");
  return value.map((raw) => {
    const set = parseExactObject(raw, ["exerciseVariantId", "loadKg", "reps", "rir", "rpe", "performedOn", "conditions"]);
    const loadKg = optionalBoundedNumber(set.loadKg, 0, 1000);
    const reps = optionalBoundedInteger(set.reps, 0, 200);
    if (typeof set.exerciseVariantId !== "string" || !set.exerciseVariantId.trim() || loadKg === undefined || reps === undefined || typeof set.performedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(set.performedOn)) throw new ToolSchemaError("invalid_tool_input");
    if ((set.rir !== undefined && (typeof set.rir !== "number" || !Number.isFinite(set.rir) || set.rir < 0 || set.rir > 10)) || (set.rpe !== undefined && (typeof set.rpe !== "number" || !Number.isFinite(set.rpe) || set.rpe < 1 || set.rpe > 10)) || (set.conditions !== undefined && (typeof set.conditions !== "string" || set.conditions.length > 240))) throw new ToolSchemaError("invalid_tool_input");
    return { exerciseVariantId: set.exerciseVariantId.trim(), load: { value: loadKg, unit: "kg" as const }, reps, ...(typeof set.rir === "number" ? { rir: set.rir } : {}), ...(typeof set.rpe === "number" ? { rpe: set.rpe } : {}), performedOn: set.performedOn, ...(typeof set.conditions === "string" && set.conditions.trim() ? { conditions: set.conditions.trim() } : {}) };
  });
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
