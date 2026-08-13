import { stableHash } from "../coach/stable";
import type {
  CoachingAssessmentDimension,
  CoachingAssessmentEvidence,
  CoachingLevelAssessment,
  OnboardingProgress,
  TrainingBackgroundDraft,
} from "./model";

function emptyDimension(input: {
  unknowns: readonly string[];
  refutingEvidence?: readonly CoachingAssessmentEvidence[];
  applicableExerciseVariantIds?: readonly string[];
  reassessWhen: readonly string[];
}): CoachingAssessmentDimension {
  return {
    status: "unknown",
    supportingEvidence: [],
    refutingEvidence: input.refutingEvidence ?? [],
    unknowns: input.unknowns,
    applicableExerciseVariantIds: input.applicableExerciseVariantIds ?? [],
    reassessWhen: input.reassessWhen,
  };
}

function backgroundEvidence(
  background: TrainingBackgroundDraft,
  code: Extract<CoachingAssessmentEvidence["code"], Exclude<CoachingAssessmentEvidence["code"], "duration_and_vocabulary_not_sufficient">>,
  exerciseVariantId?: string,
): CoachingAssessmentEvidence {
  return {
    code,
    source: background.source,
    capturedAt: background.capturedAt,
    ...(exerciseVariantId ? { exerciseVariantId } : {}),
  };
}

function continuity(background: TrainingBackgroundDraft): CoachingAssessmentDimension {
  const reported = background.recentContinuity;
  if (!reported) {
    return emptyDimension({
      unknowns: ["recent_continuity_not_provided"],
      reassessWhen: ["user_reports_recent_training_window", "first_calibration_sessions_completed"],
    });
  }
  const support = backgroundEvidence(background, "recent_continuity_reported");
  if ((reported.timeAwayWeeks ?? 0) >= 4 && (reported.consecutiveWeeks ?? 0) < 4) {
    return {
      status: "contradicted",
      supportingEvidence: [support],
      refutingEvidence: [backgroundEvidence(background, "recent_time_away_reported")],
      unknowns: [],
      applicableExerciseVariantIds: [],
      reassessWhen: ["four_consecutive_training_weeks_completed", "new_comparable_sets_recorded"],
    };
  }
  if ((reported.consecutiveWeeks ?? 0) >= 8 && (reported.usualSessionsPerWeek ?? 0) >= 2) {
    return {
      status: "supported",
      supportingEvidence: [support],
      refutingEvidence: [],
      unknowns: [],
      applicableExerciseVariantIds: [],
      reassessWhen: ["four_or_more_weeks_away", "training_frequency_changes"],
    };
  }
  return {
    status: "provisional",
    supportingEvidence: [support],
    refutingEvidence: [],
    unknowns: ["longer_recent_continuity_window_not_provided"],
    applicableExerciseVariantIds: [],
    reassessWhen: ["first_calibration_sessions_completed", "recent_training_window_updated"],
  };
}

function exactFamiliarity(background: TrainingBackgroundDraft): CoachingAssessmentDimension {
  const variants = [...new Set(background.exactExerciseFamiliarity ?? [])];
  if (variants.length === 0) {
    return emptyDimension({
      unknowns: ["exact_exercise_familiarity_not_provided"],
      reassessWhen: ["user_confirms_exact_exercise_variant", "first_calibration_sessions_completed"],
    });
  }
  return {
    status: "supported",
    supportingEvidence: variants.map((variant) => backgroundEvidence(background, "exact_exercise_familiarity_reported", variant)),
    refutingEvidence: [],
    unknowns: [],
    applicableExerciseVariantIds: variants,
    reassessWhen: ["exercise_variant_changes", "execution_evidence_contradicts_familiarity"],
  };
}

function comparablePerformance(background: TrainingBackgroundDraft): CoachingAssessmentDimension {
  const sets = background.comparableSets ?? [];
  if (sets.length === 0) {
    return emptyDimension({
      unknowns: ["comparable_set_not_provided"],
      reassessWhen: ["user_reports_comparable_set", "first_calibration_sessions_completed"],
    });
  }
  const variants = [...new Set(sets.map((set) => set.exerciseVariantId))];
  return {
    status: "supported",
    supportingEvidence: sets.map((set) => backgroundEvidence(background, "comparable_set_reported", set.exerciseVariantId)),
    refutingEvidence: [],
    unknowns: sets.some((set) => set.rir === undefined && set.rpe === undefined)
      ? ["rir_or_rpe_not_provided"]
      : [],
    applicableExerciseVariantIds: variants,
    reassessWhen: ["new_comparable_sets_recorded", "exercise_variant_or_conditions_change"],
  };
}

function programmingUnderstanding(background: TrainingBackgroundDraft): CoachingAssessmentDimension {
  if ((background.recentSplit?.length ?? 0) >= 2) {
    return {
      status: "provisional",
      supportingEvidence: [backgroundEvidence(background, "recent_split_reported")],
      refutingEvidence: [],
      unknowns: ["progression_and_volume_management_not_observed"],
      applicableExerciseVariantIds: [],
      reassessWhen: ["first_training_cycle_reviewed", "user_corrects_recent_split"],
    };
  }
  const durationOrTermsWereReported = Boolean(
    background.cumulativeTrainingMonths || background.reportedTerminology?.length,
  );
  return emptyDimension({
    unknowns: ["programming_evidence_not_provided"],
    refutingEvidence: durationOrTermsWereReported
      ? [{ code: "duration_and_vocabulary_not_sufficient" }]
      : [],
    reassessWhen: ["recent_split_or_training_structure_reported", "first_training_cycle_reviewed"],
  });
}

function selfRegulation(background: TrainingBackgroundDraft): CoachingAssessmentDimension {
  const setsWithEffort = (background.comparableSets ?? []).filter(
    (set) => set.rir !== undefined || set.rpe !== undefined,
  );
  if (setsWithEffort.length === 0) {
    return emptyDimension({
      unknowns: ["effort_autoregulation_evidence_not_provided"],
      reassessWhen: ["comparable_sets_include_rir_or_rpe", "first_calibration_sessions_completed"],
    });
  }
  return {
    status: "provisional",
    supportingEvidence: setsWithEffort.map((set) => backgroundEvidence(background, "comparable_set_reported", set.exerciseVariantId)),
    refutingEvidence: [],
    unknowns: ["effort_reporting_not_yet_compared_with_execution"],
    applicableExerciseVariantIds: [...new Set(setsWithEffort.map((set) => set.exerciseVariantId))],
    reassessWhen: ["first_calibration_sessions_completed", "effort_and_execution_records_diverge"],
  };
}

function executionStability(background: TrainingBackgroundDraft): CoachingAssessmentDimension {
  if (background.executionStability === "reported_consistent") {
    return {
      status: "provisional",
      supportingEvidence: [backgroundEvidence(background, "execution_consistency_reported")],
      refutingEvidence: [],
      unknowns: ["attendance_and_completion_records_not_yet_observed"],
      applicableExerciseVariantIds: [],
      reassessWhen: ["first_calibration_sessions_completed", "attendance_pattern_changes"],
    };
  }
  if (background.executionStability === "reported_variable") {
    return {
      status: "contradicted",
      supportingEvidence: [],
      refutingEvidence: [backgroundEvidence(background, "execution_consistency_reported")],
      unknowns: [],
      applicableExerciseVariantIds: [],
      reassessWhen: ["four_consecutive_training_weeks_completed", "attendance_pattern_changes"],
    };
  }
  return emptyDimension({
    unknowns: ["execution_stability_not_provided"],
    reassessWhen: ["first_calibration_sessions_completed", "user_reports_execution_pattern"],
  });
}

/**
 * Deterministic, evidence-bounded assessment. It intentionally has no single
 * novice/intermediate/advanced output: Planner callers must inspect the
 * relevant dimension for the decision they are making.
 */
export function createCoachingLevelAssessment(input: {
  progress: OnboardingProgress;
  assessedAt: string;
  revision: number;
}): CoachingLevelAssessment {
  const background = input.progress.patch.trainingBackground;
  const absent = emptyDimension({
    unknowns: ["training_background_not_provided"],
    reassessWhen: ["training_background_captured"],
  });
  const dimensions = background
    ? {
        trainingProgrammingUnderstanding: programmingUnderstanding(background),
        exactExerciseFamiliarity: exactFamiliarity(background),
        currentComparablePerformance: comparablePerformance(background),
        trainingContinuity: continuity(background),
        selfRegulation: selfRegulation(background),
        executionStability: executionStability(background),
      }
    : {
        trainingProgrammingUnderstanding: absent,
        exactExerciseFamiliarity: absent,
        currentComparablePerformance: absent,
        trainingContinuity: absent,
        selfRegulation: absent,
        executionStability: absent,
      };
  return {
    id: `coaching-level-assessment:${stableHash({ draftId: input.progress.id, revision: input.revision, sourceDraftRevision: input.progress.revision })}`,
    userId: input.progress.userId,
    revision: input.revision,
    assessedAt: input.assessedAt,
    sourceDraft: { id: input.progress.id, revision: input.progress.revision },
    priority: "multi_dimensional_assessment",
    ...(input.progress.patch.profile?.trainingExperience
      ? { legacyTrainingExperience: input.progress.patch.profile.trainingExperience }
      : {}),
    dimensions,
  };
}
