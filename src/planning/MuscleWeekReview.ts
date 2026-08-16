import type { GoalContractData, SetOutcomeData, WellnessDimension } from "../coach/domain";
import type { ExerciseVariant } from "../knowledge/model";
import { fatigueContributionsForExercise, MUSCLE_FATIGUE_POLICY } from "./muscleFatigue";

/**
 * 周肌群复盘（规划域深模块）。
 *
 * 把一周内经用户确认或导入的完成组按版本钉定的 Expected muscle association
 * 展开为各肌群的直接组数与含协同的相对负荷。计划数据永不混入；未审校关联
 * 的动作计入 unknown 而不是猜测。报告是相对训练负荷，不是力量、激活或
 * 恢复完成度观测。
 */

/** 版本化每周直接组目标带。来源：核心知识包周量政策（TP-VOL 系列）。 */
export const WEEKLY_DIRECT_SET_TARGETS = {
  id: "maxpower.weekly-direct-set-targets",
  version: "1.0.0",
  evidenceNote: "knowledge_pack_volume_policy_tp_vol",
  bands: {
    beginner: { min: 2, max: 8 },
    intermediate: { min: 4, max: 10 },
    advanced: { min: 6, max: 12 },
  },
} as const;

export type MuscleWeekTrainingLevel = keyof typeof WEEKLY_DIRECT_SET_TARGETS.bands;

export interface MuscleWeekSetInput {
  readonly completedAt: string;
  readonly outcomes: readonly SetOutcomeData[];
}

export interface MuscleWeekMuscleRow {
  readonly muscleId: string;
  /** 主目标角色才计直接组。 */
  readonly directSets: number;
  /** 含协同/稳定肌的相对负荷（政策单位 RU）。 */
  readonly relativeLoad: number;
  readonly synergistLoad: number;
  readonly targetGap: "low" | "in_range" | "high" | "unknown";
  readonly evidenceState: "reviewed" | "unknown";
  /** 事实链：这条结论来自哪些动作、哪些确认组。 */
  readonly contributions: readonly {
    readonly date: string;
    readonly exerciseVariantId: string;
    readonly exerciseName: string;
    readonly role: "primary_intent" | "secondary_intent" | "stabilizer";
    readonly sets: number;
    readonly relativeLoad: number;
  }[];
}

export interface MuscleWeekReport {
  readonly week: { readonly startDate: string; readonly endDate: string };
  readonly policy: { readonly id: string; readonly version: string; readonly evidenceTier: "D_product_policy"; readonly unit: "relative_load" };
  readonly targetPolicy: { readonly id: string; readonly version: string };
  readonly knowledgeVersion: string;
  /** 对照的当前目标（钉版引用）；目标不改写账本数字。 */
  readonly goalRef?: { readonly id: string; readonly revision?: number };
  readonly perMuscle: readonly MuscleWeekMuscleRow[];
  readonly explanations: readonly string[];
  /** RIR 缺失的组按 0.85 保守折算；这里显式标注缺失比例。 */
  readonly rirMissing: { readonly sets: number; readonly totalSets: number; readonly share: number };
  /** 肌群关联未审校的动作：贡献不计入任何肌群。 */
  readonly unknownExercises: readonly { readonly exerciseVariantId: string; readonly exerciseName: string; readonly sets: number }[];
  readonly confidence: "high" | "partial" | "low";
  readonly limitations: readonly string[];
  /** 「你说过的好变化」回放：本周窗内用户自述的 wellness_note（原话，不改写）。 */
  readonly wellnessNotes: readonly { readonly occurredAt: string; readonly note: string; readonly dimension?: WellnessDimension }[];
  readonly disclaimer: "relative_load_not_strength_or_activation";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function dateOf(value: string): string {
  return value.slice(0, 10);
}

export function assessMuscleWeek(input: {
  readonly week: { readonly startDate: string; readonly endDate: string };
  /** 已完成的训练组（仅来源 user_confirmed / imported 由调用方保证之外的过滤在此强制执行）。 */
  readonly completedSets: readonly MuscleWeekSetInput[];
  readonly goalContract?: GoalContractData;
  readonly knowledgeVersion: string;
  readonly trainingLevel?: MuscleWeekTrainingLevel;
  readonly exerciseById: (id: string) => ExerciseVariant | undefined;
  /** 本周窗内的主观好变化记录（wellness_note）；回放用，原话呈现。 */
  readonly wellnessNotes?: readonly { readonly occurredAt: string; readonly note: string; readonly dimension?: WellnessDimension }[];
}): MuscleWeekReport {
  const perMuscleSets = new Map<string, number>();
  const perMuscleLoad = new Map<string, number>();
  const perMuscleSynergist = new Map<string, number>();
  const contributionsByMuscle = new Map<string, MuscleWeekMuscleRow["contributions"][number][]>();
  const unknownByExercise = new Map<string, { exerciseName: string; sets: number }>();
  let totalSets = 0;
  let rirMissingSets = 0;

  for (const day of input.completedSets) {
    const date = dateOf(day.completedAt);
    if (date < input.week.startDate || date > input.week.endDate) continue;
    for (const outcome of day.outcomes) {
      // 只消费确认或导入的完成组；planned/skipped 永不进入账本。
      if (outcome.source !== "user_confirmed" && outcome.source !== "imported") continue;
      const exercise = input.exerciseById(outcome.exerciseVariantId);
      if (!exercise) continue;
      totalSets += 1;
      if (outcome.actualRir === undefined) rirMissingSets += 1;
      const reviewed = exercise.dataEligibility.expectedMuscleMetadata === "reviewed"
        && exercise.expectedMuscleAssociation.status === "reviewed_expected_participation";
      if (!reviewed) {
        const entry = unknownByExercise.get(exercise.id) ?? { exerciseName: exercise.displayName.zh, sets: 0 };
        entry.sets += 1;
        unknownByExercise.set(exercise.id, entry);
        continue;
      }
      const contributions = fatigueContributionsForExercise({ exercise, setCount: 1, rir: outcome.actualRir });
      for (const contribution of contributions) {
        const list = contributionsByMuscle.get(contribution.muscleId) ?? [];
        const existing = list.find((entry) => entry.exerciseVariantId === exercise.id && entry.role === contribution.role && entry.date === date);
        if (existing) {
          list.splice(list.indexOf(existing), 1, { ...existing, sets: existing.sets + 1, relativeLoad: round1(existing.relativeLoad + contribution.relativeLoad) });
        } else {
          list.push({ date, exerciseVariantId: exercise.id, exerciseName: exercise.displayName.zh, role: contribution.role, sets: 1, relativeLoad: contribution.relativeLoad });
        }
        contributionsByMuscle.set(contribution.muscleId, list);
        perMuscleLoad.set(contribution.muscleId, round1((perMuscleLoad.get(contribution.muscleId) ?? 0) + contribution.relativeLoad));
        if (contribution.role === "primary_intent") {
          perMuscleSets.set(contribution.muscleId, (perMuscleSets.get(contribution.muscleId) ?? 0) + 1);
        } else {
          perMuscleSynergist.set(contribution.muscleId, round1((perMuscleSynergist.get(contribution.muscleId) ?? 0) + contribution.relativeLoad));
        }
      }
    }
  }

  const band = WEEKLY_DIRECT_SET_TARGETS.bands[input.trainingLevel ?? "intermediate"];
  const limitations: string[] = [];
  if (!input.trainingLevel) limitations.push("未提供训练水平，目标带按 intermediate（4–10 直接组/周）对照。");

  const perMuscle: MuscleWeekMuscleRow[] = [...new Set([...perMuscleSets.keys(), ...perMuscleLoad.keys()])]
    .map((muscleId) => {
      const directSets = perMuscleSets.get(muscleId) ?? 0;
      const targetGap: MuscleWeekMuscleRow["targetGap"] = directSets < band.min ? "low" : directSets > band.max ? "high" : "in_range";
      return {
        muscleId,
        directSets,
        relativeLoad: round1(perMuscleLoad.get(muscleId) ?? 0),
        synergistLoad: round1(perMuscleSynergist.get(muscleId) ?? 0),
        targetGap,
        evidenceState: "reviewed" as const,
        contributions: (contributionsByMuscle.get(muscleId) ?? []).sort((left, right) => left.date.localeCompare(right.date)),
      };
    })
    .sort((left, right) => right.directSets - left.directSets || right.relativeLoad - left.relativeLoad);

  const unknownExercises = [...unknownByExercise.entries()].map(([exerciseVariantId, entry]) => ({ exerciseVariantId, exerciseName: entry.exerciseName, sets: entry.sets }));
  if (unknownExercises.length) {
    limitations.push(`肌群关联未审校的动作未计入：${unknownExercises.map((entry) => `${entry.exerciseName} ${entry.sets} 组`).join("、")}。`);
  }
  const rirShare = totalSets ? rirMissingSets / totalSets : 0;
  if (rirMissingSets > 0) limitations.push(`${rirMissingSets}/${totalSets} 组缺少 RIR，按 0.85 保守折算；可在记录中补录修正。`);
  if (totalSets === 0) limitations.push("本周没有已确认的训练组。");

  const explanations = perMuscle.map((row) => {
    const primaries = [...new Set(row.contributions.filter((entry) => entry.role === "primary_intent").map((entry) => entry.exerciseName))].join("、");
    const synergists = [...new Set(row.contributions.filter((entry) => entry.role !== "primary_intent").map((entry) => entry.exerciseName))].join("、");
    return `${row.muscleId}：${row.directSets} 直接组（${primaries || "无"}）${synergists ? `；协同负荷来自 ${synergists}` : ""}`;
  });

  return {
    week: input.week,
    policy: { id: MUSCLE_FATIGUE_POLICY.id, version: MUSCLE_FATIGUE_POLICY.version, evidenceTier: "D_product_policy", unit: "relative_load" },
    targetPolicy: { id: WEEKLY_DIRECT_SET_TARGETS.id, version: WEEKLY_DIRECT_SET_TARGETS.version },
    knowledgeVersion: input.knowledgeVersion,
    ...(input.goalContract ? { goalRef: { id: input.goalContract.id } } : {}),
    perMuscle,
    explanations,
    rirMissing: { sets: rirMissingSets, totalSets, share: round1(rirShare * 100) / 100 },
    unknownExercises,
    confidence: totalSets === 0 ? "low" : rirShare > 0.5 || unknownExercises.length > 0 ? "partial" : "high",
    limitations,
    wellnessNotes: input.wellnessNotes ?? [],
    disclaimer: "relative_load_not_strength_or_activation",
  };
}
