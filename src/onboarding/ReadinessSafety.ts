import type { RecoveryConstraintData } from "../coach/domain";
import type {
  OnboardingActionGate,
  OnboardingDynamicFieldCapture,
  OnboardingProgress,
  SafetyDraft,
} from "./model";

export type OnboardingSafetyEvidenceStatus =
  | "unknown"
  | "explicitly_unknown"
  | "explicitly_denied"
  | "restricted"
  | "stop_signal";

export interface OnboardingSafetyEvidence {
  status: OnboardingSafetyEvidenceStatus;
  factsNeeded: readonly string[];
  reasonCodes: readonly string[];
}

export interface OnboardingReadinessState {
  status: "unassessed" | "active" | "expired";
  evaluatedAt?: string;
  validUntil?: string;
  availability?: { availableMinutes?: number; location?: string };
  evidenceRefs: readonly string[];
  affectedAreas: readonly string[];
  canTrainUnaffectedAreas: boolean;
  reassessRequired: boolean;
  reasonCodes: readonly string[];
}

export interface OnboardingCapabilityGate {
  action: OnboardingActionGate;
  status: "available" | "limited" | "blocked";
  /** Facts that would change this specific action decision. */
  factsNeeded: readonly string[];
  /** Allowed constrained path, kept distinct from a claim that it is clear. */
  allowedWith: readonly string[];
  reasonCodes: readonly string[];
}

export interface OnboardingReadinessSafetyAssessment {
  readiness: OnboardingReadinessState;
  safety: OnboardingSafetyEvidence;
  capabilities: readonly OnboardingCapabilityGate[];
}

/**
 * Projects short-lived recovery evidence and draft safety answers without
 * promoting either into User Profile or a permanent training-level label.
 */
export function projectOnboardingReadinessSafety(input: {
  draft: OnboardingProgress;
  recoveryConstraints: readonly { revision: number; value: RecoveryConstraintData }[];
  now: string;
}): OnboardingReadinessSafetyAssessment {
  const readiness = projectReadiness(input.recoveryConstraints, input.now);
  const safety = projectSafety(input.draft.patch.safety, input.draft.patch.dynamicFields?.["safety.activity_restrictions"]);
  const dynamic = input.draft.patch.dynamicFields ?? {};
  const hasExplicit = (fieldId: string) => dynamic[fieldId]?.state === "captured_explicit";
  const gates: OnboardingCapabilityGate[] = [];
  gates.push(gateForEnergy(hasExplicit("timeline.daily_activity"), hasExplicit("nutrition.usual_intake")));
  gates.push(gateForCardio("fasted_cardio", safety, readiness));
  gates.push(gateForCardio("high_intensity_cardio", safety, readiness));
  gates.push(gateForTraining("training_execution", safety, readiness));
  gates.push(gateForTraining("exercise_selection", safety, readiness));
  gates.push(hasExplicit("profile.training_schedule")
    ? available("dated_session_schedule")
    : limited("dated_session_schedule", ["profile.training_schedule"], [], ["schedule_unknown"]));
  gates.push(hasExplicit("training.comparable_set")
    ? available("comparable_strength_progression")
    : limited("comparable_strength_progression", ["training.comparable_set"], ["conservative_start_and_calibration"], ["comparable_set_unknown"]));
  gates.push(hasExplicit("profile.body_measurement_method")
    ? available("body_composition_trend")
    : limited("body_composition_trend", ["profile.body_measurement_method"], ["record_method_before_interpreting_trend"], ["measurement_method_unknown"]));
  gates.push(hasExplicit("mandate.plan_adjustment_authority")
    ? available("managed_plan_changes")
    : limited("managed_plan_changes", ["mandate.plan_adjustment_authority"], ["ask_before_every_change"], ["mandate_unknown"]));
  gates.push(hasExplicit("permission.remote_llm")
    ? available("remote_coach_conversation")
    : limited("remote_coach_conversation", ["permission.remote_llm"], ["local_only_conversation"], ["permission_unknown"]));
  return { readiness, safety, capabilities: gates };
}

function projectReadiness(
  constraints: readonly { revision: number; value: RecoveryConstraintData }[],
  now: string,
): OnboardingReadinessState {
  const latest = [...constraints].sort((left, right) =>
    (right.value.evaluation?.evaluatedAt ?? "").localeCompare(left.value.evaluation?.evaluatedAt ?? "") || right.revision - left.revision,
  )[0];
  if (!latest) {
    return { status: "unassessed", evidenceRefs: [], affectedAreas: [], canTrainUnaffectedAreas: true, reassessRequired: false, reasonCodes: ["no_current_readiness_evidence"] };
  }
  const validUntil = Date.parse(latest.value.validUntil);
  const active = Number.isFinite(validUntil) && validUntil >= Date.parse(now);
  const affectedAreas = (latest.value.intentions ?? [])
    .filter((intention) => intention.kind === "avoid_area" && intention.area)
    .map((intention) => intention.area!)
    .sort();
  const pause = latest.value.level === "pause_and_confirm";
  return {
    status: active ? "active" : "expired",
    ...(latest.value.evaluation?.evaluatedAt ? { evaluatedAt: latest.value.evaluation.evaluatedAt } : {}),
    validUntil: latest.value.validUntil,
    ...(latest.value.availability ? { availability: latest.value.availability } : {}),
    evidenceRefs: [
      ...(latest.value.evaluation?.triggeringFactRefs ?? []),
      ...(latest.value.evaluation?.corroboratingFactRefs ?? []),
    ],
    affectedAreas,
    canTrainUnaffectedAreas: !pause,
    reassessRequired: !active,
    reasonCodes: latest.value.evaluation?.reasonCodes ?? [],
  };
}

function projectSafety(
  safety: SafetyDraft | undefined,
  restrictionCapture: OnboardingDynamicFieldCapture | undefined,
): OnboardingSafetyEvidence {
  const stopSignals = safety?.stopSignals ?? [];
  if (stopSignals.length) {
    return { status: "stop_signal", factsNeeded: [], reasonCodes: stopSignals.map((signal) => `stop_signal:${signal}`) };
  }
  if (
    safety?.professionalRestriction ||
    safety?.recentSurgeryOrAcuteInjury ||
    safety?.pregnancyOrPostpartumSpecialConsideration ||
    safety?.eatingDisorderOrLowEnergyRiskDeclared
  ) {
    return { status: "restricted", factsNeeded: ["safety.activity_restrictions"], reasonCodes: ["declared_safety_restriction"] };
  }
  if (restrictionCapture?.state === "explicit_unknown") {
    return {
      status: "explicitly_unknown",
      factsNeeded: [],
      reasonCodes: ["safety_restrictions_explicitly_unknown"],
    };
  }
  const restrictionValue = restrictionCapture?.value;
  if (Array.isArray(restrictionValue)) {
    if (restrictionValue.includes("none_declared") && restrictionValue.length === 1) {
      return { status: "explicitly_denied", factsNeeded: [], reasonCodes: ["no_restrictions_explicitly_declared"] };
    }
    if (restrictionValue.length) {
      return { status: "restricted", factsNeeded: [], reasonCodes: ["activity_restriction_explicitly_declared"] };
    }
  }
  return {
    status: "unknown",
    factsNeeded: ["safety.activity_restrictions"],
    reasonCodes: ["safety_restrictions_not_yet_answered"],
  };
}

function gateForEnergy(activityKnown: boolean, intakeKnown: boolean): OnboardingCapabilityGate {
  const missing = [
    ...(activityKnown ? [] : ["timeline.daily_activity"]),
    ...(intakeKnown ? [] : ["nutrition.usual_intake"]),
  ];
  return missing.length
    ? limited("reliable_energy_target", missing, ["use_observed_trend_before_setting_precise_target"], ["energy_inputs_incomplete"])
    : available("reliable_energy_target");
}

function gateForCardio(
  action: "fasted_cardio" | "high_intensity_cardio",
  safety: OnboardingSafetyEvidence,
  readiness: OnboardingReadinessState,
): OnboardingCapabilityGate {
  if (safety.status === "stop_signal") return blocked(action, [], ["stop_signal"]);
  if (readiness.status === "active" && readiness.canTrainUnaffectedAreas === false) return blocked(action, [], ["active_pause_constraint"]);
  const factsNeeded = safetyUnknown(safety) ? safety.factsNeeded : [];
  const reasonCodes = [
    ...(safety.status === "restricted" ? ["safety_restriction"] : []),
    ...(safetyUnknown(safety) ? safety.reasonCodes : []),
    ...(readiness.status === "active" ? readiness.reasonCodes : []),
  ];
  return safety.status === "explicitly_denied" && readiness.status !== "active"
    ? available(action)
    : limited(action, factsNeeded, ["choose_low_intensity_after_warmup"], reasonCodes.length ? reasonCodes : ["readiness_not_assessed"]);
}

function gateForTraining(
  action: "training_execution" | "exercise_selection",
  safety: OnboardingSafetyEvidence,
  readiness: OnboardingReadinessState,
): OnboardingCapabilityGate {
  if (safety.status === "stop_signal") return blocked(action, [], ["stop_signal"]);
  if (readiness.status === "active" && !readiness.canTrainUnaffectedAreas) return blocked(action, [], ["active_pause_constraint"]);
  if (safety.status === "explicitly_denied" && readiness.status !== "active") return available(action);
  const allowedWith = [
    ...(readiness.affectedAreas.map((area) => `avoid:${area}`)),
    ...(readiness.status === "active" ? ["follow_active_recovery_constraint"] : []),
    ...(safetyUnknown(safety) ? ["confirm_safety_before_loading" ] : []),
  ];
  return limited(
    action,
    safetyUnknown(safety) ? safety.factsNeeded : [],
    allowedWith,
    [
      ...(safety.status === "restricted" ? ["safety_restriction"] : safety.reasonCodes),
      ...(readiness.status === "active" ? readiness.reasonCodes : []),
    ],
  );
}

function available(action: OnboardingActionGate): OnboardingCapabilityGate {
  return { action, status: "available", factsNeeded: [], allowedWith: [], reasonCodes: [] };
}

function limited(
  action: OnboardingActionGate,
  factsNeeded: readonly string[],
  allowedWith: readonly string[],
  reasonCodes: readonly string[],
): OnboardingCapabilityGate {
  return { action, status: "limited", factsNeeded, allowedWith, reasonCodes };
}

function blocked(action: OnboardingActionGate, factsNeeded: readonly string[], reasonCodes: readonly string[]): OnboardingCapabilityGate {
  return { action, status: "blocked", factsNeeded, allowedWith: [], reasonCodes };
}

function safetyUnknown(safety: OnboardingSafetyEvidence): boolean {
  return safety.status === "unknown" || safety.status === "explicitly_unknown";
}
