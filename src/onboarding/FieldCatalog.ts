import type {
  OnboardingActionGate,
  OnboardingDynamicFieldCapture,
  OnboardingDynamicFormRequest,
  OnboardingInputSource,
  OnboardingProgress,
  OnboardingQuestionReasonCode,
} from "./model";

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
}

/**
 * The local, inspectable intake frontier. It suggests the next decision that
 * is unblocked by the draft; the Agent still chooses wording and whether a
 * natural question or an allowed card is the clearest interaction.
 */
export type GoalDrivenOnboardingFrontier =
  | { kind: "natural_training_background"; reason: "initial_training_context" }
  | { kind: "assess_training_context"; reason: "training_background_captured" }
  | {
      kind: "catalog_fields";
      reason: "goal_specific_planning_gate";
      topic: string;
      reasonCode: OnboardingDynamicFormProposal["reasonCode"];
      requiredFor: OnboardingDynamicFormProposal["requiredFor"];
      fieldIds: readonly string[];
    }
  | { kind: "review_dossier"; reason: "no_unblocked_goal_specific_fields" };

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
    requiredFor: ["reliable_energy_target"],
    themes: ["energy_planning"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_profile_sex",
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
    requiredFor: ["reliable_energy_target"],
    themes: ["energy_planning"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_timeline_daily_activity",
  },
  {
    id: "nutrition.usual_intake",
    owner: "nutrition_strategy",
    valueType: "quantity",
    sensitivity: "nutrition",
    label: "平时每日摄入",
    control: { kind: "numeric_with_unit", units: ["kcal"], min: 0, max: 10000 },
    requiredFor: ["reliable_energy_target"],
    themes: ["energy_planning"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_usual_energy_intake",
  },
  {
    id: "profile.training_schedule",
    owner: "user_profile",
    valueType: "compound",
    sensitivity: "standard",
    label: "可训练的频率和时长",
    control: { kind: "field_group", fields: ["days_per_week", "minutes_per_session"] },
    requiredFor: ["dated_session_schedule"],
    themes: ["schedule_feasibility"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_training_schedule",
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
    requiredFor: ["managed_plan_changes"],
    themes: ["coaching_collaboration"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_plan_adjustment_authority",
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
    id: "training.comparable_set",
    owner: "timeline_baseline",
    valueType: "compound",
    sensitivity: "standard",
    label: "一组近期可比较的训练表现",
    control: {
      kind: "field_group",
      fields: ["exercise_variant", "load", "reps", "rir_or_rpe", "performed_on", "conditions"],
    },
    requiredFor: ["comparable_strength_progression"],
    themes: ["strength_baseline"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_comparable_training_set",
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
    requiredFor: ["high_intensity_cardio", "exercise_selection"],
    themes: ["safety_check"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_activity_restrictions",
  },
  {
    id: "goal.target_horizon",
    owner: "goal_contract",
    valueType: "date_range",
    sensitivity: "standard",
    label: "希望达成目标的时间",
    control: { kind: "date_range" },
    requiredFor: ["dated_session_schedule", "body_composition_trend"],
    themes: ["goal_timing"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_goal_horizon",
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
    requiredFor: ["body_composition_trend"],
    themes: ["measurement_quality"],
    allowedSources: ["conversation_message", "form_submission"],
    acceptsExplicitUnknown: true,
    writeCommand: "onboarding.capture_measurement_method",
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
  "topic" | "fieldIds" | "reasonCode" | "requiredFor"
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
  if (!reasonCodes.has(proposal.reasonCode) || !proposal.topic || proposal.fieldIds.length === 0 || proposal.fieldIds.length > 4) {
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

export function recommendFieldsForGoal(goalKind: "fat_loss" | "hypertrophy" | "strength" | "visual_physique" | "general"): OnboardingDynamicFormProposal {
  switch (goalKind) {
    case "fat_loss":
      return { topic: "energy_planning", fieldIds: ["profile.sex", "timeline.daily_activity", "nutrition.usual_intake"], reasonCode: "planning_gate", requiredFor: "reliable_energy_target" };
    case "strength":
      return { topic: "strength_baseline", fieldIds: ["training.comparable_set"], reasonCode: "planning_gate", requiredFor: "comparable_strength_progression" };
    case "visual_physique":
      return { topic: "measurement_quality", fieldIds: ["profile.body_measurement_method"], reasonCode: "measurement_quality", requiredFor: "body_composition_trend" };
    case "hypertrophy":
      return { topic: "schedule_feasibility", fieldIds: ["profile.training_schedule"], reasonCode: "schedule_feasibility", requiredFor: "dated_session_schedule" };
    default:
      return { topic: "safety_check", fieldIds: ["safety.activity_restrictions"], reasonCode: "safety_gate", requiredFor: "exercise_selection" };
  }
}

/**
 * A small goal-led decision tree, not a second questionnaire. It exposes
 * only the currently unblocked frontier and intentionally caps a card at
 * three independent fields. Facts already captured from conversation count
 * as answered; they are confirmed later in the dossier summary.
 */
export function goalDrivenOnboardingFrontier(progress: OnboardingProgress): GoalDrivenOnboardingFrontier {
  if (!progress.patch.trainingBackground) {
    return { kind: "natural_training_background", reason: "initial_training_context" };
  }
  if (!progress.coachingLevelAssessments?.length) {
    return { kind: "assess_training_context", reason: "training_background_captured" };
  }
  const narrative = progress.patch.baseline?.goalNarrative?.text ?? "";
  const goalKind = /(减脂|减重|体脂|腹肌|瘦)/u.test(narrative)
    ? "fat_loss"
    : /(力量|卧推|深蹲|硬拉|重量)/u.test(narrative)
      ? "strength"
      : /(体型|宽肩|窄腰|视觉|围度)/u.test(narrative)
        ? "visual_physique"
        : /(增肌|肌肉)/u.test(narrative)
          ? "hypertrophy"
          : "general";
  const proposal = recommendFieldsForGoal(goalKind);
  const fieldIds = proposal.fieldIds.filter((id) => {
    const field = fieldById(id);
    return field ? fieldIsAskable(progress, field) : false;
  }).slice(0, 3);
  return fieldIds.length
    ? { kind: "catalog_fields", reason: "goal_specific_planning_gate", topic: proposal.topic, reasonCode: proposal.reasonCode, requiredFor: proposal.requiredFor, fieldIds }
    : { kind: "review_dossier", reason: "no_unblocked_goal_specific_fields" };
}

function fieldIsAskable(progress: OnboardingProgress, field: OnboardingFieldDefinition): boolean {
  const existing = progress.patch.dynamicFields?.[field.id];
  return !existing || existing.state === "conflicted";
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
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && options.some((option) => option.id === item))) throw new Error("dynamic_form_rejected");
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
    if (field.id === "training.comparable_set") {
      const load = record.load as { value?: unknown; unit?: unknown } | undefined;
      if (
        typeof record.exercise_variant !== "string" || !record.exercise_variant.trim() ||
        !load || typeof load.value !== "number" || !Number.isFinite(load.value) || load.value < 0 || load.unit !== "kg" ||
        !isWholeNumberInRange(record.reps, 1, 100) ||
        (record.rir_or_rpe !== undefined && (typeof record.rir_or_rpe !== "number" || record.rir_or_rpe < 0 || record.rir_or_rpe > 10)) ||
        typeof record.performed_on !== "string" || !Number.isFinite(Date.parse(record.performed_on)) ||
        typeof record.conditions !== "string"
      ) throw new Error("dynamic_form_rejected");
    }
    return;
  }
  if (field.control.kind === "date" || field.control.kind === "date_range") {
    if (typeof value !== "string" && !(value && typeof value === "object")) throw new Error("dynamic_form_rejected");
    return;
  }
  if (typeof value !== "string" || !value.trim()) throw new Error("dynamic_form_rejected");
}

function isWholeNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
