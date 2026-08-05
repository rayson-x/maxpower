import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateHomeWorkoutValidation } from "../../src/motion/homeWorkoutValidation";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("Usage: npm run validate:home-workout -- validation-input.json [report.json]");
const input = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as Parameters<typeof evaluateHomeWorkoutValidation>[0];
const report = evaluateHomeWorkoutValidation(input);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) writeFileSync(resolve(outputPath), serialized);
else process.stdout.write(serialized);
if (report.status === "fail") process.exitCode = 1;
