import type { AchievabilityState, TimelineRiskAssessmentInput, TimelineRiskAssessmentPort, TimelineRiskOutcome } from "./timelineRiskEvaluation";

/**
 * Ticket 06 decorates the ticket 04 Goal-risk port. The Timeline remains the
 * source of truth; this source is only a fact-frontier-pinned projection of
 * execution and comparable measurements. In particular, an absent entry is
 * not represented as a failed entry.
 */
export interface ExecutionContinuityRiskSnapshotSource {
  load(input: TimelineRiskAssessmentInput): Promise<ExecutionContinuityRiskSnapshot | undefined>;
}

export interface ExecutionContinuityRiskSnapshot {
  execution: {
    /** Coverage is a fact-quality statement, never a compliance judgement. */
    coverage: "high" | "partial" | "low";
    energyPath: "on_path" | "behind" | "unknown";
    diet: readonly ExecutionObservation[];
    keyTraining: readonly KeyTrainingExecutionObservation[];
  };
  trend: {
    measurementQuality: "comparable" | "incomparable" | "insufficient";
    bodyWeight: "improving" | "flat" | "regressing" | "unknown";
    waist: "improving" | "flat" | "regressing" | "unknown";
  };
  recovery: "adequate" | "degraded" | "unknown";
}

export interface ExecutionObservation {
  occurredAt: string;
  status: "within_tolerance" | "outside_tolerance";
}

export interface KeyTrainingExecutionObservation {
  occurredAt: string;
  status: "completed" | "partial" | "missed";
}

export interface PlateauAdjustmentCandidate {
  kind: "single_variable_experiment";
  /** A candidate cannot alter a completed/current Timeline event. */
  effectiveTiming: "future_only";
  confirmationRequired: true;
  /** Exactly one action variable is permitted for the observation window. */
  variables: readonly ["daily_activity" | "diet_energy_tolerance" | "training_dose"];
  observationWindowDays: 14;
  successSignal: "body_weight_or_waist_trend_improves";
  stopSignal: "recovery_or_performance_declines";
}

export interface ExecutionContinuityRiskDecision {
  status: Exclude<TimelineRiskOutcome, "queued" | "not_evaluated">;
  achievabilityState: AchievabilityState;
  reasonCodes: readonly string[];
  adjustment?: PlateauAdjustmentCandidate;
}

export interface ExecutionContinuityRiskAssessment extends TimelineRiskAssessmentPort {
  assessState(input: TimelineRiskAssessmentInput): Promise<ExecutionContinuityRiskDecision>;
}

export function createExecutionContinuityRiskAssessment(input: {
  base: TimelineRiskAssessmentPort;
  source: ExecutionContinuityRiskSnapshotSource;
}): ExecutionContinuityRiskAssessment {
  const assessState = async (assessmentInput: TimelineRiskAssessmentInput): Promise<ExecutionContinuityRiskDecision> => {
    const base = await input.base.assess(assessmentInput);
    const snapshot = await input.source.load(assessmentInput);
    if (!snapshot) {
      return normalizeBase(base);
    }

    // Safety/goal-contract hard stops are never made less strict by better
    // tracking coverage or a flat trend.
    if (base.achievabilityState === "infeasible_under_guardrails") return normalizeBase(base);

    const continuity = evaluateContinuity(snapshot);
    if (continuity && continuity.achievabilityState !== "on_path") return continuity;

    // A known base deviation remains material even if the execution slice has
    // only one minor deviation or a currently flat measurement trend.
    if (base.achievabilityState && base.achievabilityState !== "insufficient_evidence" && base.achievabilityState !== "on_path") {
      return normalizeBase(base);
    }

    const plateau = evaluateStagnation(snapshot);
    if (plateau) return plateau;

    if (continuity) return continuity;

    // A base deviation remains material even if the current execution slice
    // itself looks clean. This prevents a recent meal/event from being hidden.
    if (base.achievabilityState && base.achievabilityState !== "insufficient_evidence") {
      return normalizeBase(base);
    }

    return {
      status: "no_review",
      achievabilityState: "on_path",
      reasonCodes: ["execution_and_measurement_path_currently_supported"],
    };
  };

  return {
    assessState,
    async assess(assessmentInput) {
      const decision = await assessState(assessmentInput);
      return {
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        achievabilityState: decision.achievabilityState,
      };
    },
  };
}

function evaluateContinuity(snapshot: ExecutionContinuityRiskSnapshot): ExecutionContinuityRiskDecision | undefined {
  const { execution } = snapshot;
  if (execution.coverage === "low") {
    return insufficient("execution_record_coverage_low");
  }
  if (execution.energyPath === "unknown") {
    return insufficient("execution_energy_path_unknown");
  }
  if (execution.energyPath === "behind") return atRisk(["execution_energy_path_behind"]);

  const observations = executionObservations(execution);
  const failures = observations.filter((observation) => observation.failed);
  if (failures.length === 0) return undefined;
  const run = trailingFailureRun(observations);
  const failureRateHigh = observations.length >= 3 && failureRate(observations) >= 0.5;
  const worsening = isFailureRateWorsening(observations);
  if (run >= 2 || failureRateHigh || worsening) {
    return atRisk([
      ...(run >= 2 ? ["execution_failure_run_detected"] : []),
      ...(failureRateHigh ? ["execution_failure_rate_high"] : []),
      ...(worsening ? ["execution_failure_rate_worsening"] : []),
    ]);
  }
  return {
    status: "no_review",
    achievabilityState: "on_path",
    reasonCodes: ["single_execution_deviation_observed"],
  };
}

function evaluateStagnation(snapshot: ExecutionContinuityRiskSnapshot): ExecutionContinuityRiskDecision | undefined {
  const { trend } = snapshot;
  if (trend.measurementQuality === "incomparable") return insufficient("measurement_protocol_not_comparable");
  if (trend.measurementQuality === "insufficient") return insufficient("measurement_trend_insufficient");
  if (trend.bodyWeight === "flat" && trend.waist === "improving") {
    return { status: "no_review", achievabilityState: "on_path", reasonCodes: ["waist_trend_improving_weight_flat"] };
  }
  if (trend.bodyWeight !== "flat" || trend.waist !== "flat") return undefined;
  if (snapshot.recovery === "degraded") {
    return atRisk(["recovery_degraded_blocks_plateau_adjustment"]);
  }
  if (snapshot.recovery === "unknown") return insufficient("recovery_evidence_unknown_for_plateau");
  if (snapshot.execution.coverage !== "high" || snapshot.execution.energyPath !== "on_path") {
    return atRisk(["stagnation_execution_path_not_confirmed"]);
  }
  return {
    status: "review_due",
    achievabilityState: "at_risk",
    reasonCodes: ["candidate_response_plateau"],
    adjustment: {
      kind: "single_variable_experiment",
      effectiveTiming: "future_only",
      confirmationRequired: true,
      variables: ["daily_activity"],
      observationWindowDays: 14,
      successSignal: "body_weight_or_waist_trend_improves",
      stopSignal: "recovery_or_performance_declines",
    },
  };
}

function executionObservations(
  execution: ExecutionContinuityRiskSnapshot["execution"],
): readonly { occurredAt: string; failed: boolean }[] {
  return [
    ...execution.diet.map((entry) => ({ occurredAt: entry.occurredAt, failed: entry.status === "outside_tolerance" })),
    ...execution.keyTraining.map((entry) => ({ occurredAt: entry.occurredAt, failed: entry.status !== "completed" })),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

function trailingFailureRun(observations: readonly { failed: boolean }[]): number {
  let run = 0;
  for (let index = observations.length - 1; index >= 0 && observations[index]!.failed; index -= 1) run += 1;
  return run;
}

function failureRate(observations: readonly { failed: boolean }[]): number {
  return observations.length ? observations.filter((observation) => observation.failed).length / observations.length : 0;
}

function isFailureRateWorsening(observations: readonly { failed: boolean }[]): boolean {
  if (observations.length < 4) return false;
  const midpoint = Math.floor(observations.length / 2);
  return failureRate(observations.slice(midpoint)) > failureRate(observations.slice(0, midpoint));
}

function atRisk(reasonCodes: readonly string[]): ExecutionContinuityRiskDecision {
  return { status: "review_due", achievabilityState: "at_risk", reasonCodes };
}

function insufficient(reasonCode: string): ExecutionContinuityRiskDecision {
  return { status: "insufficient_evidence", achievabilityState: "insufficient_evidence", reasonCodes: [reasonCode] };
}

function normalizeBase(base: Awaited<ReturnType<TimelineRiskAssessmentPort["assess"]>>): ExecutionContinuityRiskDecision {
  return {
    status: base.status,
    achievabilityState: base.achievabilityState ?? (base.status === "no_review" ? "on_path" : "insufficient_evidence"),
    reasonCodes: base.reasonCodes,
  };
}
