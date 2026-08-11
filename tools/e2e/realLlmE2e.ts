/**
 * 真实端到端：云端 LLM 在环，全人设矩阵 + 确认/拒绝双路径。
 *
 * 流程（每个人设）：
 *   登录 → 真实云端 provider → 写档案 → LLM 回合（自述）→ 引擎生成计划
 *   → 质量红线校验 → 确认写入 或 模拟拒绝（校验未落账）
 *
 * 运行前提：本地 3000 端口转发到 cloud-developer:3000
 *   ssh -N -L 3000:127.0.0.1:3000 cloud-developer
 *
 * 环境变量：
 *   MAXPOWER_E2E_EMAIL / MAXPOWER_E2E_PASSWORD  必填（除非 SKIP_LLM）
 *   MAXPOWER_E2E_PERSONAS  可选，逗号分隔 id 前缀（默认全跑）
 *   MAXPOWER_E2E_SKIP_LLM  设 1 则只跑引擎层（快速回归，不计费）
 *
 * 真实 LLM 调用会计费，所以是手动脚本而非 CI。
 */
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { MaxPowerPiCoachProviderResolver } from "../../src/mobile/cloud/MaxPowerPiCoachProvider";
import { PERSONA_MATRIX, type Persona } from "./personaMatrix";

const BASE_URL = process.env.MAXPOWER_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.MAXPOWER_E2E_EMAIL ?? "";
const PASSWORD = process.env.MAXPOWER_E2E_PASSWORD ?? "";
const SKIP_LLM = process.env.MAXPOWER_E2E_SKIP_LLM === "1";
const ONLY = (process.env.MAXPOWER_E2E_PERSONAS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const CURRENT_DATE = "2026-08-12";

async function login(): Promise<{ accountId: string; accessToken: string }> {
  const response = await fetch(`${BASE_URL}/v1/auth/login/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: { kind: "email", value: EMAIL }, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { accountId: string; accessToken: string };
}

interface Outcome {
  id: string;
  label: string;
  llm: "completed" | "failed" | "skipped";
  toolCalls: number;
  llmError?: string;
  planKind: string;
  strengthDays?: number;
  aerobicDays?: number;
  restDays?: number;
  declared?: number;
  committed?: boolean;
  rejected?: boolean;
  issues: string[];
}

async function runPersona(
  persona: Persona,
  ctx: { accountId: string; resolver?: MaxPowerPiCoachProviderResolver; stamp: string; index: number },
): Promise<Outcome> {
  const out: Outcome = { id: persona.id.slice(0, 3), label: persona.label, llm: "skipped", toolCalls: 0, planKind: "-", issues: [] };
  const scope = `${persona.id}-${ctx.stamp}`;
  let seq = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => `${CURRENT_DATE}T10:00:00.000Z`, nextId: (p: string) => `${p}-${scope}-${++seq}` },
    ...(ctx.resolver ? { llmProviderResolver: ctx.resolver } : {}),
    knowledgeToolsEnabled: true,
    actionToolsEnabled: true,
  });

  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: persona.profile,
    goalContract: persona.goalContract,
    mandate: persona.mandate,
    meta: {
      userId: ctx.accountId, actor: { kind: "user", id: ctx.accountId }, deviceId: "e2e",
      occurredAt: `${CURRENT_DATE}T10:00:00.000Z`, timezoneOffsetMinutes: 0, idempotencyKey: `boot-${scope}`,
    },
  });

  if (ctx.resolver) {
    const session = await app.startSession({ userId: ctx.accountId, context: { kind: "today", ref: CURRENT_DATE }, title: "目标沟通" });
    try {
      const events = await app.sendCoachTurn({ sessionId: session.id, text: `${persona.selfDescription}\n\n请帮我安排训练计划。` });
      const list = events as readonly { type: string; state?: string; message?: string }[];
      out.toolCalls = list.filter((e) => e.type === "tool-state" && e.state === "output-available").length;
      const snap = await ledger.read();
      const run = [...snap.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      out.llm = run?.status === "completed" ? "completed" : "failed";
      if (out.llm === "failed") out.llmError = list.find((e) => e.type === "run-error")?.message ?? run?.terminalCode ?? "unknown";
    } catch (error) {
      out.llm = "failed";
      out.llmError = error instanceof Error ? error.message : String(error);
    }
  }

  const preview = await app.previewGoalCycle({ userId: ctx.accountId, trigger: "initial_plan", currentDate: CURRENT_DATE });
  out.planKind = preview.kind;
  if (preview.kind !== "plan_proposal") return out; // 安全边界拒绝是正确行为

  const seven = preview.planRevision.upcomingSevenDays ?? [];
  out.strengthDays = seven.filter((s) => s.tasks.length > 0 && s.kind !== "cardio").length;
  out.aerobicDays = seven.filter((s) => s.kind === "cardio").length;
  out.restDays = seven.filter((s) => s.tasks.length === 0).length;
  out.declared = persona.profile.schedule?.weeklyFrequency;

  if (seven.length !== 7) out.issues.push(`窗口${seven.length}天`);
  if (out.declared !== undefined && out.strengthDays !== out.declared) out.issues.push(`力量${out.strengthDays}≠声明${out.declared}`);
  if (out.restDays === 0) out.issues.push("零休息日");
  const ng = preview.planRevision.nutritionGuidance;
  if (persona.profile.demographics?.currentWeight && !ng?.proteinGramsPerDay) out.issues.push("无蛋白克数");
  // 动作数下限按可用时长分档：20 分钟做 2 个动作是合理的，75 分钟只有 2 个才是问题
  const minutes = persona.profile.schedule?.sessionDurationMinutes ?? 60;
  const minTasks = minutes <= 25 ? 2 : minutes <= 45 ? 3 : 4;
  for (const s of seven.filter((x) => x.tasks.length > 0 && x.kind !== "cardio")) {
    if (s.tasks.length < minTasks) {
      out.issues.push(`${s.scheduledFor.slice(5)}仅${s.tasks.length}动作(${minutes}min应≥${minTasks})`);
      break;
    }
  }

  // 确认 / 拒绝双路径（每 3 个人设有 1 个走拒绝路径）
  const reject = ctx.index % 3 === 2;
  try {
    const artifact = await app.createPlanningPreview({
      userId: ctx.accountId, trigger: "initial_plan", currentDate: CURRENT_DATE, idempotencyKey: `prev-${scope}`,
    });
    if (reject) {
      const projection = await app.readDomainProjection({ userId: ctx.accountId });
      out.rejected = true;
      if (projection.plan) out.issues.push("未确认却已落账");
    } else {
      await app.confirmPlanningPreview({ userId: ctx.accountId, previewId: artifact.id, idempotencyKey: `conf-${scope}` });
      const projection = await app.readDomainProjection({ userId: ctx.accountId });
      out.committed = Boolean(projection.plan);
      if (!out.committed) out.issues.push("确认后未落账");
    }
  } catch (error) {
    out.issues.push(`确认流程: ${error instanceof Error ? error.message.slice(0, 40) : error}`);
  }
  return out;
}

async function main() {
  const personas = PERSONA_MATRIX.filter((p) => !ONLY.length || ONLY.some((x) => p.id.startsWith(x)));
  console.log(`人设 ${personas.length} 个${SKIP_LLM ? "（跳过 LLM）" : "（真实 LLM 在环）"}\n`);

  let resolver: MaxPowerPiCoachProviderResolver | undefined;
  let accountId = "e2e-user";
  if (!SKIP_LLM) {
    const auth = await login();
    accountId = auth.accountId;
    console.log(`✓ 登录 ${accountId}\n`);
    resolver = new MaxPowerPiCoachProviderResolver({
      apiBaseUrl: BASE_URL, allowInsecureHttp: true, accountId,
      accessTokens: { accessTokenFor: () => auth.accessToken },
    });
  }

  const stamp = Date.now().toString(36);
  const outcomes: Outcome[] = [];
  for (const [index, persona] of personas.entries()) {
    if (!SKIP_LLM && index > 0) await new Promise((r) => setTimeout(r, 1200));
    const out = await runPersona(persona, { accountId, resolver, stamp, index });
    outcomes.push(out);
    const llm = out.llm === "completed" ? `LLM✓${out.toolCalls}工具` : out.llm === "failed" ? "LLM✗" : "LLM–";
    const plan = out.planKind === "plan_proposal"
      ? `力量${out.strengthDays}/${out.declared} 有氧${out.aerobicDays} 休${out.restDays}`
      : out.planKind;
    const path = out.committed ? "已落账" : out.rejected ? "拒绝态" : "";
    console.log(`${out.id} ${out.label.slice(0, 20).padEnd(22)} ${llm.padEnd(12)} ${plan.padEnd(28)} ${path}${out.issues.length ? " ⚠ " + out.issues.join("; ") : ""}`);
  }

  console.log(`\n${"═".repeat(58)}`);
  const llmFail = outcomes.filter((o) => o.llm === "failed");
  const refusals = outcomes.filter((o) => o.planKind !== "plan_proposal" && o.planKind !== "-");
  const issues = outcomes.filter((o) => o.issues.length > 0);
  console.log(`LLM：${outcomes.filter((o) => o.llm === "completed").length} 成功 / ${llmFail.length} 失败`);
  console.log(`计划：${outcomes.filter((o) => o.planKind === "plan_proposal").length} 提案 / ${refusals.length} 非提案`);
  console.log(`路径：${outcomes.filter((o) => o.committed).length} 确认落账 · ${outcomes.filter((o) => o.rejected).length} 拒绝未落账`);
  console.log(`质量问题：${issues.length} 个人设`);
  if (llmFail.length) { console.log(`\nLLM 失败：`); for (const o of llmFail) console.log(`  ${o.id} ${o.llmError?.slice(0, 80)}`); }
  if (refusals.length) { console.log(`\n非提案（应为安全边界）：`); for (const o of refusals) console.log(`  ${o.id} ${o.label.slice(0, 24)} → ${o.planKind}`); }
  if (issues.length) { console.log(`\n质量问题：`); for (const o of issues) console.log(`  ${o.id} ${o.label.slice(0, 22)}: ${o.issues.join("; ")}`); }
  console.log(`\n${issues.length === 0 && llmFail.length === 0 ? "✓ 全部通过" : "见上方明细"}`);
}

main().catch((error) => {
  console.error("E2E 失败:", error instanceof Error ? error.message : error);
  process.exit(1);
});
