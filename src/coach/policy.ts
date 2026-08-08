import type { PlanChangeProposalArtifact, UserState } from "./model";

export type PolicyDecision =
  | { result: "allow"; executionPolicy: "confirm" | "managed" | "advice_only" }
  | { result: "deny"; reason: "safety_hold" | "stale" | "advice_only" };

/** Pure policy. No storage, clock, provider or UI access. */
export class PolicyGate {
  proposal(user: UserState): PolicyDecision {
    if (user.safetyHold) return { result: "deny", reason: "safety_hold" };
    if (user.mandate.mode === "manual") {
      return { result: "allow", executionPolicy: "advice_only" };
    }
    return {
      result: "allow",
      executionPolicy: user.mandate.mode === "managed" ? "managed" : "confirm",
    };
  }

  apply(user: UserState, proposal: PlanChangeProposalArtifact): PolicyDecision {
    if (user.safetyHold) return { result: "deny", reason: "safety_hold" };
    if (
      user.plan.revision !== proposal.basePlanRevision ||
      user.mandate.revision !== proposal.mandateRevision
    ) {
      return { result: "deny", reason: "stale" };
    }
    if (user.mandate.mode === "manual") {
      return { result: "deny", reason: "advice_only" };
    }
    return {
      result: "allow",
      executionPolicy: user.mandate.mode === "managed" ? "managed" : "confirm",
    };
  }
}
