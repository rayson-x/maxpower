export const MMFIT_ACTION_TO_EXERCISE = Object.freeze({
  squats: "bodyweight_squat",
  lunges: "alternating_lunge",
  bicep_curls: "alternating_dumbbell_biceps_curl",
  situps: "sit_up",
  pushups: "push_up",
  tricep_extensions: "overhead_triceps_extension",
  dumbbell_rows: "standing_dumbbell_row",
  jumping_jacks: "jumping_jack",
  dumbbell_shoulder_press: "dumbbell_shoulder_press",
  lateral_shoulder_raises: "lateral_raise",
} as const);

export const REPCOUNT_ACTION_TO_EXERCISE = Object.freeze({
  front_raise: "front_raise",
  pull_up: "pull_up",
  squat: "bodyweight_squat",
  bench_pressing: "barbell_bench_press",
  bench_press: "barbell_bench_press",
  jump_jack: "jumping_jack",
  jumping_jack: "jumping_jack",
  situp: "sit_up",
  sit_up: "sit_up",
  push_up: "push_up",
  pommelhorse: null,
} as const);

export function mapMmFitAction(sourceAction: string): string | null {
  const key = normalizeAction(sourceAction);
  return MMFIT_ACTION_TO_EXERCISE[key as keyof typeof MMFIT_ACTION_TO_EXERCISE] ?? null;
}

export function mapRepCountAction(sourceAction: string): string | null {
  const key = normalizeAction(sourceAction);
  const mapped = REPCOUNT_ACTION_TO_EXERCISE[key as keyof typeof REPCOUNT_ACTION_TO_EXERCISE];
  return mapped === undefined ? null : mapped;
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
