export type ExerciseMaturity =
  | "catalog_only"
  | "experimental"
  | "validated"
  | "suspended";

export type MovementPattern =
  | "horizontal_pull"
  | "vertical_pull"
  | "squat"
  | "hip_hinge"
  | "horizontal_push"
  | "vertical_push"
  | "shoulder_abduction"
  | "shoulder_horizontal_abduction"
  | "shoulder_external_rotation"
  | "elbow_flexion"
  | "elbow_extension"
  | "knee_flexion"
  | "knee_extension"
  | "ankle_plantarflexion";

export type MuscleGroup = "chest" | "back" | "legs" | "shoulders" | "arms";

export const MUSCLE_GROUPS: ReadonlyArray<{ id: MuscleGroup; labelZh: string }> = [
  { id: "chest", labelZh: "胸" },
  { id: "back", labelZh: "背" },
  { id: "legs", labelZh: "腿" },
  { id: "shoulders", labelZh: "肩" },
  { id: "arms", labelZh: "手臂" },
];

export interface ExerciseSource {
  name: string;
  url: string | null;
  license: string;
}

export interface ExerciseConcept {
  id: string;
  nameZh: string;
  nameEn: string;
  aliases: readonly string[];
  muscleGroup: MuscleGroup;
  movementPattern: MovementPattern;
  equipment: readonly string[];
  variationOf: string | null;
  maturity: ExerciseMaturity;
  source: ExerciseSource;
}

const MATURITIES = new Set<ExerciseMaturity>([
  "catalog_only",
  "experimental",
  "validated",
  "suspended",
]);

const MOVEMENT_PATTERNS = new Set<MovementPattern>([
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hip_hinge",
  "horizontal_push",
  "vertical_push",
  "shoulder_abduction",
  "shoulder_horizontal_abduction",
  "shoulder_external_rotation",
  "elbow_flexion",
  "elbow_extension",
  "knee_flexion",
  "knee_extension",
  "ankle_plantarflexion",
]);
const MUSCLE_GROUP_IDS = new Set<MuscleGroup>(MUSCLE_GROUPS.map((group) => group.id));

const PROJECT_SOURCE: ExerciseSource = {
  name: "Form Coach project-authored seed catalog",
  url: null,
  license: "project-authored metadata",
};

const SEED_EXERCISES: readonly ExerciseConcept[] = [
  {
    id: "barbell_row",
    nameZh: "杠铃划船",
    nameEn: "Barbell row",
    aliases: ["俯身杠铃划船"],
    muscleGroup: "back",
    movementPattern: "horizontal_pull",
    equipment: ["barbell"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "pull_up",
    nameZh: "引体向上",
    nameEn: "Pull-up",
    aliases: ["正手引体"],
    muscleGroup: "back",
    movementPattern: "vertical_pull",
    equipment: ["pull-up bar"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "lat_pulldown",
    nameZh: "高位下拉",
    nameEn: "Lat pulldown",
    aliases: ["背阔肌下拉"],
    muscleGroup: "back",
    movementPattern: "vertical_pull",
    equipment: ["cable machine"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "seated_row",
    nameZh: "坐姿划船",
    nameEn: "Seated cable row",
    aliases: ["坐姿绳索划船"],
    muscleGroup: "back",
    movementPattern: "horizontal_pull",
    equipment: ["cable machine"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "straight_arm_pulldown",
    nameZh: "直臂下压",
    nameEn: "Straight-arm pulldown",
    aliases: ["直臂绳索下拉"],
    muscleGroup: "back",
    movementPattern: "vertical_pull",
    equipment: ["cable machine"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "wide_grip_lat_pulldown",
    nameZh: "宽握高位下拉",
    nameEn: "Wide-grip lat pulldown",
    aliases: ["宽握下拉"],
    muscleGroup: "back",
    movementPattern: "vertical_pull",
    equipment: ["cable machine", "wide bar"],
    variationOf: "lat_pulldown",
    maturity: "catalog_only",
    source: PROJECT_SOURCE,
  },
  {
    id: "bodyweight_squat",
    nameZh: "徒手深蹲",
    nameEn: "Bodyweight squat",
    aliases: ["深蹲", "自重深蹲"],
    muscleGroup: "legs",
    movementPattern: "squat",
    equipment: ["bodyweight"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "seated_shoulder_press",
    nameZh: "坐姿推肩",
    nameEn: "Seated shoulder press",
    aliases: ["坐姿哑铃推肩", "坐姿器械推肩", "肩上推举"],
    muscleGroup: "shoulders",
    movementPattern: "vertical_push",
    equipment: ["dumbbell or shoulder press machine", "bench"],
    variationOf: null,
    // The segmentation contract is ready for field capture, but its scores
    // must first be approved against the athlete's recordings.
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "lateral_raise",
    nameZh: "侧平举",
    nameEn: "Lateral raise",
    aliases: ["哑铃侧平举", "器械侧平举", "绳索侧平举"],
    muscleGroup: "shoulders",
    movementPattern: "shoulder_abduction",
    equipment: ["dumbbell or cable"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "rear_delt_fly",
    nameZh: "后束飞鸟",
    nameEn: "Rear delt fly",
    aliases: ["反向飞鸟", "反向蝴蝶机", "俯身飞鸟"],
    muscleGroup: "shoulders",
    movementPattern: "shoulder_horizontal_abduction",
    equipment: ["reverse pec deck or dumbbell"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  {
    id: "face_pull",
    nameZh: "绳索面拉",
    nameEn: "Cable face pull",
    aliases: ["面拉", "绳索面部拉"],
    muscleGroup: "shoulders",
    movementPattern: "horizontal_pull",
    equipment: ["cable machine", "rope attachment"],
    variationOf: null,
    maturity: "experimental",
    source: PROJECT_SOURCE,
  },
  // Catalog-only entries are deliberately recordable. They have canonical
  // labels and muscle ownership, but no unvalidated scoring profile yet.
  {
    id: "barbell_bench_press", nameZh: "杠铃卧推", nameEn: "Barbell bench press", aliases: ["平板卧推"], muscleGroup: "chest", movementPattern: "horizontal_push", equipment: ["barbell", "bench"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "dumbbell_bench_press", nameZh: "哑铃卧推", nameEn: "Dumbbell bench press", aliases: ["平板哑铃卧推"], muscleGroup: "chest", movementPattern: "horizontal_push", equipment: ["dumbbell", "bench"], variationOf: "barbell_bench_press", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "incline_dumbbell_press", nameZh: "上斜哑铃卧推", nameEn: "Incline dumbbell press", aliases: ["上斜卧推"], muscleGroup: "chest", movementPattern: "horizontal_push", equipment: ["dumbbell", "incline bench"], variationOf: "dumbbell_bench_press", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "machine_chest_press", nameZh: "器械推胸", nameEn: "Machine chest press", aliases: ["坐姿推胸"], muscleGroup: "chest", movementPattern: "horizontal_push", equipment: ["chest press machine"], variationOf: "barbell_bench_press", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "cable_chest_fly", nameZh: "绳索夹胸", nameEn: "Cable chest fly", aliases: ["绳索飞鸟", "夹胸"], muscleGroup: "chest", movementPattern: "horizontal_push", equipment: ["cable machine"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "push_up", nameZh: "俯卧撑", nameEn: "Push-up", aliases: ["标准俯卧撑"], muscleGroup: "chest", movementPattern: "horizontal_push", equipment: ["bodyweight"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "one_arm_dumbbell_row", nameZh: "单臂哑铃划船", nameEn: "One-arm dumbbell row", aliases: ["单手哑铃划船"], muscleGroup: "back", movementPattern: "horizontal_pull", equipment: ["dumbbell", "bench"], variationOf: "barbell_row", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "chest_supported_row", nameZh: "胸托划船", nameEn: "Chest-supported row", aliases: ["器械胸托划船"], muscleGroup: "back", movementPattern: "horizontal_pull", equipment: ["row machine or incline bench"], variationOf: "barbell_row", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "single_arm_cable_row", nameZh: "单臂绳索划船", nameEn: "Single-arm cable row", aliases: ["单手绳索划船"], muscleGroup: "back", movementPattern: "horizontal_pull", equipment: ["cable machine"], variationOf: "seated_row", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "assisted_pull_up", nameZh: "辅助引体向上", nameEn: "Assisted pull-up", aliases: ["辅助引体"], muscleGroup: "back", movementPattern: "vertical_pull", equipment: ["assisted pull-up machine"], variationOf: "pull_up", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "barbell_back_squat", nameZh: "杠铃深蹲", nameEn: "Barbell back squat", aliases: ["后蹲"], muscleGroup: "legs", movementPattern: "squat", equipment: ["barbell", "rack"], variationOf: "bodyweight_squat", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "leg_press", nameZh: "腿举", nameEn: "Leg press", aliases: ["倒蹬"], muscleGroup: "legs", movementPattern: "squat", equipment: ["leg press machine"], variationOf: "bodyweight_squat", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "romanian_deadlift", nameZh: "罗马尼亚硬拉", nameEn: "Romanian deadlift", aliases: ["RDL"], muscleGroup: "legs", movementPattern: "hip_hinge", equipment: ["barbell or dumbbell"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "walking_lunge", nameZh: "行走箭步蹲", nameEn: "Walking lunge", aliases: ["弓步走"], muscleGroup: "legs", movementPattern: "squat", equipment: ["dumbbell or bodyweight"], variationOf: "bodyweight_squat", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "bulgarian_split_squat", nameZh: "保加利亚分腿蹲", nameEn: "Bulgarian split squat", aliases: ["分腿蹲"], muscleGroup: "legs", movementPattern: "squat", equipment: ["dumbbell", "bench"], variationOf: "bodyweight_squat", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "leg_extension", nameZh: "腿屈伸", nameEn: "Leg extension", aliases: ["坐姿腿屈伸"], muscleGroup: "legs", movementPattern: "knee_extension", equipment: ["leg extension machine"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "leg_curl", nameZh: "腿弯举", nameEn: "Leg curl", aliases: ["俯卧腿弯举", "坐姿腿弯举"], muscleGroup: "legs", movementPattern: "knee_flexion", equipment: ["leg curl machine"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "hip_thrust", nameZh: "臀推", nameEn: "Hip thrust", aliases: ["杠铃臀推"], muscleGroup: "legs", movementPattern: "hip_hinge", equipment: ["barbell", "bench"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "calf_raise", nameZh: "提踵", nameEn: "Calf raise", aliases: ["站姿提踵", "坐姿提踵"], muscleGroup: "legs", movementPattern: "ankle_plantarflexion", equipment: ["calf raise machine or bodyweight"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "front_raise", nameZh: "前平举", nameEn: "Front raise", aliases: ["哑铃前平举", "绳索前平举"], muscleGroup: "shoulders", movementPattern: "shoulder_abduction", equipment: ["dumbbell or cable"], variationOf: "lateral_raise", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "single_arm_cable_lateral_raise", nameZh: "单臂绳索侧平举", nameEn: "Single-arm cable lateral raise", aliases: ["单手绳索侧平举"], muscleGroup: "shoulders", movementPattern: "shoulder_abduction", equipment: ["cable machine"], variationOf: "lateral_raise", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "landmine_press", nameZh: "地雷管推举", nameEn: "Landmine press", aliases: ["地雷管单臂推举"], muscleGroup: "shoulders", movementPattern: "vertical_push", equipment: ["barbell", "landmine attachment"], variationOf: "seated_shoulder_press", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "cable_y_raise", nameZh: "绳索 Y 举", nameEn: "Cable Y raise", aliases: ["Y 举"], muscleGroup: "shoulders", movementPattern: "shoulder_abduction", equipment: ["cable machine"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "cable_external_rotation", nameZh: "绳索外旋", nameEn: "Cable external rotation", aliases: ["肘贴身外旋"], muscleGroup: "shoulders", movementPattern: "shoulder_external_rotation", equipment: ["cable or resistance band"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "rear_delt_row", nameZh: "后束划船", nameEn: "Rear delt row", aliases: ["高位后束划船"], muscleGroup: "shoulders", movementPattern: "horizontal_pull", equipment: ["cable or dumbbell"], variationOf: "rear_delt_fly", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "barbell_biceps_curl", nameZh: "杠铃弯举", nameEn: "Barbell biceps curl", aliases: ["杠铃二头弯举"], muscleGroup: "arms", movementPattern: "elbow_flexion", equipment: ["barbell"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "dumbbell_biceps_curl", nameZh: "哑铃弯举", nameEn: "Dumbbell biceps curl", aliases: ["哑铃二头弯举"], muscleGroup: "arms", movementPattern: "elbow_flexion", equipment: ["dumbbell"], variationOf: "barbell_biceps_curl", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "hammer_curl", nameZh: "锤式弯举", nameEn: "Hammer curl", aliases: ["锤式二头弯举"], muscleGroup: "arms", movementPattern: "elbow_flexion", equipment: ["dumbbell"], variationOf: "dumbbell_biceps_curl", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "cable_biceps_curl", nameZh: "绳索弯举", nameEn: "Cable biceps curl", aliases: ["绳索二头弯举"], muscleGroup: "arms", movementPattern: "elbow_flexion", equipment: ["cable machine"], variationOf: "barbell_biceps_curl", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "triceps_pushdown", nameZh: "绳索下压", nameEn: "Triceps pushdown", aliases: ["三头下压"], muscleGroup: "arms", movementPattern: "elbow_extension", equipment: ["cable machine"], variationOf: null, maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "overhead_triceps_extension", nameZh: "过顶臂屈伸", nameEn: "Overhead triceps extension", aliases: ["绳索过顶臂屈伸"], muscleGroup: "arms", movementPattern: "elbow_extension", equipment: ["cable or dumbbell"], variationOf: "triceps_pushdown", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
  {
    id: "skull_crusher", nameZh: "仰卧臂屈伸", nameEn: "Lying triceps extension", aliases: ["碎颅者"], muscleGroup: "arms", movementPattern: "elbow_extension", equipment: ["barbell or dumbbell", "bench"], variationOf: "triceps_pushdown", maturity: "catalog_only", source: PROJECT_SOURCE,
  },
];

export class ExerciseRegistry {
  private readonly byId: ReadonlyMap<string, ExerciseConcept>;

  constructor(readonly exercises: readonly ExerciseConcept[]) {
    this.byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  }

  get(id: string): ExerciseConcept | undefined {
    return this.byId.get(id);
  }

  require(id: string): ExerciseConcept {
    const exercise = this.get(id);
    if (!exercise) throw new Error(`Unknown exercise id: ${id}`);
    return exercise;
  }

  /** Resolves recognizer labels through catalog-owned names and aliases. */
  matchText(text: string): ExerciseConcept | undefined {
    const query = normalizeExerciseText(text);
    if (!query) return undefined;
    const matches = this.exercises
      .flatMap((exercise) =>
        [exercise.id, exercise.nameZh, exercise.nameEn, ...exercise.aliases].map((term) => ({
          exercise,
          term: normalizeExerciseText(term),
        })),
      )
      .filter(({ term }) => term.length > 0 && query.includes(term));
    const matchedExercises = new Set(matches.map(({ exercise }) => exercise.id));
    // A recognizer can emit a specific Chinese variation name alongside a
    // generic English parent name. A matched child is more informative than
    // its matched parent, regardless of script-specific string length.
    const specificMatches = matches.filter(
      ({ exercise }) =>
        exercise.variationOf !== null && matchedExercises.has(exercise.variationOf),
    );
    const candidates = specificMatches.length > 0 ? specificMatches : matches;
    candidates.sort((a, b) => b.term.length - a.term.length);
    return candidates[0]?.exercise;
  }

  canRunSpecializedAnalysis(id: string): boolean {
    const maturity = this.get(id)?.maturity;
    return maturity === "experimental" || maturity === "validated";
  }
}

export function loadExerciseRegistry(input: readonly unknown[]): ExerciseRegistry {
  const exercises = input.map((value, index) => parseExercise(value, index));
  const ids = new Set<string>();
  for (const exercise of exercises) {
    if (ids.has(exercise.id)) throw new Error(`Duplicate exercise id: ${exercise.id}`);
    ids.add(exercise.id);
  }
  for (const exercise of exercises) {
    if (exercise.variationOf !== null && !ids.has(exercise.variationOf)) {
      throw new Error(
        `Exercise ${exercise.id} references missing variation parent ${exercise.variationOf}`,
      );
    }
    if (exercise.variationOf === exercise.id) {
      throw new Error(`Exercise ${exercise.id} cannot be its own variation parent`);
    }
  }
  assertAcyclicVariations(exercises);
  return new ExerciseRegistry(exercises);
}

export const EXERCISE_REGISTRY = loadExerciseRegistry(SEED_EXERCISES);

function parseExercise(value: unknown, index: number): ExerciseConcept {
  if (!isRecord(value)) throw new Error(`Exercise at index ${index} must be an object`);
  const id = requiredString(value.id, `Exercise at index ${index} id`);
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`Exercise id must be stable snake_case: ${id}`);
  }
  const maturity = requiredString(value.maturity, `Exercise ${id} maturity`);
  if (!MATURITIES.has(maturity as ExerciseMaturity)) {
    throw new Error(`Exercise ${id} has invalid maturity: ${maturity}`);
  }
  const movementPattern = requiredString(
    value.movementPattern,
    `Exercise ${id} movementPattern`,
  );
  if (!MOVEMENT_PATTERNS.has(movementPattern as MovementPattern)) {
    throw new Error(`Exercise ${id} has invalid movement pattern: ${movementPattern}`);
  }
  const muscleGroup = requiredString(value.muscleGroup, `Exercise ${id} muscleGroup`);
  if (!MUSCLE_GROUP_IDS.has(muscleGroup as MuscleGroup)) {
    throw new Error(`Exercise ${id} has invalid muscleGroup: ${muscleGroup}`);
  }
  if (!isRecord(value.source)) throw new Error(`Exercise ${id} source must be an object`);
  const sourceUrl = value.source.url;
  if (sourceUrl !== null && typeof sourceUrl !== "string") {
    throw new Error(`Exercise ${id} source url must be a string or null`);
  }
  return {
    id,
    nameZh: requiredString(value.nameZh, `Exercise ${id} nameZh`),
    nameEn: requiredString(value.nameEn, `Exercise ${id} nameEn`),
    aliases: requiredStringArray(value.aliases, `Exercise ${id} aliases`),
    muscleGroup: muscleGroup as MuscleGroup,
    movementPattern: movementPattern as MovementPattern,
    equipment: requiredStringArray(value.equipment, `Exercise ${id} equipment`),
    variationOf:
      value.variationOf === null
        ? null
        : requiredString(value.variationOf, `Exercise ${id} variationOf`),
    maturity: maturity as ExerciseMaturity,
    source: {
      name: requiredString(value.source.name, `Exercise ${id} source name`),
      url: sourceUrl,
      license: requiredString(value.source.license, `Exercise ${id} source license`),
    },
  };
}

function assertAcyclicVariations(exercises: readonly ExerciseConcept[]): void {
  const parents = new Map(exercises.map(({ id, variationOf }) => [id, variationOf]));
  for (const exercise of exercises) {
    const visited = new Set<string>();
    let current: string | null = exercise.id;
    while (current !== null) {
      if (visited.has(current)) throw new Error(`Variation cycle includes exercise ${current}`);
      visited.add(current);
      current = parents.get(current) ?? null;
    }
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return [...value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeExerciseText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_-]+/g, "");
}
