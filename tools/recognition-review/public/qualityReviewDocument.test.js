"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createReviewDocument,
  importReviewDocument,
} = require("./qualityReviewDocument.js");

function frozenProposal() {
  return {
    schemaVersion: "maxpower-motion-quality-proposal/v1",
    proposalHash: "sha256:proposal-a",
    lineage: {
      runId: "blind-run-a",
      runKind: "blind_evaluation",
      motionPacketHash: "sha256:packet-a",
      qlt1Version: "1.0",
      profileVersion: "profile-a",
      ruleVersion: "rules-a",
    },
    reps: [{
      repId: "rep-1",
      endpoints: {
        start_anchor: { occurredAtMs: 1_000, confirmedAtMs: 1_000 },
        primary_turnaround: { occurredAtMs: 2_000, confirmedAtMs: 2_100 },
        end_return: { occurredAtMs: 3_000, confirmedAtMs: 3_100 },
      },
      conclusions: [{
        conclusionId: "rom-complete",
        dimension: "rom_endpoint_completeness",
        value: "observed_acceptable",
        confidence: 0.91,
      }],
    }],
  };
}

const reviewer = {
  reviewerId: "owner",
  reviewerRole: "owner_observation",
};

const exportMetadata = {
  exportId: "export-a",
  exportedAt: "2026-08-13T23:00:00.000Z",
  applicationVersion: "quality-review/v1",
};

test("reviewer exports independent endpoint and conclusion decisions with explicit null corrections", () => {
  const review = createReviewDocument({ proposal: frozenProposal(), reviewer });

  review.setDecision({
    target: { kind: "conclusion", repId: "rep-1", conclusionId: "rom-complete" },
    verdict: "correct",
    correctedValue: null,
  });
  review.setDecision({
    target: { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" },
    verdict: "incorrect",
    correctedValue: null,
    note: "",
  });

  const first = review.exportJson(exportMetadata);
  const second = review.exportJson(exportMetadata);
  assert.equal(second, first);

  const exported = JSON.parse(first);
  assert.equal(exported.schemaVersion, "maxpower-motion-quality-review-export/v1");
  assert.equal(exported.proposalHash, "sha256:proposal-a");
  assert.deepEqual(exported.proposalLineage, frozenProposal().lineage);
  assert.deepEqual(exported.reviewer, reviewer);
  assert.deepEqual(exported.exportMetadata, exportMetadata);
  assert.deepEqual(exported.decisions, [{
    target: { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" },
    verdict: "incorrect",
    correctedValue: null,
    note: null,
  }, {
    target: { kind: "conclusion", repId: "rep-1", conclusionId: "rom-complete" },
    verdict: "correct",
    correctedValue: null,
    note: null,
  }]);
});

test("import then export preserves incorrect decisions with a null corrected value", () => {
  const proposal = frozenProposal();
  const original = createReviewDocument({ proposal, reviewer });
  original.setDecision({
    target: { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" },
    verdict: "incorrect",
    correctedValue: null,
    note: "候选点偏晚",
  });
  original.setDecision({
    target: { kind: "conclusion", repId: "rep-1", conclusionId: "rom-complete" },
    verdict: "cannot_judge",
    correctedValue: { state: "cannot_judge", reason: "equipment_path_unavailable" },
  });
  const first = original.exportJson(exportMetadata);

  const imported = importReviewDocument({ proposal, json: first });
  const second = imported.exportJson(exportMetadata);

  assert.equal(second, first);
  assert.equal(JSON.parse(second).decisions[0].correctedValue, null);
});

test("review state is readable in memory while proposal and decision inputs remain immutable", () => {
  const proposal = frozenProposal();
  const originalProposal = structuredClone(proposal);
  const correction = { occurredAtMs: 2_050 };
  const target = { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" };
  const review = createReviewDocument({ proposal, reviewer });

  review.setDecision({ target, verdict: "incorrect", correctedValue: correction });
  correction.occurredAtMs = 9_999;
  proposal.reps[0].endpoints.primary_turnaround.occurredAtMs = 8_888;

  assert.deepEqual(review.proposal, originalProposal);
  assert.equal(Object.isFrozen(review.proposal), true);
  assert.equal(Object.isFrozen(review.proposal.reps[0].endpoints.primary_turnaround), true);
  assert.deepEqual(review.getDecision(target), {
    target,
    verdict: "incorrect",
    correctedValue: { occurredAtMs: 2_050 },
    note: null,
  });

  review.setDecision({ target, verdict: "cannot_judge", correctedValue: null });
  assert.deepEqual(review.listDecisions(), [{
    target,
    verdict: "cannot_judge",
    correctedValue: null,
    note: null,
  }]);
  assert.deepEqual(proposal, {
    ...originalProposal,
    reps: [{
      ...originalProposal.reps[0],
      endpoints: {
        ...originalProposal.reps[0].endpoints,
        primary_turnaround: { occurredAtMs: 8_888, confirmedAtMs: 2_100 },
      },
    }],
  });
});

test("review contract rejects incomplete endpoints, lineage metadata, and implicit corrections", () => {
  const incomplete = frozenProposal();
  delete incomplete.reps[0].endpoints.end_return;
  assert.throws(
    () => createReviewDocument({ proposal: incomplete, reviewer }),
    /end_return/,
  );
  assert.throws(
    () => createReviewDocument({ proposal: frozenProposal(), reviewer: {} }),
    /reviewerId/,
  );

  const review = createReviewDocument({ proposal: frozenProposal(), reviewer });
  assert.throws(() => review.setDecision({
    target: { kind: "endpoint", repId: "rep-1", endpoint: "start_anchor" },
    verdict: "correct",
  }), /correctedValue/);
  assert.throws(() => review.setDecision({
    target: { kind: "conclusion", repId: "rep-1", conclusionId: "invented" },
    verdict: "incorrect",
    correctedValue: null,
  }), /unknown review target/);
  assert.throws(
    () => review.exportJson({ exportId: "export-a" }),
    /exportedAt/,
  );
});
