import { spawnSync } from "node:child_process";

import { resolveTestFrontier } from "./testFrontier";

const projectRoot = process.cwd();
const tests = resolveTestFrontier(projectRoot);

if (tests.length === 0) {
  throw new Error("No source tests found under tools/");
}

const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
