import type {
  AchievabilityState,
  TimelineRiskAssessmentInput,
  TimelineRiskAssessmentPort,
  TimelineRiskOutcome,
} from "./timelineRiskEvaluation";

/**
 * A narrow goal-specific extension for the Timeline risk seam. Ticket 04 owns
 * the persisted Goal contract and its general risk snapshot; this module is
 * deliberately a typed adapter so it can be joined to that snapshot without
 * widening Timeline facts or treating a scale reading as a body-composition
 * observation.
 */
export type GoalSpecificRiskSnapshot =
  | FatLossRiskSnapshot
  | HypertrophyRiskSnapshot
  | PhysiqueRiskSnapshot;

export interface GoalSpecificRiskSnapshotSource {
  load(input: TimelineRiskAssessmentInput): Promise<GoalSpecificRiskSnapshot | undefined>;
}

export interface FatLossRiskSnapshot {
  mode: "fat_loss";
  observations: { energyPath: "on_path" | "behind" | "unknown" };
}

export interface HypertrophyRiskSnapshot {
  mode: "hypertrophy";
  contract: HypertrophyGoalContractExtension;
  observations: GoalSpecificRiskObservations;
}

export interface PhysiqueRiskSnapshot {
  mode: "physique";
  contract: PhysiqueGoalContractExtension;
  observations: GoalSpecificRiskObservations;
}

/** Measurements are comparable only inside the user-declared protocol. */
export interface ComparableGoalMeasurement {
  protocolId: string;
  metric: "circumference" | "body_weight" | "body_fat_percentage" | "photo_check";
  site?: string;
  observedAt: string;
  value: number;
  unit: "cm" | "kg" | "percent" | "ordinal";
  confidence: "confirmed" | "estimated" | "unknown";
}

export interface GoalMeasurementRequirement {
  protocolId: string;
  metric: ComparableGoalMeasurement["metric"];
  site?: string;
  required: boolean;
}

export interface GoalProtectionConstraints {
  recovery: "required" | "monitor";
  targetMuscleMinimumDose: "required" | "monitor";
}

export interface HypertrophyGoalContractExtension {
  targetMuscles: readonly string[];
  measurements: readonly GoalMeasurementRequirement[];
  protection: GoalProtectionConstraints;
}

export interface PhysiqueGoalContractExtension {
  /** A stated preference, never a promise that an aesthetic result is visible. */
  appearancePreference: "shoulder_to_waist" | "target_muscle_emphasis" | "balanced_proportions";
  measurements: readonly GoalMeasurementRequirement[];
  protection: GoalProtectionConstraints;
}

export interface GoalSpecificRiskObservations {
  measurements: readonly ComparableGoalMeasurement[];
  targetMuscleDose: "met" | "below_minimum" | "unknown";
  recovery: "adequate" | "degraded" | "unknown";
}

export interface GoalSpecificRiskDecision {
  status: Exclude<TimelineRiskOutcome, "queued" | "not_evaluated">;
  reasonCodes: readonly string[];
  achievabilityState: AchievabilityState;
}

/**
 * Joins goal-specific predicates to the public coordinator port. The source
 * must build its snapshot from the same fact frontier supplied by the
 * coordinator, which prevents an older measurement/contract from silently
 * deciding a newer Timeline revision.
 */
export function createGoalSpecificRiskAssessmentPort(
  source: GoalSpecificRiskSnapshotSource,
): TimelineRiskAssessmentPort {
  return {
    async assess(input) {
      const snapshot = await source.load(input);
      if (!snapshot) {
        return {
          status: "insufficient_evidence",
          reasonCodes: ["goal_specific_risk_snapshot_missing"],
          achievabilityState: "insufficient_evidence",
        };
      }
      return evaluateGoalSpecificRisk(snapshot);
    },
  };
}

export function evaluateGoalSpecificRisk(snapshot: GoalSpecificRiskSnapshot): GoalSpecificRiskDecision {
  if (snapshot.mode === "fat_loss") {
    if (snapshot.observations.energyPath === "behind") {
      return { status: "review_due", reasonCodes: ["fat_loss_energy_path_behind"], achievabilityState: "at_risk" };
    }
    if (snapshot.observations.energyPath === "unknown") {
      return { status: "insufficient_evidence", reasonCodes: ["fat_loss_energy_path_unknown"], achievabilityState: "insufficient_evidence" };
    }
    return { status: "no_review", reasonCodes: ["fat_loss_predicates_on_path"], achievabilityState: "on_path" };
  }

  const prefix = snapshot.mode;
  const missing = missingRequiredMeasurements(snapshot.contract.measurements, snapshot.observations.measurements);
  if (missing.length) {
    return {
      status: "insufficient_evidence",
      reasonCodes: missing.map((measurement) => `${prefix}_required_measurement_missing:${measurementLabel(measurement)}`),
      achievabilityState: "insufficient_evidence",
    };
  }

  const protectionEvidenceMissing = requiredProtectionEvidenceMissing(snapshot.contract.protection, snapshot.observations);
  if (protectionEvidenceMissing.length) {
    return {
      status: "insufficient_evidence",
      reasonCodes: protectionEvidenceMissing.map((field) => `${prefix}_${field}_unknown`),
      achievabilityState: "insufficient_evidence",
    };
  }

  const reasons: string[] = [];
  if (snapshot.contract.protection.recovery === "required" && snapshot.observations.recovery === "degraded") {
    reasons.push(`${prefix}_recovery_guardrail_breached`);
  }
  if (snapshot.contract.protection.targetMuscleMinimumDose === "required" && snapshot.observations.targetMuscleDose === "below_minimum") {
    reasons.push(`${prefix}_target_muscle_minimum_dose_missed`);
  }
  if (snapshot.mode === "physique" && waistTrendRegressed(snapshot.contract.measurements, snapshot.observations.measurements)) {
    reasons.push("physique_waist_trend_regressed");
  }
  if (snapshot.mode === "hypertrophy" && targetMuscleTrendRegressed(snapshot.contract, snapshot.observations.measurements)) {
    reasons.push("hypertrophy_target_muscle_trend_regressed");
  }

  return reasons.length
    ? { status: "review_due", reasonCodes: reasons, achievabilityState: "at_risk" }
    : { status: "no_review", reasonCodes: [`${prefix}_predicates_on_path`], achievabilityState: "on_path" };
}

function missingRequiredMeasurements(
  requirements: readonly GoalMeasurementRequirement[],
  observations: readonly ComparableGoalMeasurement[],
): readonly GoalMeasurementRequirement[] {
  return requirements.filter((requirement) =>
    requirement.required && comparableSeries(requirement, observations).length < 2,
  );
}

function requiredProtectionEvidenceMissing(
  protection: GoalProtectionConstraints,
  observations: GoalSpecificRiskObservations,
): readonly ("recovery" | "target_muscle_minimum_dose")[] {
  return [
    ...(protection.recovery === "required" && observations.recovery === "unknown" ? ["recovery" as const] : []),
    ...(protection.targetMuscleMinimumDose === "required" && observations.targetMuscleDose === "unknown"
      ? ["target_muscle_minimum_dose" as const]
      : []),
  ];
}

function targetMuscleTrendRegressed(
  contract: HypertrophyGoalContractExtension,
  observations: readonly ComparableGoalMeasurement[],
): boolean {
  return contract.measurements.some((measurement) => {
    if (measurement.metric !== "circumference" || !measurement.site || !contract.targetMuscles.includes(measurement.site)) return false;
    return hasNegativeTrend(comparableSeries(measurement, observations));
  });
}

function waistTrendRegressed(
  requirements: readonly GoalMeasurementRequirement[],
  observations: readonly ComparableGoalMeasurement[],
): boolean {
  const waist = requirements.find((measurement) => measurement.metric === "circumference" && measurement.site === "waist");
  return waist !== undefined && hasPositiveTrend(comparableSeries(waist, observations));
}

function comparableSeries(
  requirement: GoalMeasurementRequirement,
  observations: readonly ComparableGoalMeasurement[],
): readonly ComparableGoalMeasurement[] {
  return observations
    .filter((observation) =>
      observation.protocolId === requirement.protocolId &&
      observation.metric === requirement.metric &&
      observation.site === requirement.site &&
      observation.confidence === "confirmed",
    )
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

function hasPositiveTrend(series: readonly ComparableGoalMeasurement[]): boolean {
  return series.length >= 2 && series[series.length - 1]!.value > series[0]!.value;
}

function hasNegativeTrend(series: readonly ComparableGoalMeasurement[]): boolean {
  return series.length >= 2 && series[series.length - 1]!.value < series[0]!.value;
}

function measurementLabel(measurement: GoalMeasurementRequirement): string {
  return measurement.site ?? measurement.metric;
}
