/** Stable Interface between local motion evidence and the client coaching Agent. */
export type EvidenceLevel = "E0" | "E1" | "E2" | "E3" | "E4" | "E5";
export type JudgementStatus = "observed" | "inferred" | "cannot_judge" | "not_applicable";
export type DimensionStatus =
  | "meets_target"
  | "partially_meets_target"
  | "deviates"
  | "cannot_judge";

export interface TrainingIntentContract {
  goal: "hypertrophy" | "strength" | "power" | "endurance" | "technique" | "unknown";
  exerciseVariant: string;
  equipmentAndResistanceMode: string;
  targetMuscles: readonly string[];
  expectedJointActions: readonly string[];
  plannedRom: "protocol" | "full_available" | "partial_intent" | "personal" | "unknown";
  tempoIntent?: string;
  velocityIntent?: "maximal_intent" | "controlled" | "not_specified";
  allowedStrategyEnvelope: readonly string[];
  load?: { value: number; unit: "kg" | "lb" };
  targetReps?: readonly [number, number];
  targetRir?: readonly [number, number];
}

export interface AssessmentEvidenceRef {
  id: string;
  level: EvidenceLevel;
  feature: string;
  source: "rust_canonical" | "equipment_observation" | "training_intent" | "personal_history" | "reviewed_knowledge" | "user_report";
  confidence: number;
  sourceTimestampMs?: number;
  repId?: number;
}

export interface TrainingExecutionLineage {
  observationPipeline: "yolox-nano-humanart+rtmpose-m-halpe26";
  poseSchema: "halpe26";
  canonicalOwner: "rust-motion-sdk";
  packetContract: "MOTN/1.7";
  runtimeValidation: {
    status: "validated" | "partially_validated" | "unvalidated" | "failed";
    platform: "web" | "android" | "ios";
    runtime: string;
    reportSha256?: string;
  };
  trajectoryDatabase: {
    databaseId: string;
    status: "research_candidate_not_promoted" | "reviewed_candidate" | "production";
    manifestSha256: string;
  };
}

export interface DimensionAssessment<TDetails = Readonly<Record<string, unknown>>> {
  status: DimensionStatus;
  judgementStatus: JudgementStatus;
  confidence: number;
  evidenceRefs: readonly string[];
  details: TDetails;
}

export interface ObservedMovementStrategy {
  id: string;
  observation: string;
  phase: string;
  side?: "left" | "right";
  evidenceRefs: readonly string[];
}

export interface CoachInference {
  label: string;
  probability: number;
  evidenceRefs: readonly string[];
  independentFeatureGroups: readonly string[];
  alternativeExplanations: readonly string[];
  primaryCue?: string;
  claimLevel: "expected_association" | "coach_inference" | "mechanical_demand_tendency";
}

export interface TrainingExecutionAssessment {
  schemaVersion: "maxpower-training-execution-assessment/v1";
  sequenceId: string;
  lineage: TrainingExecutionLineage;
  intent: TrainingIntentContract;
  evidence: readonly AssessmentEvidenceRef[];
  observation: {
    status: "sufficient" | "partial" | "insufficient";
    reasons: readonly string[];
  };
  movementTask: DimensionAssessment;
  techniqueAdherence: DimensionAssessment;
  movementStrategy: readonly ObservedMovementStrategy[];
  stimulusCompatibility: {
    status:
      | "consistent"
      | "likely_consistent_with_observed_deviation"
      | "possible_strategy_shift"
      | "inconsistent_with_selected_variant"
      | "insufficient_evidence";
    judgementStatus: JudgementStatus;
    explanation: string;
    evidenceRefs: readonly string[];
    claimLevel: "expected_association" | "coach_inference" | "mechanical_demand_tendency";
  };
  coachConclusion: {
    standardExecution:
      | "standard"
      | "mostly_standard"
      | "completed_with_strategy_shift"
      | "incomplete"
      | "cannot_judge";
    likelyTrainingEffect: readonly string[];
    primaryCue?: string;
    inferenceBasis: readonly string[];
  };
  coachInferences: readonly CoachInference[];
  effortAndDose: {
    status: "on_target" | "off_target" | "unknown";
    loadSource?: string;
    rirSource?: "user_reported" | "individual_estimate";
    performanceDrift?: Readonly<Record<string, unknown>>;
  };
  measurementLimits: readonly string[];
}

export interface TrainingExecutionAssessmentInput {
  sequenceId: string;
  lineage: TrainingExecutionLineage;
  intent: TrainingIntentContract;
  evidence: readonly AssessmentEvidenceRef[];
  observation: TrainingExecutionAssessment["observation"];
  movementTask?: {
    completed: boolean;
    confidence: number;
    evidenceRefs: readonly string[];
    details?: Readonly<Record<string, unknown>>;
  };
  technique?: {
    referenceStatus: "unavailable" | "reviewed_match" | "reviewed_deviation";
    confidence: number;
    evidenceRefs: readonly string[];
    details?: Readonly<Record<string, unknown>>;
    primaryCue?: string;
    likelyTrainingEffect?: readonly string[];
  };
  movementStrategies?: readonly (ObservedMovementStrategy & {
    independentFeatureGroups: readonly string[];
    probability: number;
    alternativeExplanations: readonly string[];
    primaryCue?: string;
  })[];
  effortAndDose?: TrainingExecutionAssessment["effortAndDose"];
  measurementLimits?: readonly string[];
}

/**
 * Builds the one evidence object consumed by client Agents. It deliberately
 * separates task completion from technique judgement: an observed rep never
 * becomes a standard-form claim without a reviewed reference, and a possible
 * compensation needs two independent feature groups.
 */
export function buildAgentTrainingExecutionAssessment(
  input: TrainingExecutionAssessmentInput,
): TrainingExecutionAssessment {
  const runtimeFailed = input.lineage.runtimeValidation.status === "failed";
  const observation: TrainingExecutionAssessment["observation"] = runtimeFailed
    ? {
      status: "insufficient",
      reasons: [...new Set([...input.observation.reasons, "runtime_validation_failed"])],
    }
    : input.observation;
  const insufficient = observation.status === "insufficient";
  const movementTask: DimensionAssessment = insufficient || !input.movementTask
    ? {
      status: "cannot_judge",
      judgementStatus: "cannot_judge",
      confidence: 0,
      evidenceRefs: [],
      details: { reason: insufficient ? "insufficient_observation" : "no_task_evidence" },
    }
    : {
      status: input.movementTask.completed ? "meets_target" : "partially_meets_target",
      judgementStatus: "observed",
      confidence: input.movementTask.confidence,
      evidenceRefs: input.movementTask.evidenceRefs,
      details: input.movementTask.details ?? {},
    };
  const techniqueAvailable = !insufficient
    && input.technique
    && input.technique.referenceStatus !== "unavailable";
  const techniqueAdherence: DimensionAssessment = techniqueAvailable
    ? {
      status: input.technique!.referenceStatus === "reviewed_match" ? "meets_target" : "deviates",
      judgementStatus: "inferred",
      confidence: input.technique!.confidence,
      evidenceRefs: input.technique!.evidenceRefs,
      details: input.technique!.details ?? {},
    }
    : {
      status: "cannot_judge",
      judgementStatus: "cannot_judge",
      confidence: 0,
      evidenceRefs: [],
      details: { reason: insufficient ? "insufficient_observation" : "no_reviewed_technique_reference" },
    };
  const strategies = insufficient ? [] : [...(input.movementStrategies ?? [])];
  const supportedStrategies = strategies.filter(
    (strategy) => strategy.independentFeatureGroups.length >= 2 && strategy.evidenceRefs.length >= 2,
  );
  const coachInferences: CoachInference[] = supportedStrategies.map((strategy) => ({
    label: strategy.id,
    probability: strategy.probability,
    evidenceRefs: strategy.evidenceRefs,
    independentFeatureGroups: strategy.independentFeatureGroups,
    alternativeExplanations: strategy.alternativeExplanations,
    primaryCue: strategy.primaryCue,
    claimLevel: "coach_inference",
  }));
  const deviation = techniqueAvailable && input.technique!.referenceStatus === "reviewed_deviation";
  const strategyShift = supportedStrategies.length > 0;
  const standardExecution: TrainingExecutionAssessment["coachConclusion"]["standardExecution"] = insufficient
    ? "cannot_judge"
    : movementTask.status !== "meets_target"
      ? "incomplete"
      : strategyShift
        ? "completed_with_strategy_shift"
        : techniqueAvailable
          ? deviation ? "mostly_standard" : "standard"
          : "cannot_judge";
  const techniqueEffects = techniqueAvailable ? [...(input.technique!.likelyTrainingEffect ?? [])] : [];
  const primaryStrategy = supportedStrategies[0];
  const assessment: TrainingExecutionAssessment = {
    schemaVersion: "maxpower-training-execution-assessment/v1",
    sequenceId: input.sequenceId,
    lineage: input.lineage,
    intent: input.intent,
    evidence: input.evidence,
    observation,
    movementTask,
    techniqueAdherence,
    movementStrategy: supportedStrategies.map((strategy) => ({
      id: strategy.id,
      observation: strategy.observation,
      phase: strategy.phase,
      side: strategy.side,
      evidenceRefs: strategy.evidenceRefs,
    })),
    stimulusCompatibility: strategyShift
      ? {
        status: "possible_strategy_shift",
        judgementStatus: "inferred",
        explanation: "观察到的动作策略可能偏离当前训练意图，需要结合负荷、疲劳与所选变式复核。",
        evidenceRefs: primaryStrategy.evidenceRefs,
        claimLevel: "coach_inference",
      }
      : {
        status: techniqueAvailable && !deviation ? "consistent" : "insufficient_evidence",
        judgementStatus: techniqueAvailable ? "inferred" : "cannot_judge",
        explanation: techniqueAvailable
          ? "当前可观察轨迹与已审核参考一致。"
          : "缺少已审核技术参考或独立策略证据，无法判断刺激兼容性。",
        evidenceRefs: techniqueAvailable ? input.technique!.evidenceRefs : [],
        claimLevel: "coach_inference",
      },
    coachConclusion: {
      standardExecution,
      likelyTrainingEffect: strategyShift
        ? ["观察到可能改变目标动作策略的协同运动；先降低变量并复核动作意图。"]
        : techniqueEffects,
      primaryCue: primaryStrategy?.primaryCue ?? (techniqueAvailable ? input.technique!.primaryCue : undefined),
      inferenceBasis: strategyShift
        ? primaryStrategy.evidenceRefs
        : techniqueAvailable ? input.technique!.evidenceRefs : [],
    },
    coachInferences,
    effortAndDose: input.effortAndDose ?? { status: "unknown" },
    measurementLimits: runtimeFailed
      ? [...new Set([...(input.measurementLimits ?? []), "runtime_validation_failed"])]
      : input.measurementLimits ?? [],
  };
  assertAgentConsumableAssessment(assessment);
  return assessment;
}

const FORBIDDEN_PHYSIOLOGY_PATTERNS = [
  /肌肉?激活.*\d+\s*%/u,
  /发力.*\d+\s*%/u,
  /力量.*(?:强|弱).*\d+\s*%/u,
  /腹压(?:不足|充足|正常)/u,
  /一定会受伤/u,
];

/**
 * Refuses structurally unsupported Agent input. This is a claim gate, not a
 * technique model: Rust/evaluation code must still produce the evidence.
 */
export function assertAgentConsumableAssessment(
  assessment: TrainingExecutionAssessment,
): void {
  const sha256 = /^[0-9a-f]{64}$/u;
  const runtime = assessment.lineage.runtimeValidation;
  if (
    assessment.lineage.observationPipeline !== "yolox-nano-humanart+rtmpose-m-halpe26"
    || assessment.lineage.poseSchema !== "halpe26"
    || assessment.lineage.canonicalOwner !== "rust-motion-sdk"
    || assessment.lineage.packetContract !== "MOTN/1.7"
  ) {
    throw new Error("Assessment runtime lineage is not the supported Halpe-26 Rust contract");
  }
  if (!sha256.test(assessment.lineage.trajectoryDatabase.manifestSha256)) {
    throw new Error("Assessment trajectory database manifest SHA-256 is invalid");
  }
  if (
    (runtime.status === "validated" || runtime.status === "partially_validated")
    && (!runtime.reportSha256 || !sha256.test(runtime.reportSha256))
  ) {
    throw new Error("Validated runtime lineage requires a parity report SHA-256");
  }
  if (runtime.status === "failed" && assessment.observation.status !== "insufficient") {
    throw new Error("Failed runtime validation must propagate insufficient observation");
  }
  const evidenceById = new Map(assessment.evidence.map((evidence) => [evidence.id, evidence]));
  const allEvidenceRefs = [
    ...assessment.movementTask.evidenceRefs,
    ...assessment.techniqueAdherence.evidenceRefs,
    ...assessment.stimulusCompatibility.evidenceRefs,
    ...assessment.movementStrategy.flatMap((strategy) => strategy.evidenceRefs),
    ...assessment.coachInferences.flatMap((inference) => inference.evidenceRefs),
  ];
  for (const evidenceRef of allEvidenceRefs) {
    if (!evidenceById.has(evidenceRef)) {
      throw new Error(`Assessment references missing evidence: ${evidenceRef}`);
    }
  }
  for (const evidence of assessment.evidence) {
    if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) {
      throw new Error(`Evidence confidence is outside 0..1: ${evidence.id}`);
    }
  }
  for (const inference of assessment.coachInferences) {
    if (!Number.isFinite(inference.probability) || inference.probability < 0 || inference.probability > 1) {
      throw new Error(`Coach inference probability is outside 0..1: ${inference.label}`);
    }
    if (inference.independentFeatureGroups.length < 2) {
      throw new Error(`Coach inference requires two independent feature groups: ${inference.label}`);
    }
    if (inference.evidenceRefs.length < 2) {
      throw new Error(`Coach inference requires at least two evidence references: ${inference.label}`);
    }
  }
  if (assessment.observation.status === "insufficient") {
    if (
      assessment.movementTask.status !== "cannot_judge" ||
      assessment.techniqueAdherence.status !== "cannot_judge" ||
      assessment.coachConclusion.standardExecution !== "cannot_judge"
    ) {
      throw new Error("Insufficient observation must propagate cannot_judge");
    }
  }
  const userFacingClaims = [
    assessment.stimulusCompatibility.explanation,
    ...assessment.coachConclusion.likelyTrainingEffect,
  ];
  for (const claim of userFacingClaims) {
    if (FORBIDDEN_PHYSIOLOGY_PATTERNS.some((pattern) => pattern.test(claim))) {
      throw new Error(`Unsupported physiology claim: ${claim}`);
    }
  }
}
