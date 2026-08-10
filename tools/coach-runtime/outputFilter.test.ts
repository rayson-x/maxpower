import assert from "node:assert/strict";
import test from "node:test";

import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { filterCoachOutput } from "../../src/coach/outputFilter";
import { createInstalledKnowledgePack } from "../../src/knowledge/installedPack";

const NOW = "2026-08-08T08:00:00.000Z";
const rules = createInstalledKnowledgePack().safetyLexicon?.forbiddenClaims ?? [];

test("安全词表随知识包提供且非空", () => {
  assert.ok(rules.length >= 10);
  assert.ok(createInstalledKnowledgePack().safetyLexicon?.domainAnchors.length);
});

test("每条禁止声称规则都能拦截对应文本并替换为安全文案", () => {
  for (const rule of rules) {
    const text = `好的，${rule.patterns.join("，")}，照做就行。`;
    const result = filterCoachOutput(text, rules);
    assert.equal(result.intercepted, true, `规则 ${rule.id} 应拦截`);
    assert.equal(result.text, rule.replacement);
    assert.ok(result.matchedRuleIds.includes(rule.id));
  }
});

test("正常训练表述与近义日常用语不拦截（误伤用例）", () => {
  const benign = [
    "今天做 3 组 8 次卧推，最后留 2 次余量",
    "燃烧脂肪的长期结果是能量平衡驱动的",
    "昨晚睡得不好，今天注意休息",
    "你的恢复分偏低，我们先做个热身检查再决定",
    "酸痛只是参考信号之一",
  ];
  for (const text of benign) {
    assert.equal(filterCoachOutput(text, rules).intercepted, false, `不应拦截：${text}`);
  }
});

test("端到端：provider 输出违禁文本时落账的是安全文案且拦截落审计", async () => {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const provider = new ScriptedLLMProvider([
    { type: "text-delta", delta: "听我的，高次数更燃脂，减脂期全部改成高次数。" },
    { type: "completed" },
  ]);
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => NOW,
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
    llmProvider: provider,
  });
  await app.seedUserState({
    userId: "user-1",
    profile: { goal: "fat_loss", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "减脂保肌",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "8", loadKg: 60, targetRir: 2 }],
    },
  });
  const session = await app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
    title: "今天安排",
  });
  await app.sendCoachTurn({ sessionId: session.id, text: "减脂期要不要全改高次数？" });

  const snapshot = await ledger.read();
  const assistant = snapshot.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  assert.ok(!assistant.content.includes("高次数更燃脂"));
  assert.ok(assistant.content.includes("燃脂"));
  const interception = snapshot.toolAudit.find(
    (record) => record.phase === "policy_decision" && record.outcome === "rejected",
  );
  assert.ok(interception, "应有 policy_decision/rejected 审计记录");
  assert.match(String(interception.metadata.matchedRuleIds), /high-rep-fat-loss/);
});
