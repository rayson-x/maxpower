import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { stableHash } from "../../src/coach/stable";
import type { KnowledgePassage } from "../../src/knowledge/model";

/**
 * 知识段落构建器：把已审核的知识页切成 agent 可检索的段落，随知识包发到客户端。
 *
 * 纪律：
 * - 段落是**原文切片**，不是模型摘要——agent 引用的必须是审过的文字
 * - 每段带来源路径与小节路径，可追溯
 * - 证据等级从段落内的标注推断（文中出现 PMID/PMC 链接视为有外部证据；
 *   出现"产品规则/产品默认"视为 D；出现"待核验"视为 U）
 * - 切分按 Markdown 小节，过长的小节按段落再切，保证单段可直接引用
 */

/** 要打进包的知识文档（只放已审核的）。 */
const SOURCE_DOCS: readonly { path: string; title: string }[] = [
  { path: "docs/wiki/training-programming.md", title: "训练编程知识" },
  { path: "docs/wiki/nutrition-strategy.md", title: "营养策略知识" },
  { path: "docs/wiki/recovery-and-health-signals.md", title: "恢复与健康信号" },
  { path: "docs/wiki/exercise-and-stimulus-knowledge.md", title: "动作与刺激知识" },
  { path: "docs/wiki/program-strategy-set.md", title: "训练编排策略集" },
  {
    path: "docs/research/2026-08-11-fat-oxidation-physiology-and-fasted-cardio.md",
    title: "脂肪氧化生理学与空腹有氧",
  },
  {
    path: "docs/research/2026-08-11-fitness-claims-vs-evidence-audit.md",
    title: "健身流派对账：说法与证据",
  },
  {
    path: "docs/research/2026-08-11-healthy-adult-plan-and-nutrition-acceptance-standards.md",
    title: "健康成人计划与营养验收标准",
  },
];

/** 单段目标长度（字符）；过长的小节会被再切。 */
const MAX_PASSAGE_CHARS = 1200;
const MIN_PASSAGE_CHARS = 80;

/** 文献 id 映射：段落里出现这些标识时挂上对应引用。 */
const CITATION_PATTERNS: readonly { ref: string; patterns: readonly RegExp[] }[] = [
  { ref: "impey_2018_fuel_for_the_work_required", patterns: [/PMC5889771/, /Fuel for the Work Required/i, /按需供能/] },
  { ref: "schoenfeld_2014_fasted_vs_fed", patterns: [/PMC4242477/, /Schoenfeld.{0,20}2014/] },
  { ref: "postprandial_walking_meta_2023", patterns: [/PMC10036272/, /餐后步行/, /After Dinner Rest a While/i] },
  { ref: "postprandial_walking_glucose_response_2022", patterns: [/PMC8912639/] },
  { ref: "acsm_2026_resistance_training", patterns: [/41843416/, /ACSM 2026/] },
  { ref: "schoenfeld_2017_load_range", patterns: [/28834797/] },
  { ref: "grgic_2022_failure_vs_nonfailure", patterns: [/33497853/] },
  { ref: "murphy_koehler_2022_energy_deficiency", patterns: [/34623696/] },
  { ref: "issn_2017_protein", patterns: [/s12970-017-0177-8/, /ISSN.{0,10}蛋白/] },
  { ref: "thomas_2016_nutrition_athletic_performance", patterns: [/26920240/, /S2212-2672/] },
  { ref: "who_2020_physical_activity", patterns: [/9789240015128/, /WHO 20?20/] },
  { ref: "acsm_2009_progression", patterns: [/19204579/] },
];


/**
 * 英中术语映射：知识库里有英文页（nutrition-strategy / exercise-and-stimulus 基本是英文），
 * 若只按字面抽关键词，中文查询就检索不到这 70KB 内容。构建时给英文段落补中文关键词。
 * 只做**术语对译**，不做知识推断。
 */
const EN_ZH_TERMS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/\bprotein\b/i, ["蛋白", "蛋白质"]],
  [/\bcarbohydrate|carbs?\b/i, ["碳水"]],
  [/\bfat\b/i, ["脂肪"]],
  [/\benergy\b|\bcalorie/i, ["热量", "能量"]],
  [/\bdeficit\b/i, ["赤字", "缺口"]],
  [/\bsurplus\b/i, ["盈余"]],
  [/\bhypertrophy\b/i, ["增肌", "肌肥大"]],
  [/\bstrength\b/i, ["力量"]],
  [/\bfat loss\b/i, ["减脂"]],
  [/\bvolume\b/i, ["周量", "训练量"]],
  [/\bset(s)?\b/i, ["组数"]],
  [/\brep(etition)?s?\b/i, ["次数"]],
  [/\bload\b/i, ["负荷", "重量"]],
  [/\bintensity\b/i, ["强度"]],
  [/\bfrequency\b/i, ["频率"]],
  [/\brecovery\b/i, ["恢复"]],
  [/\bsleep\b/i, ["睡眠"]],
  [/\bfatigue\b/i, ["疲劳"]],
  [/\bfailure\b/i, ["力竭"]],
  [/\bprogression\b/i, ["进阶"]],
  [/\bdeload\b/i, ["减量"]],
  [/\baerobic|cardio\b/i, ["有氧"]],
  [/\bglycogen\b/i, ["糖原"]],
  [/\bfasted\b/i, ["空腹"]],
  [/\bsquat\b/i, ["深蹲"]],
  [/\bbench press\b/i, ["卧推"]],
  [/\bdeadlift\b/i, ["硬拉"]],
  [/\bpull[- ]?up\b/i, ["引体"]],
  [/\brow\b/i, ["划船"]],
  [/\bpress\b/i, ["推举"]],
  [/\bhip thrust\b/i, ["臀桥", "臀推"]],
  [/\bplank\b/i, ["平板"]],
  [/\bpush[- ]?up\b/i, ["俯卧撑"]],
  [/\bmuscle group\b/i, ["肌群"]],
  [/\bsafety\b/i, ["安全"]],
  [/\bcontraindication\b/i, ["禁忌"]],
  [/\bpain\b/i, ["疼痛"]],
  [/\breferral\b/i, ["转介"]],
  [/\bpregnan/i, ["孕期"]],
  [/\bhydration|water\b/i, ["水分"]],
  [/\bmeal\b/i, ["餐", "进餐"]],
  [/\bsupplement/i, ["补剂"]],
  [/\bmicronutrient|vitamin|mineral/i, ["微量营养素"]],
  [/\bfiber|fibre\b/i, ["纤维"]],
  [/\bsatiety|hunger\b/i, ["饱腹", "饥饿"]],
  [/\badherence\b/i, ["依从性"]],
  [/\bplateau\b/i, ["平台期"]],
  [/\bstimulus\b/i, ["刺激"]],
  [/\bequipment\b/i, ["器械"]],
  [/\bsubstitut/i, ["替代"]],
];

/** 主题标签（语言无关，供按主题限定检索）。 */
const TOPIC_BY_PATH: readonly (readonly [string, KnowledgePassage["topic"]])[] = [
  ["docs/wiki/training-programming", "training"],
  ["docs/wiki/nutrition-strategy", "nutrition"],
  ["docs/wiki/recovery-and-health-signals", "recovery"],
  ["docs/wiki/exercise-and-stimulus-knowledge", "exercise"],
  ["docs/wiki/program-strategy-set", "training"],
  ["docs/research/2026-08-11-fat-oxidation", "nutrition"],
  ["docs/research/2026-08-11-fitness-claims", "training"],
  ["docs/research/2026-08-11-healthy-adult-plan", "training"],
];

function topicFor(sourcePath: string): KnowledgePassage["topic"] {
  return TOPIC_BY_PATH.find(([prefix]) => sourcePath.startsWith(prefix))?.[1] ?? "any";
}

/** 中文与英文关键词抽取（构建时做，运行时零依赖）。 */
function extractKeywords(text: string, sectionPath: readonly string[]): string[] {
  const keywords = new Set<string>();
  // 小节标题本身是最强的检索信号
  for (const section of sectionPath) {
    for (const token of section.split(/[\s·、，,（）()\/|:：-]+/)) {
      if (token.length >= 2) keywords.add(token.toLowerCase());
    }
  }
  // 中文术语（2-6 字的常见领域词）
  const domainTerms = [
    "增肌", "减脂", "塑形", "力量", "有氧", "无氧", "糖原", "碳水", "蛋白", "脂肪",
    "热量", "赤字", "盈余", "周量", "组数", "次数", "负荷", "强度", "频率", "分化",
    "休息", "恢复", "睡眠", "疲劳", "力竭", "进阶", "超负荷", "校准", "空腹", "餐后",
    "碳循环", "生酮", "低碳", "断食", "间歇", "步数", "代谢", "适应", "平台期",
    "深蹲", "卧推", "硬拉", "引体", "划船", "推举", "臀桥", "弓步", "平板",
    "安全", "禁忌", "疼痛", "受伤", "转介", "孕期", "未成年", "老年",
  ];
  for (const term of domainTerms) {
    if (text.includes(term)) keywords.add(term);
  }
  // 英文术语与缩写
  for (const match of text.matchAll(/\b(RIR|RPE|1RM|VO2max|HIIT|MICT|LISS|NEAT|EPOC|BMI|WHO|ACSM|ISSN|FATmax|TDEE|REDs)\b/gi)) {
    keywords.add(match[0].toLowerCase());
  }
  // 英中对译：让英文页也能被中文查询命中
  for (const [pattern, zhTerms] of EN_ZH_TERMS) {
    if (pattern.test(text)) {
      for (const term of zhTerms) keywords.add(term);
    }
  }
  return [...keywords];
}

function inferTier(text: string): KnowledgePassage["tier"] {
  if (/待核验|未核验|unverified/i.test(text)) return "U";
  if (/PMID|PMC\d|pubmed|iris\.who\.int|jissn|jandonline/i.test(text)) return "A";
  if (/产品规则|产品默认|D 级/.test(text)) return "D";
  if (/课程|培训|大纲/.test(text)) return "C";
  return "B";
}

function citationsFor(text: string): string[] {
  return CITATION_PATTERNS.filter((entry) => entry.patterns.some((pattern) => pattern.test(text))).map(
    (entry) => entry.ref,
  );
}

/** 按 Markdown 标题切分，过长小节按空行再切。 */
function splitDocument(markdown: string, docTitle: string, sourcePath: string): KnowledgePassage[] {
  const lines = markdown.split("\n");
  const passages: KnowledgePassage[] = [];
  const headingStack: string[] = [];
  let buffer: string[] = [];
  let inFrontMatter = false;

  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (text.length < MIN_PASSAGE_CHARS) return;
    // 过长则按空行分块，尽量保持在目标长度内
    const chunks: string[] = [];
    if (text.length <= MAX_PASSAGE_CHARS) {
      chunks.push(text);
    } else {
      let current: string[] = [];
      let currentLength = 0;
      for (const block of text.split(/\n\s*\n/)) {
        if (currentLength + block.length > MAX_PASSAGE_CHARS && current.length) {
          chunks.push(current.join("\n\n"));
          current = [];
          currentLength = 0;
        }
        current.push(block);
        currentLength += block.length;
      }
      if (current.length) chunks.push(current.join("\n\n"));
    }
    const sectionPath = [...headingStack];
    for (const [index, chunk] of chunks.entries()) {
      if (chunk.trim().length < MIN_PASSAGE_CHARS) continue;
      passages.push({
        id: `passage-${stableHash({ sourcePath, sectionPath, index, chunk }).slice(0, 20)}`,
        sourcePath,
        docTitle,
        sectionPath,
        text: chunk.trim(),
        topic: topicFor(sourcePath),
        keywords: extractKeywords(chunk, sectionPath),
        citationRefs: citationsFor(chunk),
        tier: inferTier(chunk),
        contentHash: stableHash(chunk),
      });
    }
  };

  for (const line of lines) {
    if (line.trim() === "---" && passages.length === 0 && buffer.length === 0 && !inFrontMatter) {
      inFrontMatter = true;
      continue;
    }
    if (inFrontMatter) {
      if (line.trim() === "---") inFrontMatter = false;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      headingStack.length = Math.max(0, level - 1);
      headingStack[level - 1] = heading[2]!.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return passages;
}

/** 构建全部知识段落（缺失的文档跳过并记录，不静默）。 */
export function buildKnowledgePassages(repoRoot = process.cwd()): {
  passages: readonly KnowledgePassage[];
  skipped: readonly string[];
} {
  const passages: KnowledgePassage[] = [];
  const skipped: string[] = [];
  for (const doc of SOURCE_DOCS) {
    const absolute = join(repoRoot, doc.path);
    if (!existsSync(absolute)) {
      skipped.push(doc.path);
      continue;
    }
    passages.push(...splitDocument(readFileSync(absolute, "utf8"), doc.title, doc.path));
  }
  return { passages, skipped };
}

if (require.main === module) {
  const { passages, skipped } = buildKnowledgePassages();
  const byTier = passages.reduce<Record<string, number>>((acc, passage) => {
    acc[passage.tier] = (acc[passage.tier] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`built ${passages.length} passages from ${SOURCE_DOCS.length - skipped.length} docs`);
  console.log(`tiers: ${JSON.stringify(byTier)}`);
  console.log(`with citations: ${passages.filter((passage) => passage.citationRefs.length > 0).length}`);
  if (skipped.length) console.log(`skipped (missing): ${skipped.join(", ")}`);
}
