import assert from "node:assert/strict";
import test from "node:test";

import {
  createDynamicOnboardingFormValues,
  answeredDynamicOnboardingFormFieldIds,
  dynamicFormControlPresentation,
  updateDynamicOnboardingFormValue,
} from "../../src/mobile/ui/dynamicOnboardingForm";
import { ONBOARDING_FIELD_CATALOG, type DynamicFormCard } from "../../src/onboarding";

function cardFor(...fieldIds: string[]): DynamicFormCard {
  const fields = fieldIds.map((id) => {
    const field = ONBOARDING_FIELD_CATALOG.find((candidate) => candidate.id === id);
    if (!field) throw new Error(`missing fixture field ${id}`);
    return field;
  });
  return {
    cardId: "card:contract",
    catalogVersion: "onboarding-field-catalog/v1",
    draftRevision: 3,
    topic: "energy_planning",
    fieldIds,
    reasonCode: "planning_gate",
    requiredFor: "reliable_energy_target",
    fields,
  };
}

test("dynamic form values are scoped to the supplied catalog card and reject invented field IDs", () => {
  const card = cardFor("timeline.daily_activity", "nutrition.usual_intake");
  const values = createDynamicOnboardingFormValues(card);

  assert.deepEqual(values, {
    "timeline.daily_activity": "",
    "nutrition.usual_intake": { amount: "", unit: "kcal" },
  });
  assert.deepEqual(
    updateDynamicOnboardingFormValue(card, values, "timeline.daily_activity", "sedentary_remote_work"),
    {
      "timeline.daily_activity": "sedentary_remote_work",
      "nutrition.usual_intake": { amount: "", unit: "kcal" },
    },
  );
  assert.throws(
    () => updateDynamicOnboardingFormValue(card, values, "llm.invented_field", "anything"),
    /dynamic_form_field_not_in_card/,
  );
});

test("dynamic catalog controls map to their explicit interaction types", () => {
  assert.deepEqual(
    dynamicFormControlPresentation(ONBOARDING_FIELD_CATALOG.find((field) => field.id === "nutrition.usual_intake")!),
    { kind: "numeric_with_unit", keyboardType: "decimal-pad" },
  );
  assert.deepEqual(
    dynamicFormControlPresentation(ONBOARDING_FIELD_CATALOG.find((field) => field.id === "timeline.daily_activity")!),
    { kind: "single_select", selection: "single" },
  );
  assert.deepEqual(
    dynamicFormControlPresentation(ONBOARDING_FIELD_CATALOG.find((field) => field.id === "safety.activity_restrictions")!),
    { kind: "multi_select", selection: "multiple" },
  );
  assert.deepEqual(
    dynamicFormControlPresentation(ONBOARDING_FIELD_CATALOG.find((field) => field.id === "goal.target_horizon")!),
    { kind: "date_range", selection: "range" },
  );
  assert.deepEqual(
    dynamicFormControlPresentation(ONBOARDING_FIELD_CATALOG.find((field) => field.id === "readiness.perceived_recovery")!),
    { kind: "segmented_scale", selection: "single", hasIncrementDecrementAlternative: true },
  );
  assert.deepEqual(
    dynamicFormControlPresentation(ONBOARDING_FIELD_CATALOG.find((field) => field.id === "training.comparable_set")!),
    { kind: "field_group", fields: ["exercise_variant", "load", "reps", "effort_metric", "effort_value", "performed_on", "conditions"] },
  );
});

test("field-group initial values preserve distinct training-set semantics", () => {
  const [comparableSet] = [ONBOARDING_FIELD_CATALOG.find((field) => field.id === "training.comparable_set")!];
  const card = cardFor(comparableSet.id);

  assert.deepEqual(createDynamicOnboardingFormValues(card), {
    "training.comparable_set": {
      exercise_variant: "",
      load: { amount: "", unit: "kg" },
      reps: "",
      effort_metric: "",
      effort_value: "",
      performed_on: "",
      conditions: "",
    },
  });
});

test("untouched controls are not treated as answers", () => {
  const card = cardFor("training.environment", "safety.activity_restrictions", "timeline.daily_activity");
  const initial = createDynamicOnboardingFormValues(card);
  assert.deepEqual(answeredDynamicOnboardingFormFieldIds(card, initial, new Set()), []);

  const changed = updateDynamicOnboardingFormValue(card, initial, "timeline.daily_activity", "sedentary_remote_work");
  assert.deepEqual(answeredDynamicOnboardingFormFieldIds(card, changed, new Set()), ["timeline.daily_activity"]);
  assert.deepEqual(answeredDynamicOnboardingFormFieldIds(card, changed, new Set(["safety.activity_restrictions"])), [
    "safety.activity_restrictions",
    "timeline.daily_activity",
  ]);
});
