import type { FactRef } from "./model";
import type { GoalContractData, TimelineProjectionEvent } from "./domain";

/**
 * The semantic boundary between Timeline admission and goal-specific risk
 * modelling. This module deliberately knows nothing about fat loss, training
 * splits, or Plan revisions: it only decides whether the latest immutable
 * Timeline frontier should be handed to the registered evaluator.
 */
export type TimelineRiskDisposition = "material" | "coalesced" | "skipped" | "stale" | "failed";

export type TimelineRiskOutcome =
  | "queued"
  | "review_due"
  | "no_review"
  | "insufficient_evidence"
  | "not_evaluated";

/** Closed, non-numeric goal-achievability vocabulary. */
export type AchievabilityState =
  | "on_path"
  | "at_risk"
  | "infeasible_under_guardrails"
  | "insufficient_evidence";

export interface TimelineRiskAssessmentInput {
  userId: string;
  timelineRevision: number;
  factFrontier: readonly FactRef[];
  sourceFactRefs: readonly FactRef[];
  causationIds: readonly string[];
  evaluatedAt: string;
  /** Optional goal-aware snapshot. Admission remains usable for evaluators that only need refs. */
  riskSnapshot?: {
    goalContract?: { revision: number; value: GoalContractData };
    timeline: readonly TimelineProjectionEvent[];
  };
}

/** Implemented by ticket 04; the coordinator stays deterministic without it. */
export interface TimelineRiskAssessmentPort {
  assess(input: TimelineRiskAssessmentInput): Promise<{
    status: Exclude<TimelineRiskOutcome, "queued" | "not_evaluated">;
    reasonCodes: readonly string[];
    achievabilityState?: AchievabilityState;
  }>;
}

export interface TimelineRiskEvaluationRecord {
  phase: "timeline_changed" | "scheduled_check";
  disposition: TimelineRiskDisposition;
  outcome: TimelineRiskOutcome;
  timelineRevision: number;
  sourceFactRefs: readonly FactRef[];
  reasonCodes: readonly string[];
  causationIds: readonly string[];
  coalescesArtifactId?: string;
  achievabilityState?: AchievabilityState;
}

export class TimelineRiskEvaluationCoordinator {
  constructor(private readonly assessment?: TimelineRiskAssessmentPort) {}

  /**
   * Every committed Timeline change enters here. A later change does not
   * discard the pending earlier fact: it is recorded as coalesced and moves
   * the one future check to the newest Timeline revision.
   */
  onTimelineChanged(input: {
    timelineRevision: number;
    sourceFactRefs: readonly FactRef[];
    causationIds: readonly string[];
    pending?: {
      artifactId: string;
      sourceFactRefs: readonly FactRef[];
      causationIds: readonly string[];
    };
  }): TimelineRiskEvaluationRecord {
    const coalesced = Boolean(input.pending);
    return {
      phase: "timeline_changed",
      disposition: coalesced ? "coalesced" : "material",
      outcome: "queued",
      timelineRevision: input.timelineRevision,
      sourceFactRefs: distinctFactRefs([...(input.pending?.sourceFactRefs ?? []), ...input.sourceFactRefs]),
      reasonCodes: coalesced ? ["pending_timeline_check_coalesced"] : ["material_timeline_fact_changed"],
      causationIds: [...new Set([...(input.pending?.causationIds ?? []), ...input.causationIds])],
      ...(input.pending ? { coalescesArtifactId: input.pending.artifactId } : {}),
    };
  }

  /**
   * A scheduler has no authority to create a Record. It can only inspect the
   * current Timeline frontier and request an assessment of that exact state.
   */
  async runScheduledCheck(input: {
    userId: string;
    timelineRevision: number;
    factFrontier: readonly FactRef[];
    latestQueued?: TimelineRiskEvaluationRecord;
    expectedTimelineRevision?: number;
    evaluatedAt: string;
    riskSnapshot?: TimelineRiskAssessmentInput["riskSnapshot"];
  }): Promise<TimelineRiskEvaluationRecord> {
    if (input.timelineRevision === 0) {
      return skipped(input.timelineRevision, "no_timeline_facts");
    }
    if (
      input.expectedTimelineRevision !== undefined &&
      input.expectedTimelineRevision !== input.timelineRevision
    ) {
      return {
        phase: "scheduled_check",
        disposition: "stale",
        outcome: "not_evaluated",
        timelineRevision: input.timelineRevision,
        sourceFactRefs: [],
        reasonCodes: ["timeline_frontier_advanced"],
        causationIds: [],
      };
    }
    if (!input.latestQueued || input.latestQueued.timelineRevision !== input.timelineRevision) {
      return skipped(input.timelineRevision, "no_pending_timeline_check");
    }
    if (!this.assessment) {
      return {
        phase: "scheduled_check",
        disposition: "material",
        outcome: "not_evaluated",
        timelineRevision: input.timelineRevision,
        sourceFactRefs: input.latestQueued.sourceFactRefs,
        reasonCodes: ["risk_assessment_not_registered"],
        causationIds: input.latestQueued.causationIds,
      };
    }
    try {
      const assessment = await this.assessment.assess({
        userId: input.userId,
        timelineRevision: input.timelineRevision,
        factFrontier: input.factFrontier,
        sourceFactRefs: input.latestQueued.sourceFactRefs,
        causationIds: input.latestQueued.causationIds,
        evaluatedAt: input.evaluatedAt,
        ...(input.riskSnapshot ? { riskSnapshot: input.riskSnapshot } : {}),
      });
      return {
        phase: "scheduled_check",
        disposition: "material",
        outcome: assessment.status,
        timelineRevision: input.timelineRevision,
        sourceFactRefs: input.latestQueued.sourceFactRefs,
        reasonCodes: assessment.reasonCodes,
        causationIds: input.latestQueued.causationIds,
        ...(assessment.achievabilityState ? { achievabilityState: assessment.achievabilityState } : {}),
      };
    } catch {
      return {
        phase: "scheduled_check",
        disposition: "failed",
        outcome: "not_evaluated",
        timelineRevision: input.timelineRevision,
        sourceFactRefs: input.latestQueued.sourceFactRefs,
        reasonCodes: ["risk_assessment_failed"],
        causationIds: input.latestQueued.causationIds,
      };
    }
  }
}

function distinctFactRefs(refs: readonly FactRef[]): readonly FactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.aggregate}:${ref.id}:${ref.revision}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function skipped(timelineRevision: number, reasonCode: string): TimelineRiskEvaluationRecord {
  return {
    phase: "scheduled_check",
    disposition: "skipped",
    outcome: "not_evaluated",
    timelineRevision,
    sourceFactRefs: [],
    reasonCodes: [reasonCode],
    causationIds: [],
  };
}
