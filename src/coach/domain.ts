export const DOMAIN_EVENT_SCHEMA_VERSION = 1 as const;
export const COACH_LEDGER_SNAPSHOT_SCHEMA_VERSION = 7 as const;

export type DomainAggregateKind =
  | "user_profile"
  | "goal_contract"
  | "coaching_mandate"
  | "plan"
  | "workout_session"
  | "timeline"
  | "equipment_profile"
  | "recovery_constraint"
  | "nutrition_strategy"
  | "custom_exercise"
  | "permission_set"
  | "safety_constraint";

export interface DomainAggregateRef<K extends DomainAggregateKind = DomainAggregateKind> {
  kind: K;
  id: string;
  revision: number;
}

export interface DomainActor {
  kind: "user" | "agent" | "rule_engine" | "sensor" | "sync" | "system";
  id: string;
}

export interface CommandMeta {
  userId: string;
  actor: DomainActor;
  deviceId: string;
  occurredAt: string;
  timezoneOffsetMinutes: number;
  idempotencyKey: string;
  /** Import/replay only: preserves an immutable source event identity. */
  eventId?: string;
}

export interface LocalSettingsAuthorization {
  kind: "local_user_presence";
  verifiedAt: string;
  nonce: string;
}

export interface MassQuantity {
  value: number;
  unit: "kg" | "lb";
}

export interface EnergyQuantity {
  value: number;
  unit: "kcal" | "kJ";
}

export interface DurationQuantity {
  value: number;
  unit: "seconds" | "minutes" | "hours";
}

export interface PercentageQuantity {
  value: number;
  unit: "percent";
}

export interface LengthQuantity {
  value: number;
  unit: "cm" | "in";
}

export type EquipmentRequirement =
  | {
      kind: "item";
      id: string;
      quantity?: number;
      attachments?: readonly string[];
      loadRange?: { min: MassQuantity; max: MassQuantity; increment?: MassQuantity };
      discreteLoads?: readonly MassQuantity[];
      settings?: { min?: number; max?: number; increment?: number };
      fixedInstallation?: boolean;
      safeStopRequired?: boolean;
    }
  | {
      kind: "all";
      items: readonly EquipmentRequirement[];
    }
  | {
      kind: "any";
      items: readonly EquipmentRequirement[];
    }
  | {
      kind: "environment";
      space: "small" | "medium" | "large";
      noise: "quiet" | "moderate" | "any";
      floorImpact: "low" | "any";
      fixedConditions?: readonly string[];
    }
  | {
      /** A deliberate unknown is not equivalent to unavailable or available. */
      kind: "unknown";
      description?: string;
    };

export type ImmutableEvidenceRef =
  {
    kind: "canonical_packet";
    id: string;
    version: number;
    hash: string;
  };

export interface UserProfileData {
  id: string;
  locale: string;
  /** Decision-specific coaching evidence; there is deliberately no global beginner/intermediate/advanced label. */
  trainingCapabilities?: {
    trainingProgrammingUnderstanding: CoachingCapabilitySummary;
    exactExerciseFamiliarity: CoachingCapabilitySummary;
    currentComparablePerformance: CoachingCapabilitySummary;
    trainingContinuity: CoachingCapabilitySummary;
    selfRegulation: CoachingCapabilitySummary;
    executionStability: CoachingCapabilitySummary;
  };
  /** Optional intake facts stay absent when the user did not provide them. */
  demographics?: {
    ageYears?: number;
    sex?: "female" | "male" | "intersex" | "prefer_not_to_say" | "unknown";
    height?: LengthQuantity;
    currentWeight?: MassQuantity;
    /**
     * 当前围度（cm）：腰围最关键——有它就能用海军围度法估算体脂率，
     * 从而让目标时间线进入精确模式，不必要求用户自报体脂。
     * 键名约定：waist / neck / hip / chest / shoulder / thigh / arm
     */
    currentCircumferences?: Readonly<Record<string, LengthQuantity>>;
  };
  adultConfirmed?: boolean;
  returningStatus?: "new" | "returning" | "consistent";
  schedule?: { weeklyFrequency: number; sessionDurationMinutes: number };
  /**
   * 日常活动水平（**不含**结构化训练）。
   *
   * 为什么与 weeklyFrequency 分开：把训练频率与全天活动混成一个系数，是 TDEE 估算
   * 的主要误差源——一周练 5 天的久坐程序员和一周练 5 天的工地师傅日消耗差几百千卡。
   * 现在训练消耗按频率×时长单独估，日常消耗按这个字段估。
   *
   * sedentary 久坐办公 · lightly_active 有一定走动 · active 常走动/站立工作 ·
   * very_active 体力劳动
   */
  dailyActivityLevel?: "sedentary" | "lightly_active" | "active" | "very_active";
  /**
   * 有氧相关的代谢/低血糖风险筛查。它只记录用户已知事实，
   * 用于阻止不安全的自动空腹或高强度处方；不是诊断、也不提供用药建议。
   */
  metabolicExerciseSafety?: {
    diabetesType?: "type_1" | "type_2" | "other" | "unknown";
    usesInsulinOrSecretagogue?: boolean;
    hypoglycemiaHistory?: boolean;
    recentHypoglycemia?: boolean;
    hasGlucoseMonitoringPlan?: boolean;
    clinicianExercisePlan?: boolean;
  };
  locations?: readonly {
    id: string;
    kind: "home" | "gym" | "hotel" | "outdoor" | "other";
    environment: { space: "small" | "medium" | "large"; noise: "quiet" | "moderate" | "any" };
    availableEquipment: readonly string[];
  }[];
  bodyDirection?: "gain_mass" | "decrease_body_fat" | "maintain" | "performance_only";
  exerciseConstraints?: readonly import("../knowledge/model").ExerciseConstraintState[];
  /** Explicit user choices; a preference is never inferred from one temporary substitution. */
  exercisePreferences?: readonly {
    id: string;
    exerciseVariantId: string;
    movementPattern?: import("../knowledge/model").MovementPattern;
    scope: "future_preference";
    createdAt: string;
  }[];
  /** Per-metric; choosing a scale must not also choose a sleep/wearable source. */
  primaryDataSources?: import("../timeline").PrimarySourcePreferences;
  nutritionPreferences?: readonly string[];
  professionalConstraints?: readonly ProfessionalConstraint[];
  trainingHistorySummary?: {
    recentSplit?: readonly string[];
    weeklyVolume?: readonly { muscleGroup: string; sets: number }[];
  };
  strengthBaseline?: {
    squat?: MassQuantity;
    /** 用户报告的该重量完成次数；缺失时保留为未知，绝不把重量冒充为 1RM。 */
    squatReps?: number;
    benchPress?: MassQuantity;
    benchPressReps?: number;
    deadlift?: MassQuantity;
    deadliftReps?: number;
    measuredAt?: string;
    source?: "user_confirmed" | "estimated";
  };
  historyModifiers?: {
    /** 近期训练阶段（刚过增肌期/刚减脂/维持），影响起步策略。 */
    recentPhase?: "bulk" | "cut" | "maintain";
    priorStrategies?: readonly string[];
    plateau?: {
      durationWeeks?: number;
      priorStrategies?: readonly string[];
      executionAdherence?: "unknown" | "low" | "mixed" | "high";
      recoveryChange?: "unknown" | "worse" | "stable" | "better";
      suspectedReasons?: readonly string[];
    };
    majorWeightLossHistory?: {
      lostWeight?: MassQuantity;
      maintenanceExperience?: "unknown" | "short" | "established";
      reboundOrHunger?: "unknown" | "present" | "not_reported";
    };
  };
  bodyObservationRefs?: readonly string[];
  fieldProvenance?: Readonly<Record<string, FieldProvenance>>;
}

export interface CoachingCapabilitySummary {
  status: "unknown" | "provisional" | "supported" | "contradicted";
  unknowns: readonly string[];
  applicableExerciseVariantIds: readonly string[];
  reassessWhen: readonly string[];
}

export interface FieldProvenance {
  source: "form" | "conversation" | "health" | "import" | "professional";
  confidence: "confirmed" | "estimated" | "unknown";
  confirmedAt?: string;
}

export interface ProfessionalConstraint {
  id: string;
  sourceDescription: string;
  scope: readonly ("training" | "nutrition" | "exercise" | "schedule")[];
  instruction: string;
  validUntil?: string;
  /**
   * 结构化限制（2026-08-11）：规划引擎只消费这些字段，不对 instruction 做文本匹配。
   * instruction 保留为用户可读原文；缺结构化字段时该限制只作为上下文展示，
   * 并在 trace 里标记为 not_machine_actionable（要求 intake 补齐，而不是猜）。
   */
  restrictedPatterns?: readonly import("../knowledge/model").MovementPattern[];
  /** ROM 限制（如"深蹲不低于大腿平行"）。 */
  romLimits?: readonly { pattern: import("../knowledge/model").MovementPattern; limit: string }[];
  /** 是否需要专业许可才能自动规划（如孕期、术后）。 */
  requiresClearance?: boolean;
  /** 低冲击要求（跳跃/跑动受限）。 */
  lowImpactOnly?: boolean;
}

export interface GoalContractData {
  id: string;
  primaryGoal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass" | "physique" | "maintain" | "return_to_training";
  /**
   * Goal-specific forecast mode within the primary goal: a cut can protect
   * lean mass, prioritize a key lift, or use the larger-body-mass starting
   * model without creating a second goal identity.
   */
  targetMode?: "higher_body_mass_fat_loss" | "lean_mass_preserving_fat_loss" | "strength_priority_cut";
  /** The correction envelope; it is not permission to silently weaken a goal. */
  executionTier?: "protect_deadline" | "balanced" | "protect_sustainability";
  /** Hard conditions that candidate plans must preserve while pursuing the target. */
  guardrails?: {
    minimumRecovery?: number;
    requiredTrainingCompletion?: "key_sessions";
  };
  /** Comparable observations required before judging the target path. */
  measurementPlan?: {
    requiredMeasurements: readonly ("body_weight" | "body_fat_percentage" | "waist_circumference" | "shoulder_circumference" | "key_lift")[];
  };
  /**
   * A specific, user-granted exception to protect_original_path. Absence is
   * never treated as consent to move the deadline, reduce the outcome, or
   * lower the agreed execution burden.
   */
  slowdownConsent?: {
    grantedAt: string;
    allowedChanges: readonly ("deadline" | "target_outcome" | "execution_burden")[];
  };
  modifiers?: readonly ("conditioning" | "health")[];
  expectedDirection?: string;
  successMetrics?: readonly string[];
  horizon: { startDate: string; endDate?: string };
  acceptableCosts?: readonly string[];
  measurementStrategy?: readonly string[];
  maintenanceFloors?: readonly string[];
  /** 显式选择的计划性恢复窗口间隔（TP-DELOAD-001：默认不按日历强制 deload）。 */
  plannedRecoveryEveryWeeks?: number;
  /** 分领域意愿向量（用户自选、随时可改；不由系统推断）。
   * 训练/饮食/作息各自独立：意愿高的领域走最佳路线，意愿低的给最小约束方案并明说 trade-off。 */
  /** 缺席处理总开关（用户自选）：shift=轮转顺延（胸背腿一轮回不错过）；skip=默认跳过，只记录。 */
  missedSessionPolicy?: "shift" | "skip";
  /** 用户选择的饮食策略 id（供需图供给侧）；未选时按目标给默认。 */
  dietStrategyId?: string;
  /** 用户是否锁定该饮食策略（锁定时冲突只调训练，不建议换策略）。 */
  dietStrategyLocked?: boolean;
  /** 局部侧重肌群（塑形："想让臀/肩更明显"）；这些肌群周量提升，其余不低于维持线。 */
  emphasisMuscles?: readonly string[];
  /**
   * 用户主动选择**减弱**的部位（"我不想练肩/不想腿变粗"）。
   *
   * 纪律：只能来自用户明确表达，系统绝不替用户推断某个部位不重要。
   * 减到维持线而非归零——完全不练会造成结构失衡与代偿，
   * 除非用户在 exerciseConstraints 里明确禁用该动作模式。
   */
  deemphasisMuscles?: readonly string[];
  /** 每日步数目标（减脂期 NEAT 是掉秤停滞主因，休息日也适用）。 */
  dailyStepTarget?: number;
  /** 训练史中的近期阶段（刚过增肌期/刚减脂/维持），影响起步策略。 */
  recentPhase?: "bulk" | "cut" | "maintain";
  /** 目标达成的时间窗（周）；用户想要的速度。 */
  targetWeeks?: number;
  /** 速度档位（由 targetWeeks 推导或用户直接选）：激进 / 标准 / 稳健。 */
  pace?: "aggressive" | "standard" | "gentle";
  /** 有氧只在用户明确的角色/时机偏好内加码；缺失时走保守起步而非猜测。 */
  aerobicPreference?: {
    role: "health_baseline" | "fat_loss_acceleration" | "endurance_priority";
    timingPreference?: "after_strength" | "separate_session" | "either";
    intensityPreference?: "easy_moderate" | "intervals";
  };
  commitmentPreferences?: {
    training?: "minimal" | "standard" | "high";
    nutrition?: "flexible" | "standard" | "strict";
    recovery?: "flexible" | "standard" | "strict";
  };
  targets?: {
    targetWeight?: MassQuantity;
    targetBodyFat?: PercentageQuantity;
    /** 当前体脂率（用户测量或估算；时间反推的起点）。 */
    currentBodyFat?: PercentageQuantity;
    /** 目标肩腰比（"宽肩窄腰"类形态目标的量化：肩围/腰围）。 */
    targetShoulderWaistRatio?: number;
    /** 目标腰围。 */
    targetWaist?: LengthQuantity;
    /** 目标肩围。 */
    targetShoulder?: LengthQuantity;
    strength?: {
      squat?: MassQuantity;
      benchPress?: MassQuantity;
      deadlift?: MassQuantity;
      combinedTotal?: MassQuantity;
    };
    circumferences?: Readonly<Record<string, LengthQuantity>>;
  };
  unacceptableCosts?: readonly string[];
  status?: "draft" | "active";
}

export interface CoachingMandateData {
  id: string;
  mode: "manual" | "collaborative" | "managed";
  scopes?: {
    loadReps: "manual" | "confirm" | "managed_small_step";
    volume: "manual" | "confirm" | "managed_small_step";
    substitution: "manual" | "confirm" | "managed_small_step";
    schedule: "manual" | "confirm" | "managed_small_step";
    deload: "manual" | "confirm" | "managed_small_step";
    nutrition: "advice_only" | "confirm" | "managed_small_step";
    /**
     * Whether Coach may turn a clear statement made by the person in the
     * current conversation into a Timeline record on their behalf. This never
     * authorizes inferred, imported, or estimated facts.
     */
    recording?: "confirm" | "delegated";
  };
  limits?: { maxLoadIncreasePercent?: number; maxWeeklySetChange?: number };
  locks?: readonly {
    id: string;
    field: "exercise" | "training_day" | "load" | "sets" | "week_structure" | "professional_constraint";
    scope: "next_unstarted_set" | "current_session" | "future_sessions" | "week" | "current_plan_stage" | "goal" | "nutrition";
    value: unknown;
    expiresAt?: string;
  }[];
  validUntil?: string;
  /** Codex-style durable authority selection for future Plan changes. */
  planChangeAuthorization: "ask_this_time" | "always_ask" | "allow_once" | "allow_similar_small" | "deny";
}

export type PermissionStatus = "not_configured" | "denied" | "granted";

/**
 * Non-secret selection metadata for a user-owned remote language provider.
 * The API credential is deliberately absent: it lives only in SecureCredentialPort.
 */
export interface PermissionSetData {
  id: string;
  camera: PermissionStatus;
  health: PermissionStatus;
  notifications: PermissionStatus;
  remoteLlm: PermissionStatus;
  /**
   * 诊断 trace 上报的独立授权项。缺省（未写过）即 not_configured = 关闭，
   * 且 remoteLlm 授权是它的前提——诊断数据不搭便车。
   */
  observability?: PermissionStatus;
  remoteLlmDisclosure?: {
    taskRelevantHealthTrainingNutritionSleepAndExperienceSent: true;
    directIdentityFieldsRemoved: readonly (
      | "name"
      | "address"
      | "contact_details"
      | "precise_location"
      | "external_account_id"
    )[];
    consentedAt: string;
  };
}

export type StopSignal =
  | "chest_pain"
  | "dizziness_or_fainting"
  | "unusual_shortness_of_breath"
  | "new_significant_pain"
  | "palpitations"
  | "unusual_fatigue";

export interface SafetyConstraintData {
  id: string;
  disposition: "clear" | "pause_and_confirm" | "stop_and_seek_professional_guidance";
  reasons: readonly string[];
  stopSignals: readonly StopSignal[];
  professionalConstraints: readonly ProfessionalConstraint[];
  diagnosis?: never;
  validUntil?: string;
}

export interface WeeklyIntentData {
  id: string;
  ordinal: number;
  startDate: string;
  endDate: string;
  intent: string;
  materialization: "materialized" | "intent_only";
  stimulusBudget: readonly StimulusBudgetData[];
}

export interface StimulusBudgetData {
  key: string;
  movementPattern?: import("../knowledge/model").MovementPattern;
  muscleGroup?: string;
  targetExposure: number;
  priority: "primary" | "maintenance" | "optional";
}

export interface PlannedExerciseSet {
  id: string;
  targetReps?: { min: number; max: number };
  targetDuration?: DurationQuantity;
  targetDistance?: { value: number; unit: "m" | "km" };
  targetLoad?: MassQuantity;
  targetLoadStatus?: "unknown" | "historical_anchor" | "predicted_target";
  /**
   * 校准起点建议：仅当用户自报了力量基线（如 1RM）但缺少该动作的次数/RIR 上下文时给出。
   * 这**不是**目标负荷——负荷状态仍为 unknown，首组必须由用户确认后才成为事实。
   * 存在的意义：用户填的力量数据必须可见地影响输出，而不是被忽略。
   */
  calibrationStartSuggestion?: {
    load: MassQuantity;
    basis: "user_reported_strength_baseline";
    evidenceRef: string;
    note: string;
  };
  targetLoadBasis?: {
    source: "exact_variant_history";
    evidenceRef: string;
    equipmentIncrement?: MassQuantity;
    upperBound?: MassQuantity;
    confidence: number;
  };
  calibrationIntent?: string;
  targetRir?: number;
  /** 计划的 RIR 目标区间（权威）；targetRir 标量仅为旧消费者的兼容中点。 */
  targetRirRange?: { min: number; max: number };
  rest?: DurationQuantity;
}

export interface PlannedExerciseTask {
  id: string;
  exerciseVariantId: string;
  stimulusSlotId?: string;
  mode?: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  sets: readonly PlannedExerciseSet[];
}

export interface StimulusIntentData {
  movementPattern: import("../knowledge/model").MovementPattern;
  muscleGroups: readonly string[];
  /** 直接组归属肌群（周量账本唯一依据）；缺省时退回 muscleGroups。 */
  directMuscles?: readonly string[];
  stability: "supported" | "free" | "either";
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  fatigueIntent: "low" | "medium" | "high";
  priority: "primary" | "maintenance" | "optional";
}

export interface ExerciseResolutionData {
  status: "resolved" | "unresolved";
  exerciseVariantId?: string;
  satisfiedContracts: readonly string[];
  deviatedContracts: readonly string[];
  requiredEquipment: readonly string[];
  performanceComparability: "exact_variant" | "cold_start";
  coldStart: boolean;
  sessionTimeImpactMinutes: number;
  fatigueImpact: "low" | "medium" | "high";
  cameraCapability: "available" | "manual_only";
  reasonCodes: readonly string[];
}

export interface StimulusSlotData {
  id: string;
  intent: StimulusIntentData;
  prescription: {
    setCount: number;
    repRange?: { min: number; max: number };
    duration?: DurationQuantity;
    distance?: { value: number; unit: "m" | "km" };
    targetRir?: number;
    /** 计划的 RIR 目标区间（权威）；targetRir 标量仅为旧消费者的兼容中点。 */
    targetRirRange?: { min: number; max: number };
    rest?: DurationQuantity;
  };
  exerciseSlot: ExerciseResolutionData;
  lockedFields: readonly string[];
}

export interface PlannedSessionData {
  id: string;
  title: string;
  scheduledFor: string;
  knowledgePins: import("../knowledge/model").KnowledgeVersionPins;
  kind?: "weighted_reps" | "bodyweight_reps" | "cardio" | "recovery" | "rest";
  locationId?: string;
  durationBudget?: DurationQuantity;
  /** Deterministic estimate from warm-up, work sets, planned rest and exercise transitions. */
  estimatedDuration?: DurationQuantity;
  stimulusSlots?: readonly StimulusSlotData[];
  /** 进食状态编排（见 src/planning/sessionFueling.ts）：何时做、为什么可行、优势与风险。 */
  fueling?: {
    workType: "strength" | "high_intensity_aerobic" | "low_intensity_aerobic" | "walking";
    preferredState: "fasted" | "light_snack" | "fed" | "post_strength";
    acceptableStates: readonly ("fasted" | "light_snack" | "fed" | "post_strength")[];
    minMinutesAfterFullMeal: number | null;
    minMinutesAfterSnack: number | null;
    rationale: string;
    advantages: readonly string[];
    risks: readonly string[];
    /** 空腹是否适格（仅对可空腹的工作类型有意义）。 */
    fastedEligible?: boolean;
    fastedBlockers?: readonly string[];
    fastedNote?: string;
    /** 解析后的文献引用——让用户看到这条安排的依据。 */
    citations?: readonly {
      id: string;
      tier: "A" | "B" | "C" | "D" | "U";
      label: string;
      url?: string;
      claim: string;
    }[];
  };
  /** 独立呈现附加有氧，避免客户端把“力量后有氧”误显示为另一堂力量课。 */
  aerobicBlock?: {
    placement: "after_strength" | "separate_session";
    role: "health_baseline" | "fat_loss_acceleration" | "endurance_priority";
    intensity: "easy" | "moderate" | "vigorous";
    targetRpe: { min: number; max: number };
    talkTest: string;
    minutes: number;
    fastedEligible: boolean;
    reasonCodes: readonly string[];
    safetyNote?: string;
  };
  status?: "planned" | "frozen_for_workout";
  tasks: readonly PlannedExerciseTask[];
}

export interface WeekPlanData {
  id: string;
  ordinal: number;
  startDate: string;
  endDate: string;
  sessions: readonly PlannedSessionData[];
  stimulusBudget: readonly StimulusBudgetData[];
  materializedAt: string;
  /** 周量账本（ticket 03）：每肌群本周直接组数，由物化内容求和得出。 */
  weeklyDirectSets?: Readonly<Record<string, number>>;
}

/** 计划的进阶与校准阶段（验收标准 §1：起点必须带进阶路径，保守起点不得永久化）。 */
export interface ProgressionPolicyData {
  /** 当前是否处于校准阶段（负荷未锚定时的技术学习期）。 */
  phase: "calibration" | "working";
  /** 退出校准的条件（用户可读，且是确定性可判定的）。 */
  exitCriteria: readonly string[];
  /** 进阶条件与幅度（ACSM 2009 progression model：超出目标 1-2 次 → +2-10%）。 */
  progressionRule: string;
  /** 负荷增量上限（%）。 */
  maxLoadIncrementPercent: number;
  ruleVersion: string;
}

/** 计划级营养指导（按目标 × 饮食意愿生成；数值规则见营养知识库）。 */
export interface NutritionGuidanceData {
  mode: "minimal_constraint" | "standard" | "full_targets";
  proteinFloorPerKg: number;
  /** 体重换算后的每日蛋白区间（克）；无体重时缺省并进 unknowns。 */
  proteinGramsPerDay?: { min: number; max: number };
  calorieDirection: "small_surplus" | "maintenance" | "deficit";
  /** 绝对热量只在有可用体重与活动数据时给出；否则永远缺省。 */
  energyKcalPerDay?: number;
  /** 赤字幅度的周降幅目标（%体重/周，按体脂状态分档）。 */
  weeklyRateTarget?: { min: number; max: number };
  /** 每日步数目标（减脂期）。 */
  dailyStepTarget?: number;
  /** 维持热量估算（kcal/天，Mifflin-St Jeor × 活动系数；标为估算非测量）。 */
  maintenanceKcalEstimate?: number;
  /** 每日能量目标（kcal/天，含赤字/盈余方向）。 */
  dailyEnergyTargetKcal?: { min: number; max: number };
  /** 每日脂肪目标（克，下限约总能量 20-25%）。 */
  fatGramsPerDay?: { min: number; max: number };
  /** 碳循环各日型的碳水克数（高/中/低碳日的绝对量）。 */
  carbGramsByDayType?: {
    high: { min: number; max: number };
    moderate: { min: number; max: number };
    low: { min: number; max: number };
  };
  tracking: string;
  committedStrategyRef?: { id: string; revision: number };
  /** 显式未知项（如 body_weight_unknown）：禁止用推测值补齐。 */
  unknowns?: readonly string[];
  note: string;
}

/** 计划级恢复指导。 */
export interface RecoveryGuidanceData {
  sleepNote: string;
  /** 每日步数目标（减脂期 NEAT；休息日也适用）。 */
  dailyStepTarget?: number;
  restDayIntent: string;
  deloadPolicy: string;
}

export interface PlanRevisionData {
  id: string;
  goalContractRef: DomainAggregateRef<"goal_contract">;
  baseRevision?: number;
  /** Formal lifecycle. Reopening planning never reactivates an older revision. */
  lifecycle?: {
    state: "active" | "paused" | "completed" | "planning_required";
    changedAt: string;
    reason: "user_paused" | "coach_paused" | "goal_confirmed_complete" | "new_goal" | "replan_requested" | "candidate_committed" | "candidate_reverted";
    confirmedBy: "user" | "agent_with_user_confirmation" | "system";
  };
  effectiveFrom: string;
  knowledgePins: import("../knowledge/model").KnowledgeVersionPins;
  materializedWeeks?: readonly WeekPlanData[];
  /**
   * 用户视角的"接下来 7 天"（滚动窗口，跨日历周拼接）。
   *
   * 为什么需要：materializedWeeks 按日历周组织（周量账本需要固定周边界），
   * 但用户在周三打开应用时期待看到完整的一周安排，而不是"本周剩余 4 天"。
   * 这是纯派生视图，不参与引擎决策。
   */
  upcomingSevenDays?: readonly PlannedSessionData[];
  /**
   * 肌群恢复间隔冲突（含用户自己完成的训练）。
   * 只暴露不自动重排——重排牵连轮转续接/器械过滤/内容回填，需统一设计。
   */
  recoveryIntervalConflicts?: readonly {
    muscle: string;
    previousDate: string;
    conflictDate: string;
    actualGapDays: number;
    requiredGapDays: number;
    previousFromHistory: boolean;
  }[];
  /**
   * 动作主/次级肌群参与形成的相对恢复负荷预测。
   * 与 weeklyDirectSets 分离：前者用于恢复和排序，后者只用于训练量统计。
   */
  muscleFatigueForecast?: import("../planning/muscleFatigue").MuscleFatigueForecast;
  /**
   * 有氧的系统/下肢相对负荷预测。它与力量动作的肌群 RU 分开，
   * 让“今天跑了什么”能够影响明天候选腿课的准备度，而不伪装成力量训练组数。
   */
  cardioLoadForecast?: import("../planning/cardioLoad").CardioLoadForecast;
  /**
   * 连续训练队列：近端为已物化动作，远端只表示「满足恢复条件后最早可排」的动作意图。
   * 未来不锁死具体变式/重量，训练完成或恢复变化后必须重算。
   */
  continuousTrainingQueue?: import("../planning/continuousTrainingQueue").ContinuousTrainingQueue;
  /**
   * 每日能量预算（按日型严格分解，key = YYYY-MM-DD）。
   * 训练日消耗比休息日高 200-350 kcal，给周平均会让训练日吃不够、休息日吃过量。
   */
  dailyEnergyBudgets?: Readonly<Record<string, {
    bmrKcal: number;
    neatKcal: number;
    eatKcal: number;
    tefKcal: number;
    tdeeKcal: number;
    intakeTargetKcal?: number;
    /** 已计划但尚未完成的、用于滚动能量回调的额外低冲击活动估算。 */
    plannedExtraActivityKcal?: number;
    uncertaintyKcal: number;
  }>>;
  /** 已记录聚餐/超额后的滚动能量调整；量化日志优先，明确「吃多」陈述仅给低置信度范围。 */
  rollingEnergyAdjustment?: import("../planning/rollingEnergyAdjustment").RollingEnergyAdjustment;
  futureIntentRefs?: readonly string[];
  reasonCodes?: readonly string[];
  strategySelection?: import("../planning").StrategySelection;
  appliedPhaseStrategy?: import("../planning").AppliedPhaseStrategy;
  trainingStrategy?: import("../planning").TrainingStrategy;
  nutritionStrategy?: import("../planning").PlanningNutritionStrategy;
  recoveryStrategy?: import("../planning").RecoveryStrategy;
  explanation?: import("../planning").RecommendationExplanation;
  adaptiveForecasts?: readonly import("../planning").AdaptiveForecastScenario[];
  sessions: readonly PlannedSessionData[];
  /** 营养与恢复指导（ticket：计划=训练+饮食+恢复一体）。 */
  nutritionGuidance?: NutritionGuidanceData;
  recoveryGuidance?: RecoveryGuidanceData;
  /** 校准/进阶策略（每份计划必带，防止保守起点永久化）。 */
  progressionPolicy?: ProgressionPolicyData;
  /** Evidence contract for judging this current stage; missing never means failed. */
  observationContract?: {
    requiredSignals: readonly string[];
    minimumObservationDays: number;
    trackingSilenceReviewDays: number;
    reviewCadenceDays: number;
    successConditions: readonly string[];
    progressionConditions: readonly string[];
    holdConditions: readonly string[];
    fallbackConditions: readonly string[];
    stopConditions: readonly string[];
  };
  /** 人群分层说明（recomp 可行性与阶段提示，用户可读）。 */
  personaTieringNote?: string;
  /** 目标→时间反推（体脂目标存在时）：最快天数 + 三档速度 + 所需总能量差。 */
  goalTimeline?: import("../planning/goalTimeline").GoalTimeline;
  /** 饮食×训练耦合结果（碳水日型 + 冲突说明），见 src/planning/dietTrainingGraph.ts。 */
  dietTrainingCoupling?: {
    strategyId: string;
    strategyNameZh: string;
    goalFit: "good" | "workable_with_tradeoffs" | "poor";
    carbDayTypes: Readonly<Record<string, "high" | "moderate" | "low">>;
    conflicts: readonly {
      ruleId: string;
      severity: "blocking" | "tradeoff" | "advisory";
      code: string;
      explanation: string;
      defaultResolution: string;
    }[];
  };
}

export interface PlannedSessionRef {
  planId: string;
  planRevision: number;
  sessionPrescriptionId: string;
}

export type WorkoutSessionSource =
  | { kind: "planned"; plannedSessionRef: PlannedSessionRef }
  | { kind: "freestyle"; authoredBy: "user" | "agent" };

export type WorkoutSessionStatus = "planned" | "active" | "paused" | "completed" | "partial" | "abandoned";
export type WorkoutExecutionMode = "record_only" | "coach_monitor";

export interface WorkoutSessionPolicy {
  id: string;
  version: string;
  /** Explicit policy, not a magic UI timeout. */
  resumeWindowHours: number;
  defaultRest?: DurationQuantity;
}

export interface RestTimerData {
  id: string;
  setId: string;
  deadlineMonotonicMs: number;
  /** Optional because legacy/default clocks may not expose a stable epoch. */
  monotonicClockEpoch?: string;
  deadlineWallClockAt: string;
  duration: DurationQuantity;
  notificationId?: string;
}

export interface WorkoutExecutionState {
  status: WorkoutSessionStatus;
  mode: WorkoutExecutionMode;
  currentTaskId?: string;
  currentSetId?: string;
  pauseReason?: "user" | "safety" | "background" | "schedule";
  restTimer?: RestTimerData;
  policy: WorkoutSessionPolicy;
  transitions: readonly {
    from: WorkoutSessionStatus;
    to: WorkoutSessionStatus;
    reason: string;
    actor: DomainActor;
    occurredAt: string;
    idempotencyKey: string;
  }[];
}

export interface SetDraftData {
  id: string;
  prescriptionSetId: string;
  exerciseVariantId: string;
  /** Copied for UI convenience only; never becomes a SetOutcome until explicit confirmation. */
  proposedFromPrescription: PlannedExerciseSet;
  actualLoad?: MassQuantity;
  actualReps?: number;
  actualDuration?: DurationQuantity;
  actualDistance?: { value: number; unit: "m" | "km" };
  assistance?: string;
  actualRir?: number;
  noviceFeedback?: "easy" | "appropriate" | "hard";
  noviceFeedbackMappingVersion?: string;
  note?: string;
  status: "draft";
  createdAt: string;
  updatedAt: string;
}

export interface SessionOutcomeData {
  status: "completed" | "partial" | "abandoned";
  completedAt: string;
  completedWorkSets: number;
  directSets: number;
  incompletePrescriptionSetIds: readonly string[];
  /** Explicitly skipped prescription sets are resolved, but never counted as performed volume. */
  skippedPrescriptionSetIds?: readonly string[];
  subjectiveFeedback?: "easy" | "appropriate" | "hard";
  dataCompleteness: "complete" | "partial" | "manual_only";
}

export interface SetOutcomeData {
  id: string;
  prescriptionSetId: string;
  exerciseVariantId: string;
  actualLoad?: MassQuantity;
  actualReps?: number;
  actualDuration?: DurationQuantity;
  actualDistance?: { value: number; unit: "m" | "km" };
  assistance?: string;
  actualRir?: number;
  noviceFeedback?: "easy" | "appropriate" | "hard";
  noviceFeedbackMappingVersion?: string;
  note?: string;
  completedAs?: "confirmed_as_planned" | "user_edited" | "imported";
  source: "user_confirmed" | "imported";
  /** 组确认时间（实测休息的计算锚点）。 */
  recordedAt?: string;
  /** 实测休息秒数（休息计时器的经过时间；无计时器则不测——缺失不是零）。 */
  measuredRestSeconds?: number;
  /** 与计划休息的偏差（产品规则：<0.5×目标=过短，>1.5×=过长）。 */
  restDeviation?: "within" | "too_short" | "too_long";
}

/**
 * An explicit execution fact for a prescribed set the user chose not to do.
 * It advances the task frontier without fabricating a performed SetOutcome.
 */
export interface SkippedSetData {
  id: string;
  prescriptionSetId: string;
  exerciseVariantId: string;
  reason: string;
  skippedAt: string;
}

/**
 * A correction is a new, append-only fact about a committed set.  It keeps
 * the semantic set identity stable for comparable-performance queries while
 * the ledger retains both the recorded outcome and every correction event.
 */
export interface SetOutcomeCorrectionData {
  id: string;
  correctsOutcomeId: string;
  replacement: SetOutcomeData;
  reason: string;
}

/** Null explicitly clears a user-entered field; omission preserves it. */
export interface SetOutcomeCorrectionPatch {
  actualLoad?: MassQuantity | null;
  actualReps?: number | null;
  actualDuration?: DurationQuantity | null;
  actualDistance?: { value: number; unit: "m" | "km" } | null;
  assistance?: string | null;
  actualRir?: number | null;
  noviceFeedback?: "easy" | "appropriate" | "hard" | null;
  note?: string | null;
}

/**
 * Session totals are derived from committed set outcomes; the only
 * user-correctable session-level field in the first delivery is the user's
 * subjective feedback.  A terminal state is never reopened by a correction.
 */
export interface SessionOutcomeCorrectionData {
  id: string;
  outcome: SessionOutcomeData;
  reason: string;
}

export interface SessionOutcomeCorrectionPatch {
  status?: "completed" | "partial";
  subjectiveFeedback?: "easy" | "appropriate" | "hard" | null;
}

/**
 * A deliberately small, typed surface for edits made while a WorkoutSession
 * is running.  The caller never supplies a whole replacement document: this
 * keeps completed sets, an in-progress draft, and the immutable session
 * identity outside the editable surface.
 */
export type UpcomingWorkoutPlanChange =
  | {
      kind: "adjust_set";
      taskId: string;
      setId: string;
      patch: {
        targetReps?: { min: number; max: number } | null;
        targetDuration?: DurationQuantity | null;
        targetDistance?: { value: number; unit: "m" | "km" } | null;
        targetLoad?: MassQuantity | null;
        targetRir?: number | null;
        rest?: DurationQuantity | null;
      };
    }
  | {
      kind: "add_task";
      task: PlannedExerciseTask;
      index?: number;
    }
  | {
      kind: "remove_task";
      taskId: string;
    }
  | {
      kind: "replace_task_exercise";
      taskId: string;
      replacementExerciseVariantId: string;
      /**
       * A replacement starts a new comparable-performance context.  Caller
       * supplied sets may change reps/RIR/rest, but may never carry an
       * absolute target load from the prior exercise.
       */
      replacementSets?: readonly PlannedExerciseSet[];
    }
  | {
      /** Keep locked sets on the original task and insert a replacement for the unresolved remainder. */
      kind: "replace_remaining_task";
      taskId: string;
      replacementTaskId: string;
      replacementExerciseVariantId: string;
    }
  | {
      kind: "reorder_task";
      taskId: string;
      toIndex: number;
    };

export type TimelineFact =
  | {
      kind: "training";
      workoutSessionRef?: DomainAggregateRef<"workout_session">;
      /**
       * A user-reported session completed outside the guided workout flow.
       * It deliberately keeps the user's action names separate from an exact
       * catalog ExerciseVariant until that identity has been explicitly
       * resolved; a free-text report must never fabricate comparable strength
       * history for the planner.
       */
      reportedSession?: {
        /** A confirmed miss is a Record, not an absence of logging. */
        executionStatus?: "completed" | "partial" | "missed";
        /** Required when a manual Record claims an outcome for a planned session. */
        plannedSessionRef?: PlannedSessionRef;
        summary?: string;
        duration?: DurationQuantity;
        note?: string;
        exercises?: readonly {
          name: string;
          /**
           * The movement selected in the daily-log vocabulary. This is
           * intentionally only a broad concept: it must not be promoted to
           * an exact ExerciseVariant or comparable performance history until
           * the user has resolved the precise equipment/variation.
           */
          exerciseConceptId?: string;
          sets?: readonly {
            reps?: number;
            load?: MassQuantity;
            rir?: number;
          }[];
        }[];
      };
      historicalSet?: {
        exerciseVariantId: string;
        load: MassQuantity;
        reps: number;
        rir?: number;
      };
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "activity";
      activityType: string;
      duration?: DurationQuantity;
      distance?: { value: number; unit: "m" | "km" };
      intensity?: "easy" | "moderate" | "hard" | "unknown";
      /** 用户主观用力感 0–10；缺失时仅使用粗强度档位，绝不推测。 */
      perceivedExertion?: number;
      /** 仅记录用户报告的停止/异常信号，不由 Planner 诊断。 */
      symptoms?: readonly StopSignal[];
      /** The person's reported or explicitly confirmed exercise expenditure. */
      energyExpenditure?: EnergyQuantity;
      /** Keeps a reported number distinct from a conservative local/Coach estimate. */
      energyExpenditureSource?: "manual" | "rule_estimate";
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "nutrition";
      observationId: string;
      /** Absent when the person only recorded a time; it is then inferred for display only. */
      mealSlot?: import("../nutrition").MealSlot;
      /** Descriptive identity only; a food name or portion never implies nutrient values. */
      foods?: readonly import("../nutrition").FoodEntryData[];
      /** Only explicit, user-confirmed field values participate in nutrition accounting. */
      nutrients?: readonly import("../nutrition").NutrientValueData[];
      /** 用户明确报告的「相对当天计划多出多少」，与整日摄入总热量区分保存。 */
      reportedEnergyDeviationKcal?: number;
      observationMode?: "structured" | "descriptive";
      /** Only an explicit user selection may close the day's intake log. */
      dayCoverage?: "partial" | "complete";
      mealDescription?: string;
      /** Qualitative self-report stays qualitative; it is never converted to calories. */
      qualitative?: {
        proteinCompletion: "none" | "partial" | "met";
        hunger: "low" | "moderate" | "high";
        deviation: "none" | "small" | "large";
      };
      confidence: "confirmed";
    }
  | {
      kind: "sleep";
      duration?: DurationQuantity;
      quality?: number;
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "body";
      measurement:
        | { metric: "body_weight"; quantity: MassQuantity; condition?: string }
        | {
            metric: "body_fat_percentage";
            quantity: PercentageQuantity;
            condition?: string;
            method?: string;
            algorithmVersion?: string;
            estimate?: {
              formulaId: string;
              inputs: Readonly<Record<string, LengthQuantity | MassQuantity | number>>;
              range: { min: PercentageQuantity; max: PercentageQuantity };
              measuredAt: string;
              userOverride?: PercentageQuantity;
            };
          }
        | {
            metric: "circumference";
            site: string;
            quantity: LengthQuantity;
            condition?: string;
          };
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "recovery";
      perceivedRecovery?: number;
      fatigue?: number;
      hrv?: number;
      /** SDNN and RMSSD are intentionally never a shared baseline. */
      hrvMetric?: "sdnn" | "rmssd";
      hrvUnit?: "milliseconds";
      restingHeartRate?: number;
      restingHeartRateUnit?: "beats_per_minute";
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "symptom";
      symptom: "soreness" | "pain";
      area?: string;
      severity?: number;
      note?: string;
      confidence: "confirmed" | "estimated";
    }
  | {
      /** User-confirmed context that puts general coaching outside its safe product boundary. */
      kind: "clinical_context";
      context:
        | "diagnosed_condition"
        | "medication"
        | "pregnancy_or_postpartum"
        | "eating_disorder_or_low_energy_risk"
        | "recent_surgery_or_acute_injury"
        | "other";
      note?: string;
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "subjective";
      metric: "physique_satisfaction";
      value: number;
      note?: string;
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "schedule";
      effect: "availability_changed" | "travel" | "work_conflict" | "other";
      note?: string;
      confidence: "confirmed" | "estimated";
    }
  | {
      kind: "rest";
      note?: string;
      confidence: "confirmed" | "estimated";
    };

export interface EquipmentProfileData {
  id: string;
  name: string;
  schemaVersion?: 1;
  locationKind?: "home" | "gym" | "hotel" | "outdoor" | "other";
  environment?: {
    space: "small" | "medium" | "large";
    noise: "quiet" | "moderate" | "any";
    floorImpact: "low" | "any";
    fixedConditions?: readonly string[];
  };
  /** Kept as an import-friendly projection; `equipment` is authoritative when present. */
  equipmentIds: readonly string[];
  equipment?: readonly EquipmentProfileItemData[];
  catalogVersion?: string;
  reviewedAt?: string;
}

export interface EquipmentProfileItemData {
  id: string;
  status: "available" | "busy" | "broken" | "unknown";
  quantity?: number;
  attachments?: readonly string[];
  loadRange?: { min: MassQuantity; max: MassQuantity; increment?: MassQuantity };
  discreteLoads?: readonly MassQuantity[];
  settings?: readonly number[];
  note?: string;
}

export interface TemporaryEquipmentStateData {
  equipmentId: string;
  status: "available" | "busy" | "broken" | "unknown";
  scope: "current_session";
  observedAt: string;
  note?: string;
}

export interface RecoveryConstraintData {
  id: string;
  level: "normal" | "slight_reduction" | "recovery_priority" | "pause_and_confirm";
  validUntil: string;
  scope?: "next_set" | "remaining_session" | "next_session" | "future_plan";
  /** Short-lived execution availability, never a stable User Profile schedule. */
  availability?: { availableMinutes?: number; location?: string };
  intentions?: readonly {
    kind: "increase_rir" | "remove_optional_sets" | "shorten_session" | "extend_rest" | "avoid_area" | "reschedule" | "pause" | "warmup_check";
    magnitude?: number;
    area?: string;
  }[];
  evaluation?: {
    rulePackId: string;
    ruleVersion: string;
    evaluatedAt: string;
    triggeringFactRefs: readonly string[];
    corroboratingFactRefs: readonly string[];
    contradictingFactRefs: readonly string[];
    missingOrStale: readonly string[];
    reasonCodes: readonly string[];
    confirmationRequired: boolean;
  };
}

export interface NutritionStrategyData {
  id: string;
  goalContractRef: DomainAggregateRef<"goal_contract">;
  calorieRange?: { min: EnergyQuantity; max: EnergyQuantity };
  status?: "draft" | "active" | "paused" | "review_required";
  phase?: "hypertrophy" | "strength_stable" | "fat_loss_preserve_lean_mass";
  reviewWindow?: { startsAt: string; endsAt: string; minimumWeightObservations: number };
  macronutrientTargets?: {
    proteinGrams: { min: number; max: number };
    fatEnergyFloorPercent: number;
    carbohydrateGrams?: { min: number; max: number };
  };
  /** Optional explicit daily targets. The engine never derives these from a food name. */
  nutrientTargets?: Readonly<Partial<Record<import("../nutrition").NutrientId, {
    unit: "kcal" | "kJ" | "g" | "mg" | "mcg";
    minimum?: number;
    maximum?: number;
    target?: number;
  }>>>;
  dayTypes?: readonly {
    date: string;
    kind: "training" | "rest" | "deload" | "recovery";
    namedSessionId?: string;
    energy?: EnergyQuantity;
    carbohydrateGrams?: number;
  }[];
  ruleVersion?: string;
  confidence?: "provisional" | "trend_calibrated" | "low";
  evidenceRefs?: readonly string[];
}

export interface CustomExerciseVariantData {
  id: string;
  name: string;
  movement?: import("../knowledge/model").MovementPattern;
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  equipmentRequirement: EquipmentRequirement;
  unknownFields: readonly (
    | "expected_muscles"
    | "stimulus"
    | "difficulty"
    | "load_history"
    | "equipment"
    | "motion_capability"
  )[];
  motionCapability: "unknown";
}

export interface DomainEventEnvelope<
  Name extends DomainEventName,
  Kind extends DomainAggregateKind,
  Payload,
> {
  id: string;
  schemaVersion: typeof DOMAIN_EVENT_SCHEMA_VERSION;
  name: Name;
  userId: string;
  aggregate: DomainAggregateRef<Kind>;
  actor: DomainActor;
  deviceId: string;
  occurredAt: string;
  recordedAt: string;
  timezoneOffsetMinutes: number;
  provenance: {
    source: DomainActor["kind"];
    confidence: "confirmed" | "estimated" | "unknown";
  };
  evidenceRefs: readonly ImmutableEvidenceRef[];
  causationId: string;
  correlationId: string;
  payload: Payload;
}

export type DomainEventName =
  | "user_profile.created"
  | "user_profile.revised"
  | "user_profile.corrected"
  | "goal_contract.created"
  | "goal_contract.revised"
  | "coaching_mandate.created"
  | "coaching_mandate.revised"
  | "plan.revised"
  | "workout.prepared"
  | "workout.started"
  | "workout.state_changed"
  | "workout.draft_set_saved"
  | "workout.draft_set_retracted"
  | "workout.prescription_revised"
  | "workout.set_recorded"
  | "workout.set_skipped"
  | "workout.set_corrected"
  | "workout.completed"
  | "workout.outcome_corrected"
  | "timeline.fact_appended"
  | "timeline.fact_corrected"
  | "timeline.source_mutated"
  | "timeline.source_tombstoned"
  | "equipment_profile.created"
  | "equipment_profile.revised"
  | "recovery_constraint.created"
  | "recovery_constraint.revised"
  | "nutrition_strategy.created"
  | "nutrition_strategy.revised"
  | "custom_exercise.created"
  | "custom_exercise.revised"
  | "permission_set.created"
  | "permission_set.revised"
  | "safety_constraint.created"
  | "safety_constraint.revised"
  | "aggregate.archived"
  | "aggregate.restored";

export type DomainEvent =
  | DomainEventEnvelope<"user_profile.created" | "user_profile.revised", "user_profile", UserProfileData>
  | DomainEventEnvelope<
      "user_profile.corrected",
      "user_profile",
      { profile: UserProfileData; correctsEventId: string; reason: string }
    >
  | DomainEventEnvelope<"goal_contract.created" | "goal_contract.revised", "goal_contract", GoalContractData>
  | DomainEventEnvelope<"coaching_mandate.created" | "coaching_mandate.revised", "coaching_mandate", CoachingMandateData>
  | DomainEventEnvelope<"plan.revised", "plan", PlanRevisionData>
  | DomainEventEnvelope<
      "workout.prepared",
      "workout_session",
      {
        source: WorkoutSessionSource;
        plannedSessionRef?: PlannedSessionRef;
        frozenPrescription: PlannedSessionData;
        state: WorkoutExecutionState;
      }
    >
  | DomainEventEnvelope<
      "workout.started",
      "workout_session",
      {
        source: WorkoutSessionSource;
        plannedSessionRef?: PlannedSessionRef;
        frozenPrescription: PlannedSessionData;
        state: WorkoutExecutionState;
      }
    >
  | DomainEventEnvelope<"workout.state_changed", "workout_session", { state: WorkoutExecutionState }>
  | DomainEventEnvelope<"workout.draft_set_saved", "workout_session", { draft: SetDraftData }>
  | DomainEventEnvelope<"workout.draft_set_retracted", "workout_session", { draftId: string; reason: string }>
  | DomainEventEnvelope<
      "workout.prescription_revised",
      "workout_session",
      { frozenPrescription: PlannedSessionData; reason: string; scope: "next_set" | "future_sets" | "future_tasks" }
    >
  | DomainEventEnvelope<"workout.set_recorded", "workout_session", { outcome: SetOutcomeData }>
  | DomainEventEnvelope<"workout.set_skipped", "workout_session", { skipped: SkippedSetData }>
  | DomainEventEnvelope<"workout.set_corrected", "workout_session", { correction: SetOutcomeCorrectionData }>
  | DomainEventEnvelope<
      "workout.completed",
      "workout_session",
      { status: "completed" | "partial"; completedAt: string; outcome?: SessionOutcomeData }
    >
  | DomainEventEnvelope<
      "workout.outcome_corrected",
      "workout_session",
      { correction: SessionOutcomeCorrectionData }
    >
  | DomainEventEnvelope<
      "timeline.fact_appended",
      "timeline",
      { fact: TimelineFact; entry: import("../timeline").TimelineFactEnvelope }
    >
  | DomainEventEnvelope<
      "timeline.fact_corrected",
      "timeline",
      {
        fact: TimelineFact;
        correctsEventId: string;
        reason?: string;
        entry: import("../timeline").TimelineFactEnvelope;
      }
    >
  | DomainEventEnvelope<
      "timeline.source_mutated",
      "timeline",
      {
        fact: TimelineFact;
        sourceEventId: string;
        reason: "source_updated" | "source_deleted" | "source_revoked";
        entry: import("../timeline").TimelineFactEnvelope;
      }
    >
  | DomainEventEnvelope<
      "timeline.source_tombstoned",
      "timeline",
      { sourceEventId: string; reason: "source_deleted" | "source_revoked" }
    >
  | DomainEventEnvelope<
      "equipment_profile.created" | "equipment_profile.revised",
      "equipment_profile",
      EquipmentProfileData
    >
  | DomainEventEnvelope<
      "recovery_constraint.created" | "recovery_constraint.revised",
      "recovery_constraint",
      RecoveryConstraintData
    >
  | DomainEventEnvelope<
      "nutrition_strategy.created" | "nutrition_strategy.revised",
      "nutrition_strategy",
      NutritionStrategyData
    >
  | DomainEventEnvelope<
      "custom_exercise.created" | "custom_exercise.revised",
      "custom_exercise",
      CustomExerciseVariantData
    >
  | DomainEventEnvelope<
      "permission_set.created" | "permission_set.revised",
      "permission_set",
      PermissionSetData
    >
  | DomainEventEnvelope<
      "safety_constraint.created" | "safety_constraint.revised",
      "safety_constraint",
      SafetyConstraintData
    >
  | DomainEventEnvelope<
      "aggregate.archived" | "aggregate.restored",
      DomainAggregateKind,
      { reason?: string }
    >;

export interface AggregateRevisionState {
  kind: DomainAggregateKind;
  id: string;
  userId: string;
  revision: number;
  archived: boolean;
}

export interface DomainIdempotencyRecord {
  userId: string;
  actorId: string;
  intent: string;
  key: string;
  eventIds: readonly string[];
  aggregateRevisions: readonly DomainAggregateRef[];
  recordedAt: string;
}

export interface OutboxEntry {
  id: string;
  userId: string;
  replicaId: string;
  deviceId: string;
  domainEventId: string;
  payloadHash: string;
  status: "pending" | "acknowledged" | "conflict";
  createdAt: string;
  acknowledgedAt?: string;
  remoteCursor?: string;
  conflict?: {
    code: "concurrent_revision" | "unknown_schema" | "account_mismatch";
    remoteRevision?: number;
  };
}

export interface DataLifecycleStatus {
  aggregate: DomainAggregateRef;
  structuredData: "active" | "archived" | "missing";
  replicaReferences: {
    pending: number;
    acknowledged: number;
    conflicts: number;
  };
  evidenceReferences: {
    canonicalPackets: number;
    disposition: "retained" | "not_present";
  };
}

interface CommandBase<Type extends string> {
  type: Type;
  meta: CommandMeta;
}

export type DomainCommand =
  | (CommandBase<"user.bootstrap"> & {
      profile: UserProfileData;
      /** Optional by design: a confirmed dossier can enter record-first without a goal. */
      goalContract?: GoalContractData;
      mandate: CoachingMandateData;
    })
  | (CommandBase<"profile.revise"> & {
      profileId: string;
      expectedRevision: number;
      profile: UserProfileData;
    })
  | (CommandBase<"profile.correct"> & {
      profileId: string;
      expectedRevision: number;
      correctsEventId: string;
      reason: string;
      profile: UserProfileData;
    })
  | (CommandBase<"goal_contract.revise"> & {
      goalContractId: string;
      expectedRevision: number;
      goalContract: GoalContractData;
    })
  | (CommandBase<"goal_contract.confirm"> & {
      expectedGoalRevision: number;
      goalContract: GoalContractData;
      expectedMandateRevision: number;
      mandate: CoachingMandateData;
      authorization: LocalSettingsAuthorization;
    })
  | (CommandBase<"mandate.revise"> & {
      mandateId: string;
      expectedRevision: number;
      mandate: CoachingMandateData;
      authorization: LocalSettingsAuthorization;
    })
  | (CommandBase<"timeline.append"> & {
      timelineId: string;
      expectedRevision: number;
      fact: TimelineFact;
      entry: import("../timeline").TimelineFactEnvelope;
    })
  | (CommandBase<"timeline.correct"> & {
      timelineId: string;
      expectedRevision: number;
      correctsEventId: string;
      fact: TimelineFact;
      reason?: string;
      entry: import("../timeline").TimelineFactEnvelope;
    })
  | (CommandBase<"timeline.source_mutate"> & {
      timelineId: string;
      expectedRevision: number;
      sourceEventId: string;
      reason: "source_updated" | "source_deleted" | "source_revoked";
      fact: TimelineFact;
      entry: import("../timeline").TimelineFactEnvelope;
    })
  | (CommandBase<"timeline.source_tombstone"> & {
      timelineId: string;
      expectedRevision: number;
      sourceEventId: string;
      reason: "source_deleted" | "source_revoked";
    })
  | (CommandBase<"plan.revise"> & {
      planId: string;
      expectedRevision: number;
      revision: PlanRevisionData;
    })
  | (CommandBase<"plan.commit_candidate"> & {
      planId: string;
      expectedPlanRevision: number;
      revision: PlanRevisionData;
      nutrition?: { strategyId: string; expectedRevision: number; value: NutritionStrategyData };
      /** Consumes a one-shot Plan authorization in the same atomic commit. */
      mandate?: { mandateId: string; expectedRevision: number; value: CoachingMandateData };
    })
  | (CommandBase<"plan.set_lifecycle"> & {
      planId: string;
      expectedRevision: number;
      lifecycle: NonNullable<PlanRevisionData["lifecycle"]>;
    })
  | (CommandBase<"workout.start"> & {
      workoutId: string;
      expectedRevision: number;
      prescriptionRef: PlannedSessionRef;
      mode?: WorkoutExecutionMode;
      policy?: WorkoutSessionPolicy;
    })
  | (CommandBase<"workout.prepare"> & {
      workoutId: string;
      expectedRevision: number;
      prescriptionRef: PlannedSessionRef;
      mode: WorkoutExecutionMode;
      policy: WorkoutSessionPolicy;
    })
  | (CommandBase<"workout.prepare_freestyle"> & {
      workoutId: string;
      expectedRevision: number;
      frozenPrescription: PlannedSessionData;
      authoredBy: "user" | "agent";
      mode: WorkoutExecutionMode;
      policy: WorkoutSessionPolicy;
    })
  | (CommandBase<"workout.transition"> & {
      workoutId: string;
      expectedRevision: number;
      state: WorkoutExecutionState;
    })
  | (CommandBase<"workout.save_draft_set"> & {
      workoutId: string;
      expectedRevision: number;
      draft: SetDraftData;
    })
  | (CommandBase<"workout.retract_draft_set"> & {
      workoutId: string;
      expectedRevision: number;
      draftId: string;
      reason: string;
    })
  | (CommandBase<"workout.revise_prescription"> & {
      workoutId: string;
      expectedRevision: number;
      frozenPrescription: PlannedSessionData;
      reason: string;
      scope: "next_set" | "future_sets" | "future_tasks";
    })
  | (CommandBase<"workout.record_set"> & {
      workoutId: string;
      expectedRevision: number;
      outcome: SetOutcomeData;
    })
  | (CommandBase<"workout.skip_set"> & {
      workoutId: string;
      expectedRevision: number;
      skipped: SkippedSetData;
    })
  | (CommandBase<"workout.correct_set_outcome"> & {
      workoutId: string;
      expectedRevision: number;
      correction: SetOutcomeCorrectionData;
    })
  | (CommandBase<"workout.complete"> & {
      workoutId: string;
      expectedRevision: number;
      status: "completed" | "partial";
      outcome?: SessionOutcomeData;
      timeline?: {
        timelineId: string;
        expectedRevision: number;
        fact: TimelineFact;
        entry: import("../timeline").TimelineFactEnvelope;
      };
    })
  | (CommandBase<"workout.correct_session_outcome"> & {
      workoutId: string;
      expectedRevision: number;
      correction: SessionOutcomeCorrectionData;
    })
  | (CommandBase<"equipment_profile.revise"> & {
      equipmentProfileId: string;
      expectedRevision: number;
      equipmentProfile: EquipmentProfileData;
    })
  | (CommandBase<"recovery_constraint.revise"> & {
      recoveryConstraintId: string;
      expectedRevision: number;
      recoveryConstraint: RecoveryConstraintData;
    })
  | (CommandBase<"nutrition_strategy.revise"> & {
      nutritionStrategyId: string;
      expectedRevision: number;
      nutritionStrategy: NutritionStrategyData;
    })
  | (CommandBase<"custom_exercise.create"> & {
      customExerciseId: string;
      exercise: CustomExerciseVariantData;
    })
  | (CommandBase<"custom_exercise.revise"> & {
      customExerciseId: string;
      expectedRevision: number;
      exercise: CustomExerciseVariantData;
    })
  | (CommandBase<"permission_set.revise"> & {
      permissionSetId: string;
      expectedRevision: number;
      permissionSet: PermissionSetData;
      authorization: LocalSettingsAuthorization;
    })
  | (CommandBase<"safety_constraint.revise"> & {
      safetyConstraintId: string;
      expectedRevision: number;
      safetyConstraint: SafetyConstraintData;
    })
  | (CommandBase<"user_profile.set_archived"> & {
      aggregateRef: DomainAggregateRef<"user_profile">;
      archived: boolean;
      reason?: string;
    })
  | (CommandBase<"custom_exercise.set_archived"> & {
      aggregateRef: DomainAggregateRef<"custom_exercise">;
      archived: boolean;
      reason?: string;
    })
  | (CommandBase<"equipment_profile.set_archived"> & {
      aggregateRef: DomainAggregateRef<"equipment_profile">;
      archived: boolean;
      reason?: string;
    });

export interface DomainCommandResult {
  status: "committed" | "idempotent";
  eventIds: readonly string[];
  aggregateRevisions: readonly DomainAggregateRef[];
}

export interface Revisioned<T> {
  revision: number;
  value: T;
}

export interface TimelineProjectionEvent {
  eventId: string;
  revision: number;
  occurredAt: string;
  recordedAt: string;
  timezoneOffsetMinutes: number;
  fact: TimelineFact;
  envelope: import("../timeline").TimelineFactEnvelope;
  correctsEventId?: string;
  sourceMutationOfEventId?: string;
  tombstonesEventId?: string;
  lifecycle?: "active" | "superseded" | "tombstoned";
}

export interface WorkoutProjection {
  id: string;
  revision: number;
  source: WorkoutSessionSource;
  plannedSessionRef?: PlannedSessionRef;
  frozenPrescription: PlannedSessionData;
  setOutcomes: readonly SetOutcomeData[];
  skippedSets?: readonly SkippedSetData[];
  /** Effective corrections; original event facts remain in the Ledger. */
  setOutcomeCorrections?: readonly SetOutcomeCorrectionData[];
  drafts: readonly SetDraftData[];
  state: WorkoutExecutionState;
  outcome?: SessionOutcomeData;
  sessionOutcomeCorrections?: readonly SessionOutcomeCorrectionData[];
  status: WorkoutSessionStatus;
}

export interface DomainProjection {
  userId: string;
  profile?: Revisioned<UserProfileData>;
  goalContract?: Revisioned<GoalContractData>;
  mandate?: Revisioned<CoachingMandateData>;
  plan?: Revisioned<PlanRevisionData>;
  planStatus?: "current" | "stale_goal_contract";
  equipmentProfiles: readonly Revisioned<EquipmentProfileData>[];
  recoveryConstraints: readonly Revisioned<RecoveryConstraintData>[];
  nutritionStrategies: readonly Revisioned<NutritionStrategyData>[];
  customExercises: readonly Revisioned<CustomExerciseVariantData>[];
  permissions?: Revisioned<PermissionSetData>;
  safetyConstraints: readonly Revisioned<SafetyConstraintData>[];
  timeline: {
    revision: number;
    events: readonly TimelineProjectionEvent[];
    current: readonly TimelineProjectionEvent[];
    tombstones: readonly {
      eventId: string;
      revision: number;
      sourceEventId: string;
      reason: "source_deleted" | "source_revoked";
      occurredAt: string;
      recordedAt: string;
    }[];
  };
  workouts: readonly WorkoutProjection[];
  archivedAggregates: readonly DomainAggregateRef[];
}

export interface DomainProjectionQuery {
  userId: string;
  date?: string;
}

export function projectDomainEvents(
  events: readonly DomainEvent[],
  query: DomainProjectionQuery,
): DomainProjection {
  const relevant = events.filter((event) => event.userId === query.userId);
  let profile: Revisioned<UserProfileData> | undefined;
  let goalContract: Revisioned<GoalContractData> | undefined;
  let mandate: Revisioned<CoachingMandateData> | undefined;
  let plan: Revisioned<PlanRevisionData> | undefined;
  const equipmentProfiles = new Map<string, Revisioned<EquipmentProfileData>>();
  const recoveryConstraints = new Map<string, Revisioned<RecoveryConstraintData>>();
  const nutritionStrategies = new Map<string, Revisioned<NutritionStrategyData>>();
  const customExercises = new Map<string, Revisioned<CustomExerciseVariantData>>();
  let permissions: Revisioned<PermissionSetData> | undefined;
  const safetyConstraints = new Map<string, Revisioned<SafetyConstraintData>>();
  const archivedAggregates = new Map<string, DomainAggregateRef>();
  const timelineEvents: TimelineProjectionEvent[] = [];
  const timelineTombstones: {
    eventId: string;
    revision: number;
    sourceEventId: string;
    reason: "source_deleted" | "source_revoked";
    occurredAt: string;
    recordedAt: string;
  }[] = [];
  const workouts = new Map<string, WorkoutProjection>();

  for (const event of relevant) {
    if (event.name === "user_profile.created" || event.name === "user_profile.revised") {
      profile = { revision: event.aggregate.revision, value: event.payload };
    } else if (event.name === "user_profile.corrected") {
      profile = { revision: event.aggregate.revision, value: event.payload.profile };
    } else if (event.name === "goal_contract.created" || event.name === "goal_contract.revised") {
      goalContract = { revision: event.aggregate.revision, value: event.payload };
    } else if (
      event.name === "coaching_mandate.created" ||
      event.name === "coaching_mandate.revised"
    ) {
      mandate = { revision: event.aggregate.revision, value: event.payload };
    } else if (event.name === "plan.revised") {
      plan = { revision: event.aggregate.revision, value: event.payload };
    } else if (
      event.name === "equipment_profile.created" ||
      event.name === "equipment_profile.revised"
    ) {
      equipmentProfiles.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (
      event.name === "recovery_constraint.created" ||
      event.name === "recovery_constraint.revised"
    ) {
      recoveryConstraints.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (
      event.name === "nutrition_strategy.created" ||
      event.name === "nutrition_strategy.revised"
    ) {
      nutritionStrategies.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (
      event.name === "custom_exercise.created" ||
      event.name === "custom_exercise.revised"
    ) {
      customExercises.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (event.name === "permission_set.created" || event.name === "permission_set.revised") {
      permissions = { revision: event.aggregate.revision, value: event.payload };
    } else if (
      event.name === "safety_constraint.created" ||
      event.name === "safety_constraint.revised"
    ) {
      safetyConstraints.set(event.aggregate.id, {
        revision: event.aggregate.revision,
        value: event.payload,
      });
    } else if (event.name === "aggregate.archived") {
      archivedAggregates.set(`${event.aggregate.kind}:${event.aggregate.id}`, event.aggregate);
      if (event.aggregate.kind === "user_profile" && profile?.value.id === event.aggregate.id) {
        profile = { ...profile, revision: event.aggregate.revision };
      } else if (
        event.aggregate.kind === "goal_contract" &&
        goalContract?.value.id === event.aggregate.id
      ) {
        goalContract = { ...goalContract, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "plan" && plan?.value.id === event.aggregate.id) {
        plan = { ...plan, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "custom_exercise") {
        const current = customExercises.get(event.aggregate.id);
        if (current) customExercises.set(event.aggregate.id, { ...current, revision: event.aggregate.revision });
      } else if (event.aggregate.kind === "safety_constraint") {
        const current = safetyConstraints.get(event.aggregate.id);
        if (current) safetyConstraints.set(event.aggregate.id, { ...current, revision: event.aggregate.revision });
      } else if (event.aggregate.kind === "recovery_constraint") {
        const current = recoveryConstraints.get(event.aggregate.id);
        if (current) recoveryConstraints.set(event.aggregate.id, { ...current, revision: event.aggregate.revision });
      } else if (event.aggregate.kind === "nutrition_strategy") {
        const current = nutritionStrategies.get(event.aggregate.id);
        if (current) nutritionStrategies.set(event.aggregate.id, { ...current, revision: event.aggregate.revision });
      }
    } else if (event.name === "aggregate.restored") {
      archivedAggregates.delete(`${event.aggregate.kind}:${event.aggregate.id}`);
      if (event.aggregate.kind === "user_profile" && profile?.value.id === event.aggregate.id) {
        profile = { ...profile, revision: event.aggregate.revision };
      } else if (
        event.aggregate.kind === "goal_contract" &&
        goalContract?.value.id === event.aggregate.id
      ) {
        goalContract = { ...goalContract, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "plan" && plan?.value.id === event.aggregate.id) {
        plan = { ...plan, revision: event.aggregate.revision };
      } else if (event.aggregate.kind === "custom_exercise") {
        const current = customExercises.get(event.aggregate.id);
        if (current) customExercises.set(event.aggregate.id, { ...current, revision: event.aggregate.revision });
      }
    } else if (
      event.name === "timeline.fact_appended" ||
      event.name === "timeline.fact_corrected" ||
      event.name === "timeline.source_mutated"
    ) {
      timelineEvents.push({
        eventId: event.id,
        revision: event.aggregate.revision,
        occurredAt: event.occurredAt,
        recordedAt: event.recordedAt,
        timezoneOffsetMinutes: event.timezoneOffsetMinutes,
        fact: event.payload.fact,
        envelope: event.payload.entry,
        ...(event.name === "timeline.fact_corrected"
          ? { correctsEventId: event.payload.correctsEventId }
          : {}),
        ...(event.name === "timeline.source_mutated"
          ? { sourceMutationOfEventId: event.payload.sourceEventId }
          : {}),
      });
    } else if (event.name === "timeline.source_tombstoned") {
      timelineTombstones.push({
        eventId: event.id,
        revision: event.aggregate.revision,
        sourceEventId: event.payload.sourceEventId,
        reason: event.payload.reason,
        occurredAt: event.occurredAt,
        recordedAt: event.recordedAt,
      });
    } else if (event.name === "workout.prepared" || event.name === "workout.started") {
      const state = event.payload.state;
      workouts.set(event.aggregate.id, {
        id: event.aggregate.id,
        revision: event.aggregate.revision,
        source: event.payload.source,
        ...(event.payload.plannedSessionRef ? { plannedSessionRef: event.payload.plannedSessionRef } : {}),
        frozenPrescription: event.payload.frozenPrescription,
        setOutcomes: [],
        skippedSets: [],
        setOutcomeCorrections: [],
        drafts: [],
        state,
        status: state.status,
        sessionOutcomeCorrections: [],
      });
    } else if (event.name === "workout.state_changed") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          state: event.payload.state,
          status: event.payload.state.status,
        });
      }
    } else if (event.name === "workout.draft_set_saved") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          drafts: [
            ...current.drafts.filter((draft) => draft.id !== event.payload.draft.id),
            event.payload.draft,
          ],
        });
      }
    } else if (event.name === "workout.draft_set_retracted") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          drafts: current.drafts.filter((draft) => draft.id !== event.payload.draftId),
        });
      }
    } else if (event.name === "workout.prescription_revised") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const resolvedSetIds = [
          ...current.setOutcomes.map((outcome) => outcome.prescriptionSetId),
          ...(current.skippedSets ?? []).map((skipped) => skipped.prescriptionSetId),
        ];
        const currentSet = event.payload.frozenPrescription.tasks
          .flatMap((task) => task.sets.map((set) => ({ taskId: task.id, setId: set.id })))
          .find((set) => set.setId === current.state.currentSetId && !resolvedSetIds.includes(set.setId));
        const next = currentSet ?? nextWorkoutPrescriptionSet(event.payload.frozenPrescription, resolvedSetIds);
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          frozenPrescription: event.payload.frozenPrescription,
          state: {
            ...current.state,
            ...(next
              ? { currentTaskId: next.taskId, currentSetId: next.setId }
              : { currentTaskId: undefined, currentSetId: undefined }),
          },
        });
      }
    } else if (event.name === "workout.set_recorded") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const setOutcomes = [...current.setOutcomes, event.payload.outcome];
        const next = nextWorkoutPrescriptionSet(current.frozenPrescription, [
          ...setOutcomes.map((outcome) => outcome.prescriptionSetId),
          ...(current.skippedSets ?? []).map((skipped) => skipped.prescriptionSetId),
        ]);
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          setOutcomes,
          drafts: current.drafts.filter(
            (draft) => draft.prescriptionSetId !== event.payload.outcome.prescriptionSetId,
          ),
          state: {
            ...current.state,
            ...(next ? { currentTaskId: next.taskId, currentSetId: next.setId } : { currentTaskId: undefined, currentSetId: undefined }),
          },
        });
      }
    } else if (event.name === "workout.set_skipped") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const skippedSets = current.skippedSets?.some(
          (skipped) => skipped.prescriptionSetId === event.payload.skipped.prescriptionSetId,
        )
          ? current.skippedSets
          : [...(current.skippedSets ?? []), event.payload.skipped];
        const next = nextWorkoutPrescriptionSet(current.frozenPrescription, [
          ...current.setOutcomes.map((outcome) => outcome.prescriptionSetId),
          ...skippedSets.map((skipped) => skipped.prescriptionSetId),
        ]);
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          skippedSets,
          drafts: current.drafts.filter(
            (draft) => draft.prescriptionSetId !== event.payload.skipped.prescriptionSetId,
          ),
          state: {
            ...current.state,
            ...(next ? { currentTaskId: next.taskId, currentSetId: next.setId } : { currentTaskId: undefined, currentSetId: undefined }),
          },
        });
      }
    } else if (event.name === "workout.set_corrected") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const correction = event.payload.correction;
        const original = current.setOutcomes.find((outcome) => outcome.id === correction.correctsOutcomeId);
        if (!original) continue;
        const setOutcomes = current.setOutcomes.map((outcome) =>
          outcome.id === correction.correctsOutcomeId ? correction.replacement : outcome,
        );
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          setOutcomes,
          setOutcomeCorrections: [...(current.setOutcomeCorrections ?? []), correction],
        });
      }
    } else if (event.name === "workout.completed") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const status = event.payload.outcome?.status ?? event.payload.status;
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          state: {
            ...current.state,
            status,
            transitions: [
              ...current.state.transitions,
              {
                from: current.state.status,
                to: status,
                reason: "session_completed",
                actor: event.actor,
                occurredAt: event.payload.completedAt,
                idempotencyKey: event.correlationId,
              },
            ],
          },
          ...(event.payload.outcome ? { outcome: event.payload.outcome } : {}),
          status,
        });
      }
    } else if (event.name === "workout.outcome_corrected") {
      const current = workouts.get(event.aggregate.id);
      if (current) {
        const correction = event.payload.correction;
        const status = correction.outcome.status;
        workouts.set(event.aggregate.id, {
          ...current,
          revision: event.aggregate.revision,
          outcome: correction.outcome,
          status,
          state: {
            ...current.state,
            status,
            transitions: [
              ...current.state.transitions,
              {
                from: current.state.status,
                to: status,
                reason: "session_outcome_corrected",
                actor: event.actor,
                occurredAt: event.occurredAt,
                idempotencyKey: event.correlationId,
              },
            ],
          },
          sessionOutcomeCorrections: [...(current.sessionOutcomeCorrections ?? []), correction],
        });
      }
    }
  }

  const supersededIds = new Set(
    timelineEvents.flatMap((event) => [
      ...(event.correctsEventId ? [event.correctsEventId] : []),
      ...(event.sourceMutationOfEventId ? [event.sourceMutationOfEventId] : []),
    ]),
  );
  const tombstonedIds = new Set(
    relevant.flatMap((event) =>
      event.name === "timeline.source_tombstoned" ? [event.payload.sourceEventId] : [],
    ),
  );
  const lifecycleTimelineEvents = timelineEvents.map((event) => ({
    ...event,
    lifecycle: tombstonedIds.has(event.eventId)
      ? ("tombstoned" as const)
      : supersededIds.has(event.eventId)
        ? ("superseded" as const)
        : ("active" as const),
  }));
  const timelineRevision = relevant
    .filter((event) => event.aggregate.kind === "timeline")
    .reduce((revision, event) => Math.max(revision, event.aggregate.revision), 0);
  const visibleTimelineEvents = query.date
    ? lifecycleTimelineEvents.filter((event) => timelineDateKey(event) === query.date)
    : lifecycleTimelineEvents;

  const profileArchived = profile
    ? archivedAggregates.has(`user_profile:${profile.value.id}`)
    : false;
  const goalArchived = goalContract
    ? archivedAggregates.has(`goal_contract:${goalContract.value.id}`)
    : false;
  const planArchived = plan ? archivedAggregates.has(`plan:${plan.value.id}`) : false;
  const visiblePlan = planArchived ? undefined : plan;

  return {
    userId: query.userId,
    ...(profile && !profileArchived ? { profile } : {}),
    ...(goalContract && !goalArchived ? { goalContract } : {}),
    ...(mandate ? { mandate } : {}),
    ...(visiblePlan ? { plan: visiblePlan } : {}),
    ...(visiblePlan && goalContract
      ? {
          planStatus:
            visiblePlan.value.goalContractRef.id === goalContract.value.id &&
            visiblePlan.value.goalContractRef.revision === goalContract.revision
              ? ("current" as const)
              : ("stale_goal_contract" as const),
        }
      : {}),
    equipmentProfiles: [...equipmentProfiles.values()],
    recoveryConstraints: [...recoveryConstraints.values()].filter((entry) => !archivedAggregates.has(`recovery_constraint:${entry.value.id}`)),
    nutritionStrategies: [...nutritionStrategies.values()].filter((entry) => !archivedAggregates.has(`nutrition_strategy:${entry.value.id}`)),
    customExercises: [...customExercises.values()],
    ...(permissions ? { permissions } : {}),
    safetyConstraints: [...safetyConstraints.values()].filter((entry) => !archivedAggregates.has(`safety_constraint:${entry.value.id}`)),
    timeline: {
      revision: timelineRevision,
      events: visibleTimelineEvents,
      current: visibleTimelineEvents.filter((event) => event.lifecycle === "active"),
      tombstones: timelineTombstones,
    },
    workouts: [...workouts.values()],
    archivedAggregates: [...archivedAggregates.values()],
  };
}

function nextWorkoutPrescriptionSet(
  prescription: PlannedSessionData,
  resolvedPrescriptionSetIds: readonly string[],
): { taskId: string; setId: string } | undefined {
  const resolved = new Set(resolvedPrescriptionSetIds);
  for (const task of prescription.tasks) {
    for (const set of task.sets) {
      if (!resolved.has(set.id)) return { taskId: task.id, setId: set.id };
    }
  }
  return undefined;
}

function timelineDateKey(event: TimelineProjectionEvent): string {
  const envelope = event.envelope;
  const sleep = event.fact.kind === "sleep";
  const instant = sleep ? envelope?.time.endedAt ?? event.occurredAt : envelope?.time.startedAt ?? event.occurredAt;
  const offset = sleep
    ? envelope?.time.endedTimezoneOffsetMinutes ?? envelope?.time.timezoneOffsetMinutes ?? event.timezoneOffsetMinutes
    : envelope?.time.timezoneOffsetMinutes ?? event.timezoneOffsetMinutes;
  const timestamp = Date.parse(instant);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + offset * 60_000).toISOString().slice(0, 10)
    : instant.slice(0, 10);
}

/**
 * Baseline intake field contract: age, height and current weight are the only
 * universally required onboarding inputs, with these domain ranges and units
 * (years / cm / kg). The conversation module and the domain command boundary
 * both call this validator; neither defines its own field rules.
 */
export function validateBaselineIntake(input: { ageYears: number; heightCm: number; weightKg: number }): void {
  if (!Number.isInteger(input.ageYears) || input.ageYears < 18 || input.ageYears > 120
    || !Number.isFinite(input.heightCm) || input.heightCm < 100 || input.heightCm > 250
    || !Number.isFinite(input.weightKg) || input.weightKg < 25 || input.weightKg > 400) {
    throw new Error("baseline_invalid");
  }
}
