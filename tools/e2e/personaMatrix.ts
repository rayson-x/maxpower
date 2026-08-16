import type {
  CoachingMandateData,
  GoalContractData,
  UserProfileData,
} from "../../src/coach/domain";

/**
 * 端到端验证人设矩阵（数据档案层）。
 *
 * 覆盖维度：性别 × 年龄（17-63）× 体型（BMI 17.6-34.9）× 训练年限（0-10y）
 * × 目标（增肌/增力/减脂两档诉求/维持/复训）× 天数（2-6）× 单次时长（20-90min）
 * × 器械（全套/商业/家庭/徒手/酒店）× 意愿向量（训练/饮食/作息各三档）
 * × 特殊情形（青少年/老年/产后/孕期/伤病史/平台期/大基数/极少信息）
 *
 * 纪律：这里只放"用户会填的内容"。任何期望输出（该给几组、该不该拒绝）
 * 都不在此文件里断言——留给 expectations，避免把实现写进档案。
 */

export interface Persona {
  id: string;
  label: string;
  /** 用户自述（模拟真实提交时说的话，供 LLM 在环回放） */
  selfDescription: string;
  profile: UserProfileData;
  goalContract: GoalContractData;
  mandate: CoachingMandateData;
  /** 该人设最值得关注的验证点（人读，不参与断言） */
  watchFor: readonly string[];
}

const START = "2026-08-03";
const END = "2026-09-13";

function gym(id = "gym-main") {
  return {
    id,
    kind: "gym" as const,
    environment: { space: "large" as const, noise: "any" as const },
    availableEquipment: ["full_gym"],
  };
}

function commercialGym(id = "gym-commercial") {
  return {
    id,
    kind: "gym" as const,
    environment: { space: "large" as const, noise: "moderate" as const },
    availableEquipment: ["barbell", "dumbbell", "machine", "cable", "bench", "bodyweight"],
  };
}

function homeMinimal(id = "home") {
  return {
    id,
    kind: "home" as const,
    environment: { space: "medium" as const, noise: "quiet" as const },
    availableEquipment: ["dumbbell", "bodyweight", "floor_space", "resistance_band"],
  };
}

function bodyweightOnly(id = "home-bw") {
  return {
    id,
    kind: "home" as const,
    environment: { space: "small" as const, noise: "quiet" as const },
    availableEquipment: ["bodyweight", "floor_space"],
  };
}

function hotel(id = "hotel") {
  return {
    id,
    kind: "hotel" as const,
    environment: { space: "small" as const, noise: "quiet" as const },
    availableEquipment: ["dumbbell", "bodyweight", "floor_space", "treadmill"],
  };
}

function mandate(mode: CoachingMandateData["mode"] = "collaborative"): CoachingMandateData {
  return { id: "mandate-1", mode, planChangeAuthorization: "always_ask" };
}

function horizon() {
  return { startDate: START, endDate: END };
}

export const PERSONA_MATRIX: readonly Persona[] = [
  // ───────── 新手区（0 经验，意愿差异是重点）─────────
  {
    id: "p01-college-male-skinny-high-will",
    label: "大学男生 · 瘦 · 想变壮 · 意愿高",
    selfDescription: "我 20 岁男生，178cm 62kg，太瘦了想练壮一点。学校健身房器械挺全，一周能去三次，每次一小时左右。没什么运动基础。吃饭我可以配合，但让我一天吃六顿不太现实。",
    profile: {
      id: "profile-p01",
      locale: "zh-CN",
      demographics: { ageYears: 20, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 62, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 60 },
      locations: [gym("gym-campus")],
      bodyDirection: "gain_mass",
    },
    goalContract: {
      id: "goal-p01", primaryGoal: "hypertrophy",
      successMetrics: ["weekly_training_adherence", "body_mass_trend"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "high", nutrition: "standard", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["3 天应给全身分化", "新手无历史 → 校准起点而非猜重量", "热量方向应为小幅盈余"],
  },
  {
    id: "p02-office-male-belly-low-will",
    label: "白领男 · 超重 · 只想没那么胖 · 意愿低",
    selfDescription: "34 岁男，175cm 88kg，肚子太大了。天天加班，一周最多去两次健身房，每次半小时就想走。我不想吃得太克制，也不想搞得太复杂，就是别这么胖就行。",
    profile: {
      id: "profile-p02",
      locale: "zh-CN",
      demographics: { ageYears: 34, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 88, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "returning",
      schedule: { weeklyFrequency: 2, sessionDurationMinutes: 30 },
      locations: [commercialGym()],
      bodyDirection: "decrease_body_fat",
    },
    goalContract: {
      id: "goal-p02", primaryGoal: "fat_loss_preserve_lean_mass",
      successMetrics: ["weekly_training_adherence"],
      horizon: horizon(), status: "active",
      unacceptableCosts: ["严格控制饮食", "训练时间超过 40 分钟"],
      commitmentPreferences: { training: "minimal", nutrition: "flexible", recovery: "flexible" },
    },
    mandate: mandate(),
    watchFor: ["2 天×30 分钟应给可执行的极简结构，不是塞满", "饮食应走最小约束（只保蛋白底线）", "不该强推严格热量缺口"],
  },
  {
    id: "p03-female-shape-high-will",
    label: "女 · 塑形 · 要好身材 · 意愿高+严格饮食",
    selfDescription: "我 28 岁女生，163cm 58kg，想练出线条，屁股和肩膀想更明显一点，腰细一点。一周能练四次，每次一小时。饮食我愿意认真记录和控制。",
    profile: {
      id: "profile-p03",
      locale: "zh-CN",
      demographics: { ageYears: 28, sex: "female", height: { value: 163, unit: "cm" }, currentWeight: { value: 58, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 60 },
      locations: [gym()],
      bodyDirection: "decrease_body_fat",
      nutritionPreferences: ["高蛋白", "少油"],
      trainingHistorySummary: { recentSplit: ["upper", "lower"], weeklyVolume: [{ muscleGroup: "glutes", sets: 10 }] },
    },
    goalContract: {
      id: "goal-p03", primaryGoal: "fat_loss_preserve_lean_mass",
      modifiers: ["conditioning"],
      successMetrics: ["body_composition_trend", "strength_maintenance"],
      targets: { targetBodyFat: { value: 22, unit: "percent" } },
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "high", nutrition: "strict", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["4 天应给上下肢或更精细分化", "臀部有历史周量 10 组 → 不应回退到新手起点", "饮食应走完整目标追踪"],
  },
  {
    id: "p04-postpartum-female",
    label: "产后妈妈 · 8 个月 · 家庭器械 · 时间碎",
    selfDescription: "32 岁女，160cm 68kg，产后八个月，想恢复身材。家里有一对哑铃和瑜伽垫，一周能挤出三次，每次半小时。晚上带孩子睡不好。",
    profile: {
      id: "profile-p04",
      locale: "zh-CN",
      demographics: { ageYears: 32, sex: "female", height: { value: 160, unit: "cm" }, currentWeight: { value: 68, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "returning",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 30 },
      locations: [homeMinimal()],
      bodyDirection: "decrease_body_fat",
    },
    goalContract: {
      id: "goal-p04", primaryGoal: "fat_loss_preserve_lean_mass",
      successMetrics: ["weekly_training_adherence"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "standard", nutrition: "standard", recovery: "flexible" },
    },
    mandate: mandate(),
    watchFor: ["家庭哑铃器械可行性过滤", "睡眠差不应单次改计划", "不应对产后做医疗性判断"],
  },

  // ───────── 中级区 ─────────
  {
    id: "p05-male-strength-back-history",
    label: "中年男 · 力量进阶 · 腰伤史",
    selfDescription: "42 岁男，180cm 85kg，练了八年，主要练力量三大项。一周四次，每次一个半小时。三年前腰间盘突出过，现在硬拉不敢上大重量。饮食基本稳定，不想大改。",
    profile: {
      id: "profile-p05",
      locale: "zh-CN",
      demographics: { ageYears: 42, sex: "male", height: { value: 180, unit: "cm" }, currentWeight: { value: 85, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 },
      locations: [gym()],
      bodyDirection: "maintain",
      exerciseConstraints: [
        { kind: "cannot_do", movementPattern: "hip_hinge", reason: "腰间盘突出史，医生建议避免大重量硬拉", priority: "hard", scope: "future_policy" },
      ],
      strengthBaseline: { squat: { value: 140, unit: "kg" }, benchPress: { value: 100, unit: "kg" }, deadlift: { value: 150, unit: "kg" }, measuredAt: "2026-07-01", source: "user_confirmed" },
    },
    goalContract: {
      id: "goal-p05", primaryGoal: "strength",
      successMetrics: ["strength_progression"],
      targets: { strength: { squat: { value: 150, unit: "kg" }, benchPress: { value: 110, unit: "kg" } } },
      horizon: horizon(), status: "active",
      unacceptableCosts: ["腰部不适复发"],
      commitmentPreferences: { training: "high", nutrition: "standard", recovery: "strict" },
    },
    mandate: mandate(),
    watchFor: ["hinge 模式硬约束必须先于一切生效", "有力量基线 → 应锚定而非校准", "高级+4天 → 周量上限档"],
  },
  {
    id: "p06-older-male-hypertension",
    label: "退休男 · 63 岁 · 高血压服药 · 保持健康",
    selfDescription: "我 63 岁，170cm 72kg，退休了想练练身体别退化太快。有高血压，一直在吃药，血压控制得还行。社区健身房有器械，一周去三次，每次四十五分钟。",
    profile: {
      id: "profile-p06",
      locale: "zh-CN",
      demographics: { ageYears: 63, sex: "male", height: { value: 170, unit: "cm" }, currentWeight: { value: 72, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [commercialGym("gym-community")],
      bodyDirection: "maintain",
      professionalConstraints: [
        {
          id: "pc-p06", sourceDescription: "社区医院随诊医生", scope: ["training"],
          instruction: "避免憋气用力与倒立类动作；训练中如头晕立即停止",
          // 结构化：倒立类＝头下位，映射到我们目录里最接近的受限模式
          restrictedPatterns: ["core_flexion"],
          lowImpactOnly: false,
        },
      ],
    },
    goalContract: {
      id: "goal-p06", primaryGoal: "maintain",
      modifiers: ["health"],
      successMetrics: ["weekly_training_adherence", "functional_capacity"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "standard", nutrition: "flexible", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["专业约束必须注入并可见", "老年人群边界（当前产品是保守/转介策略）", "不应给出高血压的医疗建议"],
  },
  {
    id: "p07-yoga-to-strength-female",
    label: "瑜伽转力量 · 女 · 偏瘦 · 意愿全高",
    selfDescription: "25 岁女，168cm 52kg，练了两年瑜伽，柔韧性好但力气很小，想开始练力量和增点肌肉。健身房卡刚办，一周三次，每次一小时。睡眠饮食我都愿意配合调整。",
    profile: {
      id: "profile-p07",
      locale: "zh-CN",
      demographics: { ageYears: 25, sex: "female", height: { value: 168, unit: "cm" }, currentWeight: { value: 52, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 60 },
      locations: [gym()],
      bodyDirection: "gain_mass",
    },
    goalContract: {
      id: "goal-p07", primaryGoal: "hypertrophy",
      successMetrics: ["strength_progression", "body_mass_trend"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "high", nutrition: "strict", recovery: "strict" },
    },
    mandate: mandate(),
    watchFor: ["瑜伽背景不等于力量经验 → 仍应校准起点", "全高意愿 → 上限周量 + 完整追踪"],
  },
  {
    id: "p08-frequent-traveler",
    label: "常出差 · 酒店器械 · 只求维持",
    selfDescription: "38 岁男，182cm 80kg，练了四年。一年一半时间出差住酒店，只有哑铃和跑步机。一周能练四次，每次四十分钟。出差期间吃饭没法控制，就想别掉太多。",
    profile: {
      id: "profile-p08",
      locale: "zh-CN",
      demographics: { ageYears: 38, sex: "male", height: { value: 182, unit: "cm" }, currentWeight: { value: 80, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 40 },
      locations: [hotel(), gym("gym-home-city")],
      bodyDirection: "maintain",
    },
    goalContract: {
      id: "goal-p08", primaryGoal: "maintain",
      successMetrics: ["strength_maintenance"],
      horizon: horizon(), status: "active",
      unacceptableCosts: ["出差期间强制饮食记录"],
      commitmentPreferences: { training: "standard", nutrition: "flexible", recovery: "flexible" },
    },
    mandate: mandate(),
    watchFor: ["酒店器械（哑铃）可行性 → 不该出现杠铃动作", "维持目标应体现在剂量而非删内容"],
  },
  {
    id: "p09-teen-male",
    label: "高中生 · 17 岁 · 未成年边界",
    selfDescription: "我 17 岁，172cm 60kg，想变强壮点，学校有器械房，一周能练四次一小时。",
    profile: {
      id: "profile-p09",
      locale: "zh-CN",
      demographics: { ageYears: 17, sex: "male", height: { value: 172, unit: "cm" }, currentWeight: { value: 60, unit: "kg" } },
      adultConfirmed: false,
      returningStatus: "new",
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 60 },
      locations: [commercialGym("gym-school")],
      bodyDirection: "gain_mass",
    },
    goalContract: {
      id: "goal-p09", primaryGoal: "strength",
      successMetrics: ["strength_progression"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "high", nutrition: "standard", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["adultConfirmed=false 的产品边界如何处理（必须显式，不能静默照常）"],
  },

  // ───────── 疑难场景 ─────────
  {
    id: "p10-fatloss-plateau-female",
    label: "减脂平台期 · 女 · 8 周不掉秤",
    selfDescription: "30 岁女，165cm 70kg，已经减了三个月，前面掉了 6 斤，最近八周体重一动不动。一周练五次，饮食一直记录着，1400 大卡左右。是不是要再少吃点？",
    profile: {
      id: "profile-p10",
      locale: "zh-CN",
      demographics: { ageYears: 30, sex: "female", height: { value: 165, unit: "cm" }, currentWeight: { value: 70, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 5, sessionDurationMinutes: 60 },
      locations: [gym()],
      bodyDirection: "decrease_body_fat",
      nutritionPreferences: ["记录热量"],
      historyModifiers: {
        plateau: { durationWeeks: 8, priorStrategies: ["减少热量", "增加有氧"], executionAdherence: "high", recoveryChange: "worse", suspectedReasons: ["吃得太少", "睡眠变差"] },
      },
    },
    goalContract: {
      id: "goal-p10", primaryGoal: "fat_loss_preserve_lean_mass",
      successMetrics: ["body_composition_trend"],
      targets: { targetWeight: { value: 62, unit: "kg" } },
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "high", nutrition: "strict", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["不应简单答『再少吃』（知识库明确：低摄入不自动更好）", "recovery worse + adherence high → 应考虑恢复而非加码"],
  },
  {
    id: "p11-large-bodyweight-male",
    label: "大基数减重 · BMI 34.9 · 新手",
    selfDescription: "29 岁男，176cm 108kg，从来没练过。想减重，一周能去三次健身房，每次四十五分钟。跑步膝盖会疼。",
    profile: {
      id: "profile-p11",
      locale: "zh-CN",
      demographics: { ageYears: 29, sex: "male", height: { value: 176, unit: "cm" }, currentWeight: { value: 108, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [commercialGym()],
      bodyDirection: "decrease_body_fat",
      exerciseConstraints: [
        { kind: "cannot_do", movementPattern: "locomotion", reason: "跑步时膝关节疼痛", priority: "hard", scope: "future_policy" },
      ],
    },
    goalContract: {
      id: "goal-p11", primaryGoal: "fat_loss_preserve_lean_mass",
      successMetrics: ["weekly_training_adherence", "body_mass_trend"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "standard", nutrition: "standard", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["跑步约束 → 有氧应换低冲击形式", "大基数不应给徒手自重为主的方案"],
  },
  {
    id: "p12-hardgainer-male",
    label: "增肌困难 · 高瘦 · 5 天全高意愿",
    selfDescription: "23 岁男，185cm 65kg，练了两年多，力量有进步但体重几乎不涨。一周能练五次，每次一小时十五分。吃得下，愿意按量吃。",
    profile: {
      id: "profile-p12",
      locale: "zh-CN",
      demographics: { ageYears: 23, sex: "male", height: { value: 185, unit: "cm" }, currentWeight: { value: 65, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 5, sessionDurationMinutes: 75 },
      locations: [gym()],
      bodyDirection: "gain_mass",
      strengthBaseline: { squat: { value: 90, unit: "kg" }, benchPress: { value: 65, unit: "kg" }, deadlift: { value: 110, unit: "kg" }, measuredAt: "2026-07-20", source: "user_confirmed" },
      historyModifiers: { plateau: { durationWeeks: 12, priorStrategies: ["加练"], executionAdherence: "high", recoveryChange: "stable", suspectedReasons: ["吃得不够"] } },
    },
    goalContract: {
      id: "goal-p12", primaryGoal: "hypertrophy",
      successMetrics: ["body_mass_trend", "strength_progression"],
      targets: { targetWeight: { value: 72, unit: "kg" } },
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "high", nutrition: "strict", recovery: "strict" },
    },
    mandate: mandate(),
    watchFor: ["体重不涨+依从性高 → 营养应是主要杠杆而非再加训练量", "5 天应给 PPL 或上下肢，不是全身×5"],
  },
  {
    id: "p13-busy-mom-micro-sessions",
    label: "妈妈 · 碎片 20 分钟 × 6 天 · 徒手",
    selfDescription: "36 岁女，158cm 62kg，两个孩子，只能趁孩子睡觉练二十分钟，一周大概能六天。家里什么器械都没有。想紧实一点。",
    profile: {
      id: "profile-p13",
      locale: "zh-CN",
      demographics: { ageYears: 36, sex: "female", height: { value: 158, unit: "cm" }, currentWeight: { value: 62, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 6, sessionDurationMinutes: 20 },
      locations: [bodyweightOnly()],
      bodyDirection: "decrease_body_fat",
    },
    goalContract: {
      id: "goal-p13", primaryGoal: "fat_loss_preserve_lean_mass",
      successMetrics: ["weekly_training_adherence"],
      horizon: horizon(), status: "active",
      unacceptableCosts: ["单次超过 25 分钟"],
      commitmentPreferences: { training: "standard", nutrition: "flexible", recovery: "flexible" },
    },
    mandate: mandate(),
    watchFor: ["20 分钟必须给出可执行方案（不能给 6 动作）", "纯徒手 → 无变式的 slot 应被剔除且不崩", "6 天高频 + 短时长的分化选择"],
  },
  {
    id: "p14-female-powerlifter",
    label: "女举重 · 高级 · 5 天 × 90 分钟 · 全严格",
    selfDescription: "27 岁女，170cm 72kg，练力量举五年，蹲 130 卧 75 硬拉 150。备赛期，一周五练每次一个半小时，饮食睡眠都严格执行。",
    profile: {
      id: "profile-p14",
      locale: "zh-CN",
      demographics: { ageYears: 27, sex: "female", height: { value: 170, unit: "cm" }, currentWeight: { value: 72, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 5, sessionDurationMinutes: 90 },
      locations: [gym("gym-powerlifting")],
      bodyDirection: "maintain",
      strengthBaseline: { squat: { value: 130, unit: "kg" }, benchPress: { value: 75, unit: "kg" }, deadlift: { value: 150, unit: "kg" }, measuredAt: "2026-07-25", source: "user_confirmed" },
      trainingHistorySummary: { recentSplit: ["squat", "bench", "deadlift", "upper", "lower"], weeklyVolume: [{ muscleGroup: "quadriceps", sets: 16 }] },
    },
    goalContract: {
      id: "goal-p14", primaryGoal: "strength",
      successMetrics: ["strength_progression"],
      targets: { strength: { combinedTotal: { value: 375, unit: "kg" } } },
      horizon: horizon(), status: "active",
      plannedRecoveryEveryWeeks: 4,
      commitmentPreferences: { training: "high", nutrition: "strict", recovery: "strict" },
    },
    mandate: mandate("managed"),
    watchFor: ["高级+16 组历史 → 不能给新手周量", "managed 模式的自动应用与撤销", "显式 deload 间隔应被尊重"],
  },
  {
    id: "p15-knee-return-to-training",
    label: "膝伤复训 · 中级 · 谨慎起步",
    selfDescription: "31 岁男，178cm 76kg，练了三年，两个月前跑步伤了右膝，停训到现在。医生说可以逐步恢复力量训练，避免深蹲到底和跳跃。一周三次，每次五十分钟。",
    profile: {
      id: "profile-p15",
      locale: "zh-CN",
      demographics: { ageYears: 31, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 76, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "returning",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 50 },
      locations: [gym()],
      bodyDirection: "maintain",
      exerciseConstraints: [
        { kind: "cannot_do", movementPattern: "locomotion", reason: "膝关节康复期避免跳跃与跑动", priority: "hard", scope: "future_policy" },
      ],
      professionalConstraints: [
        {
          id: "pc-p15", sourceDescription: "骨科医生", scope: ["training", "exercise"],
          instruction: "深蹲不低于大腿平行；避免跳跃与急停变向；疼痛出现即停止",
          validUntil: "2026-10-01",
          romLimits: [{ pattern: "squat", limit: "not_below_parallel" }],
          lowImpactOnly: true,
        },
      ],
    },
    goalContract: {
      id: "goal-p15", primaryGoal: "return_to_training",
      successMetrics: ["weekly_training_adherence", "pain_free_sessions"],
      horizon: horizon(), status: "active",
      unacceptableCosts: ["膝关节疼痛加重"],
      commitmentPreferences: { training: "standard", nutrition: "standard", recovery: "strict" },
    },
    mandate: mandate(),
    watchFor: ["复训应保守起步（停训两个月）", "专业约束注入且计划中可见", "locomotion 约束硬过滤（跳跃/跑动）"],
  },
  {
    id: "p16-minimal-will-male",
    label: "意愿极低 · 只想别那么胖 · 家里徒手",
    selfDescription: "45 岁男，173cm 92kg。说实话我不太想运动，但体检报告不太好。家里练，一周两次，每次二十到三十分钟，最多这样了。吃的方面别管我。",
    profile: {
      id: "profile-p16",
      locale: "zh-CN",
      demographics: { ageYears: 45, sex: "male", height: { value: 173, unit: "cm" }, currentWeight: { value: 92, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 2, sessionDurationMinutes: 25 },
      locations: [bodyweightOnly()],
      bodyDirection: "decrease_body_fat",
    },
    goalContract: {
      id: "goal-p16", primaryGoal: "fat_loss_preserve_lean_mass",
      modifiers: ["health"],
      successMetrics: ["weekly_training_adherence"],
      horizon: horizon(), status: "active",
      unacceptableCosts: ["饮食限制", "训练超过 30 分钟"],
      commitmentPreferences: { training: "minimal", nutrition: "flexible", recovery: "flexible" },
    },
    mandate: mandate("manual"),
    watchFor: ["最低意愿 → 最低门槛方案，绝不加码", "manual 模式一切都要确认", "不应说教"],
  },
  {
    id: "p17-pregnant-female",
    label: "孕中期 · 应触发转介边界",
    selfDescription: "33 岁女，165cm 70kg，怀孕五个月了，想适当运动保持健康。家里有瑜伽垫和小哑铃，一周三次半小时。",
    profile: {
      id: "profile-p17",
      locale: "zh-CN",
      demographics: { ageYears: 33, sex: "female", height: { value: 165, unit: "cm" }, currentWeight: { value: 70, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 30 },
      locations: [homeMinimal()],
      bodyDirection: "maintain",
      professionalConstraints: [
        { id: "pc-p17", sourceDescription: "用户自述：孕中期", scope: ["training", "nutrition"], instruction: "孕期训练与营养需产科医生指导" },
      ],
    },
    goalContract: {
      id: "goal-p17", primaryGoal: "maintain",
      modifiers: ["health"],
      successMetrics: ["weekly_training_adherence"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "standard", nutrition: "standard", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["产品边界：孕期应转介而非自动生成方案", "不得输出任何孕期医疗建议"],
  },
  {
    id: "p18-minimal-info",
    label: "极少信息 · 无性别年龄身高体重",
    selfDescription: "我想练一下，不知道怎么开始。",
    profile: {
      id: "profile-p18",
      locale: "zh-CN",
      demographics: { sex: "prefer_not_to_say" },
      adultConfirmed: true,
      returningStatus: "new",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [bodyweightOnly()],
    },
    goalContract: {
      id: "goal-p18", primaryGoal: "hypertrophy",
      successMetrics: ["weekly_training_adherence"],
      horizon: { startDate: START }, status: "active",
    },
    mandate: mandate(),
    watchFor: ["缺失信息应标 unknown 并追问，绝不编造体重/热量", "无意愿显式选择 → 应走推断默认值"],
  },
  {
    id: "p19-dual-goal-male",
    label: "双目标 · 增肌 + 体能 · 4 天",
    selfDescription: "26 岁男，175cm 70kg，练了三年，想继续增肌但也想跑步别太废，准备年底跑个十公里。一周四次力量，每次一小时十五分。",
    profile: {
      id: "profile-p19",
      locale: "zh-CN",
      demographics: { ageYears: 26, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 70, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      locations: [gym()],
      bodyDirection: "gain_mass",
      strengthBaseline: { squat: { value: 110, unit: "kg" }, benchPress: { value: 80, unit: "kg" }, deadlift: { value: 130, unit: "kg" }, measuredAt: "2026-07-15", source: "user_confirmed" },
    },
    goalContract: {
      id: "goal-p19", primaryGoal: "hypertrophy",
      modifiers: ["conditioning"],
      successMetrics: ["body_mass_trend", "aerobic_capacity"],
      horizon: horizon(), status: "active",
      maintenanceFloors: ["每周至少一次有氧"],
      commitmentPreferences: { training: "high", nutrition: "standard", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["有氧与力量的干扰处理（并行目标）", "有氧应正式入列而非口头建议"],
  },
  {
    id: "p20-high-frequency-advanced",
    label: "高频 6 天 · 高级 · 全套器械",
    selfDescription: "24 岁男，180cm 78kg，练了六年，一周六天都能来，每次一小时。想继续增肌，肩和背是弱项。",
    profile: {
      id: "profile-p20",
      locale: "zh-CN",
      demographics: { ageYears: 24, sex: "male", height: { value: 180, unit: "cm" }, currentWeight: { value: 78, unit: "kg" } },
      adultConfirmed: true,
      returningStatus: "consistent",
      schedule: { weeklyFrequency: 6, sessionDurationMinutes: 60 },
      locations: [gym()],
      bodyDirection: "gain_mass",
      trainingHistorySummary: { recentSplit: ["push", "pull", "legs"], weeklyVolume: [{ muscleGroup: "deltoids", sets: 12 }, { muscleGroup: "back", sets: 14 }] },
      strengthBaseline: { squat: { value: 150, unit: "kg" }, benchPress: { value: 110, unit: "kg" }, deadlift: { value: 180, unit: "kg" }, measuredAt: "2026-07-28", source: "user_confirmed" },
    },
    goalContract: {
      id: "goal-p20", primaryGoal: "hypertrophy",
      successMetrics: ["body_mass_trend", "weak_point_volume"],
      horizon: horizon(), status: "active",
      commitmentPreferences: { training: "high", nutrition: "standard", recovery: "standard" },
    },
    mandate: mandate(),
    watchFor: ["6 天应给 PPL×2 轮转", "高级 → 周量上限（每肌群可达 12 组）", "弱项（肩背）是否体现"],
  },
];

/** 矩阵维度统计（人读，验证覆盖是否真的全）。 */
export function matrixCoverage() {
  const sexes = new Set(PERSONA_MATRIX.map((p) => p.profile.demographics?.sex ?? "absent"));
  const ages = PERSONA_MATRIX.map((p) => p.profile.demographics?.ageYears).filter((age): age is number => age !== undefined);
  const goals = new Set(PERSONA_MATRIX.map((p) => p.goalContract.primaryGoal));
  const days = new Set(PERSONA_MATRIX.map((p) => p.profile.schedule?.weeklyFrequency));
  const minutes = new Set(PERSONA_MATRIX.map((p) => p.profile.schedule?.sessionDurationMinutes));
  const trainingWill = new Set(PERSONA_MATRIX.map((p) => p.goalContract.commitmentPreferences?.training ?? "inferred"));
  const nutritionWill = new Set(PERSONA_MATRIX.map((p) => p.goalContract.commitmentPreferences?.nutrition ?? "inferred"));
  const bmis = PERSONA_MATRIX.map((p) => {
    const h = p.profile.demographics?.height?.value;
    const w = p.profile.demographics?.currentWeight?.value;
    return h && w ? Number((w / (h / 100) ** 2).toFixed(1)) : undefined;
  }).filter((bmi): bmi is number => bmi !== undefined);
  return {
    personas: PERSONA_MATRIX.length,
    sexes: [...sexes],
    ageRange: [Math.min(...ages), Math.max(...ages)],
    bmiRange: [Math.min(...bmis), Math.max(...bmis)],
    goals: [...goals],
    weeklyDays: [...days].sort(),
    sessionMinutes: [...minutes].sort((a, b) => (a ?? 0) - (b ?? 0)),
    trainingCommitment: [...trainingWill],
    nutritionCommitment: [...nutritionWill],
    withHardConstraints: PERSONA_MATRIX.filter((p) => p.profile.exerciseConstraints?.length).length,
    withProfessionalConstraints: PERSONA_MATRIX.filter((p) => p.profile.professionalConstraints?.length).length,
    withStrengthBaseline: PERSONA_MATRIX.filter((p) => p.profile.strengthBaseline).length,
    mandateModes: [...new Set(PERSONA_MATRIX.map((p) => p.mandate.mode))],
  };
}
