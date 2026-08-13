/**
 * The four inputs that start every User dossier.  This is deliberately a UI
 * contract: later onboarding work owns parsing, provenance, and persistence.
 */
export interface BaselineIntakeValues {
  ageYears: string;
  heightCm: string;
  currentWeightKg: string;
  goalNarrative: string;
}

export type BaselineIntakeFieldId = keyof BaselineIntakeValues;

export interface BaselineIntakeField {
  id: BaselineIntakeFieldId;
  label: string;
  placeholder: string;
  control: "integer" | "decimal" | "multiline_text";
  unit?: "years" | "cm" | "kg";
}

export const EMPTY_BASELINE_INTAKE: Readonly<BaselineIntakeValues> = {
  ageYears: "",
  heightCm: "",
  currentWeightKg: "",
  goalNarrative: "",
};

export const BASELINE_INTAKE_FIELDS: readonly BaselineIntakeField[] = [
  {
    id: "ageYears",
    label: "年龄",
    placeholder: "例如 30",
    control: "integer",
    unit: "years",
  },
  {
    id: "heightCm",
    label: "身高",
    placeholder: "例如 179",
    control: "decimal",
    unit: "cm",
  },
  {
    id: "currentWeightKg",
    label: "当前体重",
    placeholder: "例如 75",
    control: "decimal",
    unit: "kg",
  },
  {
    id: "goalNarrative",
    label: "你想练成什么样？",
    placeholder: "例如：想把体脂降到 12%，现在大约 16%，想要更清晰的腹肌和宽肩窄腰。",
    control: "multiline_text",
  },
];

export function isBaselineIntakeComplete(values: BaselineIntakeValues): boolean {
  return Object.values(values).every((value) => value.trim().length > 0);
}
