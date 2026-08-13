import type { AgentKnowledgeInitialPlan } from "../agent-knowledge";
import type { DomainAggregateRef, GoalContractData, UserProfileData } from "../coach/domain";
import type { KnowledgeVersionPin } from "../agent-knowledge";
import type { OnboardingReadinessSafetyAssessment } from "./ReadinessSafety";
import type { CoachingLevelAssessment, OnboardingProgress } from "./model";

/**
 * Durable, user-reviewable output of the short-lived initial Planner task.
 * It deliberately contains inputs, evidence and a candidate plan—not private
 * agent reasoning and not an active PlanRevision.
 */
export interface FirstPlannerHandoffProposal {
  id: string;
  /** Confirmation artifacts retain their immutable source instead of mutating it. */
  sourceProposalId?: string;
  userId: string;
  status: "needs_input" | "awaiting_confirmation" | "stale" | "confirmed" | "rejected";
  draft: { id: string; revision: number };
  factFrontier: readonly DomainAggregateRef[];
  profileRef?: DomainAggregateRef<"user_profile">;
  goalContractRef?: DomainAggregateRef<"goal_contract">;
  mandateRef?: DomainAggregateRef<"coaching_mandate">;
  assessment?: CoachingLevelAssessment;
  readiness: OnboardingReadinessSafetyAssessment["readiness"];
  safety: OnboardingReadinessSafetyAssessment["safety"];
  knowledge: {
    backend: "agent_knowledge";
    agentKnowledgeReleasePin: KnowledgeVersionPin;
  };
  rulePins: readonly KnowledgeVersionPin[];
  evidenceRefs: readonly string[];
  unknowns: readonly string[];
  needsInput: readonly string[];
  plan?: AgentKnowledgeInitialPlan;
}

export function firstPlannerEvidence(input: {
  draft: OnboardingProgress;
  assessment?: CoachingLevelAssessment;
}): {
  recentSplit?: readonly string[];
  trainingContinuity?: CoachingLevelAssessment["dimensions"]["trainingContinuity"]["status"];
  comparablePerformance?: CoachingLevelAssessment["dimensions"]["currentComparablePerformance"]["status"];
  exactExerciseFamiliarity?: CoachingLevelAssessment["dimensions"]["exactExerciseFamiliarity"]["status"];
  unknowns: readonly string[];
} {
  const assessment = input.assessment;
  return {
    ...(input.draft.patch.trainingBackground?.recentSplit
      ? { recentSplit: input.draft.patch.trainingBackground.recentSplit }
      : {}),
    ...(assessment ? {
      trainingContinuity: assessment.dimensions.trainingContinuity.status,
      comparablePerformance: assessment.dimensions.currentComparablePerformance.status,
      exactExerciseFamiliarity: assessment.dimensions.exactExerciseFamiliarity.status,
    } : {}),
    unknowns: [
      ...(assessment
        ? Object.values(assessment.dimensions).flatMap((dimension) => dimension.unknowns)
        : ["coaching_level_assessment_missing"]),
      ...(!input.draft.patch.trainingBackground ? ["training_background"] : []),
    ].sort(),
  };
}

export function firstPlannerNeedsInput(input: {
  profile?: { value: UserProfileData };
  goal?: { value: GoalContractData };
  mandatePresent: boolean;
  assessment?: CoachingLevelAssessment;
  readinessSafety: OnboardingReadinessSafetyAssessment;
}): readonly string[] {
  const missing = [
    ...(!input.profile ? ["confirmed_user_profile"] : []),
    ...(!input.goal ? ["confirmed_goal_contract"] : []),
    ...(!input.mandatePresent ? ["confirmed_coaching_mandate"] : []),
    ...(!input.profile?.value.schedule ? ["profile.training_schedule"] : []),
    ...(!input.profile?.value.demographics?.ageYears ? ["baseline.age"] : []),
    ...(!input.profile?.value.demographics?.height ? ["baseline.height"] : []),
    ...(!input.profile?.value.demographics?.currentWeight ? ["baseline.current_weight"] : []),
    // Sex is not an admission field, but the local energy calculator has no
    // evidence-safe estimate without it.  Keep it an explicit later planning
    // question instead of silently selecting a BMR equation.
    ...(!input.profile?.value.demographics?.sex ? ["profile.sex_for_energy_estimate"] : []),
    ...(!assessmentHasMeaningfulEvidence(input.assessment) ? ["coaching_level_assessment_or_first_session_calibration"] : []),
    ...(!input.profile?.value.locations?.length ? ["training_location_or_equipment"] : []),
    ...input.readinessSafety.capabilities
      .filter((gate) => gate.action === "training_execution" && gate.status === "blocked")
      .flatMap((gate) => gate.factsNeeded.length ? gate.factsNeeded : gate.reasonCodes),
  ];
  return [...new Set(missing)].sort();
}

/** An all-unknown assessment is honest, but it cannot unlock a first plan. */
export function assessmentHasMeaningfulEvidence(assessment: CoachingLevelAssessment | undefined): boolean {
  return Boolean(assessment && Object.values(assessment.dimensions).some((dimension) => dimension.supportingEvidence.length > 0));
}
