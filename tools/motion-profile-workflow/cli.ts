import fs from "node:fs";
import path from "node:path";
import { MotionProfileWorkflow, type MotionProfileWorkflowSpec, type WorkflowMode } from "./workflow.js";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const specPath = arg("--spec");
  const mode = (arg("--mode") ?? "candidate") as WorkflowMode;
  if (!specPath || !["inspect", "candidate", "proposal"].includes(mode)) throw new Error("Usage: --spec <path> --mode inspect|candidate|proposal");
  const spec = JSON.parse(fs.readFileSync(path.resolve(specPath), "utf8")) as MotionProfileWorkflowSpec;
  const result = await new MotionProfileWorkflow(process.cwd()).run({ ...spec, mode });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failed") process.exitCode = 1;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
