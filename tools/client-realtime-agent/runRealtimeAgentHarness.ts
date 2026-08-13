import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { LocalCoachProvider, type LLMProviderRequest } from "../../src/coach/adapters/provider";

interface EvaluationReport {
  rows: Array<{
    captureId: string;
    rustOutcomes: Record<string, unknown>;
    executionAssessment: Record<string, unknown>;
  }>;
  protocol: { predictionSha256: string };
}

interface FrozenClientPrediction {
  packSha256: string;
  cases: Array<{
    captureId: string;
    reps: Array<{
      disposition: "confirmed" | "needs_review" | "rejected";
      evidenceReason: string | null;
    }>;
    executionAssessment: Record<string, unknown>;
  }>;
}

async function main(): Promise<void> {
  const reportPath = resolve(process.argv[2] ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-prediction-before-truth.json");
  const outputPath = resolve(process.argv[3] ?? "data/workflows/client-realtime-agent/client-single-pass-v1/realtime-agent-harness-output.json");
  const input = JSON.parse(await readFile(reportPath, "utf8")) as EvaluationReport | FrozenClientPrediction;
  const frozenPrediction = "cases" in input;
  const rows = frozenPrediction
    ? input.cases.map((testCase) => ({
      captureId: testCase.captureId,
      rustOutcomes: summarizeRustOutcomes(testCase.reps),
      executionAssessment: testCase.executionAssessment,
    }))
    : input.rows;
  const evidenceRef = frozenPrediction ? input.packSha256 : input.protocol.predictionSha256;
  const canonicalEvidence = rows.map((row) => ({
    kind: "training_execution_assessment",
    captureId: row.captureId,
    rustOutcomes: row.rustOutcomes,
    assessment: row.executionAssessment,
    evidenceRef,
  }));
  const request: LLMProviderRequest = {
    sessionId: "client-single-pass-agent-harness",
    runId: "client-single-pass-agent-harness-v1",
    userText: "请复盘这几组动作执行，说明每个 rep/阶段能看出什么、不能判断什么，并给出下一步训练指导。",
    context: {
      userPseudonym: "local-client-harness",
      profile: {}, plan: {}, timeline: [], workingMemory: [], activeConstraints: [],
      nutritionStrategies: [], goalCycles: [], canonicalEvidence,
      historicalSummaries: [], currentConversation: [], conversationSummaries: [],
    },
    contextManifest: {
      schemaVersion: 1,
      userPseudonym: "local-client-harness",
      providerKind: "local-rule-coach",
      requestPurpose: "training_execution_review",
      assembledAt: new Date().toISOString(),
      factRefs: [evidenceRef],
      redactedPaths: [],
      includes: ["rust_training_execution_assessment"],
      priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
      productionCompression: "none",
      retrievalFactRefs: [], summaryRefs: [], timeRange: {}, mediaAttachments: [],
      redactionPolicyVersion: "direct-identifiers-v1",
    },
    toolManifest: [],
  };
  const provider = new LocalCoachProvider();
  const events = [];
  let response = "";
  for await (const event of provider.stream(request)) {
    events.push(event);
    if (event.type === "text-delta") response += event.delta;
  }
  const output = {
    schemaVersion: "maxpower-realtime-agent-motion-harness/v1",
    generatedAt: new Date().toISOString(),
    provider: { kind: provider.kind, usesNetwork: provider.usesNetwork },
    sourceKind: frozenPrediction ? "frozen_client_prediction_before_truth" : "legacy_filtered_evaluation_report",
    visualInput: "none; structured Rust evidence only",
    pythonVisionUsed: false,
    truthMetricsExposedToAgent: false,
    request,
    events,
    response,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n${response}\n`);
}

function summarizeRustOutcomes(reps: FrozenClientPrediction["cases"][number]["reps"]) {
  const reasonCounts: Record<string, number> = {};
  for (const rep of reps) {
    const reason = rep.evidenceReason ?? "none";
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    confirmed: reps.filter((rep) => rep.disposition === "confirmed").length,
    needsReview: reps.filter((rep) => rep.disposition === "needs_review").length,
    rejected: reps.filter((rep) => rep.disposition === "rejected").length,
    reasonCounts,
  };
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
