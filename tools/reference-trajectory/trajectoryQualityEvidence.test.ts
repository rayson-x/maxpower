import assert from "node:assert/strict";
import test from "node:test";

import { buildLatPulldownQualityEvidence } from "../../src/pose/trajectoryQualityEvidence";

function comparison(overrides: Partial<Parameters<typeof buildLatPulldownQualityEvidence>[0]> = {}) {
  return {
    status: "comparison_available" as const,
    reason: null,
    features: [
      feature("leftWristHeight"),
      feature("rightWristHeight"),
      feature("leftElbowAngleDeg"),
      feature("rightElbowAngleDeg"),
      feature("torsoLateralShift"),
      feature("torsoLateralTiltDeg"),
    ],
    ...overrides,
  };
}

function feature(featureName: string, overrides: Partial<{
  comparableNodeCount: number;
  unknownNodeCount: number;
  outsideNodeCount: number;
  outsideNodeRatio: number | null;
  maximumConsecutiveOutsideNodes: number;
  totalNormalizedExcess: number;
}> = {}) {
  return {
    feature: featureName,
    comparableNodeCount: 32,
    unknownNodeCount: 0,
    outsideNodeCount: 0,
    outsideNodeRatio: 0,
    maximumConsecutiveOutsideNodes: 0,
    totalNormalizedExcess: 0,
    ...overrides,
  };
}

test("quality evidence describes in-band paths without inventing a form score", () => {
  const cards = buildLatPulldownQualityEvidence(comparison(), {
    toExtremeMs: 700,
    fromExtremeMs: 1_100,
  });
  assert.equal(cards.find((card) => card.id === "trajectory_path")?.status, "within_reference_band");
  assert.equal(cards.find((card) => card.id === "torso_stability")?.status, "within_reference_band");
  assert.equal(cards.find((card) => card.id === "concentric_timing")?.status, "measured_not_judged");
  assert.equal(cards.find((card) => card.id === "eccentric_control")?.evidence, "1100ms");
  assert.equal(cards.find((card) => card.id === "range_of_motion")?.status, "not_supported");
  assert.equal(cards.find((card) => card.id === "shoulder_line")?.status, "not_supported");
});

test("quality evidence preserves sustained trajectory deviation as evidence", () => {
  const source = comparison();
  const cards = buildLatPulldownQualityEvidence({
    ...source,
    features: source.features.map((item, index) => index === 0
      ? feature("leftWristHeight", {
          outsideNodeCount: 7,
          outsideNodeRatio: 7 / 32,
          maximumConsecutiveOutsideNodes: 5,
          totalNormalizedExcess: 3.2,
        })
      : item),
  }, null);
  const path = cards.find((card) => card.id === "trajectory_path");
  assert.equal(path?.status, "deviation_observed");
  assert.match(path?.evidence ?? "", /带外 7 节点/);
  assert.equal(cards.find((card) => card.id === "concentric_timing")?.status, "insufficient_observation");
});

test("quality evidence refuses comparison failures instead of silently borrowing a reference", () => {
  const cards = buildLatPulldownQualityEvidence({
    status: "profile_mismatch",
    reason: "strict reference identity mismatch",
    features: [],
  }, null);
  assert.equal(cards.find((card) => card.id === "trajectory_path")?.status, "insufficient_observation");
  assert.match(cards.find((card) => card.id === "trajectory_path")?.detail ?? "", /identity mismatch/);
});

test("quality evidence keeps all dimensions explicitly not assessed without a reference", () => {
  const cards = buildLatPulldownQualityEvidence(null, null);
  assert.equal(cards.length, 6);
  assert.ok(cards.every((card) => card.status === "insufficient_observation" || card.status === "not_supported"));
});
