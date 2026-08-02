import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

function findSourceTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return findSourceTests(path);
    }

    return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

export function resolveTestFrontier(projectRoot: string): string[] {
  const sourceRoot = join(projectRoot, "tools");
  const buildRoot = join(projectRoot, ".test-build", "tools");

  const compiledTests = findSourceTests(sourceRoot)
    .sort()
    .map((sourcePath) =>
      join(buildRoot, relative(sourceRoot, sourcePath).replace(/\.ts$/, ".js")),
    );

  for (const compiledTest of compiledTests) {
    if (!existsSync(compiledTest)) {
      throw new Error(`Missing compiled test: ${compiledTest}`);
    }
  }

  return compiledTests;
}
