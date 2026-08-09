import type {
  CoachingMandateData,
  ProfessionalConstraint,
  SafetyConstraintData,
  UserProfileData,
} from "../coach/domain";

export interface OnboardingPolicyConstraint {
  id: string;
  source: "safety" | "professional" | "user_hard" | "user_preference" | "product_default";
  priority: number;
  instruction: string;
  bypassableByManagedMode: false;
}

export interface OnboardingPolicyDecision {
  canGeneratePlan: boolean;
  canStartWorkout: boolean;
  disposition: SafetyConstraintData["disposition"];
  orderedConstraints: readonly OnboardingPolicyConstraint[];
  mandateMode: CoachingMandateData["mode"];
}

/**
 * Converts confirmed onboarding facts into the deterministic boundary consumed
 * by planners and action policy. LLM output is deliberately absent from this
 * interface: it may explain this decision, but cannot reorder or bypass it.
 */
export function evaluateOnboardingPolicy(input: {
  profile: UserProfileData;
  mandate: CoachingMandateData;
  safety: readonly SafetyConstraintData[];
  productDefaults?: readonly string[];
}): OnboardingPolicyDecision {
  const activeSafety = input.safety.reduce<SafetyConstraintData["disposition"]>(
    (current, constraint) =>
      safetyRank(constraint.disposition) > safetyRank(current)
        ? constraint.disposition
        : current,
    "clear",
  );
  const constraints: OnboardingPolicyConstraint[] = [
    ...input.safety.flatMap((constraint) =>
      constraint.disposition === "clear"
        ? []
        : constraint.reasons.map((reason, index) => ({
            id: `${constraint.id}:safety:${index}`,
            source: "safety" as const,
            priority: 0,
            instruction: reason,
            bypassableByManagedMode: false as const,
          })),
    ),
    ...professionalPolicyConstraints(input.profile.professionalConstraints ?? []),
    ...(input.profile.exerciseConstraints ?? []).map((constraint, index) => ({
      id: `exercise-constraint:${index}`,
      source:
        constraint.priority === "preference"
          ? ("user_preference" as const)
          : ("user_hard" as const),
      priority: constraint.priority === "preference" ? 3 : 2,
      instruction: constraint.kind,
      bypassableByManagedMode: false as const,
    })),
    ...(input.productDefaults ?? []).map((instruction, index) => ({
      id: `product-default:${index}`,
      source: "product_default" as const,
      priority: 4,
      instruction,
      bypassableByManagedMode: false as const,
    })),
  ].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  return {
    canGeneratePlan: activeSafety !== "stop_and_seek_professional_guidance",
    canStartWorkout: activeSafety === "clear",
    disposition: activeSafety,
    orderedConstraints: constraints,
    mandateMode: input.mandate.mode,
  };
}

function professionalPolicyConstraints(
  constraints: readonly ProfessionalConstraint[],
): readonly OnboardingPolicyConstraint[] {
  return constraints.map((constraint) => ({
    id: constraint.id,
    source: "professional",
    priority: 1,
    instruction: constraint.instruction,
    bypassableByManagedMode: false,
  }));
}

function safetyRank(disposition: SafetyConstraintData["disposition"]): number {
  if (disposition === "stop_and_seek_professional_guidance") return 2;
  if (disposition === "pause_and_confirm") return 1;
  return 0;
}
