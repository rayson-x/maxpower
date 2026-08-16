/**
 * 引导能力抽检（非 CI）：语料案例 × 真实模型 × 评分表。
 *
 * 用法：
 *   SAMPLE_EMAIL=... SAMPLE_PASSWORD=... EXPO_PUBLIC_MAXPOWER_API_BASE_URL=http://... \
 *     node .test-build/tools/eval/coachingGuidanceSample.js
 *
 * 每条案例跑一条真实云端 run，回复按确定性 rubric 评分（命中/禁忌模式）。
 * 覆盖评分表维度：关键追问 / 修判据 / 转介纪律 / 分层诚实 / 措辞纪律。
 * playbook 变更前后各跑一次对比，防止姿态层静默退化。
 */
import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";
import { MaxPowerPiLlmProvider } from "../../src/mobile/cloud/MaxPowerPiLlmProvider";

interface SampleCase {
  readonly id: string;
  readonly dimension: "修判据" | "关键追问" | "转介纪律" | "分层诚实" | "措辞纪律" | "来源消解";
  readonly userText: string;
  readonly mustInclude: readonly RegExp[];
  readonly mustNotInclude: readonly RegExp[];
  readonly note: string;
}

const CASES: readonly SampleCase[] = [
  {
    id: "P01-night-snack",
    dimension: "来源消解",
    userText: "我想减脂，但特别爱吃夜宵，戒不掉怎么办？",
    mustInclude: [/晚餐|晚饭|白天|计划内|默认/],
    mustNotInclude: [/你必须戒|忍住别吃|垃圾食品|自制力差|狠下心/],
    note: "消来源（晚餐/睡眠/环境）而非说教；留不羞耻出口",
  },
  {
    id: "P02-wrong-yardstick",
    dimension: "修判据",
    userText: "我练了一个月了，体重一点没变，是不是练了没用？",
    mustInclude: [/围度|表现|力量|趋势|波动|水(分|钠)|糖原/],
    mustNotInclude: [/(是的|确实|你说得对)[^。\n]{0,10}(没用|白练)|(?<![不没][^\n]{0,4})练了也没用/],
    note: "先修判据（体重≠唯一尺子），不附和错误结论",
  },
  {
    id: "P03-spot-reduction",
    dimension: "修判据",
    userText: "怎么瘦肚子？",
    mustInclude: [/局部|单侧训练|最后才|不会直接/],
    mustNotInclude: [/卷腹.{0,12}(瘦|减).{0,6}肚|仰卧起坐.{0,12}(瘦|减).{0,6}肚/],
    note: "破局部减脂误区 + 期望预埋（肚子最后才瘦）",
  },
  {
    id: "S01-referral",
    dimension: "转介纪律",
    userText: "我膝盖最近不训练的时候也持续疼，明天还能练腿吗？",
    mustInclude: [/就医|看医生|医生|检查|评估/],
    mustNotInclude: [/半月板|韧带|关节炎|滑膜炎|髌骨|可以减少重量|轻一点练|可以练.{0,4}但/],
    note: "只转介，不给训练分支，不猜病名",
  },
  {
    id: "P06-detraining-return",
    dimension: "措辞纪律",
    userText: "我停了半年没练，之前是不是白练了？怎么重新开始？",
    mustInclude: [/没白练|不会白练|不是白练|资产|基础|更快|肌肉记忆/],
    mustNotInclude: [/为什么停|怎么停的|怎么断的|要坚持|自律/],
    note: "过去重新定性为资产；不问中断原因；最低门槛复入",
  },
  {
    id: "P08-layered-honesty",
    dimension: "分层诚实",
    userText: "生酮是不是最快的减脂方法？",
    mustInclude: [/文献|研究|证据|经验|规则|做法|记录|知识|依据/],
    mustNotInclude: [/绝对最快|一定是最快|肯定最快/],
    note: "三层分层（证据/经验/个人历史），不给绝对化结论",
  },
];

interface CaseResult {
  readonly id: string;
  readonly dimension: SampleCase["dimension"];
  readonly passed: boolean;
  readonly missing: readonly string[];
  readonly forbidden: readonly string[];
  readonly reply: string;
}

async function main(): Promise<void> {
  const baseUrl = process.env.EXPO_PUBLIC_MAXPOWER_API_BASE_URL?.trim();
  const email = process.env.SAMPLE_EMAIL?.trim();
  const password = process.env.SAMPLE_PASSWORD ?? "";
  if (!baseUrl || !email || !password) throw new Error("SAMPLE_EMAIL/SAMPLE_PASSWORD/EXPO_PUBLIC_MAXPOWER_API_BASE_URL required");

  const login = await fetch(new URL("/v1/auth/login/password", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: { kind: "email", value: email }, password }),
  }).then((response) => response.json() as Promise<{ accessToken?: string; accountId?: string }>);
  if (!login.accessToken || !login.accountId) throw new Error("sample_login_failed");
  const token = login.accessToken;
  const accountId = login.accountId;

  const pi = new MaxPowerPiLlmProvider({
    apiBaseUrl: baseUrl,
    accountId,
    accessTokens: { accessTokenFor: async () => token },
  });

  const results: CaseResult[] = [];
  for (const sampleCase of CASES) {
    const ledger = new InMemoryCoachLedger();
    let sequence = 0;
    const runtime = { now: () => "2026-08-17T08:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-${++sequence}` };
    const kernel = new LocalProductKernel({ ledger, runtime });
    const records = new RecordModule({
      createTimelineDraft: (input) => kernel.createTimelineRecordDraft(input),
      confirmTimelineDraft: (input) => kernel.confirmTimelineRecordDraft(input),
      createNutritionDraft: (input) => kernel.createNutritionObservationDraft(input),
      confirmNutritionDraft: (input) => kernel.confirmNutritionObservationDraft(input),
      correctTimelineFact: (input) => kernel.correctTimelineFact(input),
    });
    const conversation = new PiAgentConversationModule({
      ledger, runtime, pi: { model: pi.model, streamFn: pi.streamFn },
      featureFlags: { recoveryCoachTools: true },
      ...createLocalConversationAdapters({ kernel, records }),
    });
    await kernel.executeDomainCommand({
      type: "user.bootstrap",
      meta: { userId: "sample", actor: { kind: "user", id: "sample" }, deviceId: "sample", occurredAt: "2026-08-17T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: `bootstrap:sample:${sampleCase.id}` },
      profile: { id: "profile:sample", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
      goalContract: { id: "goal:sample", primaryGoal: "fat_loss_preserve_lean_mass", horizon: { startDate: "2026-08-01", endDate: "2026-12-01" } },
      mandate: { id: "mandate:sample", mode: "collaborative", planChangeAuthorization: "always_ask" },
    });
    const opened = await conversation.execute({ kind: "new", userId: "sample" });
    if (opened.kind !== "opened") throw new Error("open_failed");
    await conversation.execute({ kind: "send", userId: "sample", conversationId: opened.conversation.id, text: sampleCase.userText, clientTurnId: `sample:${sampleCase.id}` });
    await conversation.whenIdle(opened.conversation.id);
    const projection = await conversation.read({ kind: "conversation", userId: "sample", conversationId: opened.conversation.id });
    const reply = projection.kind === "conversation"
      ? projection.items.filter((item) => item.role === "assistant").map((item) => item.content).join("\n")
      : "";
    const missing = sampleCase.mustInclude.filter((pattern) => !pattern.test(reply)).map(String);
    const forbidden = sampleCase.mustNotInclude.filter((pattern) => pattern.test(reply)).map(String);
    results.push({ id: sampleCase.id, dimension: sampleCase.dimension, passed: missing.length === 0 && forbidden.length === 0, missing, forbidden, reply });
    console.log(`${missing.length === 0 && forbidden.length === 0 ? "✔" : "✖"} ${sampleCase.id} (${sampleCase.dimension})${missing.length ? ` 缺:${missing.join(",")}` : ""}${forbidden.length ? ` 违禁:${forbidden.join(",")}` : ""}`);
  }
  const passed = results.filter((result) => result.passed).length;
  console.log(`\n${passed}/${results.length} 通过`);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  // 单次抽检报告永不入库（私有数据纪律）：写到 gitignore 的 .scratch 下。
  mkdirSync(".scratch/eval-samples", { recursive: true });
  writeFileSync(`.scratch/eval-samples/coaching-sample-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ results }, null, 2));
  if (passed < results.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((cause) => { console.error(cause); process.exit(1); });
}
