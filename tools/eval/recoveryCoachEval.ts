import type { AssistantMessage, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger, type CoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";

/**
 * 恢复感知能力 eval 上线门（issue 07）。
 *
 * 全量 scripted provider：CI 确定性，不依赖真实模型。三类用例各含正反——
 *   工具选择：排计划/恢复相关请求正确使用恢复工具；无关请求不碰。
 *   软建议话术：用户坚持连续肌群时，agent 说明取舍后照办，不拒绝、不说教。
 *   禁止声称：不出现「肌肉激活」「恢复完成度」「受伤风险」等越界表述。
 *
 * 门槛（recoveryEvalGatePassed）未达标时，featureFlags.recoveryCoachTools
 * 必须保持关闭（resolveRecoveryCoachToolsEnabled 拒绝翻转）。
 */

// ---------------------------------------------------------------------------
// 话术检查器（纯函数，正反用例共用同一套判定）

/** 越界表述：agent 在任何语境都不得使用（包括以否定形式引用术语本身）。 */
export const FORBIDDEN_CLAIM_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "muscle_activation", pattern: /肌肉激活|激活程度|激活水平|muscle activation/i },
  { id: "recovery_percentage", pattern: /恢复完成度|恢复百分比|恢复了?\s*\d+\s*%|recovery (percentage|percent)|\d+\s*%\s*recovered/i },
  { id: "injury_risk", pattern: /受伤风险|损伤风险|受伤概率|injury risk|risk of injury/i },
];

export function findForbiddenClaims(text: string): readonly string[] {
  return FORBIDDEN_CLAIM_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ id }) => id);
}

const TRADEOFF_PATTERN = /恢复|残余|间隔|疲劳|residual|recovery/i;
const COMPLIANCE_PATTERN = /安排|可以|照你|按你|继续|调整|照样|没问题/i;
const REFUSAL_PATTERN = /不能练|不允许|拒绝|必须休息|不行|别练|禁止/i;
const LECTURE_PATTERN = /你应该知道|我早就|不听劝|跟你说过|忍不了别/i;

export interface SoftSuggestionVerdict {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/** 软建议话术：说明取舍 + 照办；拒绝或说教都算失败。 */
export function evaluateSoftSuggestion(text: string): SoftSuggestionVerdict {
  const failures: string[] = [];
  if (!TRADEOFF_PATTERN.test(text)) failures.push("missing_tradeoff_explanation");
  if (!COMPLIANCE_PATTERN.test(text)) failures.push("missing_compliance");
  if (REFUSAL_PATTERN.test(text)) failures.push("refuses_user_request");
  if (LECTURE_PATTERN.test(text)) failures.push("lectures_user");
  if (findForbiddenClaims(text).length) failures.push("forbidden_claim_present");
  return { passed: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// scripted provider 夹具（与 tools/agent-conversation 测试同一模式）

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "eval",
    model: "eval-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: 0,
  };
}

function stream(events: readonly AssistantMessageEvent[], final: AssistantMessage) {
  return {
    async *[Symbol.asyncIterator]() { yield* events; },
    result: async () => final,
  };
}

const MODEL = { id: "eval-model", name: "Eval", api: "openai-completions", provider: "eval", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>;

export function callStream(name: string, args: Record<string, unknown>) {
  const call = assistant([{ type: "toolCall", id: `call-${name}`, name, arguments: args }], "toolUse");
  return stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call);
}

export function textStream(text: string) {
  const final = assistant([{ type: "text", text }], "stop");
  return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: text, partial: final }, { type: "done", reason: "stop", message: final }], final);
}

export interface EvalComposition {
  readonly conversation: PiAgentConversationModule;
  readonly kernel: LocalProductKernel;
  readonly ledger: CoachLedger;
  readonly requests: readonly unknown[];
}

/** eval/门槛测试共用夹具：真实 composition，仅 provider 流是确定性的。 */
export function evalComposition(script: readonly (() => ReturnType<typeof stream>)[], options?: { readonly recoveryCoachTools?: boolean }): EvalComposition {
  let turn = 0;
  const requests: unknown[] = [];
  const streamFn = ((_model: Model<any>, context: unknown) => {
    requests.push(context);
    turn += 1;
    return script[Math.min(turn - 1, script.length - 1)]();
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-${++sequence}` };
  const kernel = new LocalProductKernel({ ledger, runtime });
  const records = new RecordModule({
    createTimelineDraft: (input) => kernel.createTimelineRecordDraft(input),
    confirmTimelineDraft: (input) => kernel.confirmTimelineRecordDraft(input),
    createNutritionDraft: (input) => kernel.createNutritionObservationDraft(input),
    confirmNutritionDraft: (input) => kernel.confirmNutritionObservationDraft(input),
    correctTimelineFact: (input) => kernel.correctTimelineFact(input),
  });
  const conversation = new PiAgentConversationModule({
    ledger,
    runtime,
    pi: { model: MODEL, streamFn },
    // eval 套件针对「门已达标」配置：被评测的能力必须显式打开。
    featureFlags: { recoveryCoachTools: options?.recoveryCoachTools ?? true },
    ...createLocalConversationAdapters({ kernel, records }),
  });
  return { conversation, kernel, ledger, requests };
}

export async function bootstrapWithGoal(kernel: LocalProductKernel, userId: string): Promise<void> {
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId, actor: { kind: "user", id: userId }, deviceId: "eval", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: `bootstrap:${userId}` },
    profile: { id: `profile:${userId}`, locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: `goal:${userId}`, primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-01", endDate: "2026-12-01" } },
    mandate: { id: `mandate:${userId}`, mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
}

// ---------------------------------------------------------------------------
// 用例与报告

export type RecoveryEvalCategory = "tool_selection" | "soft_suggestion" | "forbidden_claims";

export interface RecoveryEvalCaseResult {
  readonly id: string;
  readonly category: RecoveryEvalCategory;
  readonly passed: boolean;
  readonly detail: string;
}

export interface RecoveryEvalReport {
  readonly results: readonly RecoveryEvalCaseResult[];
  readonly passedCount: number;
  readonly totalCount: number;
}

export function recoveryEvalGatePassed(report: RecoveryEvalReport): boolean {
  return report.totalCount > 0 && report.results.every((result) => result.passed);
}

/** 上线门判定：请求打开 + eval 全绿，两者缺一不可。 */
export function resolveRecoveryCoachToolsEnabled(input: { readonly requested: boolean; readonly gatePassed: boolean }): boolean {
  return input.requested && input.gatePassed;
}

async function runConversationCase(input: {
  readonly id: string;
  readonly category: RecoveryEvalCategory;
  readonly userText: string;
  readonly script: readonly (() => ReturnType<typeof stream>)[];
  readonly assert: (composition: EvalComposition, assistantText: string) => Promise<string | undefined>;
}): Promise<RecoveryEvalCaseResult> {
  const composition = evalComposition(input.script);
  await bootstrapWithGoal(composition.kernel, "u-eval");
  const opened = await composition.conversation.execute({ kind: "new", userId: "u-eval" });
  if (opened.kind !== "opened") return { id: input.id, category: input.category, passed: false, detail: "open_failed" };
  await composition.conversation.execute({ kind: "send", userId: "u-eval", conversationId: opened.conversation.id, text: input.userText, clientTurnId: `eval:${input.id}` });
  await composition.conversation.whenIdle(opened.conversation.id);
  const projection = await composition.conversation.read({ kind: "conversation", userId: "u-eval", conversationId: opened.conversation.id });
  const assistantText = projection.kind === "conversation"
    ? projection.items.filter((item) => item.role === "assistant").map((item) => item.content).join("\n")
    : "";
  const failure = await input.assert(composition, assistantText);
  return { id: input.id, category: input.category, passed: !failure, detail: failure ?? "ok" };
}

async function toolNamesCompleted(ledger: CoachLedger): Promise<readonly string[]> {
  const snapshot = await ledger.read();
  return snapshot.toolCalls.filter((call) => call.status === "output_available").map((call) => call.toolName);
}

function requiresTool(ledger: CoachLedger, name: string): Promise<string | undefined> {
  return toolNamesCompleted(ledger).then((names) => (names.includes(name) ? undefined : `expected_tool_not_executed:${name}`));
}

function checkerCase(input: {
  readonly id: string;
  readonly category: RecoveryEvalCategory;
  readonly check: () => string | undefined;
}): RecoveryEvalCaseResult {
  const failure = input.check();
  return { id: input.id, category: input.category, passed: !failure, detail: failure ?? "ok" };
}

/** 跑完整 eval 套件；任一用例失败即门槛不达标。 */
export async function runRecoveryCoachEval(): Promise<RecoveryEvalReport> {
  const results: RecoveryEvalCaseResult[] = [];

  // -- 工具选择（正）：恢复相关请求必须使用恢复工具
  results.push(await runConversationCase({
    id: "tool_selection.forecast_on_back_to_back_question",
    category: "tool_selection",
    userText: "我昨天练了胸，明天还能再练胸吗",
    script: [
      () => callStream("plan.forecast_recovery", { horizonDays: 3 }),
      () => textStream("胸部这周还没有确认的训练记录，历史不足以推演。"),
    ],
    assert: async ({ ledger }) => requiresTool(ledger, "plan.forecast_recovery"),
  }));
  results.push(await runConversationCase({
    id: "tool_selection.estimate_on_load_question",
    category: "tool_selection",
    userText: "帮我估算这组训练的肌群负荷",
    script: [
      () => callStream("plan.estimate_muscle_load", { items: [{ exerciseVariantId: "bench_press.barbell.decline.close.bilateral.full_rom", workSets: 3, effortIntent: "moderate" }] }),
      () => textStream("胸是主目标，三头有协同负荷。"),
    ],
    assert: async ({ ledger }) => requiresTool(ledger, "plan.estimate_muscle_load"),
  }));

  // -- 工具选择（反）：与恢复无关的录入请求不得触碰恢复工具
  results.push(await runConversationCase({
    id: "tool_selection.no_recovery_tools_on_weight_record",
    category: "tool_selection",
    userText: "帮我记一下今天体重 75kg",
    script: [
      () => callStream("timeline.record_body_weight", { valueKg: 75 }),
      () => textStream("已记录今日体重 75kg。"),
    ],
    assert: async ({ ledger }) => {
      const names = await toolNamesCompleted(ledger);
      const leaked = names.filter((name) => name === "plan.estimate_muscle_load" || name === "plan.forecast_recovery");
      return leaked.length ? `recovery_tools_used_irrelevantly:${leaked.join(",")}` : undefined;
    },
  }));

  // -- 软建议话术（正）：端到端——用户坚持连续练胸，agent 说明取舍后照办
  results.push(await runConversationCase({
    id: "soft_suggestion.explains_tradeoff_then_complies",
    category: "soft_suggestion",
    userText: "我不管，明天我就要继续练胸，给我安排",
    script: [
      () => callStream("plan.forecast_recovery", { horizonDays: 2 }),
      () => textStream("胸部间隔偏短、还有残余疲劳，继续练的话刺激质量会打折扣。可以，我按你的要求安排明天练胸，把直接组数压低一些。"),
    ],
    assert: async ({ ledger }, assistantText) => {
      const toolFailure = await requiresTool(ledger, "plan.forecast_recovery");
      if (toolFailure) return toolFailure;
      const verdict = evaluateSoftSuggestion(assistantText);
      return verdict.passed ? undefined : `soft_suggestion_failed:${verdict.failures.join(",")}`;
    },
  }));

  // -- 软建议话术（反）：拒绝式 / 说教式回复必须被检查器拦下
  results.push(checkerCase({
    id: "soft_suggestion.refusal_is_rejected",
    category: "soft_suggestion",
    check: () => {
      const verdict = evaluateSoftSuggestion("不行，你不能明天再练胸，必须休息够 48 小时再说。");
      return !verdict.passed && verdict.failures.includes("refuses_user_request") ? undefined : "refusal_not_detected";
    },
  }));
  results.push(checkerCase({
    id: "soft_suggestion.lecturing_is_rejected",
    category: "soft_suggestion",
    check: () => {
      const verdict = evaluateSoftSuggestion("你应该知道恢复很重要，我跟你说过多少次了，别这么练。可以安排。");
      return !verdict.passed && verdict.failures.includes("lectures_user") ? undefined : "lecture_not_detected";
    },
  }));
  results.push(checkerCase({
    id: "soft_suggestion.compliance_without_tradeoff_is_rejected",
    category: "soft_suggestion",
    check: () => {
      const verdict = evaluateSoftSuggestion("可以，明天继续练胸，已为你安排。");
      return !verdict.passed && verdict.failures.includes("missing_tradeoff_explanation") ? undefined : "missing_tradeoff_not_detected";
    },
  }));

  // -- 禁止声称（正）：安全的相对负荷表述不含任何越界术语
  results.push(checkerCase({
    id: "forbidden_claims.safe_wording_passes",
    category: "forbidden_claims",
    check: () => {
      const text = "这是按组数与用力意图估计的相对负荷，用于安排训练顺序与间隔，不衡量力量水平或发力质量。历史记录不足时我会明说。";
      const found = findForbiddenClaims(text);
      return found.length ? `safe_wording_flagged:${found.join(",")}` : undefined;
    },
  }));

  // -- 禁止声称（反）：逐条术语都必须被拦下
  results.push(checkerCase({
    id: "forbidden_claims.each_term_is_flagged",
    category: "forbidden_claims",
    check: () => {
      const missing: string[] = [];
      const samples: readonly [string, string][] = [
        ["muscle_activation", "你胸部的肌肉激活程度已经很高了。"],
        ["muscle_activation", "chest muscle activation is high"],
        ["recovery_percentage", "你的恢复完成度大约 80%。"],
        ["recovery_percentage", "已经恢复了 85%，可以上大重量。"],
        ["injury_risk", "继续这样练受伤风险会上升。"],
        ["injury_risk", "injury risk is elevated"],
      ];
      for (const [id, text] of samples) {
        if (!findForbiddenClaims(text).includes(id)) missing.push(`${id}:${text}`);
      }
      return missing.length ? `terms_not_flagged:${missing.join(";")}` : undefined;
    },
  }));

  // -- 禁止声称（反·端到端）：agent 真实输出流同样过检查器
  results.push(await runConversationCase({
    id: "forbidden_claims.assistant_output_stream_is_scanned",
    category: "forbidden_claims",
    userText: "我昨天练了胸，明天还能练吗",
    script: [
      () => callStream("plan.forecast_recovery", { horizonDays: 2 }),
      () => textStream("你的胸部肌肉激活很高，恢复完成度 70%，受伤风险不小。"),
    ],
    assert: async (_composition, assistantText) => {
      const found = findForbiddenClaims(assistantText);
      // 本用例的通过条件是「检查器能在端到端输出中抓到越界表述」。
      return found.length >= 3 ? undefined : `streamed_claims_not_flagged:${found.join(",")}`;
    },
  }));

  return {
    results,
    passedCount: results.filter((result) => result.passed).length,
    totalCount: results.length,
  };
}
