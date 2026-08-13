import type { DomainAggregateRef } from "../coach/domain";
import type { WorkingMemoryItem } from "../coach/model";
import type { OnboardingReadinessSafetyAssessment } from "./ReadinessSafety";
import type { OnboardingProgress } from "./model";

/**
 * Client-safe dossier review model. It deliberately preserves owner
 * boundaries: this is a composite view, never a second authoritative record.
 */
export interface OnboardingDossierSummary {
  draftId: string;
  userId: string;
  draftRevision: number;
  userFacts: {
    baseline: OnboardingProgress["patch"]["baseline"];
    profile: OnboardingProgress["patch"]["profile"];
    /** Conversation-normalized values are shown back before confirmation. */
    dynamicFields: OnboardingProgress["patch"]["dynamicFields"];
  };
  goalContract: OnboardingProgress["patch"]["goal"];
  goalInterpretation: {
    rawNarratives: readonly string[];
    structuredCaptures: OnboardingProgress["patch"]["goalCapture"];
    conflicts: readonly string[];
  };
  trainingBackground: OnboardingProgress["patch"]["trainingBackground"];
  coachingLevelAssessment?: NonNullable<OnboardingProgress["coachingLevelAssessments"]>[number];
  readiness: OnboardingReadinessSafetyAssessment["readiness"];
  authorization: {
    mandate: OnboardingProgress["patch"]["mandate"];
    permissions: OnboardingProgress["patch"]["permissions"];
  };
  safety: OnboardingReadinessSafetyAssessment["safety"];
  timelineMeasurements: NonNullable<OnboardingProgress["patch"]["goalCapture"]>["timelineBaselineMeasurements"];
  workingMemory: {
    authority: "non_authoritative";
    items: readonly Pick<WorkingMemoryItem, "id" | "kind" | "content" | "confidence" | "expiresAt">[];
  };
  unknowns: readonly string[];
  limitedActions: readonly string[];
  confirmation: {
    factFrontier: readonly DomainAggregateRef[];
  };
}

export function buildOnboardingDossierSummary(input: {
  draft: OnboardingProgress;
  readinessSafety: OnboardingReadinessSafetyAssessment;
  factFrontier: readonly DomainAggregateRef[];
  workingMemory: readonly WorkingMemoryItem[];
}): OnboardingDossierSummary {
  const capture = input.draft.patch.goalCapture;
  const unknowns = [
    ...input.draft.baselineMissingFields,
    ...Object.values(input.draft.patch.dynamicFields ?? {})
      .filter((field) => field.state === "explicit_unknown")
      .map((field) => field.fieldId),
    ...(!input.draft.patch.trainingBackground ? ["training_background"] : []),
    ...(!capture?.timelineBaselineMeasurements.length ? ["body_measurements"] : []),
    ...(!input.draft.patch.professional?.nutritionObservations?.length ? ["nutrition_intake"] : []),
  ];
  const limitedActions = input.readinessSafety.capabilities
    .filter((gate) => gate.status !== "available")
    .map((gate) => gate.action)
    .sort();
  return {
    draftId: input.draft.id,
    userId: input.draft.userId,
    draftRevision: input.draft.revision,
    userFacts: {
      baseline: input.draft.patch.baseline,
      profile: input.draft.patch.profile,
      dynamicFields: input.draft.patch.dynamicFields,
    },
    goalContract: input.draft.patch.goal,
    goalInterpretation: {
      rawNarratives: capture?.narratives.map((narrative) => narrative.text) ?? [],
      structuredCaptures: capture,
      conflicts: capture?.conflicts.map((conflict) => conflict.id) ?? [],
    },
    trainingBackground: input.draft.patch.trainingBackground,
    ...(input.draft.coachingLevelAssessments?.length
      ? { coachingLevelAssessment: input.draft.coachingLevelAssessments.at(-1) }
      : {}),
    readiness: input.readinessSafety.readiness,
    authorization: {
      mandate: input.draft.patch.mandate,
      permissions: input.draft.patch.permissions,
    },
    safety: input.readinessSafety.safety,
    timelineMeasurements: capture?.timelineBaselineMeasurements ?? [],
    workingMemory: {
      authority: "non_authoritative",
      items: input.workingMemory
        .filter((item) => !item.deletedAt && !item.supersededBy)
        .map(({ id, kind, content, confidence, expiresAt }) => ({ id, kind, content, confidence, ...(expiresAt ? { expiresAt } : {}) })),
    },
    unknowns: [...new Set(unknowns)].sort(),
    limitedActions,
    confirmation: { factFrontier: input.factFrontier },
  };
}
