import type { DomainProjection, GoalContractData, MassQuantity, UserProfileData } from "../coach/domain";
import { estimateBodyFat } from "../planning/bodyComposition";
import { strengthTargetProgress } from "./StrengthGoalEvidence";

export interface GoalPathOption {
  id: "gradual" | "balanced" | "faster";
  executionTier: NonNullable<GoalContractData["executionTier"]>;
  targetWeeks: number;
  behaviorBurden: "low" | "moderate" | "high";
  trainingBurden: "low" | "moderate" | "high";
  recordingBurden: "minimum_weekly" | "representative_days" | "high_coverage";
  uncertainty: readonly string[];
  guardrails: readonly string[];
  feasible: boolean;
  conflictReasons: readonly string[];
}

export interface GoalNegotiationPreview {
  status: "options" | "needs_clarification" | "no_safe_path";
  options: readonly GoalPathOption[];
  missing: readonly string[];
}

/** Fixed path math; an Agent may explain it but cannot invent a safer/faster bound. */
export function negotiateGoalPaths(input: { goal: GoalContractData; profile?: UserProfileData; domain?: DomainProjection; today: string }): GoalNegotiationPreview {
  const safePath = minimumSafeWeeksFor(input.goal, input.profile ?? input.domain?.profile?.value, input.domain);
  const missing = [
    ...(!input.goal.horizon.endDate && !input.goal.targetWeeks ? ["desired_time_or_deadline_missing"] : []),
    ...(!input.goal.targets || Object.keys(input.goal.targets).length === 0 ? ["measurable_target_missing"] : []),
    ...safePath.missing,
  ];
  if (missing.length) return { status: "needs_clarification", options: [], missing };
  const desiredWeeks = input.goal.targetWeeks ?? Math.max(1, Math.ceil(daysBetween(input.today, input.goal.horizon.endDate!) / 7));
  const minimumSafeWeeks = safePath.minimumWeeks;
  const definitions = [
    { id: "gradual" as const, factor: 1.35, safeFactor: 1.2, tier: "protect_sustainability" as const, behavior: "low" as const, training: "moderate" as const, recording: "minimum_weekly" as const },
    { id: "balanced" as const, factor: 1, safeFactor: 1, tier: "balanced" as const, behavior: "moderate" as const, training: "moderate" as const, recording: "representative_days" as const },
    { id: "faster" as const, factor: 0.8, safeFactor: 0, tier: "protect_deadline" as const, behavior: "high" as const, training: "high" as const, recording: "high_coverage" as const },
  ];
  const options = definitions.map((definition): GoalPathOption => {
    // Negotiation must always expose at least one safe alternative when the
    // requested deadline is too aggressive. The user chooses the extra time;
    // the engine never silently preserves an impossible deadline.
    const safeFloor = minimumSafeWeeks === undefined ? 1 : Math.ceil(minimumSafeWeeks * definition.safeFactor);
    const targetWeeks = Math.max(1, safeFloor, Math.ceil(desiredWeeks * definition.factor));
    const feasible = minimumSafeWeeks === undefined || targetWeeks >= minimumSafeWeeks;
    return {
      id: definition.id, executionTier: definition.tier, targetWeeks, behaviorBurden: definition.behavior, trainingBurden: definition.training, recordingBurden: definition.recording,
      uncertainty: ["individual_response_requires_observation", "maintenance_energy_is_a_range"],
      guardrails: ["no_extreme_energy_restriction", "recovery_and_injury_limits_are_non_overridable", "goal_change_requires_confirmation"],
      feasible,
      conflictReasons: feasible ? [] : [`target_time_below_guardrail_minimum:${minimumSafeWeeks}`],
    };
  });
  return { status: options.some((option) => option.feasible) ? "options" : "no_safe_path", options, missing: [] };
}

function minimumSafeWeeksFor(goal: GoalContractData, profile?: UserProfileData, domain?: DomainProjection): { minimumWeeks?: number; missing: string[] } {
  const targets = goal.targets;
  if (!targets) return { missing: [] };
  const missing: string[] = [];
  const minimumWeeks: number[] = [];
  const currentWeightKg = latestBodyValue(domain, "body_weight") ?? toKg(profile?.demographics?.currentWeight);
  const targetWeightKg = toKg(targets.targetWeight);
  if (targetWeightKg !== undefined) {
    if (currentWeightKg === undefined || currentWeightKg <= 0) missing.push("current_body_weight_missing_for_deadline");
    else {
      const weeklyRate = goal.primaryGoal === "fat_loss_preserve_lean_mass" ? currentWeightKg * 0.01 : goal.primaryGoal === "hypertrophy" ? currentWeightKg * 0.005 : currentWeightKg * 0.0025;
      minimumWeeks.push(Math.ceil(Math.abs(targetWeightKg - currentWeightKg) / Math.max(0.1, weeklyRate)));
    }
  }

  const targetBodyFat = targets.targetBodyFat?.value;
  if (targetBodyFat !== undefined) {
    const currentBodyFat = latestBodyValue(domain, "body_fat_percentage") ?? targets.currentBodyFat?.value ?? (profile ? estimateBodyFat({ profile })?.percent : undefined);
    if (currentBodyFat === undefined) missing.push("current_body_fat_missing_for_deadline");
    else minimumWeeks.push(Math.ceil(Math.abs(targetBodyFat - currentBodyFat) / (targetBodyFat < currentBodyFat ? 0.75 : 0.25)));
  }

  const currentWaist = latestCircumferenceCm(domain, "waist") ?? toCm(profile?.demographics?.currentCircumferences?.waist);
  const targetWaist = toCm(targets.targetWaist);
  if (targetWaist !== undefined) {
    if (currentWaist === undefined) missing.push("current_waist_missing_for_deadline");
    else minimumWeeks.push(Math.ceil(Math.abs(targetWaist - currentWaist) / (targetWaist < currentWaist ? 1 : 0.25)));
  }
  const currentShoulder = latestCircumferenceCm(domain, "shoulder") ?? toCm(profile?.demographics?.currentCircumferences?.shoulder);
  const targetShoulder = toCm(targets.targetShoulder);
  if (targetShoulder !== undefined) {
    if (currentShoulder === undefined) missing.push("current_shoulder_missing_for_deadline");
    else minimumWeeks.push(Math.ceil(Math.abs(targetShoulder - currentShoulder) / (targetShoulder > currentShoulder ? 0.25 : 1)));
  }
  if (targets.targetShoulderWaistRatio !== undefined) {
    if (currentWaist === undefined || currentShoulder === undefined) missing.push("current_shoulder_waist_measurements_missing_for_deadline");
    else minimumWeeks.push(Math.ceil(Math.abs(targets.targetShoulderWaistRatio - currentShoulder / Math.max(1, currentWaist)) / 0.015));
  }

  const strength = currentStrengthKg(domain, profile, targets.strength);
  for (const [lift, target] of Object.entries(targets.strength ?? {}) as [keyof NonNullable<typeof targets.strength>, MassQuantity][]) {
    const targetKg = toKg(target)!;
    const currentKg = strength[lift];
    if (currentKg === undefined) missing.push(`current_strength_missing_for_deadline:${lift}`);
    else if (targetKg > currentKg) {
      const rate = strengthProgressFraction(profile);
      minimumWeeks.push(Math.ceil((targetKg - currentKg) / Math.max(0.5, currentKg * rate)));
    }
  }
  return { ...(minimumWeeks.length ? { minimumWeeks: Math.max(1, ...minimumWeeks) } : {}), missing: [...new Set(missing)] };
}

/** Conservative strength-path bound from decision-specific evidence, never a global experience label. */
export function strengthProgressFraction(profile?: UserProfileData): number {
  const capability = profile?.trainingCapabilities;
  if (!capability) return 0.005;
  if (capability.currentComparablePerformance.status === "supported" && capability.trainingContinuity.status === "supported") return 0.01;
  if (capability.currentComparablePerformance.status === "contradicted" || capability.trainingContinuity.status === "contradicted") return 0.005;
  return 0.005;
}

function latestBodyValue(domain: DomainProjection | undefined, metric: "body_weight" | "body_fat_percentage"): number | undefined {
  const event = domain?.timeline.current
    .filter((candidate) => candidate.fact.kind === "body" && candidate.fact.confidence === "confirmed" && candidate.fact.measurement.metric === metric)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
  if (!event || event.fact.kind !== "body" || event.fact.measurement.metric !== metric) return undefined;
  return event.fact.measurement.metric === "body_weight" ? toKg(event.fact.measurement.quantity) : event.fact.measurement.quantity.value;
}

function latestCircumferenceCm(domain: DomainProjection | undefined, site: "waist" | "shoulder"): number | undefined {
  const event = domain?.timeline.current
    .filter((candidate) => candidate.fact.kind === "body" && candidate.fact.confidence === "confirmed" && candidate.fact.measurement.metric === "circumference" && candidate.fact.measurement.site.toLowerCase() === site)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
  return event?.fact.kind === "body" && event.fact.measurement.metric === "circumference" ? toCm(event.fact.measurement.quantity) : undefined;
}

function currentStrengthKg(
  domain: DomainProjection | undefined,
  profile: UserProfileData | undefined,
  targets: NonNullable<GoalContractData["targets"]>["strength"],
): Partial<Record<keyof NonNullable<typeof targets>, number>> {
  const result: Partial<Record<keyof NonNullable<typeof targets>, number>> = {};
  if (domain) {
    for (const progress of strengthTargetProgress(domain, targets)) {
      if (progress.latestKg !== undefined) result[progress.lift] = progress.latestKg;
    }
  }
  const baseline = profile?.strengthBaseline;
  const baselineKg = (load?: MassQuantity, reps?: number) => {
    const kg = toKg(load);
    return kg === undefined ? undefined : kg * (1 + (reps ?? 1) / 30);
  };
  result.squat ??= baselineKg(baseline?.squat, baseline?.squatReps);
  result.benchPress ??= baselineKg(baseline?.benchPress, baseline?.benchPressReps);
  result.deadlift ??= baselineKg(baseline?.deadlift, baseline?.deadliftReps);
  if (result.combinedTotal === undefined && result.squat !== undefined && result.benchPress !== undefined && result.deadlift !== undefined) result.combinedTotal = result.squat + result.benchPress + result.deadlift;
  return result;
}

function toKg(quantity?: MassQuantity): number | undefined { return quantity ? quantity.unit === "kg" ? quantity.value : quantity.value * 0.45359237 : undefined; }
function toCm(quantity?: { value: number; unit: "cm" | "in" }): number | undefined { return quantity ? quantity.unit === "cm" ? quantity.value : quantity.value * 2.54 : undefined; }
function daysBetween(left: string, right: string): number { return Math.max(0, Math.round((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86_400_000)); }

export function goalDeadlineForWeeks(today: string, weeks: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(1, weeks) * 7);
  return date.toISOString().slice(0, 10);
}
