import assert from "node:assert/strict";
import test from "node:test";

import { InferenceCompletionGate } from "../../src/motion/inferenceCompletionGate";

test("stale, reset, and model-epoch inference completions are diagnosed and dropped", () => {
  const gate = new InferenceCompletionGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.accept(second).accepted, true);
  assert.deepEqual(gate.accept(first), { accepted: false, reason: "superseded-request" });

  const beforeReset = gate.begin();
  gate.resetSequence();
  assert.deepEqual(gate.accept(beforeReset), { accepted: false, reason: "sequence-reset" });

  const beforeModelChange = gate.begin();
  gate.replaceModel();
  assert.deepEqual(gate.accept(beforeModelChange), {
    accepted: false,
    reason: "model-epoch-changed",
  });
  assert.equal(gate.accept(gate.begin()).accepted, true);
});
