import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveTestFrontier } from "../testFrontier";

test("test frontier includes every nested source test in deterministic order", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "form-coach-test-frontier-"));
  try {
    mkdirSync(join(projectRoot, "tools", "alpha"), { recursive: true });
    mkdirSync(join(projectRoot, "tools", "nested", "beta"), { recursive: true });
    mkdirSync(join(projectRoot, ".test-build", "tools", "alpha"), { recursive: true });
    mkdirSync(join(projectRoot, ".test-build", "tools", "nested", "beta"), {
      recursive: true,
    });
    writeFileSync(join(projectRoot, "tools", "alpha", "zeta.test.ts"), "");
    writeFileSync(join(projectRoot, "tools", "nested", "beta", "alpha.test.ts"), "");
    writeFileSync(join(projectRoot, ".test-build", "tools", "alpha", "zeta.test.js"), "");
    writeFileSync(
      join(projectRoot, ".test-build", "tools", "nested", "beta", "alpha.test.js"),
      "",
    );

    assert.deepEqual(resolveTestFrontier(projectRoot), [
      join(projectRoot, ".test-build", "tools", "alpha", "zeta.test.js"),
      join(projectRoot, ".test-build", "tools", "nested", "beta", "alpha.test.js"),
    ]);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("test frontier rejects a source test without a compiled test", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "form-coach-test-frontier-"));
  try {
    mkdirSync(join(projectRoot, "tools", "pose"), { recursive: true });
    writeFileSync(join(projectRoot, "tools", "pose", "continuity.test.ts"), "");

    assert.throws(
      () => resolveTestFrontier(projectRoot),
      /Missing compiled test.*continuity\.test\.js/,
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
