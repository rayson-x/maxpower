import { EXERCISE_REGISTRY, type ExerciseMaturity } from "./exerciseRegistry";
import {
  EXPERIMENTAL_THRESHOLDS_V1,
  scoreFormSet,
  type CameraView,
  type ExerciseSelection,
  type RuleEvaluationStatus,
  type SetScore,
} from "./formRuleEngine";
import { getKinematicsProfile, type KinematicsProfile } from "./kinematicsProfile";
import type { PoseEstimate } from "./PoseEngine";
import {
  extractRepMetrics,
  type RepMetricsExtraction,
} from "./repMetricsExtractor";
import type { RepSegment } from "./repSegmenter";

export type AnalysisExerciseSelection =
  | { mode: "user"; exerciseId: string }
  | { mode: "auto"; exerciseId: string | null; confidence: number };

export interface PoseSetAnalysisInput {
  poses: PoseEstimate[];
  cameraView: CameraView;
  exercise: AnalysisExerciseSelection;
  autoSuggestion?: { exerciseId: string | null; confidence: number };
}

export interface RuleCoverage {
  totalEvaluations: number;
  eligibleEvaluations: number;
  passed: number;
  deducted: number;
  refused: number;
  notApplicable: number;
}

export interface PoseSetAnalysisResult {
  status: SetScore["status"] | "unsupported";
  reason?: string;
  exercise: {
    id: string | null;
    nameZh: string | null;
    maturity: ExerciseMaturity | null;
    selectionMode: AnalysisExerciseSelection["mode"];
    userSelectionOverrodeAutoSuggestion: boolean;
  };
  profile: KinematicsProfile | null;
  extraction: RepMetricsExtraction | null;
  /** Same array instance carried by extraction; clients should render this field. */
  reps: RepMetricsExtraction["reps"];
  segments: RepSegment[];
  score: SetScore | null;
  coverage: RuleCoverage;
  versions: {
    analysis: "pose-set-analysis/v1";
    profile: string | null;
    rule: string;
  };
}

const EMPTY_COVERAGE: RuleCoverage = {
  totalEvaluations: 0,
  eligibleEvaluations: 0,
  passed: 0,
  deducted: 0,
  refused: 0,
  notApplicable: 0,
};

export function analyzePoseSet(input: PoseSetAnalysisInput): PoseSetAnalysisResult {
  const requestedId = input.exercise.exerciseId;
  const concept = requestedId ? EXERCISE_REGISTRY.get(requestedId) : undefined;
  const availableProfile = requestedId ? getKinematicsProfile(requestedId) : null;
  const profile =
    availableProfile &&
    (input.exercise.mode === "user" ||
      (Number.isFinite(input.exercise.confidence) &&
        input.exercise.confidence >= EXPERIMENTAL_THRESHOLDS_V1.minAutoExerciseConfidence))
      ? availableProfile
      : null;
  const overridden =
    input.exercise.mode === "user" &&
    !!input.autoSuggestion?.exerciseId &&
    input.autoSuggestion.exerciseId !== input.exercise.exerciseId;

  if (
    requestedId &&
    (!concept || !availableProfile || !EXERCISE_REGISTRY.canRunSpecializedAnalysis(requestedId))
  ) {
    const maturity = concept?.maturity ?? null;
    return {
      status: "unsupported",
      reason: concept
        ? `Exercise ${requestedId} is ${maturity} and has no eligible kinematics profile`
        : `Unknown exercise id: ${requestedId}`,
      exercise: {
        id: requestedId,
        nameZh: concept?.nameZh ?? null,
        maturity,
        selectionMode: input.exercise.mode,
        userSelectionOverrodeAutoSuggestion: overridden,
      },
      profile: null,
      extraction: null,
      reps: [],
      segments: [],
      score: null,
      coverage: EMPTY_COVERAGE,
      versions: {
        analysis: "pose-set-analysis/v1",
        profile: null,
        rule: EXPERIMENTAL_THRESHOLDS_V1.version,
      },
    };
  }

  const exercise: ExerciseSelection =
    input.exercise.mode === "user"
      ? { mode: "user", exerciseId: profile!.ruleExerciseId }
      : {
          mode: "auto",
          exerciseId: availableProfile?.ruleExerciseId ?? null,
          confidence: input.exercise.confidence,
        };
  const extraction = extractRepMetrics(input.poses, {
    cameraView: input.cameraView,
    exercise,
    profile: profile ?? undefined,
  });
  const score = scoreFormSet(extraction.reps, extraction.context);
  return {
    status: score.status,
    exercise: {
      id: requestedId,
      nameZh: concept?.nameZh ?? null,
      maturity: concept?.maturity ?? null,
      selectionMode: input.exercise.mode,
      userSelectionOverrodeAutoSuggestion: overridden,
    },
    profile,
    extraction,
    reps: extraction.reps,
    segments: extraction.reps.map((rep) => {
      const amplitude = rep.metrics.amplitude?.value ?? 0;
      const toExtremeMs = rep.extremeMs - rep.startMs;
      const fromExtremeMs = rep.endMs - rep.extremeMs;
      return {
        repIndex: rep.repIndex,
        startMs: rep.startMs,
        peakMs: rep.extremeMs,
        endMs: rep.endMs,
        durationMs: rep.endMs - rep.startMs,
        concentricMs:
          rep.phaseSemantics?.toExtreme === "concentric" ? toExtremeMs : fromExtremeMs,
        eccentricMs:
          rep.phaseSemantics?.toExtreme === "eccentric" ? toExtremeMs : fromExtremeMs,
        amplitude,
      };
    }),
    score,
    coverage: coverageOf(score),
    versions: {
      analysis: "pose-set-analysis/v1",
      profile: profile?.version ?? null,
      rule: score.engineVersion,
    },
  };
}

function coverageOf(score: SetScore): RuleCoverage {
  const statuses = score.reps.flatMap((rep) => rep.evaluations.map(({ status }) => status));
  const count = (status: RuleEvaluationStatus) =>
    statuses.filter((candidate) => candidate === status).length;
  const notApplicable = count("not_applicable");
  return {
    totalEvaluations: statuses.length,
    eligibleEvaluations: statuses.length - notApplicable,
    passed: count("passed"),
    deducted: count("deducted"),
    refused: count("refused"),
    notApplicable,
  };
}
