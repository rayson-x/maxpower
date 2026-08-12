/**
 * Live-provider lifecycle evaluation.
 *
 * Runs without the mobile client.  Unlike the deterministic lifecycle test,
 * each daily report is interpreted by the configured cloud LLM, then executed
 * through the same AgentRuntime, ToolRegistry, Ledger and Planner used by the
 * product.  Credentials are supplied only through process environment.
 */
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { MaxPowerPiCoachProviderResolver } from "../../src/mobile/cloud/MaxPowerPiCoachProvider";
import { PERSONA_MATRIX, type Persona } from "./personaMatrix";
import { writeFile } from "node:fs/promises";

const BASE_URL = process.env.MAXPOWER_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.MAXPOWER_E2E_EMAIL ?? "";
const PASSWORD = process.env.MAXPOWER_E2E_PASSWORD ?? "";
const CURRENT_DATE = "2026-08-12";
const ONLY = new Set((process.env.MAXPOWER_E2E_SCENARIOS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const REPORT_PATH = process.env.MAXPOWER_E2E_REPORT_PATH;

type ScenarioId = "strict" | "recovery" | "schedule" | "indulgence";

interface LiveOutcome {
  scenario: ScenarioId;
  persona: string;
  initialPlanConfirmed: boolean;
  turns: readonly { message: string; tools: readonly string[]; failed?: string }[];
  timelineFacts: readonly string[];
  dynamicPreview: boolean;
  dynamicConfirmed: boolean;
  finalPlanRevision?: number;
  diagnostics: Readonly<Record<string, unknown>>;
  issues: readonly string[];
}

async function login(): Promise<{ accountId: string; accessToken: string }> {
  if (!EMAIL || !PASSWORD) throw new Error("MAXPOWER_E2E_EMAIL_and_PASSWORD_required");
  const response = await fetch(`${BASE_URL}/v1/auth/login/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: { kind: "email", value: EMAIL }, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login_failed:${response.status}`);
  return await response.json() as { accountId: string; accessToken: string };
}

function persona(id: string): Persona {
  const selected = PERSONA_MATRIX.find((item) => item.id === id);
  if (!selected) throw new Error(`persona_not_found:${id}`);
  return selected;
}

function scenarioDefinition(id: ScenarioId): { persona: Persona; messages: readonly string[]; expectedTool: string; dynamic: boolean } {
  switch (id) {
    case "strict":
      return {
        persona: persona("p01-college-male-skinny-high-will"),
        messages: [
          "我今天按计划完成了训练，75 分钟，卧推 3 组都留了 2 次余力。请记录。",
          "晚餐吃了鸡胸肉、米饭和西兰花，按计划完成。请记录饮食。",
          "请汇总我这周的训练和饮食记录。",
        ],
        expectedTool: "timeline.record_user_report",
        dynamic: false,
      };
    case "recovery":
      return {
        persona: persona("p10-fatloss-plateau-female"),
        messages: ["我今天恢复 2/5，疲劳 9/10，昨晚睡得很差。请根据这个调整后续安排并让我确认。"],
        expectedTool: "plan.adapt_from_user_report",
        dynamic: true,
      };
    case "schedule":
      return {
        persona: persona("p08-frequent-traveler"),
        messages: ["我 2026-08-14 出差，无法训练。请记录并调整之后的训练安排，让我确认。"],
        expectedTool: "plan.adapt_from_user_report",
        dynamic: true,
      };
    case "indulgence":
      {
        const base = persona("p03-female-shape-high-will");
      return {
        // 选择有明确减脂热量方向的高依从减脂用户；低意愿/柔性营养人设
        // 不应被系统强制要求以运动补偿一次聚餐。
        persona: {
          ...base,
          profile: {
            ...base.profile,
            dailyActivityLevel: "sedentary",
            schedule: { ...base.profile.schedule!, sessionDurationMinutes: 90 },
          },
          goalContract: { ...base.goalContract, aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" } },
        },
        messages: ["今天聚餐后我比当天计划多吃了大约 650 kcal。请记录并温和调整后续安排，让我确认。"],
        expectedTool: "plan.propose_energy_rebalance",
        dynamic: true,
      };
      }
  }
}

async function runScenario(id: ScenarioId, auth: { accountId: string; accessToken: string }): Promise<LiveOutcome> {
  const definition = scenarioDefinition(id);
  // Resolver credentials are account-bound.  Each scenario already owns an
  // isolated in-memory ledger, so keep the canonical account id here rather
  // than manufacturing a per-scenario user id that the cloud boundary must
  // (correctly) reject.
  const userId = auth.accountId;
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => `${CURRENT_DATE}T10:00:00.000Z`, nextId: (prefix: string) => `live:${id}:${prefix}-${++sequence}` },
    llmProviderResolver: new MaxPowerPiCoachProviderResolver({
      apiBaseUrl: BASE_URL,
      allowInsecureHttp: BASE_URL.startsWith("http://127.0.0.1"),
      accountId: auth.accountId,
      accessTokens: { accessTokenFor: () => auth.accessToken },
    }),
    knowledgeToolsEnabled: true,
    actionToolsEnabled: true,
  });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: definition.persona.profile,
    goalContract: definition.persona.goalContract,
    mandate: definition.persona.mandate,
    meta: { userId, actor: { kind: "user", id: userId }, deviceId: "live-provider-e2e", occurredAt: `${CURRENT_DATE}T10:00:00.000Z`, timezoneOffsetMinutes: 480, idempotencyKey: `live:${id}:bootstrap` },
  });
  const initial = await app.createPlanningPreview({ userId, currentDate: CURRENT_DATE, trigger: "initial_plan", idempotencyKey: `live:${id}:initial-preview` });
  const issues: string[] = [];
  let initialPlanConfirmed = false;
  if (initial.planningPreview) {
    await app.confirmPlanningPreview({ userId, previewId: initial.id, idempotencyKey: `live:${id}:initial-confirm` });
    initialPlanConfirmed = Boolean((await app.readDomainProjection({ userId })).plan);
  } else {
    issues.push("initial_plan_not_confirmable");
  }
  const session = await app.startSession({ userId, context: { kind: "today", ref: CURRENT_DATE }, title: `live lifecycle ${id}` });
  const turns: { message: string; tools: string[]; failed?: string }[] = [];
  for (const message of definition.messages) {
    let result: { message: string; tools: string[]; failed?: string } | undefined;
    const toolNames = new Set<string>();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = (await ledger.read()).toolCalls.length;
      try {
        await app.sendCoachTurn({ sessionId: session.id, text: message });
        const afterAttempt = await ledger.read();
        const tools = afterAttempt.toolCalls.slice(before).map((call) => call.toolName);
        tools.forEach((tool) => toolNames.add(tool));
        const response = [...afterAttempt.messages].reverse().find((item) => item.role === "assistant")?.content ?? "";
        if (/服务暂时不可用|service unavailable/i.test(response) && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
          continue;
        }
        result = { message, tools: [...toolNames], ...(response.includes("服务暂时不可用") ? { failed: "provider_service_unavailable_after_retry" } : {}) };
        break;
      } catch (error) {
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
          continue;
        }
        result = { message, tools: [...toolNames], failed: error instanceof Error ? error.message : String(error) };
      }
    }
    turns.push(result ?? { message, tools: [...toolNames], failed: "provider_retry_exhausted" });
  }
  const afterTurns = await app.readDomainProjection({ userId });
  const snapshot = await ledger.read();
  const planningArtifacts = snapshot.artifacts
    .filter((artifact) => artifact.kind === "evidence_brief")
    .map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      summary: artifact.summary,
      previewStatus: artifact.planningPreview?.status,
      trigger: artifact.planningPreview?.request.trigger,
      rollingEnergyStatus: artifact.planningPreview?.proposal.planRevision.rollingEnergyAdjustment?.status,
      rollingEnergyReasons: artifact.planningPreview?.proposal.planRevision.rollingEnergyAdjustment?.reasonCodes,
    }));
  const dynamicPreview = snapshot.artifacts.some(
    (artifact) => artifact.kind === "evidence_brief" && artifact.planningPreview?.status === "awaiting_confirmation" && artifact.id !== initial.id,
  );
  let dynamicConfirmed = false;
  if (definition.dynamic && dynamicPreview) {
    const preview = [...snapshot.artifacts].reverse().find(
      (artifact) => artifact.kind === "evidence_brief" && artifact.planningPreview?.status === "awaiting_confirmation" && artifact.id !== initial.id,
    );
    if (preview && preview.kind === "evidence_brief") {
      try {
        await app.confirmPlanningPreview({ userId, previewId: preview.id, idempotencyKey: `live:${id}:dynamic-confirm` });
        dynamicConfirmed = true;
      } catch (error) {
        issues.push(`dynamic_confirmation_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (!turns.some((turn) => turn.tools.includes(definition.expectedTool))) issues.push(`missing_expected_tool:${definition.expectedTool}`);
  if (definition.dynamic && !dynamicPreview) issues.push("missing_dynamic_preview");
  if (definition.dynamic && !dynamicConfirmed) issues.push("dynamic_preview_not_confirmed");
  const final = await app.readDomainProjection({ userId });
  return {
    scenario: id,
    persona: definition.persona.label,
    initialPlanConfirmed,
    turns,
    timelineFacts: afterTurns.timeline.current.map((event) => event.fact.kind),
    dynamicPreview,
    dynamicConfirmed,
    ...(final.plan ? { finalPlanRevision: final.plan.revision } : {}),
    diagnostics: {
      toolCalls: snapshot.toolCalls.map((call) => ({ toolName: call.toolName, status: call.status, artifactRef: call.artifactRef })),
      messages: snapshot.messages.map((message) => ({ role: message.role, content: message.content })),
      planningArtifacts,
      presentations: snapshot.presentations.map((presentation) => ({ artifactId: presentation.artifactId, status: presentation.status, renderer: presentation.renderer })),
    },
    issues,
  };
}

async function main() {
  const auth = await login();
  const results: LiveOutcome[] = [];
  for (const id of ["strict", "recovery", "schedule", "indulgence"] as const) {
    if (ONLY.size && !ONLY.has(id)) continue;
    results.push(await runScenario(id, auth));
  }
  console.log("REAL_PROVIDER_LIFECYCLE_E2E=" + JSON.stringify(results));
  if (REPORT_PATH) {
    await writeFile(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, results }, null, 2) + "\n", "utf8");
  }
  const failures = results.filter((result) => result.issues.length || !result.initialPlanConfirmed);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("REAL_PROVIDER_LIFECYCLE_E2E_FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
