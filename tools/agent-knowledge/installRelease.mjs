import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = resolve(root, "../wiki/records/releases/generated.knowledge_release.maxpower.planner.v2.json");
const target = resolve(root, "src/agent-knowledge/releases/maxpower-planner.v2.json");
const release = JSON.parse(readFileSync(source, "utf8"));
if (release.schemaVersion !== "agent-knowledge/v1" || release.status !== "active") {
  throw new Error("agent_knowledge_install_requires_active_release");
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(JSON.stringify({ releaseId: release.releaseId, version: release.semanticVersion, target }));
