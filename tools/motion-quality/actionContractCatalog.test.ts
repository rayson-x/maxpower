import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACTION_CONTRACT_CATALOG,
  ACTION_CONTRACT_CATALOG_POLICY,
  QUALITY_DIMENSIONS,
  getExactActionContextContract,
  type EquipmentMode,
  type TrainingSide,
} from "./actionContractCatalog.js";

const EXPECTED_TICKET_ACTIONS = [
  "barbell_bench_press",
  "barbell_row",
  "machine_chest_press",
  "seated_shoulder_press",
  "push_up",
  "lat_pulldown",
  "pull_up",
  "seated_row",
  "straight_arm_pulldown",
  "lateral_raise",
  "rear_delt_fly",
  "single_arm_cable_lateral_raise",
] as const;

test("tickets 05-16 expose exactly twelve action contracts", () => {
  assert.deepEqual(
    ACTION_CONTRACT_CATALOG.map((contract) => contract.exerciseId),
    EXPECTED_TICKET_ACTIONS,
  );
});

const EXPECTED_PERSONAL_VIEWS = {
  barbell_bench_press: ["front", "frontLeft45", "frontRight45"],
  barbell_row: ["front", "frontLeft45", "frontRight45", "rearLeft45", "rearRight45"],
  machine_chest_press: ["front", "frontRight45"],
  seated_shoulder_press: ["front"],
  push_up: ["rearRight45"],
  lat_pulldown: ["rear", "rearLeft45"],
  pull_up: ["rearLeft45"],
  seated_row: ["frontLeft45", "rearLeft45", "right"],
  straight_arm_pulldown: ["frontLeft45", "frontRight45"],
  lateral_raise: ["front"],
  rear_delt_fly: ["front"],
  single_arm_cable_lateral_raise: ["frontLeft45", "rearRight45"],
} as const;

const EQUIPMENT_BY_ACTION = {
  barbell_bench_press: "barbell",
  barbell_row: "barbell",
  machine_chest_press: "chest_press_machine",
  seated_shoulder_press: "barbell",
  push_up: "bodyweight",
  lat_pulldown: "cable_bar",
  pull_up: "fixed_pull_up_bar",
  seated_row: "cable_handle",
  straight_arm_pulldown: "cable_bar",
  lateral_raise: "dumbbell",
  rear_delt_fly: "dumbbell",
  single_arm_cable_lateral_raise: "cable_handle",
} as const satisfies Readonly<Record<(typeof EXPECTED_TICKET_ACTIONS)[number], EquipmentMode>>;

function expectedSide(exerciseId: string, capturePosition: string): TrainingSide {
  if (exerciseId !== "single_arm_cable_lateral_raise") return "bilateral";
  return capturePosition === "frontLeft45" ? "left" : "right";
}

test("the catalog resolves every exact action and view in the admitted personal labels", () => {
  const dataset = JSON.parse(
    readFileSync("data/training/personal-golden-segmentation-v2.json", "utf8"),
  ) as {
    records: Array<{ exerciseId: string; capturePosition: string }>;
  };

  const actualViews = Object.fromEntries(EXPECTED_TICKET_ACTIONS.map((exerciseId) => [
    exerciseId,
    [...new Set(dataset.records
      .filter((record) => record.exerciseId === exerciseId)
      .map((record) => record.capturePosition))].sort(),
  ]));
  const expectedViews = Object.fromEntries(Object.entries(EXPECTED_PERSONAL_VIEWS).map(
    ([exerciseId, views]) => [exerciseId, [...views].sort()],
  ));
  assert.deepEqual(actualViews, expectedViews);

  for (const record of dataset.records) {
    if (!(record.exerciseId in EXPECTED_PERSONAL_VIEWS)) continue;
    const exerciseId = record.exerciseId as (typeof EXPECTED_TICKET_ACTIONS)[number];
    const resolved = getExactActionContextContract({
      exerciseId,
      capturePosition: record.capturePosition,
      equipment: EQUIPMENT_BY_ACTION[exerciseId],
      trainingSide: expectedSide(exerciseId, record.capturePosition),
    });
    assert.ok(
      resolved,
      `missing exact contract for ${exerciseId}/${record.capturePosition}`,
    );
  }
});

const EXPECTED_PHASE_ORDER = {
  barbell_bench_press: ["eccentric", "concentric"],
  barbell_row: ["concentric", "eccentric"],
  machine_chest_press: ["concentric", "eccentric"],
  seated_shoulder_press: ["concentric", "eccentric"],
  push_up: ["eccentric", "concentric"],
  lat_pulldown: ["concentric", "eccentric"],
  pull_up: ["concentric", "eccentric"],
  seated_row: ["concentric", "eccentric"],
  straight_arm_pulldown: ["concentric", "eccentric"],
  lateral_raise: ["concentric", "eccentric"],
  rear_delt_fly: ["concentric", "eccentric"],
  single_arm_cable_lateral_raise: ["concentric", "eccentric"],
} as const;

test("every action declares endpoint semantics, phase order and counting mode", () => {
  for (const contract of ACTION_CONTRACT_CATALOG) {
    assert.deepEqual(contract.phase.order, EXPECTED_PHASE_ORDER[contract.exerciseId]);
    assert.ok(contract.phase.startAnchor.length > 0);
    assert.ok(contract.phase.primaryTurnaround.length > 0);
    assert.ok(contract.phase.endReturn.length > 0);
    assert.equal(
      contract.countingMode,
      contract.exerciseId === "single_arm_cable_lateral_raise"
        ? "unilateral_cycle_per_side"
        : "bilateral_cycle",
    );
  }
});

test("capability is explicit per exact context and never claims reviewed quality support", () => {
  for (const contract of ACTION_CONTRACT_CATALOG) {
    for (const context of contract.contexts) {
      assert.equal(context.capability.repAuthority, "rust_sealed_rep");
      assert.equal(
        context.capability.phase,
        contract.exerciseId === "pull_up" ? "observation_only" : "phase_supported",
      );
      assert.equal(context.capability.quality, "direct_observation_proposal");
      assert.notEqual(context.capability.quality, "quality_supported");
    }
  }
});

test("every exact context declares observability and abstention for all eight dimensions", () => {
  for (const contract of ACTION_CONTRACT_CATALOG) {
    for (const context of contract.contexts) {
      assert.deepEqual(
        Object.keys(context.dimensions).sort(),
        [...QUALITY_DIMENSIONS].sort(),
        `${contract.exerciseId}/${context.key.capturePosition} has an incomplete dimension contract`,
      );
      for (const dimension of QUALITY_DIMENSIONS) {
        const projection = context.dimensions[dimension];
        assert.ok(projection.state.length > 0);
        assert.ok(
          projection.abstainReasons.length > 0,
          `${contract.exerciseId}/${context.key.capturePosition}/${dimension} lacks an abstain path`,
        );
      }
      assert.equal(context.dimensions.standard_variant_compatibility.state, "abstain");
      assert.ok(
        context.dimensions.standard_variant_compatibility.abstainReasons.includes(
          "no_exact_reviewed_reference",
        ),
      );
    }
  }
});

test("view-bounded dimensions abstain instead of turning projection into physical symmetry", () => {
  const benchOblique = getExactActionContextContract({
    exerciseId: "barbell_bench_press",
    capturePosition: "frontLeft45",
    equipment: "barbell",
    trainingSide: "bilateral",
  });
  assert.ok(benchOblique?.dimensions.bilateral_coordination.abstainReasons.includes(
    "front_oblique_projection_not_physical_height",
  ));

  const sideRow = getExactActionContextContract({
    exerciseId: "seated_row",
    capturePosition: "right",
    equipment: "cable_handle",
    trainingSide: "bilateral",
  });
  assert.equal(sideRow?.dimensions.bilateral_coordination.state, "abstain");
  assert.ok(sideRow?.dimensions.bilateral_coordination.abstainReasons.includes(
    "pure_side_view_cannot_support_bilateral_projection",
  ));

  const unilateral = getExactActionContextContract({
    exerciseId: "single_arm_cable_lateral_raise",
    capturePosition: "frontLeft45",
    equipment: "cable_handle",
    trainingSide: "left",
  });
  assert.equal(unilateral?.dimensions.bilateral_coordination.state, "not_applicable");
  assert.equal(
    getExactActionContextContract({
      exerciseId: "single_arm_cable_lateral_raise",
      capturePosition: "frontLeft45",
      equipment: "cable_handle",
      trainingSide: "right",
    }),
    undefined,
  );
});

test("physical capture directions remain exact and are never folded into generic front or rear views", () => {
  const positions = ACTION_CONTRACT_CATALOG.flatMap((contract) => (
    contract.contexts.map((context) => context.key.capturePosition)
  ));
  assert.ok(positions.includes("frontLeft45"));
  assert.ok(positions.includes("frontRight45"));
  assert.ok(positions.includes("rearLeft45"));
  assert.ok(positions.includes("rearRight45"));
  assert.doesNotMatch(JSON.stringify(ACTION_CONTRACT_CATALOG), /analysisView|oblique45/);
});

test("the catalog is a Rust-owned review projection with no score or causal physiology output", () => {
  assert.deepEqual(ACTION_CONTRACT_CATALOG_POLICY, {
    schemaVersion: "maxpower-action-contract-catalog/v1",
    purpose: "review_report_projection",
    inputAuthority: "rust_sealed_rep",
    mayRecomputeRustRep: false,
    aggregateScore: "forbidden",
    causalPhysiologyInference: "forbidden",
  });

  const serializedContracts = JSON.stringify(ACTION_CONTRACT_CATALOG);
  assert.doesNotMatch(serializedContracts, /"score"|"strength"|"force"|"muscleActivation"/i);
  assert.equal(
    getExactActionContextContract({
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      equipment: "dumbbell",
      trainingSide: "bilateral",
    }),
    undefined,
  );
});
