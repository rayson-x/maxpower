import type { GoalContractData, TimelineFact, TimelineProjectionEvent } from "./domain";
import type { AchievabilityState, TimelineRiskAssessmentPort } from "./timelineRiskEvaluation";

/**
 * A deliberately conservative first goal-aware evaluator. It emits a closed
 * state vocabulary rather than a fabricated success percentage. Its job is
 * to decide whether the original Goal Contract needs review; candidate
 * corrections remain PlannerHarness work.
 */
export type AchievabilityRiskState = AchievabilityState;

export interface FatLossRiskAssessment extends TimelineRiskAssessmentPort {
  assessState(input: Parameters<TimelineRiskAssessmentPort["assess"]>[0]): Promise<{
    state: AchievabilityRiskState;
    reasonCodes: readonly string[];
  }>;
}

export function createFatLossTimelineRiskAssessment(): FatLossRiskAssessment {
  const assessState = async (
    input: Parameters<TimelineRiskAssessmentPort["assess"]>[0],
  ): Promise<{ state: AchievabilityRiskState; reasonCodes: readonly string[] }> => {
    const contract = input.riskSnapshot?.goalContract?.value;
    if (!contract) {
      return { state: "insufficient_evidence", reasonCodes: ["goal_contract_not_configured"] };
    }
    if (!isFatLossContract(contract)) {
      // A non-fat-loss Goal still gets a durable, honest risk outcome from the
      // default local composition. Product-specific hypertrophy/physique
      // adapters can replace this with their comparable-measurement predicate;
      // no Timeline change should degrade into an unobservable "unregistered"
      // assessment merely because that extra evidence is absent.
      return { state: "insufficient_evidence", reasonCodes: ["goal_specific_measurements_not_configured"] };
    }
    if (!contract.horizon.endDate || !contract.targetMode || !contract.executionTier) {
      return { state: "insufficient_evidence", reasonCodes: ["fat_loss_goal_contract_incomplete"] };
    }

    // This P0 evaluator reacts to the current deviation window. Ticket 06
    // replaces this fixed window with recency/criticality-weighted continuity
    // and trend evidence; an old meal must not permanently keep a Goal at risk.
    const facts = recentFacts(input.riskSnapshot?.timeline ?? [], input.evaluatedAt, 14);
    const recovery = latestFact(facts, "recovery");
    if (recovery?.fact.kind === "recovery" && belowRecoveryFloor(recovery.fact, contract)) {
      return { state: "infeasible_under_guardrails", reasonCodes: ["recovery_below_goal_guardrail"] };
    }

    const missed = facts.some((event) =>
      event.fact.kind === "training" && event.fact.reportedSession?.executionStatus === "missed",
    );
    if (missed && contract.targetMode === "strength_priority_cut") {
      return { state: "at_risk", reasonCodes: ["critical_training_miss_strength_guardrail"] };
    }
    if (missed && contract.targetMode === "lean_mass_preserving_fat_loss") {
      return { state: "at_risk", reasonCodes: ["critical_training_miss_lean_mass_guardrail"] };
    }

    const excessKcal = facts.reduce((total, event) => total + excessEnergy(event.fact), 0);
    if (excessKcal > 0) {
      if (contract.targetMode === "higher_body_mass_fat_loss" && hasLongerHorizon(contract, input.evaluatedAt)) {
        return { state: "on_path", reasonCodes: ["excess_energy_within_higher_body_mass_buffer"] };
      }
      if (contract.targetMode === "lean_mass_preserving_fat_loss") {
        return { state: "at_risk", reasonCodes: ["excess_energy_erodes_lean_cut_buffer"] };
      }
      return { state: "at_risk", reasonCodes: ["excess_energy_erodes_goal_buffer"] };
    }

    if (!hasRequiredMeasurementEvidence(contract, facts)) {
      return { state: "insufficient_evidence", reasonCodes: ["goal_measurement_plan_not_yet_covered"] };
    }
    return { state: "on_path", reasonCodes: ["original_goal_path_currently_supported"] };
  };

  return {
    assessState,
    async assess(input) {
      const result = await assessState(input);
      return {
        status: result.state === "on_path"
          ? "no_review"
          : result.state === "insufficient_evidence"
            ? "insufficient_evidence"
            : "review_due",
        reasonCodes: result.reasonCodes,
        achievabilityState: result.state,
      };
    },
  };
}

function isFatLossContract(contract: GoalContractData): boolean {
  return contract.primaryGoal === "fat_loss_preserve_lean_mass" || contract.goalType === "fat_loss";
}

function latestFact(
  events: readonly TimelineProjectionEvent[],
  kind: TimelineFact["kind"],
): TimelineProjectionEvent | undefined {
  return [...events]
    .filter((event) => event.fact.kind === kind)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
}

function recentFacts(
  events: readonly TimelineProjectionEvent[],
  evaluatedAt: string,
  windowDays: number,
): readonly TimelineProjectionEvent[] {
  const end = Date.parse(evaluatedAt);
  if (!Number.isFinite(end)) return events;
  const start = end - windowDays * 24 * 60 * 60 * 1_000;
  return events.filter((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    return Number.isFinite(occurredAt) && occurredAt >= start && occurredAt <= end;
  });
}

function belowRecoveryFloor(
  fact: Extract<TimelineFact, { kind: "recovery" }>,
  contract: GoalContractData,
): boolean {
  const floor = contract.guardrails?.minimumRecovery;
  return floor !== undefined && fact.perceivedRecovery !== undefined && fact.perceivedRecovery < floor;
}

function excessEnergy(fact: TimelineFact): number {
  if (fact.kind !== "nutrition") return 0;
  if (fact.reportedEnergyDeviationKcal !== undefined) return Math.max(0, fact.reportedEnergyDeviationKcal);
  return fact.simplified?.deviation === "large" ? 1 : 0;
}

function hasLongerHorizon(contract: GoalContractData, evaluatedAt: string): boolean {
  const end = Date.parse(`${contract.horizon.endDate}T23:59:59.999Z`);
  const now = Date.parse(evaluatedAt);
  return Number.isFinite(end) && Number.isFinite(now) && end - now >= 8 * 7 * 24 * 60 * 60 * 1_000;
}

function hasRequiredMeasurementEvidence(
  contract: GoalContractData,
  facts: readonly TimelineProjectionEvent[],
): boolean {
  const required = contract.measurementPlan?.requiredMeasurements ?? [];
  return required.every((measurement) => facts.some((event) => {
    if (measurement === "key_lift") return event.fact.kind === "training" && event.fact.reportedSession?.executionStatus === "completed";
    if (measurement === "body_weight") return event.fact.kind === "body" && event.fact.measurement.metric === "body_weight";
    return event.fact.kind === "body" && event.fact.measurement.metric === "circumference" && event.fact.measurement.site === "waist";
  }));
}
