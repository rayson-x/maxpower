import { buildTraceEnvelope, traceContentHash, type TraceEnvelope, type TraceEventKind } from "./model";
import type { TraceRecorder, TraceWriteContext } from "./TraceRecorder";

/**
 * 决策边界是闭集：分析的是可验证的动作边界，而不是模型的私有推理步骤。
 * 新边界必须先扩展此目录和评估口径，不能在调用处发明自由文本分类。
 */
export const BEHAVIOR_DECISION_BOUNDARIES = [
  "timeline_admission",
  "capability_visibility",
  "tool_selection",
  "tool_validation",
  "materiality",
  "risk_evaluation",
  "planner_candidate",
  "plan_validation",
  "notification",
  "live_cue",
] as const;

export type BehaviorDecisionBoundary = (typeof BEHAVIOR_DECISION_BOUNDARIES)[number];

/** 每次边界都显式记录正向和负向结论，避免「没有 trace = 没有发生」。 */
export const BEHAVIOR_DECISION_OUTCOMES = [
  "accepted",
  "evaluated",
  "coalesced",
  "skipped",
  "stale",
  "rejected",
  "failed",
  "completed",
] as const;

export type BehaviorDecisionOutcome = (typeof BEHAVIOR_DECISION_OUTCOMES)[number];

/**
 * 首版 reason-code 目录。它有意只表达可审计的产品/策略事实；原始对话、
 * 自由解释和 Chain of Thought 均没有字段可写入。
 */
export const BEHAVIOR_DECISION_REASON_CODES = [
  "timeline_admitted",
  "timeline_duplicate",
  "timeline_unconfirmed",
  "timeline_invalid",
  "capability_visible",
  "capability_hidden_by_permission",
  "capability_hidden_by_mandate",
  "capability_hidden_by_fact",
  "tool_selected",
  "tool_not_selected",
  "tool_schema_valid",
  "tool_schema_invalid",
  "tool_policy_allowed",
  "tool_policy_rejected",
  "material_change",
  "not_material",
  "evaluation_coalesced",
  "evaluation_skipped",
  "evaluation_failed",
  "stale_fact_frontier",
  "stale_goal_contract",
  "stale_plan_revision",
  "risk_on_path",
  "risk_at_risk",
  "risk_infeasible_under_guardrails",
  "risk_insufficient_evidence",
  "planner_candidate_improves_path",
  "planner_no_safe_candidate",
  "plan_invariants_valid",
  "plan_invariants_rejected",
  "notification_scheduled",
  "notification_suppressed_by_preference",
  "notification_delivery_failed",
  "live_cue_stable_signal",
  "live_cue_low_confidence",
  "live_cue_rate_limited",
  "live_cue_safety_hold",
] as const;

export type BehaviorDecisionReasonCode = (typeof BEHAVIOR_DECISION_REASON_CODES)[number];

export const BEHAVIOR_EXPECTED_SIGNALS = [
  "none",
  "timeline_change",
  "user_confirmation",
  "user_rejection",
  "execution_observed",
  "measurement_observed",
  "notification_delivery",
] as const;

export type BehaviorExpectedSignal = (typeof BEHAVIOR_EXPECTED_SIGNALS)[number];

export const BEHAVIOR_ACTUAL_OUTCOMES = [
  "not_observed",
  "confirmed",
  "rejected",
  "executed",
  "ignored",
  "improved",
  "not_improved",
] as const;

export type BehaviorActualOutcome = (typeof BEHAVIOR_ACTUAL_OUTCOMES)[number];

/**
 * 仅存可验证决策边界的结构化证据。所有引用都是 opaque IDs，不包含原话、
 * prompt、工具原始入参或模型思维链。
 */
export interface BehaviorDecisionRecord {
  schemaVersion: 1;
  decisionId: string;
  traceId: string;
  sessionId: string;
  occurredAt: string;
  actor: string;
  userPseudonym: string;
  deviceId: string;
  boundary: BehaviorDecisionBoundary;
  outcome: BehaviorDecisionOutcome;
  causationIds: readonly string[];
  factFrontier: readonly string[];
  versionPins: Readonly<Record<string, string>>;
  inputRefs: readonly string[];
  artifactRefs?: readonly string[];
  reasonCodes: readonly BehaviorDecisionReasonCode[];
  expectedSignal?: BehaviorExpectedSignal;
  actualOutcome?: BehaviorActualOutcome;
  durationMs?: number;
}

export type BehaviorDecisionRecordInput = Omit<BehaviorDecisionRecord, "schemaVersion" | "decisionId">;

export type BehaviorDecisionRecordValidationCode =
  | "missing_identity"
  | "unknown_boundary"
  | "unknown_outcome"
  | "unknown_reason_code"
  | "missing_causation"
  | "invalid_expected_signal"
  | "invalid_actual_outcome";

export class BehaviorDecisionRecordValidationError extends Error {
  constructor(readonly code: BehaviorDecisionRecordValidationCode) {
    super(`behavior_decision_${code}`);
    this.name = "BehaviorDecisionRecordValidationError";
  }
}

export function buildBehaviorDecisionRecord(input: BehaviorDecisionRecordInput): BehaviorDecisionRecord {
  validateBehaviorDecisionRecordInput(input);
  const decisionId = `bdr-${traceContentHash(input)}`;
  return { schemaVersion: 1, decisionId, ...input };
}

export function behaviorDecisionTraceEnvelope(record: BehaviorDecisionRecord): TraceEnvelope {
  validateBehaviorDecisionRecord(record);
  return buildTraceEnvelope({
    traceId: record.traceId,
    sessionId: record.sessionId,
    kind: behaviorDecisionTraceKind(record.boundary),
    name: `decision.${record.boundary}.${record.outcome}`,
    occurredAt: record.occurredAt,
    actor: record.actor,
    userPseudonym: record.userPseudonym,
    deviceId: record.deviceId,
    outcome: traceOutcome(record.outcome),
    decisionId: record.decisionId,
    causationIds: record.causationIds,
    factRefs: record.factFrontier,
    inputRefs: record.inputRefs,
    ...(record.artifactRefs ? { artifactRefs: record.artifactRefs } : {}),
    versionPins: record.versionPins,
    decisionCodes: record.reasonCodes,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    metadata: {
      decisionBoundary: record.boundary,
      decisionOutcome: record.outcome,
      ...(record.expectedSignal ? { expectedSignal: record.expectedSignal } : {}),
      ...(record.actualOutcome ? { actualOutcome: record.actualOutcome } : {}),
    },
  });
}

/**
 * 给 Timeline/Risk/Planner 等异步协调器的唯一写入适配器。它复用既有
 * TraceRecorder，因此本地 JSONL、TraceOutbox 和去重语义完全不分叉。
 */
export class BehaviorDecisionTraceRecorder {
  constructor(private readonly recorder: TraceRecorder) {}

  async record(
    record: BehaviorDecisionRecord,
    context: TraceWriteContext,
  ): Promise<TraceEnvelope | undefined> {
    const envelope = behaviorDecisionTraceEnvelope(record);
    await this.recorder.writeEnvelope(envelope, context);
    return this.recorder.enabled ? envelope : undefined;
  }
}

export function validateBehaviorDecisionRecord(record: BehaviorDecisionRecord): void {
  if (record.schemaVersion !== 1) {
    throw new BehaviorDecisionRecordValidationError("missing_identity");
  }
  validateBehaviorDecisionRecordInput(record);
  if (!record.decisionId) throw new BehaviorDecisionRecordValidationError("missing_identity");
}

function validateBehaviorDecisionRecordInput(input: BehaviorDecisionRecordInput): void {
  if (
    !input.traceId ||
    !input.sessionId ||
    !input.occurredAt ||
    !input.actor ||
    !input.userPseudonym ||
    !input.deviceId
  ) {
    throw new BehaviorDecisionRecordValidationError("missing_identity");
  }
  if (!BEHAVIOR_DECISION_BOUNDARIES.includes(input.boundary)) {
    throw new BehaviorDecisionRecordValidationError("unknown_boundary");
  }
  if (!BEHAVIOR_DECISION_OUTCOMES.includes(input.outcome)) {
    throw new BehaviorDecisionRecordValidationError("unknown_outcome");
  }
  if (!input.causationIds.length) {
    throw new BehaviorDecisionRecordValidationError("missing_causation");
  }
  if (!input.reasonCodes.length || input.reasonCodes.some((code) => !BEHAVIOR_DECISION_REASON_CODES.includes(code))) {
    throw new BehaviorDecisionRecordValidationError("unknown_reason_code");
  }
  if (input.expectedSignal && !BEHAVIOR_EXPECTED_SIGNALS.includes(input.expectedSignal)) {
    throw new BehaviorDecisionRecordValidationError("invalid_expected_signal");
  }
  if (input.actualOutcome && !BEHAVIOR_ACTUAL_OUTCOMES.includes(input.actualOutcome)) {
    throw new BehaviorDecisionRecordValidationError("invalid_actual_outcome");
  }
}

function behaviorDecisionTraceKind(boundary: BehaviorDecisionBoundary): TraceEventKind {
  switch (boundary) {
    case "timeline_admission":
    case "tool_selection":
      return "agent";
    case "capability_visibility":
    case "plan_validation":
      return "guardrail";
    case "tool_validation":
      return "tool";
    case "planner_candidate":
      return "plan";
    case "notification":
      return "recipe";
    case "materiality":
    case "risk_evaluation":
    case "live_cue":
      return "evaluator";
  }
}

function traceOutcome(outcome: BehaviorDecisionOutcome): TraceEnvelope["outcome"] {
  if (outcome === "failed") return "failed";
  if (outcome === "rejected") return "rejected";
  if (outcome === "coalesced" || outcome === "skipped" || outcome === "stale") return "degraded";
  return "ok";
}
