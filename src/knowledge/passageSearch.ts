import type { EvidenceCitation, KnowledgePassage } from "./model";

/**
 * 客户端 agent 的知识检索（离线、确定性、零外部依赖）。
 *
 * 定位：这是 **agent 用来回答与解释**的知识库，与引擎消费的规则包是两条线。
 * 纪律：
 * - 只返回知识包里已审核的**原文段落**，不生成摘要
 * - 检索不到就返回空 + typed unknown，agent 必须明说不知道，不得用模型先验补答
 * - 每条结果带来源路径、小节路径、证据等级与可解析的文献引用
 * - 打分是确定性的（同一查询同一包 → 同一结果），可回放
 */

export interface PassageHit {
  passage: KnowledgePassage;
  score: number;
  /** 命中的关键词（用于向用户解释"为什么找到这条"）。 */
  matchedTerms: readonly string[];
  citations: readonly EvidenceCitation[];
}

export interface PassageSearchResult {
  hits: readonly PassageHit[];
  /** 查询被拆出的检索词。 */
  queryTerms: readonly string[];
  /** 空结果时的 typed 原因（禁止 agent 用先验补答）。 */
  missing?: "no_passage_matched" | "knowledge_base_empty";
}

/**
 * 词表从语料派生（不手写术语表）：取所有段落的 keywords 与小节标题词。
 * 好处是自维护——知识页更新后词表自动跟随，不会出现"表里没这个词就查不到"。
 */
function vocabularyOf(passages: readonly KnowledgePassage[]): ReadonlySet<string> {
  const vocabulary = new Set<string>();
  for (const passage of passages) {
    for (const keyword of passage.keywords) {
      if (keyword.length >= 2) vocabulary.add(keyword);
    }
    for (const section of passage.sectionPath) {
      for (const token of section.toLowerCase().split(/[\s·、，,（）()\/|:：-]+/)) {
        if (token.length >= 2) vocabulary.add(token);
      }
    }
  }
  return vocabulary;
}

/** CJK 判定（用于决定是否做 n-gram 切分）。 */
function isCjk(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
}

/**
 * 同义词/口语映射（少量、可维护）：把用户的说法映射到语料里的用词。
 * 只放**语料里确实用另一种说法**的项，不做知识性推断。
 */
const QUERY_SYNONYMS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/(咖啡|咖啡因|caffeine)/, ["咖啡因", "caffeine"]],
  [/(肌酸|creatine)/, ["肌酸", "creatine"]],
  [/(拉伸|stretch|柔韧)/, ["拉伸", "柔韧", "防伤", "受伤"]],
  [/(女生|女性|女人|金刚芭比|男的|男性|男生|性别)/, ["性别差异", "训练反应"]],
  [/(老年|老人|岁数大|上了年纪)/, ["老年", "older"]],
  [/(睡|睡眠|熬夜)/, ["睡眠"]],
  [/(热身)/, ["热身", "拉伸"]],
  [/(补水|电解质|口渴|喝水)/, ["电解质", "补水"]],
  [/(溜肩|圆肩|驼背|头前伸|乌龟颈)/, ["体态", "圆肩", "头前伸"]],
  [/(骨盆前倾|小腹突出)/, ["骨盆前倾", "体态"]],
  [/(体态|姿态|驼背|翼状)/, ["体态", "姿势"]],
  [/(肩膀痛|颈痛|脖子疼|颈椎)/, ["颈痛", "疼痛", "体态"]],
  [/(腰疼|腰痛|腰酸)/, ["腰痛", "疼痛", "体态"]],
  [/(产后|生完|剖腹产|顺产)/, ["产后", "腹直肌", "盆底"]],
  [/(哺乳|喂奶|母乳|奶量)/, ["哺乳", "母乳", "奶量"]],
  [/(腹直肌|分离|肚子松)/, ["腹直肌", "分离"]],
  [/(漏尿|尿失禁|憋不住|盆底)/, ["盆底", "尿失禁", "凯格尔"]],
  [/(经期|月经|生理期|大姨妈)/, ["经期", "月经"]],
  [/(宝妈|妈妈|怀孕)/, ["产后", "孕期", "女性"]],
  [/bcaa|支链|eaa/i, ["bcaa", "补剂"]],
  [/左旋肉碱|肉碱|藤黄果|绿茶提取/i, ["营销重灾区", "不推荐"]],
  [/(一周几次|练几次|多久练|天天练|每天练)/, ["频率", "每周至少", "主要肌群"]],
  [/(翘臀|臀部|屁股|练臀)/, ["臀", "臀部", "臀桥", "深蹲"]],
  [/(膝盖|膝关节|膝痛)/, ["膝", "疼痛", "安全"]],
  [/(练前|训练前|运动前).{0,3}(吃|喝)/, ["训练前", "加餐", "碳水"]],
  [/(停训|不练|很久没练|掉肌肉|几天不练)/, ["停训", "肌肉记忆", "掉肌肉", "维持"]],
  [/(练完酸|酸痛|肌肉酸)/, ["酸痛", "恢复"]],
  [/(开始练|入门|零基础|没练过)/, ["新手", "校准", "渐进"]],
  [/(60岁|50岁|中年|年纪大)/, ["老年", "力量"]],
  [/燃脂.?剂|fat.?burner|燃脂丸/i, ["营销重灾区", "不推荐"]],
  [/(糖尿病|血糖)/, ["糖尿病", "血糖", "含糖饮料", "碳水质量"]],
  [/(高血压|血压)/, ["高血压", "钠", "dash"]],
  [/(痛风|尿酸)/, ["痛风", "嘌呤", "尿酸"]],
  [/(他汀|西柚|葡萄柚)/, ["他汀", "西柚", "药物"]],
  [/(华法林|抗凝)/, ["华法林", "维生素k", "药物"]],
  [/(减肥药|司美格鲁肽|利拉鲁肽|替尔泊肽|glp|奥利司他)/, ["处方药", "减重", "转介"]],
  [/(蛋白粉|乳清|增肌粉)/, ["蛋白", "补剂"]],
  [/(肾病|肾功能|透析)/, ["肾病", "转介"]],
  [/(骨质|骨密度|钙)/, ["骨质", "钙", "维生素d"]],
  [/(高血脂|血脂|胆固醇)/, ["血脂", "饱和脂肪"]],
  [/蛋白.{0,3}(吃|多少|摄入|克)/, ["蛋白", "蛋白质", "g/kg"]],
  [/(变大|变壮|金刚芭比|太壮|肌肉大)/, ["女性", "增肌", "负荷"]],
  [/(掉秤|停滞|不掉|平台)/, ["平台期", "代谢", "适应"]],
  [/(练哪|哪个部位|哪块肌肉)/, ["肌群", "刺激"]],
  [/(几组|多少组)/, ["组数", "周量"]],
  [/(多重|重量|上多少)/, ["负荷", "1rm", "rir"]],
  [/(休息|间歇|组间)/, ["休息"]],
  [/(饿|饥饿|馋)/, ["依从性", "饱腹"]],
];

/**
 * 把自然语言查询切成检索词。
 *
 * 中文没有空格，所以对 CJK 连续段做**最长优先匹配**：从每个位置尝试
 * 6→2 字的子串，命中语料词表就取用并前移。这样"点减脂有用吗"能切出「点减脂」，
 * 而不是只剩下「减脂」——后者会把具体问题淹没在泛化段落里。
 */
export function tokenizeQuery(query: string, vocabulary: ReadonlySet<string>): string[] {
  const normalized = query.toLowerCase();
  const terms = new Set<string>();

  // 非 CJK 部分按分隔符切
  for (const token of normalized.split(/[\s·、，,。？?！!（）()\/|:：;；"'“”]+/)) {
    if (token.length >= 2 && !isCjk(token[0]!)) terms.add(token);
  }

  // 同义词映射（把口语说法接到语料用词）
  for (const [pattern, mapped] of QUERY_SYNONYMS) {
    if (pattern.test(normalized)) {
      // 映射词可能部分不在词表；逐个检查，取存在于词表的那些
      const usable = mapped.filter((term) => vocabulary.has(term));
      if (usable.length > 0) {
        for (const term of usable) terms.add(term);
        continue;
      }
      // 全部不在词表时，回退尝试每个映射词的前缀（「咖啡因」→「咖啡因」已在词表但「咖啡」不在）
      for (const term of mapped) {
        for (const vocab of vocabulary) {
          if (vocab.startsWith(term) || term.startsWith(vocab)) {
            terms.add(vocab);
            break;
          }
        }
      }
    }
  }

  // CJK 连续段做最长优先匹配
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index]!;
    if (!isCjk(char)) {
      index += 1;
      continue;
    }
    let matched = false;
    for (let length = Math.min(6, normalized.length - index); length >= 2; length -= 1) {
      const candidate = normalized.slice(index, index + length);
      if (vocabulary.has(candidate)) {
        terms.add(candidate);
        index += length;
        matched = true;
        break;
      }
    }
    if (!matched) index += 1;
  }
  return [...terms];
}

/**
 * 检索知识段落。
 *
 * 打分（确定性）：
 *   关键词命中 +3 · 小节标题命中 +4 · 正文出现 +1（每词最多计一次）
 *   带一手文献（tier A）+2 · 待核验（tier U）−5（不优先给未核验内容）
 */
export function searchPassages(input: {
  passages: readonly KnowledgePassage[] | undefined;
  citations: readonly EvidenceCitation[] | undefined;
  query: string;
  limit?: number;
  /** 只要某个来源文档的段落（可选）。 */
  sourcePathPrefix?: string;
  /** 按主题限定（语言无关，优于路径前缀）。 */
  topic?: "training" | "nutrition" | "recovery" | "exercise" | "any";
}): PassageSearchResult {
  if (!input.passages?.length) {
    return { hits: [], queryTerms: [], missing: "knowledge_base_empty" };
  }
  const queryTerms = tokenizeQuery(input.query, vocabularyOf(input.passages));
  const library = input.citations ?? [];
  const topicFiltered = input.topic && input.topic !== "any"
    ? input.passages.filter((passage) => passage.topic === input.topic)
    : input.passages;
  const candidates = input.sourcePathPrefix
    ? topicFiltered.filter((passage) => passage.sourcePath.startsWith(input.sourcePathPrefix!))
    : topicFiltered;

  const scored: PassageHit[] = [];
  for (const passage of candidates) {
    const matched = new Set<string>();
    let score = 0;
    const sectionText = passage.sectionPath.join(" ").toLowerCase();
    const bodyText = passage.text.toLowerCase();
    for (const term of queryTerms) {
      let hit = false;
      if (passage.keywords.includes(term)) {
        score += 3;
        hit = true;
      }
      if (sectionText.includes(term)) {
        score += 4;
        hit = true;
      } else if (bodyText.includes(term)) {
        score += 1;
        hit = true;
      }
      if (hit) matched.add(term);
    }
    if (score === 0) continue;
    if (passage.tier === "A") score += 2;
    if (passage.tier === "U") score -= 5;
    if (score <= 0) continue;
    scored.push({
      passage,
      score,
      matchedTerms: [...matched],
      citations: passage.citationRefs
        .map((ref) => library.find((citation) => citation.id === ref))
        .filter((citation): citation is EvidenceCitation => citation !== undefined),
    });
  }

  // 确定性排序：分数降序，同分按 id 升序（保证同查询同结果，可回放）
  scored.sort((left, right) => right.score - left.score || left.passage.id.localeCompare(right.passage.id));
  const hits = scored.slice(0, input.limit ?? 5);
  return {
    hits,
    queryTerms,
    ...(hits.length === 0 ? { missing: "no_passage_matched" as const } : {}),
  };
}

/**
 * 分层检索（skill 式渐进披露）：agent 默认只见蒸馏层——L2 gist（小节一句话要点）
 * 挂 L1 keypoints（该小节各段落的结论句）；需要原文时按 passageId 单独下钻 L0。
 * 打分规则与 searchPassages 同族（确定性、可回放）。
 */
export interface LayeredKnowledgeEntry {
  readonly gist: import("./model").KnowledgeGist;
  /** 该小节内与查询相关的段落结论（L1，按 tier/长度优选，最多 3 条）。 */
  readonly keypoints: readonly import("./model").KnowledgeKeypoint[];
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export interface LayeredKnowledgeResult {
  readonly entries: readonly LayeredKnowledgeEntry[];
  readonly queryTerms: readonly string[];
  readonly missing?: "no_passage_matched" | "knowledge_base_empty";
}

function gistVocabulary(gists: readonly import("./model").KnowledgeGist[]): ReadonlySet<string> {
  const vocabulary = new Set<string>();
  for (const gist of gists) {
    for (const keyword of gist.keywords) {
      if (keyword.length >= 2) vocabulary.add(keyword);
    }
    for (const token of `${gist.docTitle} ${gist.sectionKey}`.toLowerCase().split(/[\s·、，,（）()\/|:：›-]+/)) {
      if (token.length >= 2) vocabulary.add(token);
    }
  }
  return vocabulary;
}

export function searchKnowledgeLayers(input: {
  readonly gists: readonly import("./model").KnowledgeGist[] | undefined;
  readonly keypoints: readonly import("./model").KnowledgeKeypoint[] | undefined;
  readonly query: string;
  readonly topic?: "training" | "nutrition" | "recovery" | "exercise" | "any";
  readonly limit?: number;
}): LayeredKnowledgeResult {
  if (!input.gists?.length) {
    return { entries: [], queryTerms: [], missing: "knowledge_base_empty" };
  }
  const queryTerms = tokenizeQuery(input.query, gistVocabulary(input.gists));
  const candidates = input.topic && input.topic !== "any"
    ? input.gists.filter((gist) => gist.topic === input.topic)
    : input.gists;
  const keypoints = input.keypoints ?? [];
  const tierRank = { A: 0, B: 1, C: 2, D: 3, U: 4 } as const;

  const scored: LayeredKnowledgeEntry[] = [];
  for (const gist of candidates) {
    const matched = new Set<string>();
    let score = 0;
    const sectionText = `${gist.docTitle} ${gist.sectionKey}`.toLowerCase();
    const gistText = gist.gist.toLowerCase();
    for (const term of queryTerms) {
      let hit = false;
      if (gist.keywords.includes(term)) { score += 3; hit = true; }
      if (sectionText.includes(term)) { score += 4; hit = true; }
      else if (gistText.includes(term)) { score += 1; hit = true; }
      if (hit) matched.add(term);
    }
    if (score === 0) continue;
    if (gist.tier === "A") score += 2;
    if (gist.tier === "U") score -= 5;
    if (score <= 0) continue;
    const passageIds = new Set(gist.passageIds);
    const points = keypoints
      .filter((keypoint) => passageIds.has(keypoint.passageId))
      .sort((left, right) => tierRank[left.tier] - tierRank[right.tier] || left.point.length - right.point.length)
      .slice(0, 3);
    scored.push({ gist, keypoints: points, score, matchedTerms: [...matched] });
  }
  scored.sort((left, right) => right.score - left.score || left.gist.id.localeCompare(right.gist.id));
  const entries = scored.slice(0, input.limit ?? 4);
  return { entries, queryTerms, ...(entries.length === 0 ? { missing: "no_passage_matched" as const } : {}) };
}
