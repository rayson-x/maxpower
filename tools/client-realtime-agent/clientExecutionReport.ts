import type {
  DecodedQualityConclusion,
  DecodedRepEndpointSnapshot,
  DecodedRustQualityProposal,
  MotionAssessmentDimension,
  MotionQualityConclusionState,
} from "../../src/motion/motionPacket";

type JudgementStatus = "observed" | "cannot_judge";

interface ClientRuntimeFrame {
  timestampMs: number;
  frameValid: boolean;
  canonicalQuality: number;
  /** Diagnostics-only inputs retained for replay compatibility. Never read here. */
  rustCanonical?: unknown;
  /** Diagnostics-only inputs retained for replay compatibility. Never read here. */
  rustJointAngles?: unknown;
  /** Diagnostics-only inputs retained for replay compatibility. Never read here. */
  rustEquipment?: unknown;
}

interface ClientRep {
  repId: string | bigint;
  startMs: string | bigint;
  peakMs: string | bigint;
  endMs: string | bigint;
  disposition: "confirmed" | "needs_review" | "rejected";
  evidenceReason: string | null;
  observationFindings: readonly string[];
}

interface ClientCaseResult {
  captureId: string;
  preset: { exerciseId: string; capturePosition: string };
  profileIdentity: string;
  runtime: {
    processedFrames: number;
    effectiveObservationFps: number;
    emptyCandidateFrames: number;
    maximumInferenceMs: number;
  };
  reps: readonly ClientRep[];
  frames: readonly ClientRuntimeFrame[];
  /** Immutable QLT1 proposals decoded from one Rust MOTN/1.10 packet lineage. */
  qualityProposals: readonly Readonly<DecodedRustQualityProposal>[];
}

interface RepPhaseSemantics {
  startToPeak: string;
  peakToEnd: string;
}

const QUALITY_DIMENSIONS: readonly MotionAssessmentDimension[] = [
  "task_completion",
  "range_of_motion",
  "phase_control",
  "support_stability",
  "bilateral_coordination",
  "trajectory_control",
  "standard_variant_compatibility",
  "observation_confidence",
];

/**
 * Projects immutable Rust MOTN/1.10 quality evidence for client Agents.
 *
 * This module deliberately performs no pose, joint-angle, equipment-path or
 * screen-coordinate analysis. If Rust did not seal a QLT1 proposal or a
 * requested conclusion, that claim remains `cannot_judge`.
 */
export function buildClientExecutionAssessment(testCase: ClientCaseResult) {
  const reps = testCase.reps.filter((rep) => rep.disposition !== "rejected");
  const confirmed = reps.filter((rep) => rep.disposition === "confirmed");
  const proposalByRepId = new Map(
    testCase.qualityProposals.map((proposal) => [String(proposal.repId), proposal]),
  );
  const repReports = reps.map((rep, index) => buildRepReport(
    rep,
    index,
    proposalByRepId.get(String(rep.repId)) ?? null,
  ));
  const task = aggregateDimension(repReports, "task_completion");
  const range = aggregateDimension(repReports, "range_of_motion");
  const phaseControl = aggregateDimension(repReports, "phase_control");
  const supportStability = aggregateDimension(repReports, "support_stability");
  const bilateralCoordination = aggregateDimension(repReports, "bilateral_coordination");
  const trajectoryControl = aggregateDimension(repReports, "trajectory_control");
  const standardVariant = aggregateDimension(repReports, "standard_variant_compatibility");
  const observationConfidence = aggregateDimension(repReports, "observation_confidence");
  const hasEquipmentFacts = repReports.some(
    (rep) => rep.trajectoryControl.equipmentPath.judgementStatus === "observed",
  );
  const hasVisibleStrategy = [supportStability, bilateralCoordination, trajectoryControl]
    .some((dimension) => dimension.judgementStatus === "observed");
  const semantics = firstPhaseSemantics(repReports);

  return {
    schemaVersion: "maxpower-training-execution-assessment/v1",
    sequenceId: `client-single-pass:${testCase.captureId}`,
    lineage: {
      observationPipeline: hasEquipmentFacts
        ? "yolox-nano-humanart+rtmpose-m-halpe26+causal-bar-axis"
        : "yolox-nano-humanart+rtmpose-m-halpe26",
      poseSchema: "halpe26",
      canonicalOwner: "rust-motion-sdk",
      packetContract: "MOTN/1.10",
      aggregationRuntime: "client-typescript-rust-quality-projection-only",
      pythonVisionUsed: false,
      pass: "causal-chronological-single-pass",
      profileIdentity: testCase.profileIdentity,
    },
    preset: testCase.preset,
    fiveLayers: {
      movementTaskCompletion: {
        ...task,
        confirmedRepCount: confirmed.length,
        reviewableRepCount: reps.length,
        rejectedCandidateCount: testCase.reps.length - reps.length,
        reps: repReports.map((rep) => ({
          repIndex: rep.repIndex,
          disposition: rep.disposition,
          startMs: rep.startMs,
          turnaroundMs: rep.turnaroundMs,
          endMs: rep.endMs,
          rustConclusion: rep.task.rustConclusion,
        })),
      },
      techniqueAdherence: standardVariant,
      visibleMovementStrategy: {
        judgementStatus: hasVisibleStrategy ? "observed" as const : "cannot_judge" as const,
        observations: repReports.map((rep) => ({
          repIndex: rep.repIndex,
          supportStability: rep.supportStability,
          bilateralCoordination: rep.bilateralCoordination,
          trajectoryControl: rep.trajectoryControl,
        })),
        interpretation: "rust_quality_proposals_and_normalized_endpoint_facts_only",
        ...(hasVisibleStrategy ? {} : { reason: "rust_visible_strategy_conclusions_unavailable" }),
      },
      stimulusCompatibility: cannotJudge(
        "rust_quality_proposal_has_no_stimulus_compatibility_conclusion",
      ),
      effortAndDoseContext: {
        ...cannotJudge("load_rpe_rir_and_reviewed_effort_context_unavailable"),
        rustPhaseControl: phaseControl,
        cannotJudge: ["RPE", "RIR", "load", "muscle_activation", "subjective_effort"],
      },
    },
    dimensions: {
      task: {
        ...task,
        confirmedRepCount: confirmed.length,
        reviewableRepCount: reps.length,
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.task })),
      },
      range: {
        ...range,
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.range })),
        standardRangeJudgement: "cannot_judge",
        reason: "rust_profile_relative_conclusion_is_not_a_reviewed_standard_rom_reference",
      },
      phaseControl: {
        ...phaseControl,
        semantics,
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.phaseControl })),
      },
      supportStability: {
        ...supportStability,
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.supportStability })),
        standardTargetJudgement: "cannot_judge",
      },
      bilateralCoordination: {
        ...bilateralCoordination,
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.bilateralCoordination })),
        standardTargetJudgement: "cannot_judge",
      },
      trajectoryControl: {
        ...trajectoryControl,
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.trajectoryControl })),
        equipmentPath: hasEquipmentFacts
          ? {
            judgementStatus: "observed" as const,
            reps: repReports.map((rep) => ({
              repIndex: rep.repIndex,
              ...rep.trajectoryControl.equipmentPath,
            })),
          }
          : cannotJudge("rust_normalized_equipment_endpoint_facts_unavailable"),
        standardCorridorJudgement: "cannot_judge",
      },
      stimulusCompatibility: cannotJudge(
        "rust_quality_proposal_has_no_stimulus_compatibility_conclusion",
      ),
      observationConfidence: {
        ...observationConfidence,
        effectiveObservationFps: testCase.runtime.effectiveObservationFps,
        processedFrames: testCase.runtime.processedFrames,
        emptyCandidateFrames: testCase.runtime.emptyCandidateFrames,
        emptyCandidateFrameRate: ratio(
          testCase.runtime.emptyCandidateFrames,
          testCase.runtime.processedFrames,
        ),
        maximumInferenceMs: testCase.runtime.maximumInferenceMs,
        perRep: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.observation })),
      },
    },
    reps: repReports,
    noAggregateStandardnessScore: true,
    measurementLimits: [
      "camera_plane_2d_only",
      "agent_projects_rust_quality_facts_without_trajectory_recomputation",
      "visible_duration_is_not_rpe_or_rir",
      "no_standard_or_compensation_claim_without_reviewed_reference",
    ],
  };
}

function buildRepReport(
  rep: ClientRep,
  index: number,
  proposal: Readonly<DecodedRustQualityProposal> | null,
) {
  const endpointFacts = proposal ? orderedEndpointFacts(proposal) : null;
  const phaseTiming = endpointFacts ? phaseTimingFrom(endpointFacts) : null;
  const task = projectDimension(proposal, "task_completion");
  const range = projectDimension(proposal, "range_of_motion");
  const phaseConclusion = projectDimension(proposal, "phase_control");
  const supportStability = projectDimension(proposal, "support_stability");
  const bilateralCoordination = projectDimension(proposal, "bilateral_coordination");
  const trajectoryConclusion = projectDimension(proposal, "trajectory_control");
  const observation = projectDimension(proposal, "observation_confidence");
  const equipmentEndpointFacts = endpointFacts
    ? Object.values(endpointFacts).filter((endpoint) => endpoint.normalizedFeatures?.equipment)
    : [];
  const equipmentPath = equipmentEndpointFacts.length > 0
    ? {
      judgementStatus: "observed" as const,
      source: "rust_normalized_endpoint_facts" as const,
      endpoints: equipmentEndpointFacts,
    }
    : cannotJudge("rust_normalized_equipment_endpoint_facts_unavailable");

  return {
    repIndex: index + 1,
    repId: rep.repId,
    disposition: rep.disposition,
    startMs: Number(rep.startMs),
    turnaroundMs: Number(rep.peakMs),
    endMs: Number(rep.endMs),
    qualityProposal: proposal
      ? { judgementStatus: "observed" as const, proposal }
      : { ...cannotJudge("rust_quality_proposal_missing"), proposal: null },
    endpoints: endpointFacts ?? {
      startAnchor: null,
      primaryTurnaround: null,
      endReturn: null,
    },
    task,
    range,
    phaseControl: {
      ...phaseConclusion,
      semantics: endpointFacts ? semanticsFrom(endpointFacts) : null,
      firstPhaseMs: phaseTiming?.firstPhaseMs ?? null,
      secondPhaseMs: phaseTiming?.secondPhaseMs ?? null,
      totalMs: phaseTiming?.totalMs ?? null,
    },
    supportStability,
    bilateralCoordination,
    trajectoryControl: {
      ...trajectoryConclusion,
      normalizedEndpoints: endpointFacts,
      equipmentPath,
    },
    observation,
  };
}

function projectDimension(
  proposal: Readonly<DecodedRustQualityProposal> | null,
  dimension: MotionAssessmentDimension,
) {
  const conclusion = proposal?.conclusions.find((candidate) => candidate.dimension === dimension) ?? null;
  if (!conclusion) {
    return {
      ...cannotJudge(`rust_quality_conclusion_missing:${dimension}`),
      rustConclusion: null,
    };
  }
  return {
    judgementStatus: isObserved(conclusion.state) ? "observed" as const : "cannot_judge" as const,
    status: conclusion.state,
    rustConclusion: conclusion,
  };
}

function aggregateDimension(
  reps: readonly ReturnType<typeof buildRepReport>[],
  dimension: MotionAssessmentDimension,
) {
  const conclusions = reps.flatMap((rep) => {
    const conclusion = rep.qualityProposal.proposal?.conclusions
      .find((candidate) => candidate.dimension === dimension);
    return conclusion ? [conclusion] : [];
  });
  if (!conclusions.length) return cannotJudge(`rust_quality_conclusion_missing:${dimension}`);
  const status = aggregateState(conclusions);
  return {
    judgementStatus: isObserved(status) ? "observed" as const : "cannot_judge" as const,
    status,
    rustConclusions: conclusions,
  };
}

function aggregateState(
  conclusions: readonly Readonly<DecodedQualityConclusion>[],
): MotionQualityConclusionState {
  if (conclusions.some((conclusion) => conclusion.state === "observed_deviation")) {
    return "observed_deviation";
  }
  if (conclusions.some((conclusion) => conclusion.state === "observed_acceptable")) {
    return "observed_acceptable";
  }
  if (conclusions.every((conclusion) => conclusion.state === "not_applicable")) {
    return "not_applicable";
  }
  return "cannot_judge";
}

function orderedEndpointFacts(proposal: Readonly<DecodedRustQualityProposal>) {
  const startAnchor = endpoint(proposal, "start_anchor");
  const primaryTurnaround = endpoint(proposal, "primary_turnaround");
  const endReturn = endpoint(proposal, "end_return");
  if (!startAnchor || !primaryTurnaround || !endReturn) return null;
  return { startAnchor, primaryTurnaround, endReturn };
}

function endpoint(
  proposal: Readonly<DecodedRustQualityProposal>,
  kind: DecodedRepEndpointSnapshot["kind"],
) {
  return proposal.endpoints.find((candidate) => candidate.kind === kind) ?? null;
}

function phaseTimingFrom(endpoints: NonNullable<ReturnType<typeof orderedEndpointFacts>>) {
  return {
    firstPhaseMs: Math.max(
      0,
      endpoints.primaryTurnaround.occurredTimestampMs - endpoints.startAnchor.occurredTimestampMs,
    ),
    secondPhaseMs: Math.max(
      0,
      endpoints.endReturn.occurredTimestampMs - endpoints.primaryTurnaround.occurredTimestampMs,
    ),
    totalMs: Math.max(
      0,
      endpoints.endReturn.occurredTimestampMs - endpoints.startAnchor.occurredTimestampMs,
    ),
  };
}

function semanticsFrom(endpoints: NonNullable<ReturnType<typeof orderedEndpointFacts>>): RepPhaseSemantics {
  return {
    startToPeak: endpoints.startAnchor.phaseAfter,
    peakToEnd: endpoints.primaryTurnaround.phaseAfter,
  };
}

function firstPhaseSemantics(reps: readonly ReturnType<typeof buildRepReport>[]) {
  return reps.find((rep) => rep.phaseControl.semantics)?.phaseControl.semantics ?? null;
}

function isObserved(state: MotionQualityConclusionState): boolean {
  return state === "observed_acceptable" || state === "observed_deviation";
}

function cannotJudge(reason: string) {
  return { judgementStatus: "cannot_judge" as const, status: "cannot_judge" as const, reason };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
