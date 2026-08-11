import type { TranslationTable } from "./core";

/**
 * 文案资源表（客户端唯一文案来源）。
 *
 * 键名约定：`域.范围.名称`（点分层）。
 * 英文为权威源，中文为翻译。新增语言加字段、更新类型、注册表。
 *
 * 初始覆盖：planner 用户可见文案（目标时间线 / 人群分层 / 饮食耦合 / 进食编排）。
 * 后续逐步把 src/mobile、src/coach 里散落的中文迁到这里。
 */

/** 规划（planner 产出的结构化 code 在这里翻译成文案）。 */
export const PLANNING_COPY: TranslationTable = {
  // 目标时间线 — 速度档
  "timeline.pace.aggressive": {
    en: "Fastest path: max safe daily deficit; requires strict load retention, high protein and a circuit-breaker",
    zh: "最快路径：每天顶到安全赤字上限，需严格保负荷+高蛋白+熔断机制",
  },
  "timeline.pace.standard": {
    en: "Balanced path: moderate deficit, better lean-mass protection and adherence",
    zh: "平衡路径：赤字适中，瘦体重保护更好，依从性更高",
  },
  "timeline.pace.gentle": {
    en: "Gentle path: smallest deficit, minimal impact on training performance",
    zh: "稳健路径：赤字最小，几乎不影响训练表现",
  },
  // 目标时间线 — 兜底说明
  "timeline.fallback.honest": {
    en: "I won't invent a precise timeline without body-fat data. For your build, a reasonable rate is {minPercent}-{maxPercent}% of body weight per week{kgPart}. Set your goal by a state you can see yourself, and we track progress with real weekly weight trends — how far and how fast depends on execution, and we calibrate as we go.",
    zh: "没有体脂率数据，我不给你编一个精确周数。按你的体型，合理的速度是每周掉体重的 {minPercent}-{maxPercent}%{kgPart}。目标用你能自己看到的状态来定，每周用真实体重趋势看进展——能持续多久、到什么程度，取决于执行，我们边走边校准。",
  },
  "timeline.fallback.kgPart": {
    en: " (about {minKg}-{maxKg} kg)",
    zh: "（约 {minKg}-{maxKg} kg）",
  },
  "timeline.upgrade.bodyFat": {
    en: "current + target body-fat %",
    zh: "当前体脂率 + 目标体脂率",
  },

  // 人群分层 — recomp 说明
  "tiering.recomp.leanBeginner": {
    en: "You're lean and new to training — this is the fastest-progress window, so we use a small surplus rather than a deficit; no need to cut yet.",
    zh: "你偏瘦且刚开始系统训练，正处于增肌的新手窗口期——这个阶段进步最快，所以用小幅热量盈余而非赤字，不用急着减脂。",
  },
  "tiering.recomp.noviceHighMass": {
    en: "At your training stage and build, you can lose fat and build muscle at the same time — diet + resistance training + enough protein is the combination.",
    zh: "以你的训练阶段和体型，这个阶段完全可以一边减脂一边增肌——饮食 + 抗阻 + 足量蛋白就是组合。",
  },
  "tiering.recomp.preserveFocus": {
    en: "At your training age, the goal during a cut is to keep muscle and strength — gaining will be slow, so we focus on preservation.",
    zh: "以你的训练年限，减脂期的目标是保住肌肉与力量，增肌会很慢——我们把重点放在保。",
  },
  "tiering.recomp.postBulkCut": {
    en: "You just finished a gaining phase — start with a small deficit and keep training load; avoid adding lots of cardio while slashing carbs at the same time.",
    zh: "你刚结束增肌期——起步用小赤字、保住训练负荷，不同时加大量有氧又猛降碳。",
  },
  "tiering.recomp.possible": {
    en: "For your situation, muscle gain and body-composition maintenance can go together.",
    zh: "以你的情况，增肌与维持体成分可以并行。",
  },
  "tiering.physique.dualTrack": {
    en: "A physique goal (broad shoulders, narrow waist) needs both tracks: enough shoulder/back size and low enough body fat — so load and protein can't be skimped.",
    zh: "形态目标（宽肩窄腰）需要两条腿一起走：肩背维度要够，体脂要够低。所以力量刺激和蛋白都不能省。",
  },

  // 进食编排 — 空腹说明（通用）
  "fueling.fasted.notMoreFatLoss": {
    en: "Fasted cardio does not burn more fat overall — its value is convenience and adherence, not a metabolic advantage.",
    zh: "空腹本身不会让你多减脂——它的价值在方便与好坚持，不是代谢杠杆。",
  },
} as const;

/** 汇总（新域注册到这里）。 */
export const TRANSLATIONS: Readonly<Record<string, TranslationTable>> = {
  planning: PLANNING_COPY,
} as const;
