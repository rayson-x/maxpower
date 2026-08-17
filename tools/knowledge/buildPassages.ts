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

/**
 * 客户端 agent 知识库的**策展政策**。
 *
 * 开发知识库里有大量不该给客户端 agent 的内容：产品决策、工程实现、验收断言、
 * 待核验清单、代码路径。agent 若把这些引给用户，等于泄露内部决策并制造困惑。
 * 所以这里显式声明：哪些文档发布、哪些小节剔除。剔除结果会打印出来可审计。
 */
interface SourceDocPolicy {
  path: string;
  title: string;
  /** 是否发布到客户端 agent。 */
  publish: boolean;
  /** 该文档中不发布的小节（匹配任一层小节标题即整段剔除）。 */
  excludeSections?: readonly RegExp[];
  /** 不发布的原因（publish=false 时必填，便于审计）。 */
  reason?: string;
  /** 覆盖 tier 推断（如方法论语料固定 tier D——作者经验，非文献证据）。 */
  defaultTier?: KnowledgePassage["tier"];
  /** 整篇标 experimental（dogfood 期内容，转正前话术可演进）。 */
  experimental?: true;
  /** 手工策展文档：跳过全局内容剔除（DROP 模式面向工程噪声，语料的「知识包」指产品概念）。 */
  skipContentDrop?: true;
  /** 措辞纪律清洗（构建期、确定性、可审计）：医学措辞（诊断/处方）替换为产品语言。 */
  contentReplacements?: readonly (readonly [RegExp, string])[];
}

const SOURCE_DOCS: readonly SourceDocPolicy[] = [
  // ── 领域知识页：整篇发布（本身就是给用户看的领域内容）──
  { path: "docs/wiki/training-programming.md", title: "训练编程知识", publish: true },
  { path: "docs/wiki/nutrition-strategy.md", title: "营养策略知识", publish: true },
  { path: "docs/wiki/recovery-and-health-signals.md", title: "恢复与健康信号", publish: true },
  { path: "docs/wiki/exercise-and-stimulus-knowledge.md", title: "动作与刺激知识", publish: true },
  { path: "docs/wiki/program-strategy-set.md", title: "训练编排策略集", publish: true },
  { path: "docs/wiki/judgment-criteria.md", title: "判据体系", publish: true },

  // ── 教练方法论语料（作者经验，tier D；2026-08-17 转正）──
  {
    path: "docs/research/coaching-diagnostic-patterns-2026-08-16.md",
    title: "教练分析模式语料",
    publish: true,
    defaultTier: "D",
    skipContentDrop: true,
    excludeSections: [/元模式/],
  },

  // ── 核验调研（平台/recomp/停训/恢复窗）：发布结论与落地建议；剔除内部裁决与引用清单 ──
  {
    path: "docs/research/fat-loss-plateau-2026-08-16.md",
    title: "减脂平台期证据",
    publish: true,
    contentReplacements: [
      [/诊断与处理/g, "判定与处理"],
      [/诊断流程/g, "判定流程"],
      [/诊断清单/g, "判定清单"],
      [/诊断动作/g, "判定动作"],
      [/诊断\/处理/g, "判定/处理"],
    ],
    excludeSections: [/对作者直觉的裁决/, /引用清单/, /怎么读/],
  },
  {
    path: "docs/research/body-recomposition-2026-08-16.md",
    title: "身体重组证据",
    publish: true,
    contentReplacements: [
      [/实践处方/g, "实践方案"],
      [/处方参数/g, "方案参数"],
      [/处方证据/g, "方案证据"],
      [/处方与/g, "方案与"],
      [/处方因此/g, "方案因此"],
      [/处方/g, "方案"],
    ],
    excludeSections: [/对作者主张的分层裁决/, /引用清单/, /核验统计/, /怎么读/],
  },
  {
    path: "docs/research/detraining-retraining-2026-08-16.md",
    title: "停训与复练证据",
    publish: true,
    contentReplacements: [
      [/实践处方/g, "实践方案"],
      [/处方证据/g, "方案证据"],
      [/处方/g, "方案"],
    ],
    excludeSections: [/对作者主张的裁决/, /引用清单/, /怎么读/],
  },
  {
    path: "docs/research/muscle-recovery-windows-2026-08-16.md",
    title: "肌群恢复时间窗证据",
    publish: true,
    excludeSections: [/引用清单/, /怎么读/],
  },

  // ── 调研报告：只发布"事实与证据"部分，剔除产品决策与工程内容 ──
  {
    path: "docs/research/2026-08-11-fat-oxidation-physiology-and-fasted-cardio.md",
    title: "脂肪氧化与空腹有氧",
    publish: true,
    excludeSections: [
      /对产品设计的直接含义/,
      /产品行为/,
      /待核验/,
      /怎么读这份文档/,
      /调研起因/,
    ],
  },
  {
    path: "docs/research/2026-08-11-fitness-claims-vs-evidence-audit.md",
    title: "常见说法与证据对照",
    publish: true,
    excludeSections: [
      /我们的立场/,
      /我们采纳与拒绝/,
      /Part D/,
      /Part E/,
      /Part F/,
      /待核验/,
      /最小实验/,
      /怎么读这份文档/,
    ],
  },
  {
    path: "docs/research/2026-08-12-supplements-and-weight-loss-drugs-evidence.md",
    title: "药物与补剂证据",
    publish: true,
    excludeSections: [/待核验/, /定位|纪律|药物红线|证据等级/, /使用约定/],
  },
  {
    path: "docs/research/2026-08-12-special-population-nutrition-evidence.md",
    title: "特殊人群营养指南",
    publish: true,
    excludeSections: [/待核验/, /定位|纪律|证据等级|触发原则/, /使用约定/],
  },
  {
    path: "docs/research/2026-08-12-postpartum-and-womens-fitness-evidence.md",
    title: "产后与女性健身证据",
    publish: true,
    excludeSections: [/待核验/, /调研|目的|纪律|方法/],
  },
  {
    path: "docs/research/2026-08-12-posture-and-corrective-exercise-evidence.md",
    title: "体态与矫正训练证据",
    publish: true,
    excludeSections: [/目的|纪律|证据等级/, /待核验/, /遗留缺口/],
  },
  {
    path: "docs/research/2026-08-12-overseas-exercise-science-evidence.md",
    title: "海外运动科学证据（补剂/睡眠/周期化/热身/性别/人群）",
    publish: true,
    excludeSections: [/待核验/, /调研起因|目的|纪律/],
  },
  {
    path: "docs/research/2026-08-11-healthy-adult-plan-and-nutrition-acceptance-standards.md",
    title: "健康成人训练与营养标准",
    publish: true,
    excludeSections: [
      /验收断言/,
      /建议加入/,
      /对.{0,6}验收的含义/,
      /产品验收规则/,
    ],
  },

  // ── 明确不发布：纯内部内容 ──
  {
    path: "docs/research/2026-08-11-coach-training-curricula.md",
    title: "教练培训体系调研",
    publish: false,
    reason: "内部能力缺口分析与路线图，非用户领域知识",
  },
  {
    path: "docs/design/training-programming-and-nutrition-coupling-v0.1.md",
    title: "训练与饮食耦合设计",
    publish: false,
    reason: "工程设计文档，含实现清单与代码引用",
  },
];

/**
 * 段落级内容过滤：即使小节通过，含以下内容的段落也不发布。
 * 这是最后一道闸——防止内部内容从任何路径泄漏到用户面前。
 */
/** 整段剔除：这类段落通体是内部内容，没有对用户有价值的部分。 */
const DROP_PASSAGE_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\b(src|tools)\/[\w.-]+\.tsx?/, label: "源码引用" },
  { pattern: /PlannerTrace|ticket\s*\d|rulePack|知识包/i, label: "实现细节" },
  { pattern: /assert\.|E2E|最小实验|验收断言/, label: "测试与验收" },
  { pattern: /status:\s*(proposal|active|draft)/i, label: "文档元信息" },
];

/**
 * 行内剔除：段落里**混有**证据与内部决策时，只删内部那几行、保留证据。
 * 用户最该看到的对照内容（点减脂、IF、HIIT…）恰好属于这类混合段落，
 * 整段剔除会把最有价值的部分一起丢掉。
 */
const DROP_LINE_PATTERNS: readonly RegExp[] = [
  /^\s*\*?\*?我们的立场/,
  /^\s*\*?\*?我们采纳/,
  /^\s*产品行为/,
  /^\s*\|?\s*产品行为\s*\|/,
  /产品规则（D）|产品默认值/,
  /待核验|未核验|需要核实/,
  /落进\s*planner|实现清单/i,
  /\b(src|tools|docs)\/[\w.-]+\//,
  /^```/,
  /^\s*目标：|^\s*机制：|^\s*可操作变量：|^\s*计划输出：|^\s*验证指标：|^\s*证据锚点：/,
];

/** 按行剔除内部内容；返回 undefined 表示剩余内容不足以成段。 */
function stripInternalLines(text: string): string | undefined {
  const kept = text
    .split("\n")
    .filter((line) => !DROP_LINE_PATTERNS.some((pattern) => pattern.test(line)));
  const result = kept.join("\n").trim();
  return result.length >= MIN_PASSAGE_CHARS ? result : undefined;
}

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
  { ref: "issn_2017_creatine", patterns: [/28615996/, /PMC5469049/] },
  { ref: "issn_2021_caffeine", patterns: [/33388079/] },
  { ref: "issn_2015_beta_alanine", patterns: [/26175657/] },
  { ref: "acsm_2007_fluid_replacement", patterns: [/17277604/] },
  { ref: "sleep_loss_performance_meta_2022", patterns: [/35708888/] },
  { ref: "sleep_muscle_strength_2018", patterns: [/29422383/] },
  { ref: "christensen_2008_spinal_curves_pain", patterns: [/19028253/] },
  { ref: "laird_2014_lumbar_lordosis", patterns: [/25012528/] },
  { ref: "swain_2020_posture_back_pain", patterns: [/31451200/] },
  { ref: "mahmoud_2019_forward_head_neck_pain", patterns: [/31773477/] },
  { ref: "richards_2021_sitting_neck_pain", patterns: [/33444448/] },
  { ref: "issn_2017_creatine", patterns: [/28615996/] },
  { ref: "issn_2021_caffeine", patterns: [/33388079/] },
  { ref: "issn_2015_beta_alanine", patterns: [/26175657/] },
  { ref: "wilding_2021_semaglutide_step1", patterns: [/33567185/] },
  { ref: "glp1_resistance_training_lean_mass_2024", patterns: [/38687506/] },
  { ref: "sacks_2001_dash_sodium", patterns: [/11136953/] },
  { ref: "ada_2019_diabetes_nutrition", patterns: [/31000505/] },
  { ref: "kdoqi_2020_ckd_nutrition", patterns: [/32829751/] },
  { ref: "acr_2020_gout", patterns: [/32391934/] },
  { ref: "nof_2016_bone_mass", patterns: [/26856587/] },
  { ref: "bailey_2016_grapefruit_statins", patterns: [/26299317/] },
  { ref: "warfarin_vitamin_k_stability", patterns: [/9066002/] },
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
  [/\bcreatine\b/i, ["肌酸"]],
  [/\bcaffeine\b/i, ["咖啡因"]],
  [/\bbeta-?alanine/i, ["丙氨酸"]],
  [/\belectrolyte|fluid|hydration/i, ["电解质", "补水"]],
  [/\bwomen|female\b/i, ["女性"]],
  [/\bmen\b|male\b/i, ["男性"]],
  [/\bsex (differences?|dimorphism)/i, ["性别"]],
  [/\bolder adult|older adult|aging|elderly/i, ["老年"]],
  [/\bsleep\b/i, ["睡眠"]],
  [/\bperiodization|periodised|periodized/i, ["周期化"]],
  [/\bwarm-?up/i, ["热身"]],
  [/\bstretch/i, ["拉伸"]],
  [/\bcluster set|velocity[- ]based|PAP|postactivation/i, ["集群组", "PAP"]],
  [/\bposture\b/i, ["体态", "姿势"]],
  [/\brounded shoulder|forward shoulder/i, ["圆肩"]],
  [/\bforward head/i, ["头前伸"]],
  [/\banterior pelvic tilt|APT\b/i, ["骨盆前倾"]],
  [/\bscapular|winging/i, ["肩胛", "翼状"]],
  [/\bneck pain|cervical/i, ["颈痛"]],
  [/\blow back pain|back pain|lumbar/i, ["腰痛"]],
  [/\bcorrective exercise/i, ["矫正训练"]],
  [/\bsitting|sedentary/i, ["久坐"]],
  [/\bsoreness|sore\b|DOMS|delayed onset/i, ["酸痛"]],
  [/\babdominal|abs\b|core\b/i, ["腹肌", "核心", "腹部"]],
  [/\bglute|butt/i, ["臀", "臀部"]],
  [/\bbicep|tricep|arm muscle/i, ["手臂", "二头", "三头"]],
  [/\bposture|slouch|hunch/i, ["体态", "溜肩", "驼背"]],
  [/\bmenstrual|menstruation|period\b/i, ["经期", "月经"]],
  [/\bpostpartum|post[- ]natal/i, ["产后"]],
  [/\bbreastfeeding|lactation|nursing/i, ["哺乳", "母乳"]],
  [/\bdiastasis/i, ["腹直肌", "分离"]],
  [/\bpelvic floor|incontinence/i, ["盆底", "尿失禁", "漏尿"]],
  [/\bketogenic|keto\b/i, ["生酮"]],
  [/\bintermittent fasting|fasting\b/i, ["断食", "空腹"]],
  [/\bspot reduction/i, ["点减脂"]],
  [/\bmuscle group/i, ["肌群"]],
  [/\bovertrain/i, ["过度训练"]],
  [/\bmacronutrient|macro\b/i, ["宏量营养素"]],
  [/\bmicronutrient|vitamin|mineral/i, ["维生素", "微量营养素"]],
  [/\bwhole food|diet quality/i, ["天然食物", "饮食质量"]],
  [/\bblood pressure|hypertension/i, ["高血压", "血压"]],
  [/\bsodium|salt\b/i, ["钠", "盐"]],
  [/\bcholesterol|lipid/i, ["胆固醇", "血脂"]],
  [/\bdiabetes|glycemic|glucose/i, ["糖尿病", "血糖"]],
  [/\bgout|purine|uric acid/i, ["痛风", "嘌呤", "尿酸"]],
  [/\bbone|osteoporosis|calcium/i, ["骨质", "钙"]],
  [/\bkidney|renal/i, ["肾", "肾功能"]],
  [/\bstatin/i, ["他汀"]],
  [/\bgrapefruit/i, ["西柚", "葡萄柚"]],
  [/\bwarfarin/i, ["华法林"]],
  [/\bsemaglutide|liraglutide|tirzepatide|GLP-1/i, ["处方药", "减重药"]],
  [/\borlistat/i, ["奥利司他"]],
  [/\bwhey|protein powder/i, ["蛋白粉", "乳清"]],
  [/\bpre[- ]workout/i, ["氮泵"]],
  [/\bcool[- ]down/i, ["放松", "冷身"]],
  [/\brest day/i, ["休息日"]],
  [/\bweekly|per week|times a week/i, ["每周", "频率"]],
  [/\bmuscle memory/i, ["肌肉记忆"]],
  [/\bdetraining|detrain/i, ["停训", "掉肌肉"]],
  [/\bDOMS|delayed onset muscle/i, ["延迟性酸痛", "酸痛"]],
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
  // 教练语料的场景词（用户原话用语——「表面信号」检索词）：语料更新时随之补充。
  const coachingScenarioTerms = [
    "夜宵", "瘦肚子", "局部减脂", "判据", "期望", "复练", "中断", "瓶颈", "平台",
    "爬楼", "外卖", "应酬", "大基数", "戒不掉", "嘴馋", "偷懒", "坚持", "放弃",
    "羞耻", "说教", "体重没变", "体重不动", "停训", "节食", "暴食", "情绪化进食",
    "改善", "感觉", "精力", "气色", "上楼", "久坐",
  ];
  for (const term of coachingScenarioTerms) {
    if (text.includes(term)) keywords.add(term);
  }
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

/**
 * 蒸馏层构建（L1 keypoint / L2 gist）：从 L0 段落做**确定性抽取**，不生成新内容。
 *
 * 抽取规则（保守——抽不出就不建，绝不编造）：
 *   keypoint = 段落里以"结论先行/关键/核心/要点/底线/bottom line"开头的句子，
 *              或第一个粗体结论句；抽不出就用段落首句（截断）
 *   gist     = 小节内各 keypoint 的第一条，或该小节所有段落的最强结论句
 */

const KEYPOINT_MARKERS = [
  /^\s*[-*]?\s*\*\*(.{10,200}?)\*\*/m,   // 首个粗体结论
  /结论先行[:：]\s*\*\*(.{10,300}?)\*\*/, // 结论先行块
  /^(?:结论|要点|底线|关键|核心)[:：]\s*(.{10,200})$/m,
];

function extractKeypoint(passage: KnowledgePassage): string {
  for (const pattern of KEYPOINT_MARKERS) {
    const match = pattern.exec(passage.text);
    if (match?.[1]) return match[1].trim();
  }
  // 兜底：第一段非表格、非引用、非标题的句子
  const line = passage.text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 20 && !l.startsWith("|") && !l.startsWith(">") && !l.startsWith("#"));
  const first = (line ?? passage.text).replace(/\*\*/g, "");
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

/** 蒸馏出 L1 与 L2（只给有实质内容的段落建层）。 */
export function buildDistilledLayers(passages: readonly KnowledgePassage[]): {
  keypoints: readonly import("../../src/knowledge/model").KnowledgeKeypoint[];
  gists: readonly import("../../src/knowledge/model").KnowledgeGist[];
} {
  const keypoints: import("../../src/knowledge/model").KnowledgeKeypoint[] = [];
  const bySection = new Map<string, KnowledgePassage[]>();

  for (const passage of passages) {
    const sectionKey = `${passage.docTitle}::${passage.sectionPath.join(" › ") || passage.docTitle}`;
    if (!bySection.has(sectionKey)) bySection.set(sectionKey, []);
    bySection.get(sectionKey)!.push(passage);

    const point = cleanGist(extractKeypoint(passage), passage);
    keypoints.push({
      id: `kp-${passage.id.slice(8)}`,
      passageId: passage.id,
      docTitle: passage.docTitle,
      sectionPath: passage.sectionPath,
      point,
      citationRefs: passage.citationRefs,
      tier: passage.tier,
    });
  }

  const gists: import("../../src/knowledge/model").KnowledgeGist[] = [];
  for (const [sectionKey, group] of bySection) {
    // gist 取该小节证据等级最高、最短的一条 keypoint（摘要要短）
    const best = [...group].sort((a, b) => {
      const rank = (tier: string) => (tier === "A" ? 0 : tier === "B" ? 1 : tier === "C" ? 2 : tier === "D" ? 3 : 4);
      return rank(a.tier) - rank(b.tier) || a.text.length - b.text.length;
    })[0]!;
    const point = cleanGist(extractKeypoint(best), best);
    const keywords = [...new Set(group.flatMap((passage) => passage.keywords))];
    const citationRefs = [...new Set(group.flatMap((passage) => passage.citationRefs))];
    const tier = group.some((passage) => passage.tier === "A")
      ? ("A" as const)
      : group.some((passage) => passage.tier === "B")
        ? ("B" as const)
        : group.some((passage) => passage.tier === "C")
          ? ("C" as const)
          : ("D" as const);
    gists.push({
      id: `gist-${stableHash(sectionKey).slice(0, 16)}`,
      sectionKey,
      docTitle: best.docTitle,
      topic: best.topic,
      gist: point.length > 160 ? `${point.slice(0, 160)}…` : point,
      keywords,
      citationRefs,
      tier,
      passageIds: group.map((passage) => passage.id),
      ...(group.some((passage) => passage.experimental) ? { experimental: true as const } : {}),
    });
  }
  return { keypoints, gists };
}

/** 构建全部知识段落（缺失的文档跳过并记录，不静默）。 */
export interface PassageBuildReport {
  passages: readonly KnowledgePassage[];
  /** 文档不存在。 */
  missing: readonly string[];
  /** 按政策不发布的文档。 */
  unpublished: readonly { path: string; reason: string }[];
  /** 被小节政策剔除的段落数（按文档）。 */
  excludedBySection: Readonly<Record<string, number>>;
  /** 被内容过滤剔除的段落（含原因，可审计）。 */
  excludedByContent: readonly { sourcePath: string; section: string; label: string }[];
}

export function buildKnowledgePassages(repoRoot = process.cwd()): PassageBuildReport {
  const passages: KnowledgePassage[] = [];
  const missing: string[] = [];
  const unpublished: { path: string; reason: string }[] = [];
  const excludedBySection: Record<string, number> = {};
  const excludedByContent: { sourcePath: string; section: string; label: string }[] = [];

  for (const doc of SOURCE_DOCS) {
    if (!doc.publish) {
      unpublished.push({ path: doc.path, reason: doc.reason ?? "未说明" });
      continue;
    }
    const absolute = join(repoRoot, doc.path);
    if (!existsSync(absolute)) {
      missing.push(doc.path);
      continue;
    }
    const raw = readFileSync(absolute, "utf8");
    // 措辞纪律清洗在切分前应用（小节标题同步生效），替换可数、可审计。
    const markdown = (doc.contentReplacements ?? []).reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), raw);
    const candidates = splitDocument(markdown, doc.title, doc.path);
    for (const passage of candidates) {
      // 小节政策
      const sectionExcluded = (doc.excludeSections ?? []).some((pattern) =>
        passage.sectionPath.some((section) => pattern.test(section)),
      );
      if (sectionExcluded) {
        excludedBySection[doc.path] = (excludedBySection[doc.path] ?? 0) + 1;
        continue;
      }
      // 整段剔除（通体内部内容）
      const drop = doc.skipContentDrop ? undefined : DROP_PASSAGE_PATTERNS.find((entry) => entry.pattern.test(passage.text));
      if (drop) {
        excludedByContent.push({
          sourcePath: doc.path,
          section: passage.sectionPath.join(" › "),
          label: drop.label,
        });
        continue;
      }
      // 行内剔除（混合段落：保留证据，删掉内部决策行）
      const cleaned = stripInternalLines(passage.text);
      if (!cleaned) {
        excludedByContent.push({
          sourcePath: doc.path,
          section: passage.sectionPath.join(" › "),
          label: "清洗后内容不足",
        });
        continue;
      }
      const finalized = cleaned === passage.text
        ? passage
        : {
            ...passage,
            text: cleaned,
            // 清洗改变了内容 → 证据等级与关键词都要按清洗后的文本重算
            tier: inferTier(cleaned),
            keywords: extractKeywords(cleaned, passage.sectionPath),
            citationRefs: citationsFor(cleaned),
            contentHash: stableHash(cleaned),
          };
      passages.push({
        ...finalized,
        // doc 级政策覆盖：方法论语料固定 tier D（作者经验而非文献证据）；
        // dogfood 期内容标 experimental。
        ...(doc.defaultTier ? { tier: doc.defaultTier } : {}),
        ...(doc.experimental ? { experimental: true as const } : {}),
      });
    }
  }
  return { passages, missing, unpublished, excludedBySection, excludedByContent };
}

if (require.main === module) {
  const { passages, missing, unpublished, excludedBySection, excludedByContent } = buildKnowledgePassages();
  const skipped = missing;
  const byTier = passages.reduce<Record<string, number>>((acc, passage) => {
    acc[passage.tier] = (acc[passage.tier] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`built ${passages.length} passages from ${SOURCE_DOCS.length - skipped.length} docs`);
  console.log(`tiers: ${JSON.stringify(byTier)}`);
  console.log(`with citations: ${passages.filter((passage) => passage.citationRefs.length > 0).length}`);
  if (skipped.length) console.log(`missing docs: ${skipped.join(", ")}`);
  console.log(`\n── 策展结果（可审计）──`);
  for (const item of unpublished) console.log(`  不发布 ${item.path}：${item.reason}`);
  for (const [path, count] of Object.entries(excludedBySection)) {
    console.log(`  小节剔除 ${path}：${count} 段`);
  }
  const byLabel = excludedByContent.reduce<Record<string, number>>((acc, item) => {
    acc[item.label] = (acc[item.label] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  内容过滤剔除：${excludedByContent.length} 段 ${JSON.stringify(byLabel)}`);
}

/**
 * 蒸馏层的质量规则（保守抽取，宁可短不可假）：
 * - 是问题（以"？"或"?"结尾）→ 替换为该小节的证据句
 * - 是"流传说法"转述 → 替换为证据句（流传说法本身不是结论）
 * - 超过 ~120 字符（标题堆叠/未截断）→ 截断
 */
function cleanGist(point: string, passage: KnowledgePassage): string {
  let result = point;
  const isQuestion = /[？?]$/.test(result.trim());
  const isRumor = /^流传说法|^民间说法|^很多人认为/.test(result.trim());
  if (isQuestion || isRumor) {
    // 找该小节里的"证据/结论"句作为要点
    const evidence = passage.text
      .split("\n")
      .map((line) => line.trim().replace(/^\*\*|\*\*$/g, ""))
      .find((line) => line.length >= 15 && /^(证据|结论|答案|实际上|但其实|事实上)/.test(line));
    if (evidence) result = evidence.replace(/\*\*/g, "");
  }
  return result.length > 140 ? `${result.slice(0, 140)}…` : result;
}
