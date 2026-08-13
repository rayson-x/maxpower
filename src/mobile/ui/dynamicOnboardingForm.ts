import type { DynamicFormCard } from "../../onboarding";
import type { OnboardingFieldDefinition } from "../../onboarding/FieldCatalog";

/**
 * UI-only, editable values for one already-authorized DynamicFormCard. They
 * intentionally retain text while a person is typing; the onboarding command
 * validates and normalizes them before a draft event is accepted.
 */
export type DynamicOnboardingFormValue =
  | string
  | readonly string[]
  | NumericWithUnitDraft
  | DateRangeDraft
  | FieldGroupDraft
  | undefined;

export interface NumericWithUnitDraft {
  amount: string;
  unit: string;
}

export interface DateRangeDraft {
  start: string;
  end: string;
}

export interface FieldGroupDraft {
  readonly [field: string]: DynamicOnboardingFormValue;
}
export type DynamicOnboardingFormValues = Readonly<Record<string, DynamicOnboardingFormValue>>;

export type DynamicFormControlPresentation =
  | { kind: "text"; multiline: boolean }
  | { kind: "numeric_with_unit"; keyboardType: "decimal-pad" }
  | { kind: "single_select"; selection: "single" }
  | { kind: "multi_select"; selection: "multiple" }
  | { kind: "date"; selection: "single" }
  | { kind: "date_range"; selection: "range" }
  | { kind: "segmented_scale"; selection: "single"; hasIncrementDecrementAlternative: true }
  | { kind: "field_group"; fields: readonly string[] };

/** A card-local draft never gains fields that its supplied catalog card lacks. */
export function createDynamicOnboardingFormValues(card: DynamicFormCard): DynamicOnboardingFormValues {
  return Object.fromEntries(card.fields.map((field) => [field.id, emptyValueFor(field)]));
}

export function updateDynamicOnboardingFormValue(
  card: DynamicFormCard,
  values: DynamicOnboardingFormValues,
  fieldId: string,
  value: DynamicOnboardingFormValue,
): DynamicOnboardingFormValues {
  if (!card.fieldIds.includes(fieldId) || !card.fields.some((field) => field.id === fieldId)) {
    throw new Error("dynamic_form_field_not_in_card");
  }
  return { ...values, [fieldId]: value };
}

/**
 * Returns only fields the person actually completed or deliberately marked
 * unknown. Empty control defaults are presentation state, never user facts.
 */
export function answeredDynamicOnboardingFormFieldIds(
  card: DynamicFormCard,
  values: DynamicOnboardingFormValues,
  explicitUnknown: ReadonlySet<string>,
): readonly string[] {
  return card.fieldIds.filter((fieldId) =>
    explicitUnknown.has(fieldId) || hasMeaningfulDynamicValue(values[fieldId]));
}

/** Maps the product-owned catalog control to a stable client interaction. */
export function dynamicFormControlPresentation(field: OnboardingFieldDefinition): DynamicFormControlPresentation {
  switch (field.control.kind) {
    case "single_line_text": return { kind: "text", multiline: false };
    case "multiline_text": return { kind: "text", multiline: true };
    case "numeric_with_unit": return { kind: "numeric_with_unit", keyboardType: "decimal-pad" };
    case "single_select": return { kind: "single_select", selection: "single" };
    case "multi_select": return { kind: "multi_select", selection: "multiple" };
    case "date": return { kind: "date", selection: "single" };
    case "date_range": return { kind: "date_range", selection: "range" };
    case "segmented_scale": return { kind: "segmented_scale", selection: "single", hasIncrementDecrementAlternative: true };
    case "field_group": return { kind: "field_group", fields: field.control.fields };
  }
  throw new Error("unsupported_dynamic_form_control");
}

function emptyValueFor(field: OnboardingFieldDefinition): DynamicOnboardingFormValue {
  switch (field.control.kind) {
    case "numeric_with_unit": return { amount: "", unit: field.control.units[0] ?? "" };
    case "multi_select": return [];
    case "date_range": return { start: "", end: "" };
    case "field_group": return Object.fromEntries(field.control.fields.map((name) => [name, emptyFieldGroupValue(name)]));
    default: return "";
  }
}

function emptyFieldGroupValue(name: string): DynamicOnboardingFormValue {
  switch (name) {
    case "load": return { amount: "", unit: "kg" };
    default: return "";
  }
}

function hasMeaningfulDynamicValue(value: DynamicOnboardingFormValue): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (!value) return false;
  if (isNumericWithUnitDraft(value)) return Boolean(value.amount.trim() && value.unit.trim());
  if (isDateRangeDraft(value)) return Boolean(value.start.trim() || value.end.trim());
  return Object.values(value).every((nested) => hasMeaningfulDynamicValue(nested));
}

function isNumericWithUnitDraft(value: object): value is NumericWithUnitDraft {
  return "amount" in value && typeof value.amount === "string"
    && "unit" in value && typeof value.unit === "string";
}

function isDateRangeDraft(value: object): value is DateRangeDraft {
  return "start" in value && typeof value.start === "string"
    && "end" in value && typeof value.end === "string";
}
