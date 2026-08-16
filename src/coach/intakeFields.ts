/**
 * The closed intake field registry. The Agent may compose dynamic intake forms
 * only from these declared fields; it can never invent a field, a unit, or a
 * validation rule. Every field is optional: an unanswered field stays unknown
 * and never blocks record-only or goal negotiation.
 *
 * Each field names the knowledge topic that justifies collecting it, so the
 * Agent's questions can be grounded in installed knowledge rather than habit.
 */
export interface IntakeFieldSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: "number" | "text" | "single_choice";
  readonly unit?: string;
  readonly options?: readonly { readonly id: string; readonly label: string }[];
  readonly validation?: { readonly min?: number; readonly max?: number; readonly maxLength?: number };
  readonly sensitivity: "normal" | "sensitive";
  readonly knowledgeTopic: "training" | "nutrition" | "recovery" | "exercise";
  /** intake_draft stays a provenance-bearing draft; clinical_record is admitted
   * as a formal clinical_context Timeline fact on submission. */
  readonly admission: "intake_draft" | "clinical_record";
}

export const INTAKE_FIELD_REGISTRY: readonly IntakeFieldSpec[] = [
  { id: "training_years", label: "系统训练年限", kind: "number", unit: "年", validation: { min: 0, max: 60 }, sensitivity: "normal", knowledgeTopic: "training", admission: "intake_draft" },
  { id: "recent_training_split", label: "近期训练安排", kind: "text", validation: { maxLength: 120 }, sensitivity: "normal", knowledgeTopic: "training", admission: "intake_draft" },
  { id: "weekly_sessions_available", label: "每周可训练次数", kind: "number", unit: "次/周", validation: { min: 0, max: 14 }, sensitivity: "normal", knowledgeTopic: "training", admission: "intake_draft" },
  { id: "session_minutes_available", label: "单次可训练时长", kind: "number", unit: "分钟", validation: { min: 10, max: 180 }, sensitivity: "normal", knowledgeTopic: "training", admission: "intake_draft" },
  {
    id: "equipment_access", label: "可用器械", kind: "single_choice", sensitivity: "normal", knowledgeTopic: "training", admission: "intake_draft",
    options: [
      { id: "full_gym", label: "健身房全器械" },
      { id: "home_dumbbell", label: "家用哑铃/简易器械" },
      { id: "bodyweight", label: "徒手为主" },
    ],
  },
  {
    id: "dietary_pattern", label: "饮食偏好", kind: "single_choice", sensitivity: "normal", knowledgeTopic: "nutrition", admission: "intake_draft",
    options: [
      { id: "omnivore", label: "普通饮食" },
      { id: "vegetarian", label: "素食" },
      { id: "other", label: "其他" },
    ],
  },
  {
    id: "protein_habit", label: "蛋白质摄入习惯", kind: "single_choice", sensitivity: "normal", knowledgeTopic: "nutrition", admission: "intake_draft",
    options: [
      { id: "usually_enough", label: "通常充足" },
      { id: "usually_low", label: "通常偏低" },
      { id: "unknown", label: "不清楚" },
    ],
  },
  { id: "sleep_baseline_hours", label: "近期睡眠时长", kind: "number", unit: "小时", validation: { min: 0, max: 14 }, sensitivity: "normal", knowledgeTopic: "recovery", admission: "intake_draft" },
  {
    id: "daily_activity", label: "日常活动量", kind: "single_choice", sensitivity: "normal", knowledgeTopic: "recovery", admission: "intake_draft",
    options: [
      { id: "mostly_sitting", label: "久坐为主" },
      { id: "lightly_active", label: "轻度活动" },
      { id: "active", label: "活动量大" },
    ],
  },
  { id: "injury_or_condition", label: "伤病或健康情况", kind: "text", validation: { maxLength: 120 }, sensitivity: "sensitive", knowledgeTopic: "recovery", admission: "clinical_record" },
];

const REGISTRY_BY_ID: ReadonlyMap<string, IntakeFieldSpec> = new Map(INTAKE_FIELD_REGISTRY.map((field) => [field.id, field]));

export function intakeField(id: string): IntakeFieldSpec | undefined {
  return REGISTRY_BY_ID.get(id);
}

/** Validate one submitted value against its registry spec. Returns the
 * normalized string for storage, or undefined when the value is empty
 * (optional field left unanswered). Throws on a contract violation. */
export function validateIntakeFieldValue(spec: IntakeFieldSpec, raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  if (spec.kind === "number") {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`intake_field_not_a_number:${spec.id}`);
    if (spec.validation?.min !== undefined && value < spec.validation.min) throw new Error(`intake_field_out_of_range:${spec.id}`);
    if (spec.validation?.max !== undefined && value > spec.validation.max) throw new Error(`intake_field_out_of_range:${spec.id}`);
    return String(value);
  }
  if (spec.kind === "single_choice") {
    if (!spec.options?.some((option) => option.id === text)) throw new Error(`intake_field_option_unknown:${spec.id}`);
    return text;
  }
  const maxLength = spec.validation?.maxLength ?? 240;
  if (text.length > maxLength) throw new Error(`intake_field_too_long:${spec.id}`);
  return text;
}
