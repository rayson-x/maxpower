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
  | "elbow_flexion"
  | "elbow_extension";

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
  "elbow_flexion",
  "elbow_extension",
]);

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
    movementPattern: "vertical_pull",
    equipment: ["cable machine", "wide bar"],
    variationOf: "lat_pulldown",
    maturity: "catalog_only",
    source: PROJECT_SOURCE,
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
