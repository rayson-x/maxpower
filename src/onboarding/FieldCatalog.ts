import type {
  OnboardingActionGate,
  OnboardingDynamicFieldCapture,
  OnboardingDynamicFormRequest,
  OnboardingInputSource,
  OnboardingProgress,
  OnboardingQuestionReasonCode,
} from "./model";
import type { AgentKnowledgeHarness } from "../agent-knowledge";
import type { AgentKnowledgeArtifactRef } from "../agent-knowledge/model";
import type { KnowledgeVersionPin } from "../agent-knowledge/runtimeSelection";

/** Product-owned version pin. A model may reference IDs, never define schema. */
export const ONBOARDING_FIELD_CATALOG_VERSION = "onboarding-field-catalog/v1" as const;

export type OnboardingFieldOwner =
  | "user_profile"
  | "goal_contract"
  | "coaching_mandate"
  | "permission_set"
  | "safety_constraint"
  | "timeline_baseline"
  | "nutrition_strategy"
  | "working_memory";

export type OnboardingFieldControl =
  | { kind: "single_line_text" }
  | { kind: "multiline_text" }
  | { kind: "numeric_with_unit"; units: readonly string[]; min?: number; max?: number }
  | { kind: "single_select"; options: readonly { id: string; label: string }[] }
  | { kind: "multi_select"; options: readonly { id: string; label: string }[] }
  | { kind: "date" }
  | { kind: "date_range" }
  | {
      kind: "segmented_scale";
      minimum: number;
      maximum: number;
      step: number;
      valueLabel: string;
      keyboardAlternative: true;
      incrementDecrementAlternative: true;
    }
  | { kind: "field_group"; fields: readonly string[] };

export interface OnboardingFieldDefinition {
  id: string;
  owner: OnboardingFieldOwner;
  valueType: "text" | "quantity" | "enum" | "multi_enum" | "date" | "date_range" | "compound" | "ordinal";
  sensitivity: "standard" | "health" | "body" | "nutrition";
  label: string;
  control: OnboardingFieldControl;
  /** The only gates for which this field can be requested. */
  requiredFor: readonly OnboardingActionGate[];
  themes: readonly string[];
  allowedSources: readonly OnboardingInputSource["kind"][];
  acceptsExplicitUnknown: boolean;
  writeCommand: string;
  dependencies?: readonly string[];
  /** Compiled Agent Knowledge decisions whose input schema consumes this fact. */
  knowledgeArtifactIds?: readonly string[];
}

/**
 * The local, inspectable intake frontier. It suggests the next decision that
 * is unblocked by the draft. Every question is rendered through the product
 * form-card tool; conversation capture is reserved for facts the user already
 * volunteered.
 */
export interface OnboardingKnowledgeRequirement {
  artifactRef: AgentKnowledgeArtifactRef;
  title: { readonly zh?: string; readonly en?: string };
  tags: readonly string[];
  sourceClaimRefs: readonly string[];
  fieldIds: readonly string[];
}

export type KnowledgeDrivenOnboardingFrontier =
  | { kind: "assess_training_context"; reason: "training_background_captured" }
  | {
      kind: "knowledge_requirements";
      reason: "active_agent_knowledge_inputs";
      knowledgeReleasePin: KnowledgeVersionPin;
      requirements: readonly OnboardingKnowledgeRequirement[];
    }
  | { kind: "review_dossier"; reason: "no_unblocked_knowledge_requirements" };

const catalog = [
  {
    id: "profile.sex",
    owner: "user_profile",
    valueType: "enum",
    sensitivity: "body",
    label: "用于估算能量的生理性别",
    control: {
      kind: "single_select",
      options: [
        { id: "male", label: "男性" },
        { id: "female", label: "女性" },
        { id: "prefer_not_to_say", label: "不想说明" },
      ],
    },
    requiredFor: ["reliable_energy_target", "initial_plan"],
    themes: ["energy_planning", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_profile_sex",
    knowledgeArtifactIds: ["calculator.initial-plan.energy-budget"],
  },
  {
    id: "timeline.daily_activity",
    owner: "timeline_baseline",
    valueType: "enum",
    sensitivity: "standard",
    label: "日常活动",
    control: {
      kind: "single_select",
      options: [
        { id: "sedentary_remote_work", label: "久坐 / 居家办公" },
        { id: "mixed_activity", label: "日常活动一般" },
        { id: "active_job", label: "工作中活动较多" },
      ],
    },
    requiredFor: ["reliable_energy_target", "initial_plan"],
    themes: ["energy_planning", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_timeline_daily_activity",
    knowledgeArtifactIds: ["calculator.initial-plan.energy-budget", "action.initial-plan.schedule-aerobic"],
  },
  {
    id: "nutrition.usual_intake",
    owner: "nutrition_strategy",
    valueType: "quantity",
    sensitivity: "nutrition",
    label: "平时每日摄入",
    control: { kind: "numeric_with_unit", units: ["kcal"], min: 0, max: 10000 },
    requiredFor: ["reliable_energy_target", "initial_plan"],
    themes: ["energy_planning", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_usual_energy_intake",
    knowledgeArtifactIds: ["calculator.initial-plan.energy-budget"],
  },
  {
    id: "profile.training_schedule",
    owner: "user_profile",
    valueType: "compound",
    sensitivity: "standard",
    label: "可训练的频率和时长",
    control: { kind: "field_group", fields: ["days_per_week", "minutes_per_session"] },
    requiredFor: ["dated_session_schedule", "initial_plan"],
    themes: ["schedule_feasibility", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_training_schedule",
    knowledgeArtifactIds: ["action.initial-plan.select-split", "action.initial-plan.schedule-recovery", "action.initial-plan.schedule-aerobic"],
  },
  {
    id: "mandate.plan_adjustment_authority",
    owner: "coaching_mandate",
    valueType: "enum",
    sensitivity: "standard",
    label: "计划调整希望如何确认",
    control: {
      kind: "single_select",
      options: [
        { id: "ask_every_time", label: "每次先问我" },
        { id: "suggest_then_confirm", label: "给出建议后由我确认" },
      ],
    },
    requiredFor: ["managed_plan_changes", "initial_plan"],
    themes: ["coaching_collaboration", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_plan_adjustment_authority",
    knowledgeArtifactIds: ["policy.maxpower.initial-planning-baseline"],
  },
  {
    id: "permission.remote_llm",
    owner: "permission_set",
    valueType: "enum",
    sensitivity: "health",
    label: "是否允许使用远程对话能力",
    control: {
      kind: "single_select",
      options: [
        { id: "granted", label: "允许" },
        { id: "denied", label: "暂不允许" },
      ],
    },
    requiredFor: ["remote_coach_conversation"],
    themes: ["permission"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: false,
    writeCommand: "onboarding.capture_remote_llm_permission",
  },
  {
    id: "training.cumulative_months",
    owner: "working_memory",
    valueType: "quantity",
    sensitivity: "standard",
    label: "累计规律训练时间",
    control: { kind: "numeric_with_unit", units: ["month"], min: 0, max: 1200 },
    requiredFor: ["initial_plan"],
    themes: ["goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_training_months",
    knowledgeArtifactIds: ["action.initial-plan.select-split", "action.initial-plan.allocate-dose"],
  },
  {
    id: "training.recent_continuity",
    owner: "working_memory",
    valueType: "compound",
    sensitivity: "standard",
    label: "最近训练连续性",
    control: { kind: "field_group", fields: ["consecutive_weeks", "usual_sessions_per_week", "time_away_weeks"] },
    requiredFor: ["initial_plan"],
    themes: ["goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_training_continuity",
    knowledgeArtifactIds: ["action.initial-plan.select-split", "action.initial-plan.allocate-dose"],
  },
  {
    id: "training.recent_split",
    owner: "working_memory",
    valueType: "text",
    sensitivity: "standard",
    label: "最近怎么分配训练部位",
    control: { kind: "multiline_text" },
    requiredFor: ["initial_plan"],
    themes: ["goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_recent_split",
    knowledgeArtifactIds: ["action.initial-plan.select-split", "action.initial-plan.schedule-recovery"],
  },
  {
    id: "training.environment",
    owner: "working_memory",
    valueType: "multi_enum",
    sensitivity: "standard",
    label: "通常在哪里训练",
    control: { kind: "multi_select", options: [{ id: "gym", label: "健身房" }, { id: "home", label: "家里" }, { id: "outdoor", label: "户外" }] },
    requiredFor: ["initial_plan"],
    themes: ["goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_training_environment",
    knowledgeArtifactIds: ["action.initial-plan.resolve-exercises"],
  },
  {
    id: "training.equipment",
    owner: "working_memory",
    valueType: "multi_enum",
    sensitivity: "standard",
    label: "可用训练器械",
    control: { kind: "multi_select", options: [{ id: "full_gym", label: "完整健身房" }, { id: "barbell", label: "杠铃" }, { id: "dumbbells", label: "哑铃" }, { id: "rack", label: "深蹲架" }, { id: "machines", label: "固定器械" }, { id: "cables", label: "绳索器械" }, { id: "bodyweight", label: "徒手" }] },
    requiredFor: ["initial_plan"],
    themes: ["goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_training_equipment",
    knowledgeArtifactIds: ["action.initial-plan.resolve-exercises", "validator.initial-plan.exercise-equipment"],
  },
  {
    id: "training.execution_stability",
    owner: "working_memory",
    valueType: "enum",
    sensitivity: "standard",
    label: "训练动作与强度执行是否稳定",
    control: { kind: "single_select", options: [{ id: "reported_consistent", label: "大多数时候稳定" }, { id: "reported_variable", label: "经常波动" }, { id: "unknown", label: "不确定" }] },
    requiredFor: ["initial_plan"],
    themes: ["goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_execution_stability",
    knowledgeArtifactIds: ["action.initial-plan.allocate-dose"],
  },
  {
    id: "training.comparable_set",
    owner: "timeline_baseline",
    valueType: "compound",
    sensitivity: "standard",
    label: "一组近期可比较的训练表现",
    control: {
      kind: "field_group",
      fields: ["exercise_variant", "load", "reps", "effort_metric", "effort_value", "performed_on", "conditions"],
    },
    requiredFor: ["comparable_strength_progression", "initial_plan"],
    themes: ["strength_baseline", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_comparable_training_set",
    knowledgeArtifactIds: ["action.initial-plan.allocate-dose"],
  },
  {
    id: "safety.activity_restrictions",
    owner: "safety_constraint",
    valueType: "multi_enum",
    sensitivity: "health",
    label: "当前需要避开的活动",
    control: {
      kind: "multi_select",
      options: [
        { id: "none_declared", label: "没有特别限制" },
        { id: "pain_or_injury", label: "疼痛或受伤" },
        { id: "medical_restriction", label: "专业人士要求限制活动" },
      ],
    },
    requiredFor: ["high_intensity_cardio", "exercise_selection", "initial_plan"],
    themes: ["safety_check", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_activity_restrictions",
    knowledgeArtifactIds: ["policy.maxpower.initial-planning-baseline", "action.initial-plan.schedule-aerobic"],
  },
  {
    id: "goal.target_horizon",
    owner: "goal_contract",
    valueType: "date_range",
    sensitivity: "standard",
    label: "希望达成目标的时间",
    control: { kind: "date_range" },
    requiredFor: ["dated_session_schedule", "body_composition_trend", "initial_plan"],
    themes: ["goal_timing", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_goal_horizon",
    knowledgeArtifactIds: ["calculator.initial-plan.energy-budget"],
  },
  {
    id: "profile.body_measurement_method",
    owner: "timeline_baseline",
    valueType: "enum",
    sensitivity: "body",
    label: "体脂或围度的记录方式",
    control: {
      kind: "single_select",
      options: [
        { id: "scale", label: "体脂秤" },
        { id: "caliper", label: "皮脂钳" },
        { id: "tape_or_photo", label: "围度或照片" },
        { id: "unknown_method", label: "不确定" },
      ],
    },
    requiredFor: ["body_composition_trend", "initial_plan"],
    themes: ["measurement_quality", "goal_based_intake"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_measurement_method",
    knowledgeArtifactIds: ["objective.fat-loss.reduce-waist"],
  },
  {
    id: "readiness.perceived_recovery",
    owner: "working_memory",
    valueType: "ordinal",
    sensitivity: "health",
    label: "最近恢复感受",
    control: {
      kind: "segmented_scale",
      minimum: 1,
      maximum: 5,
      step: 1,
      valueLabel: "1 很差，5 很好",
      keyboardAlternative: true,
      incrementDecrementAlternative: true,
    },
    requiredFor: ["high_intensity_cardio"],
    themes: ["recovery_check"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_recovery_note",
  },
] as const satisfies readonly OnboardingFieldDefinition[];

export const ONBOARDING_FIELD_CATALOG: readonly OnboardingFieldDefinition[] = catalog;

export type OnboardingDynamicFormProposal = Pick<
  OnboardingDynamicFormRequest,
  "topic" | "fieldIds" | "reasonCode" | "requiredFor" | "knowledgeArtifactIds" | "knowledgeArtifactRefs" | "knowledgeReleasePin"
>;

export interface DynamicFormCard extends OnboardingDynamicFormRequest {
  fields: readonly OnboardingFieldDefinition[];
}

export type DynamicFieldInput = Pick<
  OnboardingDynamicFieldCapture,
  "fieldId" | "state" | "value" | "observedAt" | "source"
>;

export type DynamicFormAnswer = Pick<DynamicFieldInput, "fieldId" | "state" | "value">;

const reasonCodes = new Set<OnboardingQuestionReasonCode>([
  "goal_disambiguation", "planning_gate", "safety_gate", "measurement_quality", "schedule_feasibility", "conflict_resolution",
]);

export function fieldById(id: string): OnboardingFieldDefinition | undefined {
  return catalog.find((field) => field.id === id);
}

export function validateDynamicFormProposal(
  progress: OnboardingProgress,
  proposal: OnboardingDynamicFormProposal,
): readonly OnboardingFieldDefinition[] {
  if (!reasonCodes.has(proposal.reasonCode) || !proposal.topic || proposal.fieldIds.length === 0) {
    throw new Error("dynamic_form_rejected");
  }
  const fields = proposal.fieldIds.map(fieldById);
  if (fields.some((field) => !field) || new Set(proposal.fieldIds).size !== proposal.fieldIds.length) {
    throw new Error("dynamic_form_rejected");
  }
  const resolved = fields as OnboardingFieldDefinition[];
  if (!resolved.every((field) => field.themes.includes(proposal.topic) && field.requiredFor.includes(proposal.requiredFor))) {
    throw new Error("dynamic_form_rejected");
  }
  // A dynamic question needs a concrete decision reason; no catalog-wide
  // "completeness" reason is available. Safety questions can only use safety.
  if (proposal.reasonCode === "safety_gate" && !resolved.every((field) => field.requiredFor.includes("high_intensity_cardio") || field.requiredFor.includes("exercise_selection"))) {
    throw new Error("dynamic_form_rejected");
  }
  if (!resolved.every((field) => fieldIsAskable(progress, field))) {
    throw new Error("dynamic_form_rejected");
  }
  return resolved;
}

export function validateDynamicFieldInput(input: DynamicFieldInput, inputMode: "form" | "conversation"): OnboardingDynamicFieldCapture {
  const field = fieldById(input.fieldId);
  if (!field || !field.allowedSources.includes(input.source.kind) || !matchesInputMode(input.source, inputMode) || !validTimestamp(input.observedAt)) {
    throw new Error("dynamic_form_rejected");
  }
  if (input.state === "explicit_unknown") {
    if (!field.acceptsExplicitUnknown || input.value !== undefined) throw new Error("dynamic_form_rejected");
  } else if (input.state === "normalized_needs_review") {
    // A language model may suggest a normalization only as a dossier draft.
    // It remains visibly reviewable and cannot pretend to be form-confirmed.
    if (input.source.kind !== "conversation_message" || input.value === undefined) throw new Error("dynamic_form_rejected");
    validateValue(field, input.value);
  } else if (input.state !== "captured_explicit") {
    // Normalization, estimates and conflicts are produced by their dedicated
    // local tools, not accepted as a model-authored form answer.
    throw new Error("dynamic_form_rejected");
  } else {
    validateValue(field, input.value);
  }
  return {
    fieldId: field.id,
    catalogVersion: ONBOARDING_FIELD_CATALOG_VERSION,
    state: input.state,
    ...(input.value !== undefined ? { value: input.value } : {}),
    observedAt: input.observedAt,
    source: input.source,
  };
}

export function limitedActionsFor(progress: Pick<OnboardingProgress, "patch">): OnboardingActionGate[] {
  return [...new Set(
    Object.values(progress.patch.dynamicFields ?? {})
      .filter((capture) => capture.state === "explicit_unknown")
      .flatMap((capture) => fieldById(capture.fieldId)?.requiredFor ?? []),
  )].sort();
}

/**
 * Exposes the facts consumed by the active Agent Knowledge decisions. The
 * Agent receives the goal narrative plus these requirement blocks and chooses
 * which relevant blocks to turn into a form. Local code validates the chosen
 * Artifact-to-field relation but never classifies the goal with keywords.
 */
export function knowledgeDrivenOnboardingFrontier(
  progress: OnboardingProgress,
  knowledge: Pick<AgentKnowledgeHarness, "selection" | "onboardingIntakeArtifacts">,
): KnowledgeDrivenOnboardingFrontier {
  const selection = knowledge.selection();
  if (selection.backend !== "agent_knowledge") throw new Error("onboarding_requires_agent_knowledge");
  const artifacts = knowledge.onboardingIntakeArtifacts();
  const requirements = artifacts.flatMap((artifact): readonly OnboardingKnowledgeRequirement[] => {
    const fieldIds = catalog
      .filter((field) => (field as OnboardingFieldDefinition).knowledgeArtifactIds?.includes(artifact.artifactRef.id))
      .filter((field) => fieldIsAskable(progress, field))
      .map((field) => field.id);
    return fieldIds.length ? [{ ...artifact, fieldIds }] : [];
  });
  if (requirements.length) {
    return {
      kind: "knowledge_requirements",
      reason: "active_agent_knowledge_inputs",
      knowledgeReleasePin: selection.agentKnowledgeReleasePin,
      requirements,
    };
  }
  if (progress.patch.trainingBackground && !progress.coachingLevelAssessments?.length) {
    return { kind: "assess_training_context", reason: "training_background_captured" };
  }
  return { kind: "review_dossier", reason: "no_unblocked_knowledge_requirements" };
}

export function validateKnowledgeSelectedProposal(
  frontier: KnowledgeDrivenOnboardingFrontier,
  proposal: OnboardingDynamicFormProposal,
): OnboardingDynamicFormProposal {
  if (frontier.kind !== "knowledge_requirements") throw new Error("onboarding_question_frontier_not_reached");
  const selectedIds = proposal.knowledgeArtifactIds;
  if (!selectedIds?.length || new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("onboarding_knowledge_requirement_missing");
  }
  const selected = selectedIds.map((id) => frontier.requirements.find((requirement) => requirement.artifactRef.id === id));
  if (selected.some((requirement) => !requirement)) throw new Error("onboarding_knowledge_requirement_invalid");
  const allowedFields = new Set(selected.flatMap((requirement) => requirement?.fieldIds ?? []));
  if (!proposal.fieldIds.length || proposal.fieldIds.some((fieldId) => !allowedFields.has(fieldId))) {
    throw new Error("onboarding_knowledge_field_not_required");
  }
  return {
    ...proposal,
    knowledgeArtifactRefs: selected.map((requirement) => requirement!.artifactRef),
    knowledgeReleasePin: frontier.knowledgeReleasePin,
  };
}

function fieldIsAskable(progress: OnboardingProgress, field: OnboardingFieldDefinition): boolean {
  const existing = progress.patch.dynamicFields?.[field.id];
  if (existing && existing.state !== "conflicted") return false;
  const background = progress.patch.trainingBackground;
  if (!background) return true;
  const alreadyCaptured = new Set([
    ...(background.cumulativeTrainingMonths ? ["training.cumulative_months"] : []),
    ...(background.recentContinuity ? ["training.recent_continuity"] : []),
    ...(background.recentSplit?.length ? ["training.recent_split"] : []),
    ...(background.environments?.length ? ["training.environment"] : []),
    ...(background.availableEquipment?.length ? ["training.equipment"] : []),
    ...(background.executionStability ? ["training.execution_stability"] : []),
    ...(background.schedule ? ["profile.training_schedule"] : []),
    ...(background.comparableSets?.length ? ["training.comparable_set"] : []),
  ]);
  return !alreadyCaptured.has(field.id);
}

function matchesInputMode(source: OnboardingInputSource, inputMode: "form" | "conversation"): boolean {
  return inputMode === "form" ? source.kind === "form_submission" : source.kind === "conversation_message";
}

function validTimestamp(value: string): boolean {
  return Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

function validateValue(field: OnboardingFieldDefinition, value: unknown): void {
  if (field.control.kind === "single_select") {
    if (typeof value !== "string" || !field.control.options.some((option) => option.id === value)) throw new Error("dynamic_form_rejected");
    return;
  }
  if (field.control.kind === "multi_select") {
    const options = field.control.options;
    if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && options.some((option) => option.id === item))) throw new Error("dynamic_form_rejected");
    if (field.id === "safety.activity_restrictions" && value.includes("none_declared") && value.length > 1) throw new Error("dynamic_form_rejected");
    return;
  }
  if (field.control.kind === "numeric_with_unit") {
    const quantity = value as { value?: unknown; unit?: unknown } | undefined;
    if (!quantity || typeof quantity.value !== "number" || !Number.isFinite(quantity.value) || typeof quantity.unit !== "string" || !field.control.units.includes(quantity.unit) || (field.control.min !== undefined && quantity.value < field.control.min) || (field.control.max !== undefined && quantity.value > field.control.max)) throw new Error("dynamic_form_rejected");
    return;
  }
  if (field.control.kind === "segmented_scale") {
    if (typeof value !== "number" || value < field.control.minimum || value > field.control.maximum || (value - field.control.minimum) % field.control.step !== 0) throw new Error("dynamic_form_rejected");
    return;
  }
  if (field.control.kind === "field_group") {
    if (!value || typeof value !== "object" || !field.control.fields.every((name) => name in (value as Record<string, unknown>))) throw new Error("dynamic_form_rejected");
    const record = value as Record<string, unknown>;
    if (field.id === "profile.training_schedule") {
      if (!isWholeNumberInRange(record.days_per_week, 1, 7) || !isWholeNumberInRange(record.minutes_per_session, 10, 300)) throw new Error("dynamic_form_rejected");
    }
    if (field.id === "training.recent_continuity") {
      if (!isWholeNumberInRange(record.consecutive_weeks, 0, 520) || !isWholeNumberInRange(record.usual_sessions_per_week, 0, 14) || !isWholeNumberInRange(record.time_away_weeks, 0, 520)) throw new Error("dynamic_form_rejected");
    }
    if (field.id === "training.comparable_set") {
      const load = record.load as { value?: unknown; unit?: unknown } | undefined;
      const effortMetric = record.effort_metric;
      const effortValue = record.effort_value;
      if (
        typeof record.exercise_variant !== "string" || !record.exercise_variant.trim() ||
        !load || typeof load.value !== "number" || !Number.isFinite(load.value) || load.value < 0 || load.unit !== "kg" ||
        !isWholeNumberInRange(record.reps, 1, 100) ||
        (effortMetric !== "rir" && effortMetric !== "rpe") ||
        typeof effortValue !== "number" || !Number.isFinite(effortValue) ||
        (effortMetric === "rir" && (effortValue < 0 || effortValue > 10)) ||
        (effortMetric === "rpe" && (effortValue < 1 || effortValue > 10)) ||
        typeof record.performed_on !== "string" || !Number.isFinite(Date.parse(record.performed_on)) ||
        typeof record.conditions !== "string"
      ) throw new Error("dynamic_form_rejected");
    }
    return;
  }
  if (field.control.kind === "date" || field.control.kind === "date_range") {
    if (field.control.kind === "date") {
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("dynamic_form_rejected");
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("dynamic_form_rejected");
    const range = value as Record<string, unknown>;
    if (typeof range.start !== "string" || typeof range.end !== "string" || !Number.isFinite(Date.parse(range.start)) || !Number.isFinite(Date.parse(range.end)) || range.end < range.start) throw new Error("dynamic_form_rejected");
    return;
  }
  if (typeof value !== "string" || !value.trim()) throw new Error("dynamic_form_rejected");
}

function isWholeNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
