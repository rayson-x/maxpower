import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AgentKnowledgeBackend } from "../../src/agent-knowledge";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import {
  DEFAULT_KNOWLEDGE_COMPARISON_SCENARIOS,
  KnowledgeBackendComparisonHarness,
} from "./KnowledgeBackendComparisonHarness";

const releasePath = process.env.AGENT_KNOWLEDGE_RELEASE_PATH
  ? resolve(process.env.AGENT_KNOWLEDGE_RELEASE_PATH)
  : resolve(process.cwd(), "../wiki/records/releases/generated.knowledge_release.maxpower.existing-knowledge.json");

const release = JSON.parse(readFileSync(releasePath, "utf8")) as unknown;
const harness = new KnowledgeBackendComparisonHarness({
  legacy: new KnowledgePackRegistry(createInstalledKnowledgePack()),
  agentKnowledge: AgentKnowledgeBackend.load(release, { mode: "offline_evaluation" }),
});

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  releasePath,
  report: harness.run(DEFAULT_KNOWLEDGE_COMPARISON_SCENARIOS),
}, null, 2));
