import assert from "node:assert/strict";
import test from "node:test";

import { ExactMotionCapabilityResolver } from "../../src/motion";

const executable = {
  resolve() {
    return {
      canRecord: true,
      canCount: true,
      canEmitPhase: true,
      profileIdentity: "lat-pulldown.front.v1",
      profileHash: "profile-hash",
    };
  },
};

const input = {
  exerciseVariantId: "lat_pulldown.wide.standard",
  setup: "wide_cable",
  trainingSide: "bilateral" as const,
  capturePosition: "front" as const,
  lensFacing: "back" as const,
  poseModel: "lite" as const,
  platform: "android" as const,
};

test("exact capability resolver separates executable count from validated analysis", () => {
  const unvalidated = new ExactMotionCapabilityResolver(executable).resolve(input);
  assert.equal(unvalidated.repCounting, "available");
  assert.equal(unvalidated.trajectoryComparison, "unavailable");
  assert.equal(unvalidated.evidenceLinkedTechniqueCue, "unavailable");
  assert.equal(unvalidated.validationStatus, "not_validated");

  const validated = new ExactMotionCapabilityResolver(executable, [{
    exerciseVariantId: input.exerciseVariantId,
    setup: input.setup,
    trainingSide: input.trainingSide,
    capturePosition: "front",
    lensFacing: "back",
    profileIdentity: "lat-pulldown.front.v1",
    profileHash: "profile-hash",
    approvalId: "approval-1",
    status: "approved",
  }]).resolve(input);
  assert.equal(validated.trajectoryComparison, "available");
  assert.equal(validated.evidenceLinkedTechniqueCue, "available");

  const wrongView = new ExactMotionCapabilityResolver(executable, [{
    exerciseVariantId: input.exerciseVariantId,
    setup: input.setup,
    trainingSide: input.trainingSide,
    capturePosition: "left",
    lensFacing: "back",
    profileIdentity: "lat-pulldown.front.v1",
    profileHash: "profile-hash",
    approvalId: "approval-2",
    status: "approved",
  }]).resolve(input);
  assert.equal(wrongView.trajectoryComparison, "unavailable");
});

test("missing executable profile degrades to recording/manual instead of inventing capability", () => {
  const resolver = new ExactMotionCapabilityResolver({
    resolve: () => ({ canRecord: true, canCount: false, canEmitPhase: false, reasonCodes: ["unsupported_view"] }),
  });
  const decision = resolver.resolve(input);
  assert.equal(decision.fallback, "video_only");
  assert.equal(decision.repCounting, "unavailable");
  assert.equal(decision.reasonCodes.includes("unsupported_view"), true);
});

test("profile envelope 与可执行 profile 的身份、hash、schema 或 ABI 不匹配时只保留录像", () => {
  const resolver = new ExactMotionCapabilityResolver({
    resolve: () => ({
      canRecord: true,
      canCount: true,
      canEmitPhase: true,
      profileIdentity: "lat-pulldown.front.v1",
      profileHash: "profile-hash",
      schemaVersion: "motion-profile/v1",
      abiVersion: "motion-abi/v3",
    }),
  });
  const valid = resolver.resolve({
    ...input,
    profileEnvelope: {
      schemaVersion: "motion-profile/v1",
      identity: "lat-pulldown.front.v1",
      hash: "profile-hash",
      abiVersion: "motion-abi/v3",
    },
  });
  assert.equal(valid.repCounting, "available");

  const mismatch = resolver.resolve({
    ...input,
    profileEnvelope: {
      schemaVersion: "motion-profile/v1",
      identity: "lat-pulldown.front.v1",
      hash: "wrong-profile-hash",
      abiVersion: "motion-abi/v3",
    },
  });
  assert.equal(mismatch.repCounting, "unavailable");
  assert.equal(mismatch.phaseTempo, "unavailable");
  assert.equal(mismatch.fallback, "video_only");
  assert.equal(mismatch.reasonCodes.includes("profile_envelope_hash_mismatch"), true);
});

test("平台 canonical bridge 是独立能力，iOS 接通后仍不能被 profile lookup 误开技术建议", () => {
  const resolver = new ExactMotionCapabilityResolver({
    resolve: () => ({
      canRecord: true,
      canCount: true,
      canEmitPhase: true,
      profileIdentity: "lat-pulldown.front.v1",
      profileHash: "profile-hash",
      supportedPoseModels: ["rtmpose-m-halpe26"] as const,
    }),
  });
  const android = resolver.resolve({ ...input, poseModel: "rtmpose-m-halpe26", platform: "android" });
  assert.equal(android.repCounting, "available");
  assert.equal(android.phaseTempo, "available");

  const ios = resolver.resolve({ ...input, poseModel: "rtmpose-m-halpe26", platform: "ios" });
  assert.equal(ios.localRecording, "available");
  assert.equal(ios.repCounting, "available");
  assert.equal(ios.phaseTempo, "available");
  assert.equal(ios.evidenceLinkedTechniqueCue, "unavailable");
  assert.equal(ios.fallback, "count_tempo_only");
  assert.equal(ios.reasonCodes.includes("validated_analysis_record_missing"), true);

  const web = resolver.resolve({ ...input, poseModel: "rtmpose-m-halpe26", platform: "web" });
  assert.equal(web.localRecording, "available");
  assert.equal(web.repCounting, "available");
  assert.equal(web.phaseTempo, "available");
  assert.equal(web.evidenceLinkedTechniqueCue, "unavailable");
  assert.equal(web.reasonCodes.includes("validated_analysis_record_missing"), true);
});

test("可执行 profile 必须显式支持当前 pose model，不能把同一动作模型静默复用", () => {
  const resolver = new ExactMotionCapabilityResolver({
    resolve: () => ({
      canRecord: true,
      canCount: true,
      canEmitPhase: true,
      profileIdentity: "lat-pulldown.front.v1",
      profileHash: "profile-hash",
      supportedPoseModels: ["heavy"] as const,
    }),
  });
  const decision = resolver.resolve({ ...input, poseModel: "lite" });
  assert.equal(decision.repCounting, "unavailable");
  assert.equal(decision.phaseTempo, "unavailable");
  assert.equal(decision.fallback, "video_only");
  assert.equal(decision.reasonCodes.includes("pose_model_unsupported"), true);
});

test("validated analysis 绑定完整 observation context，不跨 setup、训练侧或镜头朝向复用", () => {
  const validation = {
    exerciseVariantId: input.exerciseVariantId,
    setup: "wide_cable",
    trainingSide: "bilateral" as const,
    lensFacing: "back" as const,
    capturePosition: "front" as const,
    profileIdentity: "lat-pulldown.front.v1",
    profileHash: "profile-hash",
    approvalId: "approval-exact-context",
    status: "approved" as const,
  };
  const resolver = new ExactMotionCapabilityResolver(executable, [validation]);

  const exact = resolver.resolve({ ...input, setup: "wide_cable", trainingSide: "bilateral" });
  assert.equal(exact.validationStatus, "validated_analysis");

  const wrongSetup = resolver.resolve({ ...input, setup: "neutral_grip_cable", trainingSide: "bilateral" });
  assert.equal(wrongSetup.validationStatus, "not_validated");
  assert.equal(wrongSetup.trajectoryComparison, "unavailable");
  assert.equal(wrongSetup.evidenceLinkedTechniqueCue, "unavailable");

  const wrongLens = resolver.resolve({ ...input, setup: "wide_cable", trainingSide: "bilateral", lensFacing: "front" });
  assert.equal(wrongLens.validationStatus, "not_validated");
  assert.equal(wrongLens.trajectoryComparison, "unavailable");
});
