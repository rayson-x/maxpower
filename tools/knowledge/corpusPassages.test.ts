import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";

/** S1 知识包构建缝：语料 passages 进包、tier/转正标记、sourceRef 钉版、检索命中。 */

test("教练语料 passages 进包：tier D + 已转正（无 experimental）+ 钉语料文档", () => {
  const pack = createInstalledKnowledgePack();
  const corpus = (pack.programStrategies?.passages ?? []).filter((passage) => passage.sourcePath.includes("coaching-diagnostic-patterns"));
  assert.ok(corpus.length >= 10, `语料段落数（实际 ${corpus.length}）应覆盖 P01–P08 + S01 + G01`);
  for (const passage of corpus) {
    assert.equal(passage.tier, "D", "语料是作者方法论（经验层），不是文献证据");
    assert.equal(passage.experimental, undefined, "2026-08-17 转正后不得再带 experimental 标记");
  }
  // 关键模式条目都在
  const text = corpus.map((passage) => passage.sectionPath.join("/") + passage.text).join("\n");
  for (const marker of ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "S01", "G01"]) {
    assert.ok(text.includes(marker), `缺少 ${marker}`);
  }
  // manifest 钉版出处
  assert.ok(pack.manifest.sourceRefs.some((ref) => ref.uri.includes("coaching-diagnostic-patterns")), "manifest sourceRefs 必须钉语料文档");
  // 蒸馏层同步转正
  const gists = (pack.programStrategies?.gists ?? []).filter((gist) => gist.docTitle === "教练分析模式语料");
  assert.ok(gists.length > 0 && gists.every((gist) => gist.experimental === undefined), "蒸馏 gist 不得再带 experimental");
});

test("四份核验调研进包：结论落地建议可查，内部裁决与引用清单剔除", () => {
  const pack = createInstalledKnowledgePack();
  const passages = pack.programStrategies?.passages ?? [];
  for (const [path, title] of [["fat-loss-plateau", "减脂平台期证据"], ["body-recomposition", "身体重组证据"], ["detraining-retraining", "停训与复练证据"], ["muscle-recovery-windows", "肌群恢复时间窗证据"]] as const) {
    const hits = passages.filter((passage) => passage.sourcePath.includes(path));
    assert.ok(hits.length >= 3, `${title} 段落不足（${hits.length}）`);
    assert.ok(hits.some((passage) => passage.tier === "A"), `${title} 应含 tier A 证据段`);
    assert.ok(!hits.some((passage) => passage.sectionPath.slice(1).some((section) => /引用清单|裁决|核验统计/.test(section))), `${title} 内部章节必须剔除`);
    assert.ok(hits.every((passage) => passage.experimental === undefined), `${title} 2026-08-17 转正后不得再带 experimental`);
  }
});

test("判据体系解释页在包内且可检索（围度优先/体重=噪声/体脂仅趋势）", () => {
  const pack = createInstalledKnowledgePack();
  const passages = (pack.programStrategies?.passages ?? []).filter((passage) => passage.sourcePath.includes("judgment-criteria"));
  assert.ok(passages.length >= 3, "判据体系页应产生多条段落");
  const text = passages.map((passage) => passage.text).join("\n");
  assert.match(text, /围度/);
  assert.match(text, /周均趋势/);
  assert.match(text, /wellness_note/);
});

test("措辞纪律：发布段落不含医学注册词（诊断/处方）", () => {
  const pack = createInstalledKnowledgePack();
  const passages = pack.programStrategies?.passages ?? [];
  // 语料的 S01 含「转介 ≠ 下诊断」的纪律原句（否定式边界声明），属合法措辞；
  // 四份调研与判据页的发布内容必须零命中。
  const scrubbedPaths = ["fat-loss-plateau", "body-recomposition", "detraining-retraining", "muscle-recovery-windows", "judgment-criteria"];
  const offenders = passages.filter((passage) => scrubbedPaths.some((path) => passage.sourcePath.includes(path))
    && (/诊断|处方/.test(passage.text) || passage.sectionPath.some((section) => /诊断|处方/.test(section))));
  assert.deepEqual(offenders.map((passage) => passage.id), [], "本批发布内容不得含 诊断/处方 措辞");
  const corpusOffenders = passages.filter((passage) => passage.sourcePath.includes("coaching-diagnostic-patterns") && /处方/.test(passage.text));
  assert.deepEqual(corpusOffenders.map((passage) => passage.id), [], "语料不得含 处方 措辞");
});

test("search_installed 蒸馏层命中语料模式（夜宵/判据/中断复练）", () => {
  const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
  const nightSnack = registry.searchKnowledgeLayered({ query: "夜宵 戒不掉", limit: 3 });
  assert.ok(nightSnack.entries.some((entry) => entry.gist.docTitle === "教练分析模式语料"), "夜宵场景必须命中 P01");
  const plateau = registry.searchKnowledgeLayered({ query: "体重 三周 不动 平台", limit: 4 });
  assert.ok(plateau.entries.some((entry) => entry.gist.docTitle.includes("平台")), "平台场景必须命中核验调研");
  const detraining = registry.searchKnowledgeLayered({ query: "停训 恢复 重新 开始", limit: 4 });
  assert.ok(detraining.entries.some((entry) => entry.gist.docTitle.includes("停训") || entry.gist.docTitle === "教练分析模式语料"), "中断复练场景必须命中");
});
