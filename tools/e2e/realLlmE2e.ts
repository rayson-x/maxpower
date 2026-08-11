/**
 * 真实端到端：云端 LLM 在环。
 *
 * 流程：登录拿 token → MaxPowerPiCoachProviderResolver（真实云端 provider）→
 *       人设自述 → sendCoachTurn（LLM 抽取/路由）→ 生成计划 → 确认/拒绝。
 *
 * 运行前提：本地 3000 端口转发到 cloud-developer:3000
 *   ssh -N -L 3000:127.0.0.1:3000 cloud-developer
 *
 * 注意：这是真实 LLM 调用（会产生调用/可能计费），所以放在手动脚本而非 CI。
 */
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { MaxPowerPiCoachProviderResolver } from "../../src/mobile/cloud/MaxPowerPiCoachProvider";
import { PERSONA_MATRIX } from "../e2e/personaMatrix";

const BASE_URL = process.env.MAXPOWER_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.MAXPOWER_E2E_EMAIL ?? "";
const PASSWORD = process.env.MAXPOWER_E2E_PASSWORD ?? "";

interface LoginResult {
  accountId: string;
  accessToken: string;
}

async function login(): Promise<LoginResult> {
  const response = await fetch(`${BASE_URL}/v1/auth/login/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: { kind: "email", value: EMAIL }, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { accountId: string; accessToken: string };
  return { accountId: data.accountId, accessToken: data.accessToken };
}

async function main() {
  const { accountId, accessToken } = await login();
  console.log(`✓ 登录成功 accountId=${accountId}`);
  // 每次运行的唯一标记，保证 idempotency-key 不与历史请求碰撞
  const runStamp = `${Date.now().toString(36)}`;

  const tokenSource = { accessTokenFor: () => accessToken };
  const providerResolver = new MaxPowerPiCoachProviderResolver({
    apiBaseUrl: BASE_URL,
    allowInsecureHttp: true,
    accountId,
    accessTokens: tokenSource,
  });

  // 选 3 个有代表性的人设跑真实 E2E
  const personas = [
    PERSONA_MATRIX.find((p) => p.id.startsWith("p01"))!, // 瘦新手增肌
    PERSONA_MATRIX.find((p) => p.id.startsWith("p02"))!, // 胖白领减脂意愿低
    PERSONA_MATRIX.find((p) => p.id.startsWith("p03"))!, // 女性塑形强调臀肩
  ];

  for (const [index, persona] of personas.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 4000)); // 间隔防限流
    console.log(`\n${"═".repeat(50)}`);
    console.log(`人设：${persona.label}`);
    console.log(`自述：${persona.selfDescription}`);
    console.log("─".repeat(50));

    let sequence = 0;
    // id 必须跨人设唯一：runId 决定云端 idempotency-key，重复 key + 不同请求体会被服务端 409 拒绝
    const runScope = `${persona.id}-${runStamp}`;
    const ledger = new InMemoryCoachLedger();
    const app = new CoachApplication({
      ledger,
      runtime: {
        now: () => "2026-08-12T10:00:00.000Z",
        nextId: (prefix: string) => `${prefix}-${runScope}-${++sequence}`,
      },
      llmProviderResolver: providerResolver,
      knowledgeToolsEnabled: true,
      actionToolsEnabled: true,
    });

    // 写入档案
    await app.executeDomainCommand({
      type: "user.bootstrap",
      profile: persona.profile,
      goalContract: persona.goalContract,
      mandate: persona.mandate,
      meta: {
        userId: accountId, actor: { kind: "user", id: accountId }, deviceId: "e2e",
        occurredAt: "2026-08-12T10:00:00.000Z", timezoneOffsetMinutes: 0, idempotencyKey: `bootstrap-${persona.id}`,
      },
    });

    // 起会话，把自述发给真实 LLM
    const session = await app.startSession({
      userId: accountId,
      context: { kind: "today", ref: "2026-08-12" },
      title: "目标沟通",
    });

    console.log("→ 发送自述给云端 LLM …");
    try {
      const turn = await app.sendCoachTurn({
        sessionId: session.id,
        text: persona.selfDescription + "\n\n请帮我安排训练计划。",
      });
      const events = turn as readonly { type: string }[];
      const toolCalls = events.filter((e) => e.type === "tool-state");
      console.log(`✓ LLM 回合完成，事件 ${events.length} 个，工具调用 ${toolCalls.length} 个`);
      // 诊断：看 run 状态与错误事件
      const snapshot = await ledger.read();
      const lastRun = [...snapshot.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (lastRun) console.log(`  run 状态: ${lastRun.status}${lastRun.terminalCode ? ` (${lastRun.terminalCode})` : ""}`);
      const errors = events.filter((e) => e.type === "run-error");
      for (const err of errors) {
        const e = err as { code?: string; message?: string };
        console.log(`  ⚠ run-error: ${e.code} — ${e.message}`);
      }
      const textDeltas = events.filter((e) => e.type === "text-delta");
      if (textDeltas.length) {
        const text = textDeltas.map((e) => (e as { delta?: string }).delta ?? "").join("");
        console.log(`  LLM 文本: ${text.slice(0, 120)}`);
      }
      for (const e of toolCalls.slice(0, 5)) {
        const t = e as { toolName?: string; state?: string };
        console.log(`   工具: ${t.toolName} → ${t.state}`);
      }
    } catch (error) {
      console.log(`✗ LLM 回合失败: ${error instanceof Error ? error.message : error}`);
    }

    // 生成计划（引擎层，不依赖 LLM）
    const preview = await app.previewGoalCycle({
      userId: accountId,
      trigger: "initial_plan",
      currentDate: "2026-08-12",
    });
    if (preview.kind === "plan_proposal") {
      const w = preview.planRevision.materializedWeeks?.[0];
      const strength = w?.sessions.filter((s) => s.tasks.length > 0 && s.kind !== "cardio") ?? [];
      console.log(`✓ 计划生成：${strength.length} 个力量日/周`);
      console.log(`  分层说明: ${preview.planRevision.personaTieringNote?.slice(0, 60) ?? "-"}…`);
      const ng = preview.planRevision.nutritionGuidance;
      console.log(`  营养: ${ng?.calorieDirection} 蛋白${ng?.proteinGramsPerDay?.min}-${ng?.proteinGramsPerDay?.max}g`);
    } else {
      console.log(`  计划结果: ${preview.kind}`);
    }
  }
  console.log(`\n${"═".repeat(50)}\n✓ 真实 E2E 完成`);
}

main().catch((error) => {
  console.error("E2E 失败:", error instanceof Error ? error.message : error);
  process.exit(1);
});
