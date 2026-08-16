/**
 * S01 医疗转介红线（确定性输入检测，不依赖模型自觉）。
 *
 * 词表来源：docs/research/coaching-diagnostic-patterns-2026-08-16.md S01
 * （2026-08-16 作者确认）。这是 agent 自身行为的硬边界——与「以执行者为准」
 * 不冲突：用户主权覆盖训练偏好规则；S01 约束 agent 是否给建议。
 * 命中即转介：不编排训练、不给「练轻点试试」的分支、不推测病名/严重程度。
 */

export interface RedLinePolicy {
  readonly version: string;
  readonly patterns: readonly { readonly id: string; readonly pattern: RegExp }[];
  /** 命中后注入 run 上下文的固定指令。 */
  readonly instruction: string;
}

export const RED_LINE_POLICY: RedLinePolicy = {
  version: "red-lines.v1 (S01 2026-08-16)",
  patterns: [
    // 剧痛/剧烈疼痛（裸词即命中——S01 列表首条的分量级信号）
    { id: "severe_pain", pattern: /剧痛|剧烈(疼|痛)|疼[得要命到不行]|痛[得要命到不行]|severe pain|unbearable pain/i },
    // 疼到影响走路或上下楼
    { id: "pain_limits_daily_function", pattern: /疼[到得]?(走|上楼|下楼|爬楼|日常|影响).*|(走|上楼|下楼|爬楼).*(疼|痛)|couldn'?t walk|can'?t walk|pain (to|when) (walk|climb)|hurts to (walk|climb)/i },
    // 关节打软、卡住、错位感
    { id: "joint_mechanical", pattern: /打软|卡住|交锁|错位|脱臼|关节.*(卡|锁|软)|locking|giving way| buckle|dislocat/i },
    // 明显肿胀
    { id: "swelling", pattern: /肿(胀|起来|了|的)|明显.*肿|swollen|swelling/i },
    // 麻、刺痛、放射症状
    { id: "neurological", pattern: /麻(木|了|的)|刺痛|放射|窜[到至]|(麻|疼|痛).*(小腿|手臂|手指|脚趾)|numb|tingl|radiat|shooting pain/i },
    // 不训练/休息时也持续疼
    { id: "pain_at_rest", pattern: /不(练|训练|动|运动).*(也|还).*(疼|痛)|休息.*(也|还).*(疼|痛)|持续(疼|痛)|一直(疼|痛)|pain at rest|hurts (all the time|even when resting)|constant(ly)? (pain|hurts)/i },
    // 外伤史
    { id: "trauma_history", pattern: /(摔|扭|撞|拉伤|撕裂|骨折|断|伤)(了|过)|受过伤|外伤|(扭|拉|撞)伤|撕裂|骨折|(之前|去年|以前|曾经).*(断|裂|伤)|sprain|fracture|tore|torn|injur(ed|y)|accident/i },
  ],
  instruction: [
    "SAFETY REFERRAL (fixed rule, not advisory, overrides conversation style): the user's latest message matches medical red-flag patterns.",
    "You MUST clearly advise seeking prompt medical evaluation, MUST NOT give training workarounds or lighter-variation branches for this symptom, and MUST NOT name, guess, or rule out any condition, severity, or prognosis.",
    "Plain language, one clear referral, then stop the training thread for that symptom.",
  ].join(" "),
};

/** 命中即返回词表条目 id；未命中 undefined。纯函数、确定性。 */
export function detectRedLine(text: string): readonly string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  return RED_LINE_POLICY.patterns.filter(({ pattern }) => pattern.test(normalized)).map(({ id }) => id);
}
