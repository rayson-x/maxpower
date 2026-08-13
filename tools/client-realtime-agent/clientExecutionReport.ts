type JudgementStatus = "observed" | "cannot_judge";

interface RustCanonicalPoint {
  index: number;
  x: number | null;
  y: number | null;
  confidence: number;
  source: string;
  renderable: boolean;
}

interface RustJointAngle {
  kind: "elbow" | "shoulder" | "hip" | "knee";
  side: "left" | "right";
  valueDeg: number | null;
  confidence: number;
  source: string;
  judgeable: boolean;
}

interface RustEquipmentTrack {
  kind: "weight_plate" | "barbell_shaft" | "dumbbell" | "machine_handle";
  centerX: number;
  centerY: number;
  bbox: { x: number; y: number; width: number; height: number };
  observationScore: number;
  associationConfidence: number;
  source: "detector" | "optical_flow" | "geometry" | "predicted";
  judgeablePath: boolean;
}

interface RustEquipmentEvidence {
  status: { kind: "observed" | "cannot_judge"; reason: string | null };
  tracks: readonly RustEquipmentTrack[];
}

interface ClientRuntimeFrame {
  timestampMs: number;
  frameValid: boolean;
  canonicalQuality: number;
  rustCanonical?: RustCanonicalPoint[];
  rustJointAngles?: RustJointAngle[];
  rustEquipment?: RustEquipmentEvidence | null;
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
  reps: ClientRep[];
  frames: ClientRuntimeFrame[];
}

interface RepPhaseSemantics {
  startToPeak: "eccentric" | "concentric" | "to_extreme";
  peakToEnd: "eccentric" | "concentric" | "from_extreme";
}

/**
 * Builds the Agent-facing report from client-deployable evidence only.
 * Every kinematic input below was decoded from a Rust MotionPacket. Human
 * truth and Python observations are intentionally absent from this module.
 */
export function buildClientExecutionAssessment(testCase: ClientCaseResult) {
  const reps = testCase.reps.filter((rep) => rep.disposition !== "rejected");
  const confirmed = reps.filter((rep) => rep.disposition === "confirmed");
  const semantics = phaseSemantics(testCase.preset.exerciseId);
  const repReports = reps.map((rep, index) => buildRepReport(testCase, rep, index, semantics));
  const observableRepReports = repReports.filter((rep) => rep.observation.frameCount >= 3);
  const durationChange = durationChangeAcrossReps(repReports);
  const hasSupportEvidence = observableRepReports.some((rep) => rep.supportStability.judgementStatus === "observed");
  const hasBilateralEvidence = observableRepReports.some((rep) => rep.bilateralCoordination.judgementStatus === "observed");
  const hasTrajectoryEvidence = observableRepReports.some((rep) => rep.trajectoryControl.judgementStatus === "observed");
  const hasEquipmentTrajectoryEvidence = observableRepReports.some(
    (rep) => rep.trajectoryControl.equipmentPath.judgementStatus === "observed",
  );
  return {
    schemaVersion: "maxpower-training-execution-assessment/v1",
    sequenceId: `client-single-pass:${testCase.captureId}`,
    lineage: {
      observationPipeline: hasEquipmentTrajectoryEvidence
        ? "yolox-nano-humanart+rtmpose-m-halpe26+causal-bar-axis"
        : "yolox-nano-humanart+rtmpose-m-halpe26",
      poseSchema: "halpe26",
      canonicalOwner: "rust-motion-sdk",
      packetContract: "MOTN/1.7",
      aggregationRuntime: "client-typescript-deterministic-rust-packet-reader",
      pythonVisionUsed: false,
      pass: "causal-chronological-single-pass",
      profileIdentity: testCase.profileIdentity,
    },
    preset: testCase.preset,
    fiveLayers: {
      movementTaskCompletion: {
        judgementStatus: confirmed.length ? "observed" : "cannot_judge",
        confirmedRepCount: confirmed.length,
        reviewableRepCount: reps.length,
        rejectedCandidateCount: testCase.reps.length - reps.length,
        reps: repReports.map((rep) => ({
          repIndex: rep.repIndex,
          disposition: rep.disposition,
          startMs: rep.startMs,
          turnaroundMs: rep.turnaroundMs,
          endMs: rep.endMs,
        })),
      },
      techniqueAdherence: cannotJudge("no_reviewed_standard_trajectory_corridor_for_exact_variant_and_view"),
      visibleMovementStrategy: {
        judgementStatus: observableRepReports.length ? "observed" : "cannot_judge",
        observations: repReports.map((rep) => ({
          repIndex: rep.repIndex,
          supportStability: rep.supportStability,
          bilateralCoordination: rep.bilateralCoordination,
          trajectoryControl: rep.trajectoryControl,
        })),
        interpretation: "descriptive_camera_plane_measurements_not_compensation_or_form_labels",
      },
      stimulusCompatibility: cannotJudge("technique_reference_and_two_independent_strategy_feature_groups_unavailable"),
      effortAndDoseContext: {
        judgementStatus: repReports.length >= 2 ? "observed" : "cannot_judge",
        observable: {
          repDurationChangeFirstToLast: durationChange,
          phaseDurations: repReports.map((rep) => ({
            repIndex: rep.repIndex,
            firstPhaseMs: rep.phaseControl.firstPhaseMs,
            secondPhaseMs: rep.phaseControl.secondPhaseMs,
            totalMs: rep.phaseControl.totalMs,
          })),
        },
        cannotJudge: ["RPE", "RIR", "load", "muscle_activation", "subjective_effort"],
      },
    },
    dimensions: {
      task: {
        status: confirmed.length ? "observed_cycles" : "no_confirmed_cycle",
        judgementStatus: confirmed.length ? "observed" : "cannot_judge",
        confirmedRepCount: confirmed.length,
        reviewableRepCount: reps.length,
      },
      range: {
        status: reps.length ? "observed_against_recognition_profile_only" : "cannot_judge",
        judgementStatus: reps.length ? "observed" : "cannot_judge",
        reps: repReports.map((rep) => rep.range),
        standardRangeJudgement: "cannot_judge",
        reason: "recognition_threshold_is_not_a_reviewed_standard_rom_reference",
      },
      phaseControl: {
        status: repReports.length ? "observed" : "cannot_judge",
        judgementStatus: repReports.length ? "observed" : "cannot_judge",
        semantics,
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.phaseControl })),
      },
      supportStability: {
        status: hasSupportEvidence ? "observed_not_graded" : "cannot_judge",
        judgementStatus: hasSupportEvidence ? "observed" : "cannot_judge",
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.supportStability })),
        standardTargetJudgement: "cannot_judge",
      },
      bilateralCoordination: {
        status: hasBilateralEvidence ? "observed_not_graded" : "cannot_judge",
        judgementStatus: hasBilateralEvidence ? "observed" : "cannot_judge",
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.bilateralCoordination })),
        standardTargetJudgement: "cannot_judge",
      },
      trajectoryControl: {
        status: hasEquipmentTrajectoryEvidence
          ? "equipment_and_pose_channels_reported"
          : hasTrajectoryEvidence ? "skeleton_observed_equipment_unavailable" : "cannot_judge",
        judgementStatus: hasTrajectoryEvidence ? "observed" : "cannot_judge",
        reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.trajectoryControl })),
        equipmentPath: hasEquipmentTrajectoryEvidence
          ? {
            judgementStatus: "observed" as JudgementStatus,
            reps: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.trajectoryControl.equipmentPath })),
          }
          : cannotJudge("equipment_detector_not_enabled_for_this_preset_or_no_subject_associated_track"),
        standardCorridorJudgement: "cannot_judge",
      },
      stimulusCompatibility: cannotJudge("no_reviewed_technique_or_strategy_shift_reference"),
      observationConfidence: {
        status: "observed",
        effectiveObservationFps: testCase.runtime.effectiveObservationFps,
        processedFrames: testCase.runtime.processedFrames,
        emptyCandidateFrames: testCase.runtime.emptyCandidateFrames,
        emptyCandidateFrameRate: ratio(testCase.runtime.emptyCandidateFrames, testCase.runtime.processedFrames),
        maximumInferenceMs: testCase.runtime.maximumInferenceMs,
        perRep: repReports.map((rep) => ({ repIndex: rep.repIndex, ...rep.observation })),
      },
    },
    reps: repReports,
    noAggregateStandardnessScore: true,
    measurementLimits: [
      "camera_plane_2d_only",
      "pose_confidence_is_not_keypoint_accuracy",
      "visible_duration_change_is_not_rpe_or_rir",
      "no_standard_or_compensation_claim_without_reviewed_reference",
    ],
  };
}

function buildRepReport(
  testCase: ClientCaseResult,
  rep: ClientRep,
  index: number,
  semantics: RepPhaseSemantics,
) {
  const startMs = Number(rep.startMs);
  const turnaroundMs = Number(rep.peakMs);
  const endMs = Number(rep.endMs);
  const frames = testCase.frames.filter((frame) => frame.timestampMs >= startMs && frame.timestampMs <= endMs);
  const frameQuality = frames.map((frame) => frame.canonicalQuality).filter(Number.isFinite);
  const validFrames = frames.filter((frame) => frame.frameValid);
  return {
    repIndex: index + 1,
    repId: rep.repId,
    disposition: rep.disposition,
    startMs,
    turnaroundMs,
    endMs,
    phaseControl: {
      semantics,
      firstPhaseMs: Math.max(0, turnaroundMs - startMs),
      secondPhaseMs: Math.max(0, endMs - turnaroundMs),
      totalMs: Math.max(0, endMs - startMs),
      firstToSecondDurationRatio: ratio(turnaroundMs - startMs, endMs - turnaroundMs),
    },
    range: {
      judgementStatus: "observed" as JudgementStatus,
      recognitionProfileFindings: rep.observationFindings,
      primaryRangeBelowRecognitionExpectation: rep.observationFindings.includes("primary_range_below_expectation"),
      secondaryRangeBelowRecognitionExpectation: rep.observationFindings.includes("secondary_range_below_expectation"),
      standardRangeJudgement: "cannot_judge",
    },
    supportStability: supportMetrics(frames),
    bilateralCoordination: bilateralMetrics(frames),
    trajectoryControl: trajectoryMetrics(frames, testCase.preset.exerciseId, rep),
    observation: {
      frameCount: frames.length,
      validFrameRate: ratio(validFrames.length, frames.length),
      medianCanonicalQuality: percentile(frameQuality, 0.5),
      p10CanonicalQuality: percentile(frameQuality, 0.1),
    },
  };
}

function supportMetrics(frames: ClientRuntimeFrame[]) {
  const poses = frames.flatMap((frame) => {
    const points = pointMap(frame);
    const leftShoulder = points.get(5);
    const rightShoulder = points.get(6);
    const leftHip = points.get(11);
    const rightHip = points.get(12);
    if (!isUsablePoint(leftShoulder) || !isUsablePoint(rightShoulder)
      || !isUsablePoint(leftHip) || !isUsablePoint(rightHip)) return [];
    const shoulder = midpoint(leftShoulder, rightShoulder);
    const hip = midpoint(leftHip, rightHip);
    const torsoLength = distance(shoulder, hip);
    if (torsoLength <= 1e-5) return [];
    return [{ center: midpoint(shoulder, hip), torsoLength, tiltDeg: Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * 180 / Math.PI }];
  });
  if (poses.length < 3) return cannotJudge("insufficient_rust_torso_frames");
  const scale = percentile(poses.map((pose) => pose.torsoLength), 0.5) ?? 0;
  if (scale <= 1e-5) return cannotJudge("invalid_torso_normalization_scale");
  const origin = poses[0].center;
  const excursions = poses.map((pose) => distance(pose.center, origin) / scale);
  const tilts = poses.map((pose) => pose.tiltDeg);
  return {
    judgementStatus: "observed" as const,
    comparableFrameCount: poses.length,
    torsoCenterMaximumExcursionTorsoNorm: maximum(excursions),
    torsoCenterP90ExcursionTorsoNorm: percentile(excursions, 0.9),
    torsoTiltRangeDeg: range(tilts),
    targetJudgement: "cannot_judge",
  };
}

function bilateralMetrics(frames: ClientRuntimeFrame[]) {
  const byKind: Record<string, number[]> = {};
  for (const frame of frames) {
    const angles = frame.rustJointAngles ?? [];
    for (const kind of ["elbow", "shoulder", "hip", "knee"] as const) {
      const left = angles.find((angle) => angle.kind === kind && angle.side === "left" && angle.judgeable);
      const right = angles.find((angle) => angle.kind === kind && angle.side === "right" && angle.judgeable);
      if (left?.valueDeg === null || left?.valueDeg === undefined || right?.valueDeg === null || right?.valueDeg === undefined) continue;
      (byKind[kind] ??= []).push(Math.abs(left.valueDeg - right.valueDeg));
    }
  }
  const details = Object.fromEntries(Object.entries(byKind)
    .filter(([, values]) => values.length >= 3)
    .map(([kind, values]) => [kind, {
      comparableFrameCount: values.length,
      medianAbsoluteAngleDeltaDeg: percentile(values, 0.5),
      p90AbsoluteAngleDeltaDeg: percentile(values, 0.9),
    }]));
  if (!Object.keys(details).length) return cannotJudge("insufficient_paired_judgeable_joint_angles");
  return {
    judgementStatus: "observed" as const,
    jointAngleDeltas: details,
    targetJudgement: "cannot_judge",
  };
}

function trajectoryMetrics(frames: ClientRuntimeFrame[], exerciseId: string, rep: ClientRep) {
  const equipmentPath = equipmentTrajectoryMetrics(frames, Number(rep.peakMs));
  const poseEquipmentAgreement = poseEquipmentAgreementFor(rep.observationFindings);
  const landmarkIndices = activeTrajectoryLandmarks(exerciseId);
  const measuredFrames = frames.flatMap((frame) => {
    const points = pointMap(frame);
    const leftShoulder = points.get(5);
    const rightShoulder = points.get(6);
    const leftHip = points.get(11);
    const rightHip = points.get(12);
    if (!isUsablePoint(leftShoulder) || !isUsablePoint(rightShoulder)
      || !isUsablePoint(leftHip) || !isUsablePoint(rightHip)) return [];
    const scale = distance(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip));
    if (scale <= 1e-5) return [];
    const active = landmarkIndices.map((index) => points.get(index)).filter(isUsablePoint);
    if (!active.length) return [];
    return [{
      timestampMs: frame.timestampMs,
      x: active.reduce((sum, point) => sum + point.x, 0) / active.length,
      y: active.reduce((sum, point) => sum + point.y, 0) / active.length,
      scale,
      predictedPointRate: active.filter((point) => point.source !== "measured").length / active.length,
    }];
  });
  if (measuredFrames.length < 4) return {
    judgementStatus: equipmentPath.judgementStatus === "observed"
      ? "observed" as JudgementStatus
      : "cannot_judge" as JudgementStatus,
    skeletonPath: cannotJudge("insufficient_rust_active_landmark_frames"),
    equipmentPath,
    poseEquipmentAgreement,
  };
  const steps = measuredFrames.slice(1).flatMap((frame, index) => {
    const previous = measuredFrames[index];
    const elapsed = frame.timestampMs - previous.timestampMs;
    if (elapsed <= 0 || elapsed > 500) return [];
    return [distance(frame, previous) / Math.max(1e-5, (frame.scale + previous.scale) / 2)];
  });
  if (steps.length < 3) return {
    judgementStatus: equipmentPath.judgementStatus === "observed"
      ? "observed" as JudgementStatus
      : "cannot_judge" as JudgementStatus,
    skeletonPath: cannotJudge("insufficient_continuous_rust_path_steps"),
    equipmentPath,
    poseEquipmentAgreement,
  };
  return {
    judgementStatus: "observed" as JudgementStatus,
    activeLandmarks: landmarkIndices,
    comparableFrameCount: measuredFrames.length,
    medianFrameStepTorsoNorm: percentile(steps, 0.5),
    p90FrameStepTorsoNorm: percentile(steps, 0.9),
    maximumFrameStepTorsoNorm: maximum(steps),
    predictedOrRepairedPointRate: average(measuredFrames.map((frame) => frame.predictedPointRate)),
    equipmentPath,
    poseEquipmentAgreement,
    targetCorridorJudgement: "cannot_judge",
  };
}

function equipmentTrajectoryMetrics(frames: ClientRuntimeFrame[], turnaroundMs: number) {
  const samples = frames.flatMap((frame) => {
    const shaft = (frame.rustEquipment?.tracks ?? [])
      .filter((track) => track.kind === "barbell_shaft" && track.judgeablePath)
      .sort((left, right) => (
        right.observationScore * right.associationConfidence
        - left.observationScore * left.associationConfidence
      ))[0];
    return shaft ? [{ timestampMs: frame.timestampMs, ...shaft }] : [];
  });
  if (samples.length < 3) return cannotJudge("insufficient_subject_associated_barbell_frames");
  const vertical = samples.map((sample) => sample.centerY);
  const observedTurnaround = samples.reduce((best, sample) => (
    sample.centerY > best.centerY ? sample : best
  ));
  const steps = samples.slice(1).flatMap((sample, index) => {
    const previous = samples[index];
    const elapsedMs = sample.timestampMs - previous.timestampMs;
    if (elapsedMs <= 0 || elapsedMs > 500) return [];
    return [Math.abs(sample.centerY - previous.centerY) / (elapsedMs / 1_000)];
  });
  return {
    judgementStatus: "observed" as const,
    observedFrameCount: samples.length,
    frameCoverage: ratio(samples.length, frames.length),
    verticalRomImageRatio: range(vertical),
    observedTurnaroundMs: observedTurnaround.timestampMs,
    turnaroundOffsetMs: observedTurnaround.timestampMs - turnaroundMs,
    medianVerticalSpeedImageRatioPerSecond: percentile(steps, 0.5),
    p90VerticalSpeedImageRatioPerSecond: percentile(steps, 0.9),
    medianObservationScore: percentile(samples.map((sample) => sample.observationScore), 0.5),
    medianSubjectAssociationConfidence: percentile(
      samples.map((sample) => sample.associationConfidence),
      0.5,
    ),
    sourceCounts: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.source))]
        .map((source) => [source, samples.filter((sample) => sample.source === source).length]),
    ),
    forceAsymmetryJudgement: "cannot_judge",
  };
}

function poseEquipmentAgreementFor(findings: readonly string[]) {
  if (findings.includes("pose_equipment_turnaround_aligned")) {
    return { status: "aligned", toleranceMs: 250 };
  }
  if (findings.includes("pose_equipment_turnaround_conflict")) {
    return { status: "conflict", toleranceMs: 250 };
  }
  if (findings.includes("pose_unavailable_at_turnaround")) {
    return { status: "pose_unavailable", toleranceMs: 250 };
  }
  return { status: "not_requested", toleranceMs: 250 };
}

function activeTrajectoryLandmarks(exerciseId: string): number[] {
  if (/squat|lunge|deadlift|romanian/u.test(exerciseId)) return [11, 12, 13, 14];
  if (exerciseId === "push_up") return [5, 6, 11, 12];
  return [9, 10];
}

function phaseSemantics(exerciseId: string): RepPhaseSemantics {
  if (exerciseId === "barbell_bench_press" || exerciseId === "push_up") {
    return { startToPeak: "eccentric", peakToEnd: "concentric" };
  }
  if (/press|raise|fly|row|pulldown|pull_up|curl|extension/u.test(exerciseId)) {
    return { startToPeak: "concentric", peakToEnd: "eccentric" };
  }
  if (/squat|lunge|deadlift|romanian/u.test(exerciseId)) {
    return { startToPeak: "eccentric", peakToEnd: "concentric" };
  }
  return { startToPeak: "to_extreme", peakToEnd: "from_extreme" };
}

function durationChangeAcrossReps(reps: Array<{ phaseControl: { totalMs: number } }>) {
  if (reps.length < 2 || reps[0].phaseControl.totalMs <= 0) return null;
  return (reps.at(-1)!.phaseControl.totalMs - reps[0].phaseControl.totalMs) / reps[0].phaseControl.totalMs;
}

function pointMap(frame: ClientRuntimeFrame): Map<number, RustCanonicalPoint> {
  return new Map((frame.rustCanonical ?? []).map((point) => [point.index, point]));
}

function isUsablePoint(point: RustCanonicalPoint | undefined): point is RustCanonicalPoint & { x: number; y: number } {
  return Boolean(point && point.renderable && point.x !== null && point.y !== null
    && Number.isFinite(point.x) && Number.isFinite(point.y) && point.confidence >= 0.15);
}

function midpoint(left: { x: number; y: number }, right: { x: number; y: number }) {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function cannotJudge(reason: string) {
  return { judgementStatus: "cannot_judge" as const, reason };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function percentile(values: number[], quantile: number): number | null {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return null;
  if (finite.length === 1) return finite[0];
  const position = Math.max(0, Math.min(1, quantile)) * (finite.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return finite[lower];
  return finite[lower] * (upper - position) + finite[upper] * (position - lower);
}

function range(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) - Math.min(...finite) : null;
}

function maximum(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function average(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}
