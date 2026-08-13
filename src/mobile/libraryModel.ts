import type { ExerciseConcept, MuscleGroup } from "../pose/exerciseRegistry";
import { EXERCISE_REGISTRY, MUSCLE_GROUPS } from "../pose/exerciseRegistry";
import { recommendCapturePosition, CAPTURE_POSITIONS } from "../pose/viewGating";
import {
  isHomeExercise,
  recognitionAvailabilityForExercise,
  type RecognitionAvailability,
} from "./exerciseRecognition";

/**
 * 动作库首页的展示模型：分组 + 行数据全部为纯推导，
 * 数据源只有 exerciseRegistry 与 viewGating（机位推荐）。
 */

export interface LibraryRow {
  exercise: ExerciseConcept;
  recognition: RecognitionAvailability;
  /** 机位标签（如 "正前"），来自 viewGating 推荐；无推荐时为 null。 */
  capturePositionLabel: string | null;
  captureReason: string | null;
}

export interface LibraryGroup {
  id: "home" | MuscleGroup;
  label: string;
  rows: LibraryRow[];
}

function toRow(exercise: ExerciseConcept): LibraryRow {
  const recommendation = recommendCapturePosition(exercise.id);
  return {
    exercise,
    recognition: recognitionAvailabilityForExercise(exercise.id),
    capturePositionLabel: recommendation
      ? CAPTURE_POSITIONS.find((p) => p.id === recommendation.position)?.label ?? null
      : null,
    captureReason: recommendation?.reason ?? null,
  };
}

export function buildLibrary(): LibraryGroup[] {
  const all = EXERCISE_REGISTRY.exercises;
  const home = all.filter((exercise) => isHomeExercise(exercise.id));
  const groups: LibraryGroup[] = [
    { id: "home", label: "居家 · 前置", rows: home.map(toRow) },
  ];
  for (const group of MUSCLE_GROUPS) {
    const rows = all
      .filter((exercise) => !isHomeExercise(exercise.id) && exercise.muscleGroup === group.id)
      .map(toRow);
    if (rows.length > 0) groups.push({ id: group.id, label: group.labelZh, rows });
  }
  return groups;
}

export type RecognitionFilter = "all" | RecognitionAvailability;

/** 搜索 + 层级筛选。匹配中文名 / 英文名 / 别名 / id 的子串（不区分大小写）。 */
export function filterLibrary(
  groups: readonly LibraryGroup[],
  query: string,
  recognition: RecognitionFilter,
): LibraryGroup[] {
  const normalized = query.trim().toLowerCase();
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => {
        if (recognition !== "all" && row.recognition !== recognition) return false;
        if (!normalized) return true;
        const { exercise } = row;
        return [exercise.nameZh, exercise.nameEn, exercise.id, ...exercise.aliases].some((term) =>
          term.toLowerCase().includes(normalized),
        );
      }),
    }))
    .filter((group) => group.rows.length > 0);
}

export function countByRecognitionAvailability(): { available: number; unavailable: number } {
  let available = 0;
  let unavailable = 0;
  for (const exercise of EXERCISE_REGISTRY.exercises) {
    if (recognitionAvailabilityForExercise(exercise.id) === "available") available += 1;
    else unavailable += 1;
  }
  return { available, unavailable };
}
