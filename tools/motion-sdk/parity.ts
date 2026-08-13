import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type MotionWasmExports,
  type RustExerciseProfileData,
  type RustReferenceComparison,
} from "../../src/motion/rustCanonicalWasm";
import { decodeMotionPacket, type DecodedMotionPacket } from "../../src/motion/motionPacket";
import { createPoseContinuitySession, type CanonicalPoseFrame } from "../../src/pose/canonicalPose";
import type { PoseEstimate, PoseLandmark } from "../../src/pose/PoseEngine";
import {
  LAT_PULLDOWN_REFERENCE_FEATURES,
  extractNormalizedLatPulldownRep,
  matchLatPulldownTrajectory,
  type NormalizedLatPulldownReferenceRep,
  type PersonalProvisionalReferenceProfile,
} from "../../src/pose/referenceTrajectory";
import { buildSimulatedLatPulldownReference } from "../../src/pose/simulatedLatPulldownReference";
import { buildSimulatedTrajectoryBaseline } from "../../src/motion/simulatedTrajectoryBaseline";

const config = (sequenceId: string) => ({
  sequenceId,
  schema: "blazepose33" as const,
  image: {
    widthPx: 1_000,
    heightPx: 1_000,
    rotationDegrees: 0 as const,
    mirrored: false,
  },
  stabilization: "fusion" as const,
});

async function main(): Promise<void> {
  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(process.cwd(), "public/motion-sdk/maxpower_motion_sdk.wasm")),
  );
  const ts = createPoseContinuitySession(config("parity:continuity"));
  const rust = new RustCanonicalWasmSession(config("parity:continuity"), wasm);
  const poses = [
    pose(0),
    pose(50),
    pose(100),
    pose(150),
    pose(200),
    pose(250, { elbowVisibility: 0.35, elbowY: 0.56 }),
    pose(300, { elbowX: 0.95, elbowY: 0.05 }),
    pose(350),
    pose(400, { elbowVisibility: 0 }),
    pose(550, { elbowVisibility: 0 }),
    pose(800, { elbowVisibility: 0 }),
  ];
  poses.forEach((observation, frameIndex) => {
    compareFrames(ts.process(observation), rust.process(observation), frameIndex);
  });
  rust.close();

  // A new sequence must not inherit motion, bone, or outlier history.
  const resetTs = createPoseContinuitySession(config("parity:reset"));
  const resetRust = new RustCanonicalWasmSession(config("parity:reset"), wasm);
  const missing = pose(1_000, { elbowVisibility: 0 });
  compareFrames(resetTs.process(missing), resetRust.process(missing), 0);
  assert.equal(resetRust.lastDecodedPacket?.canonical[13].reason, "no-measurement-baseline");
  resetRust.close();

  // Cross-language contract for the numeric candidate telemetry slots.
  // This fails if the TypeScript slot map drifts from the compiled Rust ABI.
  const candidateDiagnosticsRust = new RustCanonicalWasmSession(
    config("parity:candidate-diagnostics"),
    wasm,
  );
  const diagnosticPose = pose(1);
  candidateDiagnosticsRust.processCandidates([{
    ...diagnosticPose,
    candidateId: 42,
    bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.7 },
    torsoColor: [0.2, 0.3, 0.4],
  }], 1);
  const candidateDiagnostic = candidateDiagnosticsRust.lastCandidateDiagnostics[0];
  assert.ok(candidateDiagnostic);
  assert.equal(candidateDiagnostic.candidateId, 42);
  assert.ok(Math.abs(candidateDiagnostic.bbox.x - 0.1) <= 1e-5);
  assert.ok(Math.abs(candidateDiagnostic.bbox.y - 0.2) <= 1e-5);
  assert.ok(Math.abs(candidateDiagnostic.bbox.width - 0.5) <= 1e-5);
  assert.ok(Math.abs(candidateDiagnostic.bbox.height - 0.7) <= 1e-5);
  assert.ok(Number.isFinite(candidateDiagnostic.dominanceScore));
  assert.equal(candidateDiagnostic.selected, true);
  assert.equal(candidateDiagnostic.decision, "selected");
  assert.ok(Math.abs(candidateDiagnostic.switchThreshold - 0.25) <= 1e-5);
  assert.equal(candidateDiagnostic.switchConfirmMs, 300);
  candidateDiagnosticsRust.close();

  for (const [profile, identity] of [
    ["march_in_place", "march-in-place/front/bilateral/bodyweight/v1"],
    ["side_step_touch", "side-step-touch/front/bilateral/bodyweight/v1"],
    ["alternating_knee_raise", "alternating-knee-raise/front/bilateral/bodyweight/v1"],
    ["step_jack", "step-jack/front/bilateral/bodyweight/v1"],
  ] as const) {
    const homeWorkout = new RustCanonicalWasmSession(config(`parity:${profile}`), wasm);
    homeWorkout.setExerciseProfile(profile);
    homeWorkout.process({ timestampMs: 0, landmarks: [], worldLandmarks: [] });
    assert.equal(homeWorkout.lastDecodedPacket?.lineage.activeProfileIdentity, identity);
    assert.ok((homeWorkout.lastDecodedPacket?.lineage.activeProfileHash ?? 0n) !== 0n);
    assert.equal(homeWorkout.lastFrameValid, false);
    homeWorkout.process(pose(1));
    assert.equal(homeWorkout.lastFrameValid, true);
    homeWorkout.close();
  }

  compareNativeAndWasmHomeWorkoutFixture(wasm);

  const profileWithoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    identity: "custom-pull/rear/bilateral/cable/v1",
    maturity: "provisional",
    schema: "blazepose33",
    coordinateUnit: "image-normalized-y",
    stateMachineId: "ready-effort-peak-return/v1",
    requiredCapabilities: ["canonical-landmarks", "subject-lock"],
    direction: "auto",
    primarySignal: { kind: "landmark-y", landmarks: [15] },
    secondarySignal: { kind: "landmark-y", landmarks: [13] },
    startAmplitude: 0.05,
    minPrimaryAmplitude: 0.22,
    minSecondaryAmplitude: 0.18,
    returnHysteresis: 0.05,
    readyTolerance: 0.06,
    maxGapMs: 700,
    minRepDurationMs: 450,
    maxRepDurationMs: 8_000,
  };
  const customProfile: RustExerciseProfileData = {
    ...profileWithoutHash,
    contentHash: computeRustExerciseProfileHash(profileWithoutHash),
  };
  const customRust = new RustCanonicalWasmSession(config("parity:custom-profile"), wasm);
  customRust.installExerciseProfileData(customProfile);
  const wristY = [0.20, 0.22, 0.30, 0.45, 0.65, 0.78, 0.75, 0.60, 0.40, 0.25, 0.21];
  const elbowY = [0.30, 0.31, 0.36, 0.43, 0.53, 0.60, 0.59, 0.51, 0.41, 0.33, 0.30];
  const sealed = wristY.flatMap((wrist, index) => {
    customRust.process(actionPose(index * 100, wrist, elbowY[index]));
    return [...customRust.lastCompletedReps];
  });
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0].profileIdentity, customProfile.identity);
  assert.equal(sealed[0].profileHash, customProfile.contentHash);
  assert.equal(customRust.lastDecodedPacket?.lineage.activeProfileIdentity, customProfile.identity);
  assert.equal(customRust.lastDecodedPacket?.lineage.activeProfileHash, customProfile.contentHash);
  assert.equal(customRust.lastDecodedPacket?.lineage.configVersion, "web-motion-config/v1");
  assert.equal(customRust.lastDecodedPacket?.lineage.inferenceVersion, "mediapipe-host-adapter/v1");
  assert.equal(customRust.lastDecodedPacket?.lineage.diagnosticVersion, "web-motion-diagnostics/v1");
  customRust.close();

  const angleProfileWithoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    identity: "custom-elbow-flexion/front/bilateral/bodyweight/v1",
    maturity: "provisional",
    schema: "blazepose33",
    coordinateUnit: "image-angle-deg",
    stateMachineId: "ready-effort-peak-return/v1",
    requiredCapabilities: ["canonical-landmarks", "subject-lock"],
    direction: "auto",
    primarySignal: { kind: "joint-angle", landmarks: [11, 13, 15] },
    secondarySignal: { kind: "joint-angle", landmarks: [12, 14, 16] },
    startAmplitude: 5,
    minPrimaryAmplitude: 20,
    minSecondaryAmplitude: 20,
    returnHysteresis: 5,
    readyTolerance: 6,
    maxGapMs: 700,
    minRepDurationMs: 450,
    maxRepDurationMs: 8_000,
  };
  const angleProfile: RustExerciseProfileData = {
    ...angleProfileWithoutHash,
    contentHash: computeRustExerciseProfileHash(angleProfileWithoutHash),
  };
  const angleRust = new RustCanonicalWasmSession(config("parity:angle-profile"), wasm);
  angleRust.installExerciseProfileData(angleProfile);
  const angleSealed = [90, 92, 105, 128, 150, 147, 125, 102, 91].flatMap((angle, index) => {
    angleRust.process(bilateralAnglePose(index * 100, angle));
    return [...angleRust.lastCompletedReps];
  });
  assert.equal(angleSealed.length, 1);
  assert.equal(angleSealed[0].profileIdentity, angleProfile.identity);
  assert.equal(angleSealed[0].profileHash, angleProfile.contentHash);
  angleRust.close();

  // The catalog-wide simulated baseline is installed separately from formal
  // references, but Rust must consume it from the same sealed canonical slice.
  const genericContext = {
    exerciseId: "barbell_row",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral" as const,
    variation: "",
  };
  const genericBaseline = buildSimulatedTrajectoryBaseline(
    genericContext,
    angleProfile,
    "mediapipe-pose-heavy",
  );
  assert.ok(genericBaseline);
  const genericRust = new RustCanonicalWasmSession(config("parity:simulated-baseline"), wasm);
  genericRust.installExerciseProfileData(angleProfile);
  genericRust.installSimulatedTrajectoryBaseline(genericBaseline);
  const genericSealed = [90, 92, 105, 128, 150, 147, 125, 102, 91].flatMap((angle, index) => {
    genericRust.process(bilateralAnglePose(index * 100, angle));
    return [...genericRust.lastCompletedReps];
  });
  assert.equal(genericSealed.length, 1);
  assert.equal(genericRust.simulatedBaselineComparison.status, "comparison_available");
  assert.equal(genericRust.simulatedBaselineComparison.qualityVerdict, null);
  genericRust.close();

  const reverseAngleRust = new RustCanonicalWasmSession(config("parity:reverse-angle-profile"), wasm);
  reverseAngleRust.installExerciseProfileData(angleProfile);
  const reverseAngleSealed = [150, 148, 135, 112, 90, 93, 115, 140, 150].flatMap((angle, index) => {
    reverseAngleRust.process(bilateralAnglePose(index * 100, angle));
    return [...reverseAngleRust.lastCompletedReps];
  });
  assert.equal(reverseAngleSealed.length, 1, "auto direction must seal a decreasing-first angle cycle");
  assert.equal(reverseAngleSealed[0].profileIdentity, angleProfile.identity);
  assert.equal(reverseAngleSealed[0].profileHash, angleProfile.contentHash);
  reverseAngleRust.close();

  const twoCycleAngleRust = new RustCanonicalWasmSession(config("parity:two-cycle-angle-profile"), wasm);
  twoCycleAngleRust.installExerciseProfileData(angleProfile);
  const twoCycleAngleSealed = [
    90, 92, 105, 128, 150, 147, 125, 102, 91,
    93, 106, 129, 151, 146, 124, 101, 90,
  ].flatMap((angle, index) => {
    twoCycleAngleRust.process(bilateralAnglePose(index * 100, angle));
    return [...twoCycleAngleRust.lastCompletedReps];
  });
  assert.equal(twoCycleAngleSealed.length, 2, "auto direction must not double count a return");
  twoCycleAngleRust.close();

  const referenceRust = new RustCanonicalWasmSession(config("parity:reference-profile"), wasm);
  referenceRust.setExerciseProfile("lat_pulldown");
  const referenceProfile = broadReviewedReferenceProfile();
  assert.equal(commitRawReferenceProfile(wasm, {
    profile: { ...referenceProfile, profileStatus: "personal_provisional_unreviewed" },
  }), -3);
  assert.equal(commitRawReferenceProfile(wasm, {
    profile: {
      ...referenceProfile,
      matchingPolicy: { ...referenceProfile.matchingPolicy, minimumObservationConfidence: 2 },
    },
  }), -3);
  assert.equal(commitRawReferenceProfile(wasm, { profile: referenceProfile }), -7);
  assert.throws(() => referenceRust.setReferenceRuntimeContext({
    ...referenceProfile.identity,
    poseModelVersion: "mediapipe-pose-lite",
  }), /commit_reference_context failed \(-4\)/);
  referenceRust.setReferenceRuntimeContext(referenceProfile.identity);
  const invalidPhaseProfile = structuredClone(referenceProfile);
  invalidPhaseProfile.corridor.nodes[1].phasePercent = 5;
  assert.equal(commitRawReferenceProfile(wasm, {
    profile: invalidPhaseProfile,
  }), -5);
  assert.equal(commitRawReferenceProfile(wasm, {
    profile: referenceProfile,
    observedIdentity: {
      ...referenceProfile.identity,
      poseModelVersion: "mediapipe-pose-lite",
    },
  }), -2, "reference envelope must reject self-attested observed identity");
  for (const [field, value] of [
    ["variation", "behind_neck"],
    ["equipment", "plate_loaded_lat_pulldown"],
    ["coordinateSystem", "world-space/v1"],
    ["poseModelVersion", "mediapipe-pose-lite"],
  ] as const) {
    const spoofedProfile = structuredClone(referenceProfile) as unknown as Record<string, unknown>;
    const spoofedIdentity = {
      ...(spoofedProfile.identity as Record<string, unknown>),
      [field]: value,
    };
    spoofedProfile.identity = spoofedIdentity;
    assert.equal(commitRawReferenceProfile(wasm, {
      profile: spoofedProfile,
    }), -4, `reference field ${field} must differ from trusted runtime context`);
  }
  assert.throws(() => referenceRust.installReferenceProfile({
    profile: {
      ...referenceProfile,
      identity: { ...referenceProfile.identity, equipment: "different-machine" },
    },
  }), /commit_reference_profile failed \(-4\)/);
  referenceRust.installReferenceProfile({
    profile: referenceProfile,
  });
  assert.equal(referenceRust.referenceComparison.status, "unavailable");
  assert.equal(referenceRust.referenceComparison.reason, "awaiting-sealed-rep");
  const referencePoses = wristY.map((wrist, index) =>
    bilateralActionPose(index * 100, wrist, elbowY[index]),
  );
  const referenceSealed = referencePoses.flatMap((observation) => {
    referenceRust.process(observation);
    return [...referenceRust.lastCompletedReps];
  });
  assert.equal(referenceSealed.length, 1);
  const referenceComparison = referenceRust.referenceComparison as RustReferenceComparison;
  let extractedReferenceRep: NormalizedLatPulldownReferenceRep | null = null;
  assert.equal(referenceComparison.status, "comparison_available");
  if (referenceComparison.status === "comparison_available") {
    assert.equal(referenceComparison.repId, referenceSealed[0].repId);
    assert.equal(referenceComparison.canonicalSliceHash, referenceSealed[0].canonicalSliceHash);
    assert.equal(referenceComparison.features.length, LAT_PULLDOWN_REFERENCE_FEATURES.length);
    assert.equal(referenceComparison.qualityVerdict, null);
    const extracted = extractNormalizedLatPulldownRep({
      captureId: "synthetic-parity",
      capturePosition: "rear",
      sourceStatus: "expert_approved_reference",
      profileContext: {
        variation: referenceProfile.identity.variation,
        trainingSide: referenceProfile.identity.trainingSide,
        equipment: referenceProfile.identity.equipment,
        coordinateSystem: referenceProfile.identity.coordinateSystem,
        poseModelVersion: referenceProfile.identity.poseModelVersion,
      },
      segment: {
        repIndex: 1,
        startMs: Number(referenceSealed[0].startTimestampMs),
        peakMs: Number(referenceSealed[0].peakTimestampMs),
        endMs: Number(referenceSealed[0].endTimestampMs),
      },
      poses: referencePoses,
    });
    if (extracted.status !== "ready") throw new Error(extracted.reason);
    extractedReferenceRep = extracted.rep;
    const typescriptComparison = matchLatPulldownTrajectory(referenceProfile, extracted.rep);
    assert.equal(typescriptComparison.status, referenceComparison.status);
    typescriptComparison.features.forEach((expected, index) => {
      const actual = referenceComparison.features[index];
      assert.equal(actual.feature, expected.feature);
      assert.equal(actual.comparableNodeCount, expected.comparableNodeCount, expected.feature);
      assert.equal(actual.unknownNodeCount, expected.nodes.filter((node) => node.status === "unknown").length);
      assert.equal(actual.outsideNodeCount, expected.outsideNodeCount, expected.feature);
      assert.equal(
        actual.maximumConsecutiveOutsideNodes,
        expected.maximumConsecutiveOutsideNodes,
      );
      const expectedTotalExcess = expected.nodes.reduce(
        (sum, node) => sum + (node.normalizedExcess ?? 0),
        0,
      );
      assert.ok(Math.abs(actual.totalNormalizedExcess - expectedTotalExcess) <= 1e-4);
      if (expected.outsideNodeRatio === null) assert.equal(actual.outsideNodeRatio, null);
      else assert.ok(Math.abs((actual.outsideNodeRatio ?? Infinity) - expected.outsideNodeRatio) <= 1e-5);
    });
  }

  const simulatedReferenceRust = new RustCanonicalWasmSession(config("parity:simulated-reference"), wasm);
  simulatedReferenceRust.setExerciseProfile("lat_pulldown");
  simulatedReferenceRust.setReferenceRuntimeContext(referenceProfile.identity);
  simulatedReferenceRust.installReferenceProfile({
    profile: buildSimulatedLatPulldownReference(referenceProfile.identity),
  });
  wristY.forEach((wrist, index) => {
    simulatedReferenceRust.process(bilateralActionPose(index * 100, wrist, elbowY[index]));
  });
  assert.equal(simulatedReferenceRust.referenceComparison.status, "comparison_available");
  simulatedReferenceRust.close();
  referenceRust.close();

  assert.ok(extractedReferenceRep, "TypeScript reference extraction must be available");
  const diagnosticProfile = diagnosticReviewedReferenceProfile(
    referenceProfile,
    extractedReferenceRep,
  );
  const numericRust = new RustCanonicalWasmSession(config("parity:reference-numeric"), wasm);
  numericRust.setExerciseProfile("lat_pulldown");
  numericRust.setReferenceRuntimeContext(diagnosticProfile.identity);
  numericRust.installReferenceProfile({
    profile: diagnosticProfile,
  });
  const numericSealed = referencePoses.flatMap((observation) => {
    numericRust.process(observation);
    return [...numericRust.lastCompletedReps];
  });
  assert.equal(numericSealed.length, 1);
  const numericComparison = numericRust.referenceComparison;
  const numericTypescriptComparison = matchLatPulldownTrajectory(
    diagnosticProfile,
    extractedReferenceRep,
  );
  assert.equal(numericComparison.status, "comparison_available");
  assert.equal(numericTypescriptComparison.status, "comparison_available");
  if (numericComparison.status === "comparison_available") {
    numericTypescriptComparison.features.forEach((expected, index) => {
      const actual = numericComparison.features[index];
      assert.equal(actual.feature, expected.feature);
      assert.equal(actual.comparableNodeCount, expected.comparableNodeCount, expected.feature);
      assert.equal(
        actual.unknownNodeCount,
        expected.nodes.filter((node) => node.status === "unknown").length,
      );
      assert.equal(actual.outsideNodeCount, expected.outsideNodeCount, expected.feature);
      assert.equal(
        actual.maximumConsecutiveOutsideNodes,
        expected.maximumConsecutiveOutsideNodes,
      );
      assert.ok(expected.outsideNodeCount > 0, `${expected.feature} must exercise outside semantics`);
      assert.ok(actual.unknownNodeCount > 0, `${expected.feature} must exercise unknown semantics`);
      const expectedTotalExcess = expected.nodes.reduce(
        (sum, node) => sum + (node.normalizedExcess ?? 0),
        0,
      );
      assert.ok(
        Math.abs(actual.totalNormalizedExcess - expectedTotalExcess) <= 5e-4,
        `${expected.feature} normalized excess differs: Rust=${actual.totalNormalizedExcess}, TS=${expectedTotalExcess}`,
      );
    });
  }
  numericRust.close();

  const wrongActionRust = new RustCanonicalWasmSession(config("parity:wrong-reference-action"), wasm);
  wrongActionRust.setExerciseProfile("seated_shoulder_press");
  assert.throws(
    () => wrongActionRust.setReferenceRuntimeContext(referenceProfile.identity),
    /commit_reference_context failed \(-5\)/,
  );
  wrongActionRust.close();

  console.log(JSON.stringify({
    passed: true,
    framesCompared: poses.length + 1 + wristY.length + referencePoses.length * 2 + 9,
    semantics: ["measured", "fused", "predicted", "unknown", "reason", "reset", "profile-bundle", "native-wasm-home-workout", "sealed-reference-match", "simulated-baseline"],
    coordinateTolerance: 1e-5,
  }, null, 2));
}

interface SharedMarchFixture {
  readonly sequenceId: string;
  readonly profile: "march_in_place";
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly frames: readonly Readonly<{
    timestampMs: number;
    leftKneeLift: number;
    rightKneeLift: number;
  }>[];
}

function compareNativeAndWasmHomeWorkoutFixture(wasm: MotionWasmExports): void {
  const fixturePath = path.join(
    process.cwd(),
    "tools/motion-sdk/fixtures/march-lift-cycle.json",
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as SharedMarchFixture;
  const nativeHexPackets = JSON.parse(execFileSync(
    process.env.CARGO ?? "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      "rust/motion-sdk/Cargo.toml",
      "--bin",
      "native_home_workout_fixture",
      "--",
      fixturePath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  )) as string[];
  const nativePackets = nativeHexPackets.map((hex) => decodeMotionPacket(Buffer.from(hex, "hex")));

  const session = new RustCanonicalWasmSession({
    sequenceId: fixture.sequenceId,
    schema: "blazepose33",
    image: {
      widthPx: fixture.imageWidth,
      heightPx: fixture.imageHeight,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "raw",
  }, wasm);
  session.setExerciseProfile(fixture.profile);
  const wasmPackets = fixture.frames.map((frame) => {
    session.process(sharedMarchPose(frame));
    assert.ok(session.lastDecodedPacket);
    assert.equal(session.lastFrameValid, true);
    return session.lastDecodedPacket;
  });
  session.close();

  assert.equal(nativePackets.length, wasmPackets.length);
  nativePackets.forEach((nativePacket, index) => {
    assert.deepEqual(packetSemantics(nativePacket), packetSemantics(wasmPackets[index]));
  });
  assert.equal(
    wasmPackets.flatMap((packet) => packet.completedReps)
      .filter((rep) => rep.disposition === "confirmed").length,
    1,
  );
}

function sharedMarchPose(frame: SharedMarchFixture["frames"][number]): PoseEstimate {
  const landmarks = Array.from({ length: 33 }, () => landmark(0.5, 0.5));
  landmarks[11] = landmark(0.44, 0.30);
  landmarks[12] = landmark(0.56, 0.30);
  landmarks[23] = landmark(0.44, 0.50);
  landmarks[24] = landmark(0.56, 0.50);
  landmarks[25] = landmark(0.44, 0.68 - frame.leftKneeLift);
  landmarks[26] = landmark(0.56, 0.68 - frame.rightKneeLift);
  landmarks[27] = landmark(0.44, 0.86 - frame.leftKneeLift);
  landmarks[28] = landmark(0.56, 0.86 - frame.rightKneeLift);
  return { timestampMs: frame.timestampMs, landmarks, worldLandmarks: [] };
}

function landmark(x: number, y: number): PoseLandmark {
  return { x, y, z: 0, visibility: 1 };
}

function packetSemantics(packet: DecodedMotionPacket) {
  return {
    profileIdentity: packet.lineage.activeProfileIdentity,
    profileHash: packet.lineage.activeProfileHash,
    timestampMs: packet.sourceTimestampMs,
    target: packet.target,
    lifecycle: packet.setState.lifecycle,
    repState: packet.repState,
    completedReps: packet.completedReps.map((rep) => ({
      repId: rep.repId,
      startFrameId: rep.startFrameId,
      startTimestampMs: rep.startTimestampMs,
      peakFrameId: rep.peakFrameId,
      peakTimestampMs: rep.peakTimestampMs,
      endFrameId: rep.endFrameId,
      endTimestampMs: rep.endTimestampMs,
      disposition: rep.disposition,
      evidenceReason: rep.evidenceReason,
      profileIdentity: rep.profileIdentity,
      profileHash: rep.profileHash,
    })),
  };
}

function diagnosticReviewedReferenceProfile(
  base: PersonalProvisionalReferenceProfile,
  observed: NormalizedLatPulldownReferenceRep,
): PersonalProvisionalReferenceProfile {
  const profile = structuredClone(base);
  profile.corridor.nodes = observed.nodes.map((node, nodeIndex) => ({
    nodeIndex,
    phase: node.phase,
    phasePercent: node.phasePercent,
    features: node.values.map((value, featureIndex) => {
      const forceUnknown = (nodeIndex + featureIndex) % 4 === 0;
      const known = value !== null
        && Number.isFinite(value)
        && node.confidence[featureIndex] >= profile.matchingPolicy.minimumObservationConfidence;
      let qLow: number | null = null;
      let qHigh: number | null = null;
      if (known && !forceUnknown) {
        const mode = (nodeIndex + featureIndex) % 4;
        if (mode === 1) {
          // This 2e-4 band is the numeric oracle: a feature extractor that
          // drifts beyond float32/angle propagation tolerance flips the
          // node from inside to outside instead of hiding in a broad range.
          qLow = value - 0.0001;
          qHigh = value + 0.0001;
        } else if (mode === 2) {
          qLow = value + 0.2;
          qHigh = value + 0.21;
        } else {
          qLow = value - 0.21;
          qHigh = value - 0.2;
        }
      }
      return {
        nObserved: 8,
        nSessionsObserved: null,
        median: value,
        qLow,
        qHigh,
        medianAbsoluteDeviation: qLow === null ? null : 1,
        medianConfidence: node.confidence[featureIndex],
        coverageRate: known ? 1 : 0,
        evidenceStatus: "hypothesis" as const,
      };
    }),
  }));
  profile.provenance.notes = [
    "Synthetic numeric parity oracle with per-feature inside, outside, unknown, and excess states",
  ];
  return profile;
}

function commitRawReferenceProfile(wasm: MotionWasmExports, envelope: unknown): number {
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  assert.equal(wasm.motion_sdk_begin_reference_profile(bytes.length), 0);
  bytes.forEach((value, index) => {
    assert.equal(wasm.motion_sdk_set_reference_profile_byte(index, value), 0);
  });
  return wasm.motion_sdk_commit_reference_profile();
}

function broadReviewedReferenceProfile(): PersonalProvisionalReferenceProfile {
  const identity = {
    exerciseId: "lat_pulldown" as const,
    capturePosition: "rear" as const,
    variation: "front_bar_pronated",
    trainingSide: "bilateral" as const,
    equipment: "cable_lat_pulldown/straight_bar",
    coordinateSystem: "source-image/v1" as const,
    featureSchemaId: "lat_pulldown/source-image-piecewise-32/v2" as const,
    poseModelVersion: "mediapipe-pose-heavy",
  };
  const nodes = ["pull", "return"].flatMap((phase) =>
    Array.from({ length: 16 }, (_, index) => ({
      nodeIndex: (phase === "pull" ? 0 : 16) + index,
      phase: phase as "pull" | "return",
      phasePercent: Number((index / 15 * 100).toFixed(5)),
      features: LAT_PULLDOWN_REFERENCE_FEATURES.map(() => ({
        nObserved: 8,
        nSessionsObserved: null,
        median: 0,
        qLow: -360,
        qHigh: 360,
        medianAbsoluteDeviation: 1,
        medianConfidence: 1,
        coverageRate: 1,
        evidenceStatus: "hypothesis" as const,
      })),
    })),
  );
  return {
    schemaVersion: "maxpower-provisional-reference-profile/v1",
    profileStatus: "personal_provisional_expert_reviewed",
    identity,
    intendedUse: "compare_observed_reps_to_personal_provisional_corridor",
    prohibitedUses: ["medical diagnosis", "population standard"],
    phaseModel: {
      normalization: "piecewise_linear_start_bottom_end",
      pullNodes: 16,
      returnNodes: 16,
      unrestrictedDtwAllowed: false,
      retainRawTiming: true,
    },
    featureNames: [...LAT_PULLDOWN_REFERENCE_FEATURES],
    referencePopulation: {
      participantCount: 1,
      sessionCount: null,
      captureCount: 1,
      repCount: 8,
      sourceStatuses: ["expert_approved_reference"],
      evidenceStatus: "hypothesis",
    },
    screeningSummary: {
      acceptedCandidateReps: 8,
      incompatibleCandidateReps: 0,
      unknownCandidateReps: 0,
    },
    corridor: {
      method: "pointwise_median_empirical_q10_q90",
      nodes,
      evidenceStatus: "hypothesis",
    },
    matchingPolicy: {
      minimumPointObservations: null,
      minimumComparableNodeRatio: null,
      sustainedOutsideNodes: null,
      maximumOutsideNodeRatio: null,
      minimumObservationConfidence: 0.5,
      unrestrictedDtwAllowed: false,
      decisionThresholdsCalibrated: false,
      evidenceStatus: "hypothesis",
    },
    provenance: {
      captureIds: ["synthetic-parity"],
      repIds: ["1"],
      generatedAt: null,
      notes: ["Synthetic ABI tracer only"],
    },
  };
}

function actionPose(timestampMs: number, wristY: number, elbowY: number): PoseEstimate {
  const value = pose(timestampMs);
  value.landmarks[15] = { x: 0.35, y: wristY, z: 0, visibility: 0.99 };
  value.landmarks[13] = { x: 0.40, y: elbowY, z: 0, visibility: 0.99 };
  return value;
}

function bilateralActionPose(timestampMs: number, wristY: number, elbowY: number): PoseEstimate {
  const value = actionPose(timestampMs, wristY, elbowY);
  value.landmarks[12] = { x: 0.6, y: 0.4, z: 0, visibility: 0.99 };
  value.landmarks[14] = { x: 0.60, y: elbowY, z: 0, visibility: 0.99 };
  value.landmarks[16] = { x: 0.65, y: wristY, z: 0, visibility: 0.99 };
  value.landmarks[23] = { x: 0.43, y: 0.7, z: 0, visibility: 0.99 };
  value.landmarks[24] = { x: 0.57, y: 0.7, z: 0, visibility: 0.99 };
  return value;
}

function bilateralAnglePose(timestampMs: number, angleDegrees: number): PoseEstimate {
  const value = pose(timestampMs);
  const radius = 0.10;
  const radians = angleDegrees * Math.PI / 180;
  for (const [shoulder, elbow, wrist, x] of [[11, 13, 15, 0.35], [12, 14, 16, 0.65]] as const) {
    value.landmarks[shoulder] = { x, y: 0.40, z: 0, visibility: 0.99 };
    value.landmarks[elbow] = { x, y: 0.50, z: 0, visibility: 0.99 };
    value.landmarks[wrist] = {
      x: x + radius * Math.sin(radians),
      y: 0.50 - radius * Math.cos(radians),
      z: 0,
      visibility: 0.99,
    };
  }
  return value;
}

function compareFrames(ts: CanonicalPoseFrame, rust: CanonicalPoseFrame, frameIndex: number): void {
  assert.equal(rust.landmarks.length, ts.landmarks.length, `frame ${frameIndex} landmark count`);
  ts.landmarks.forEach((expected, index) => {
    const actual = rust.landmarks[index];
    assert.equal(actual.source, expected.source, `frame ${frameIndex} joint ${index} source`);
    assert.equal(
      actual.continuityReason,
      expected.continuityReason,
      `frame ${frameIndex} joint ${index} reason`,
    );
    assert.equal(actual.renderable, expected.renderable, `frame ${frameIndex} joint ${index} renderable`);
    if (Number.isFinite(expected.x) && Number.isFinite(expected.y)) {
      assert.ok(Math.abs(actual.x - expected.x) <= 1e-5, `frame ${frameIndex} joint ${index} x`);
      assert.ok(Math.abs(actual.y - expected.y) <= 1e-5, `frame ${frameIndex} joint ${index} y`);
    } else {
      assert.equal(Number.isFinite(actual.x), false, `frame ${frameIndex} joint ${index} unknown x`);
      assert.equal(Number.isFinite(actual.y), false, `frame ${frameIndex} joint ${index} unknown y`);
    }
  });
}

function pose(
  timestampMs: number,
  overrides: { elbowX?: number; elbowY?: number; elbowVisibility?: number } = {},
): PoseEstimate {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, (_, index) => ({
    x: 0.2 + (index % 5) * 0.08,
    y: 0.2 + Math.floor(index / 5) * 0.06,
    z: 0,
    visibility: 0.99,
  }));
  landmarks[11] = { x: 0.4, y: 0.4, z: 0, visibility: 0.99 };
  landmarks[13] = {
    x: overrides.elbowX ?? 0.5,
    y: overrides.elbowY ?? 0.55,
    z: 0,
    visibility: overrides.elbowVisibility ?? 0.99,
  };
  landmarks[15] = { x: 0.6, y: 0.4, z: 0, visibility: 0.99 };
  return { timestampMs, landmarks, worldLandmarks: [] };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
