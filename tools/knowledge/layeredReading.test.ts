import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

/** 知识分层加载（skill 模式）：检索默认只见蒸馏层，原文按需下钻。 */

function kernel() {
  let sequence = 0;
  return new LocalProductKernel({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` },
  });
}

test("检索默认返回蒸馏层：gist + 段落结论，带原文下钻 id，不含全文", () => {
  const k = kernel();
  const result = k.searchInstalledKnowledge({ query: "恢复 窗口 酸痛", topic: "recovery", limit: 3 });
  assert.equal(result.kind, "found");
  assert.ok(result.entries.length > 0);
  for (const entry of result.entries) {
    assert.ok(entry.text.length < 1_200, `蒸馏层条目应小（实际 ${entry.text.length} 字符）：${entry.title.slice(0, 30)}`);
    assert.match(entry.text, /原文段落：/);
    assert.ok(entry.passageRef.passageId.length > 0);
  }
  // 蒸馏层不带原文：命中的原文段落全文不得出现在蒸馏条目里
  const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
  for (const entry of result.entries) {
    const full = registry.readKnowledgePassage(entry.passageRef.passageId);
    if (full && full.text.length > entry.text.length) {
      assert.ok(!entry.text.includes(full.text), `蒸馏层不得携带原文全文：${entry.title.slice(0, 30)}`);
    }
  }
  // 与大段落查询对照：来源索引类长段落在蒸馏层被压到有界摘录
  const big = k.searchInstalledKnowledge({ query: "增肌 周量 频率", topic: "training", limit: 4 });
  assert.equal(big.kind, "found");
  const biggestFull = Math.max(...createInstalledKnowledgePack().programStrategies!.passages!.map((p) => p.text.length));
  const biggestDigest = Math.max(...big.entries.map((entry) => entry.text.length));
  assert.ok(biggestDigest < biggestFull / 2, `蒸馏层最大条目(${biggestDigest})应远小于最长原文(${biggestFull})`);
});

test("下钻原文：按 passageId 读取完整段落，未知 id 返回 typed unknown", () => {
  const k = kernel();
  const result = k.searchInstalledKnowledge({ query: "恢复 窗口 酸痛", topic: "recovery", limit: 1 });
  assert.equal(result.kind, "found");
  const passageId = result.entries[0]!.passageRef.passageId;
  const passage = k.readInstalledKnowledgePassage({ passageId });
  assert.equal(passage.kind, "found");
  assert.ok(passage.text!.length > 100, "原文层返回完整段落");
  assert.ok(passage.title!.length > 0);
  const missing = k.readInstalledKnowledgePassage({ passageId: "passage-nonexistent" });
  assert.equal(missing.kind, "unknown");
});
