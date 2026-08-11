import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";

/**
 * 客户端 agent 知识库验收。
 *
 * 这是 agent **回答与解释**用的知识库，与引擎消费的规则包是两条线。
 * 核心不变量：
 * ① 只返回知识包内已审核的原文段落（离线、随包发）
 * ② 查不到返回 typed missing —— agent 必须明说不知道，不得用先验补答
 * ③ 确定性：同查询同包 → 同结果（可回放）
 * ④ 每条结果可追溯到来源文档与小节，带证据等级与文献引用
 */

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());

test("知识库随包发到客户端：段落非空、可追溯、带证据等级", () => {
  const passages = registry.programStrategies()?.passages;
  assert.ok(passages?.length && passages.length >= 100, `段落数应 ≥100，实际 ${passages?.length ?? 0}`);
  for (const passage of passages) {
    assert.ok(passage.sourcePath.startsWith("docs/"), "必须可追溯到源文档");
    assert.ok(passage.docTitle.length > 0);
    assert.ok(passage.text.length >= 80, "过短的碎片不应入库");
    assert.ok(passage.contentHash.length > 0, "需要内容哈希用于审计与增量更新");
    assert.ok(["A", "B", "C", "D", "U"].includes(passage.tier));
  }
  // 覆盖到多个知识域
  const docs = new Set(passages.map((passage) => passage.docTitle));
  assert.ok(docs.size >= 5, `应覆盖多个知识域，实际 ${[...docs].join("/")}`);
  // 必须有一手证据段落
  assert.ok(passages.filter((passage) => passage.tier === "A").length >= 20, "应有足量一手证据段落");
});

test("② 查不到返回 typed missing，不编造", () => {
  const offTopic = registry.searchKnowledge({ query: "量子力学的波函数坍缩" });
  assert.deepEqual(offTopic.hits, []);
  assert.equal(offTopic.missing, "no_passage_matched");

  const empty = registry.searchKnowledge({ query: "减脂", sourcePathPrefix: "docs/does-not-exist" });
  assert.deepEqual(empty.hits, []);
  assert.ok(empty.missing);
});

test("③ 确定性：同一查询重复检索结果完全一致", () => {
  const first = registry.searchKnowledge({ query: "空腹有氧是不是更能减脂", limit: 4 });
  const second = registry.searchKnowledge({ query: "空腹有氧是不是更能减脂", limit: 4 });
  assert.deepEqual(
    first.hits.map((hit) => [hit.passage.id, hit.score]),
    second.hits.map((hit) => [hit.passage.id, hit.score]),
  );
});

test("中文查询能切出具体术语，不被泛化词淹没", () => {
  // 「点减脂」必须切出来（若只剩「减脂」会召回一堆泛化段落）
  const spot = registry.searchKnowledge({ query: "点减脂有用吗", limit: 3 });
  assert.ok(spot.queryTerms.includes("点减脂"), `应切出「点减脂」，实际：${spot.queryTerms.join("/")}`);
  assert.ok(
    spot.hits[0]?.passage.sectionPath.some((section) => section.includes("点减脂")),
    `首条应命中点减脂小节，实际：${spot.hits[0]?.passage.sectionPath.join(" › ")}`,
  );

  const fasted = registry.searchKnowledge({ query: "空腹有氧是不是更能减脂", limit: 3 });
  assert.ok(fasted.queryTerms.includes("空腹有氧"));
  assert.ok(fasted.hits.length > 0);
});

test("口语说法经同义词映射接到语料用词", () => {
  const bulky = registry.searchKnowledge({ query: "女生练重了会不会变金刚芭比", limit: 3 });
  assert.ok(bulky.hits.length > 0, "口语提问也要能检索到");
  assert.ok(
    bulky.hits.some((hit) => hit.passage.sectionPath.some((section) => section.includes("负荷"))),
    `应召回负荷范围相关内容，实际：${bulky.hits.map((hit) => hit.passage.sectionPath.slice(-1)[0]).join(" | ")}`,
  );

  const stall = registry.searchKnowledge({ query: "掉秤停了怎么办", limit: 3 });
  assert.ok(
    stall.hits.some((hit) => hit.passage.sectionPath.some((section) => /代谢适应|平台/.test(section))),
    `应召回平台期/代谢适应内容，实际：${stall.hits.map((hit) => hit.passage.sectionPath.slice(-1)[0]).join(" | ")}`,
  );
});

test("④ 结果带可解析的文献引用，且引用标明不能推出什么", () => {
  const result = registry.searchKnowledge({ query: "空腹有氧 按需供能", limit: 5 });
  const withCitations = result.hits.filter((hit) => hit.citations.length > 0);
  assert.ok(withCitations.length > 0, "应有带文献引用的结果");
  for (const hit of withCitations) {
    for (const citation of hit.citations) {
      assert.ok(citation.url || citation.pmid, `${citation.id} 应有可达来源`);
      assert.ok(citation.claim.length > 10);
      assert.ok(citation.cannotSupport.length > 0, `${citation.id} 必须标明不能推出什么`);
    }
  }
});

test("按主题限定检索范围", () => {
  // 主题标签是语言无关的：营养知识页是英文的，但中文查询也能命中（构建时补了中文对译词）
  const nutritionOnly = registry.searchKnowledge({ query: "蛋白", limit: 5, topic: "nutrition" });
  assert.ok(nutritionOnly.hits.length > 0, "中文查询应能命中英文营养知识页");
  for (const hit of nutritionOnly.hits) {
    assert.equal(hit.passage.topic, "nutrition");
  }

  const trainingOnly = registry.searchKnowledge({ query: "周量", limit: 5, topic: "training" });
  assert.ok(trainingOnly.hits.length > 0);
  for (const hit of trainingOnly.hits) {
    assert.equal(hit.passage.topic, "training");
  }
});

test("待核验（U 级）内容不会排在前面", () => {
  const passages = registry.programStrategies()?.passages ?? [];
  const unverified = passages.filter((passage) => passage.tier === "U");
  if (unverified.length === 0) return;
  // 用一个待核验段落里的词去查，U 级不应占据首位（打分对 U 有惩罚）
  const term = unverified[0]!.keywords.find((keyword) => keyword.length >= 2);
  if (!term) return;
  const result = registry.searchKnowledge({ query: term, limit: 5 });
  if (result.hits.length >= 2) {
    assert.notEqual(result.hits[0]?.passage.tier, "U", "待核验内容不应排第一");
  }
});
