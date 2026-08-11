import type { EquipmentRequirement } from "../coach/domain";

export const KNOWLEDGE_PACK_SCHEMA_VERSION = 1 as const;
export const EXERCISE_CATALOG_SCHEMA_VERSION = 1 as const;
export const RULE_PACK_SCHEMA_VERSION = 1 as const;

declare const exerciseConceptBrand: unique symbol;
export type ExerciseConceptId = string & { readonly [exerciseConceptBrand]: true };

export interface ExerciseConcept {
  id: ExerciseConceptId;
  displayName: { zh: string; en: string };
  aliases: readonly string[];
  sourceRefs: readonly string[];
  license: {
    content: "project_authored_metadata" | "third_party_metadata";
    text: "project_authored" | "redistributable" | "not_bundled_pending_review";
    media: "none_bundled" | "redistributable" | "not_bundled_pending_review";
  };
  catalogVersion: string;
  status: "active" | "tombstone";
  replacementConceptId?: ExerciseConceptId;
  limitations: readonly string[];
  reviewedAt: string;
}

export type KnowledgeClassification =
  | "EvidenceFact"
  | "ProductPolicy"
  | "Unknown"
  | "SafetyBoundary"
  | "CompetitorPrecedent";

export interface SourceRef {
  id: string;
  title: string;
  uri: string;
  classification: KnowledgeClassification;
  reviewedAt: string;
}

export interface KnowledgePackManifest {
  id: string;
  semanticVersion: string;
  schemaVersion: typeof KNOWLEDGE_PACK_SCHEMA_VERSION;
  contentHash: string;
  publishedAt: string;
  reviewedAt: string;
  sourceRefs: readonly SourceRef[];
  population: readonly string[];
  scope: readonly string[];
  capabilityFlags: readonly string[];
  compatibility: { minAppSchema: number; maxAppSchema: number };
  supersedes?: { packId: string; semanticVersion: string; contentHash: string };
  signature: {
    status: "reviewed_digest" | "unsigned" | "invalid";
    algorithm: "fnv1a-32";
    value: string;
  };
}

export interface VersionPin {
  id: string;
  semanticVersion: string;
  schemaVersion: number;
  contentHash: string;
}

export interface KnowledgeVersionPins {
  knowledgePack: VersionPin;
  exerciseCatalog: VersionPin;
  rulePacks: readonly VersionPin[];
}

export type MovementPattern =
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "squat"
  | "hip_hinge"
  | "lunge"
  | "knee_extension"
  | "knee_flexion"
  | "elbow_flexion"
  | "elbow_extension"
  | "shoulder_abduction"
  | "shoulder_flexion"
  | "shoulder_horizontal_abduction"
  | "shoulder_external_rotation"
  | "ankle_plantarflexion"
  | "core_anti_extension"
  | "core_anti_rotation"
  | "core_flexion"
  | "locomotion"
  | "cardio"
  | "mobility"
  | "recovery";

export interface ExerciseVariantIdentity {
  movement: string;
  variation: string;
  loadMode: string;
  equipmentConfiguration: string;
  support: string;
  setup: string;
  angleOrStance: string;
  grip: string;
  unilateralContext: "bilateral" | "left" | "right" | "alternating";
  romContext: string;
  loadMeasurement: "external_mass" | "bodyweight_node" | "time" | "distance" | "none";
  /** Camera view is observation context, never training/performance identity. */
  cameraView?: never;
}

export interface ComparableExerciseContext {
  exerciseVariantId: string;
  performanceIdentity: string;
  comparable: "exact_variant" | "not_comparable";
  loadTransfer: "same_measurement_history_only" | "forbidden_cold_start";
  observationContextExcluded: readonly ["camera_view", "lens", "pose_model", "recognition_profile"];
}

export interface ExerciseEquipmentDescriptor {
  loadMode:
    | "bodyweight"
    | "barbell"
    | "dumbbell"
    | "kettlebell"
    | "machine"
    | "cable"
    | "band"
    | "cardio_machine"
    | "none"
    | "custom";
  requirement: EquipmentRequirement;
}

export interface StimulusContract {
  id: string;
  movementPattern: MovementPattern;
  mechanicalFunctions: readonly string[];
  jointActions: readonly string[];
  primaryMuscleIntent: readonly string[];
  secondaryMuscleIntent: readonly string[];
  stability: "supported" | "free" | "either";
  unilateral: boolean | "either";
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  repOrTimeRange?: { min: number; max: number; unit: "reps" | "seconds" | "minutes" };
  targetRir?: { min: number; max: number };
  fatigueCost: "low" | "medium" | "high";
  priority: "primary" | "maintenance" | "optional";
  lockedFields: readonly string[];
}

export interface ExpectedMuscleAssociation {
  exerciseVariantId: string;
  contextHash: string;
  status: "reviewed_expected_participation" | "unknown";
  associations: readonly {
    muscleId: string;
    role: "primary_intent" | "secondary_intent" | "stabilizer";
    evidenceStatus: "evidence_fact" | "product_policy" | "unknown";
  }[];
  disclaimer: "expected_participation_not_observed_activation";
}

export interface MotionEvidenceRequirement {
  cameraView: "front" | "rear" | "side" | "front_oblique" | "rear_oblique";
  maturity: "none" | "experimental" | "validated" | "suspended";
  recognitionProfileId?: string;
  referenceTrajectoryProfileId?: string;
  cueMappingId?: string;
  fallback: "manual_recording" | "video_only" | "count_tempo_only";
}

export interface ExerciseVariant {
  id: string;
  conceptId: ExerciseConceptId;
  schemaVersion: typeof EXERCISE_CATALOG_SCHEMA_VERSION;
  semanticVersion: string;
  displayName: { zh: string; en: string };
  aliases: readonly string[];
  identity: ExerciseVariantIdentity;
  performanceIdentity: string;
  movementPattern: MovementPattern;
  equipment: ExerciseEquipmentDescriptor;
  stimulusContractIds: readonly string[];
  expectedMuscleAssociation: ExpectedMuscleAssociation;
  motionEvidenceRequirements: readonly MotionEvidenceRequirement[];
  bodyweightDifficultyNodeId?: string;
  /** 力学分类（产品分类）：复合动作跨多关节，孤立动作单关节。
   * 主项 slot 必须优先复合动作——孤立动作不能当主项（真实缺陷，2026-08-11 修）。 */
  mechanic?: "compound" | "isolation";
  /** 结构化冲击/关节负荷（产品分类，非医学判断）：供疼痛与低冲击约束做硬过滤。
   * 缺省视为 "low"——只有明确标注 moderate/high 的动作会被低冲击约束排除。 */
  impact?: {
    level: "low" | "moderate" | "high";
    loadedJoints: readonly string[];
  };
  status: "active" | "deprecated";
  replacementId?: string;
  sourceRefs: readonly string[];
  unknownFields: readonly string[];
  dataEligibility: {
    recordable: boolean;
    plannerEligible: boolean;
    expectedMuscleMetadata: "reviewed" | "unknown";
    motionCapabilityRequirement: "independent_exact_resolver";
  };
}

export interface BodyweightDifficultyEdge {
  from: string;
  to: string;
  direction: "progression" | "regression";
  changes: readonly (
    | "support_points"
    | "body_angle"
    | "rom"
    | "unilateral"
    | "assistance"
    | "band"
    | "external_load"
    | "safe_stop"
  )[];
}

export interface BodyweightDifficultyGraph {
  id: string;
  nodes: readonly string[];
  edges: readonly BodyweightDifficultyEdge[];
}

export interface RulePackArtifact {
  id: string;
  semanticVersion: string;
  schemaVersion: typeof RULE_PACK_SCHEMA_VERSION;
  contentHash: string;
  reviewed: boolean;
  reviewedAt: string;
  sourceRefs: readonly string[];
  scope: readonly string[];
  executable: true;
}

export interface WikiDocumentRef {
  path: string;
  semanticVersion: string;
  executable: false;
}

export interface ExerciseCatalogArtifact {
  id: string;
  semanticVersion: string;
  schemaVersion: typeof EXERCISE_CATALOG_SCHEMA_VERSION;
  contentHash: string;
  migrationPolicy: {
    mode: "additive_deprecation";
    preservePinnedVersions: true;
  };
  substitutionProfiles: readonly {
    goalPack: "hypertrophy" | "strength" | "fat_loss" | "conditioning" | "health";
    weights: {
      sameMovement: number;
      sameMovementPattern: number;
      sameLoadMode: number;
      cameraCapabilityBonus: number;
      cardioOrLocomotionBonus: number;
      recoveryActivityBonus: number;
    };
  }[];
  concepts: readonly ExerciseConcept[];
  variants: readonly ExerciseVariant[];
  stimulusContracts: readonly StimulusContract[];
  difficultyGraphs: readonly BodyweightDifficultyGraph[];
}

export interface KnowledgePack {
  manifest: KnowledgePackManifest;
  classifications: readonly KnowledgeClassification[];
  exerciseCatalog: ExerciseCatalogArtifact;
  executableRulePacks: readonly RulePackArtifact[];
  wikiDocuments: readonly WikiDocumentRef[];
  /** 安全词表（ticket 09/07）：禁止声称清单与领域锚定词，随包版本化更新。 */
  safetyLexicon?: SafetyLexicon;
  /** 编排策略（ticket 03）：分化模板/课内架构/周量目标/组成本，Composer 的机器输入。 */
  programStrategies?: ProgramStrategies;
}

/** 分化轮转模板：一轮中每次训练的 slot 组成。 */
export interface SplitRotationTemplate {
  id: string;
  nameZh: string;
  /** 轮转中的一次训练：slot 列表。 */
  sessions: readonly {
    id: string;
    focusZh: string;
    slots: readonly {
      movementPattern: MovementPattern;
      /** 参与肌群（展示用；不用于周量记账）。 */
      muscleGroups: readonly string[];
      /** 直接组归属肌群（周量记账唯一依据；缺省时退回 muscleGroups）。
       * 例：深蹲的直接组记股四头，臀是参与肌群——避免同一组被多个肌群满记。 */
      directMuscles?: readonly string[];
      priority: "primary" | "maintenance" | "optional";
      fatigueIntent: "low" | "medium" | "high";
    }[];
  }[];
  /** 该轮转一圈每个肌群的暴露次数（用于周量换算）。 */
  exposuresPerCycle: number;
  /** 适用每周训练天数范围。 */
  suitableWeeklyDays: readonly [number, number];
}

/**
 * 饮食策略声明（供需图的"供给"侧，版本化知识资产）。
 *
 * 纪律：这里**只声明该策略在四个共享维度上提供什么**，不含任何训练规则。
 * 新增一种策略 = 加一条声明；训练侧代码零修改（架构见 src/planning/dietTrainingGraph.ts）。
 */
/**
 * Agent 可检索的知识段落（客户端知识库）。
 *
 * 与 `executableRulePacks`（引擎消费的确定性规则）的区别：
 *   - 规则包 = 引擎用来**做决定**的数值与逻辑
 *   - 知识段落 = agent 用来**回答与解释**的内容，离线可检索、必须带来源
 *
 * 纪律：段落是从已审核的知识页切出来的原文，**不是模型生成的摘要**。
 * agent 只能引用这里的内容；检索不到时必须明说不知道，不得用模型先验补答。
 */
/**
 * 知识层级（参考 TencentDB Agent Memory 的抽象金字塔思想，见 docs/adr 或调研）。
 *
 * 三层、自顶向下检索，目的是减少 token 消耗：
 *   L2 摘要（gist，~1-2 句）   ← 默认先答这层，token 最少
 *   L1 事实/结论（keypoint）   ← 需要细节时下钻
 *   L0 原文段落（passage）     ← 需要出处/原文时下钻
 *
 * 纪律：上层是下层的**确定性蒸馏**，不是模型生成的新内容——
 * gist 与 keypoint 都指回 passage（drillDown），保留完整可追溯链，
 * 绝不出现"蒸馏出来的说法在原文里找不到依据"。
 */

/** L2：一句话要点（检索默认命中的最小单元）。 */
export interface KnowledgeGist {
  id: string;
  /** 归属的文档小节。 */
  sectionKey: string;
  docTitle: string;
  topic: KnowledgePassage["topic"];
  /** 一句话要点（构建时从小节首条结论抽取）。 */
  gist: string;
  keywords: readonly string[];
  citationRefs: readonly string[];
  tier: KnowledgePassage["tier"];
  /** 下钻：该要点对应的 L0 段落 id。 */
  passageIds: readonly string[];
}

/** L1：一个完整结论（含边界），下钻时的中间层。 */
export interface KnowledgeKeypoint {
  id: string;
  passageId: string;
  docTitle: string;
  sectionPath: readonly string[];
  /** 该段落的结论句（抽取的小结/粗体结论）。 */
  point: string;
  citationRefs: readonly string[];
  tier: KnowledgePassage["tier"];
}

export interface KnowledgePassage {
  id: string;
  /** 来源文档路径（可追溯到仓库里的知识页）。 */
  sourcePath: string;
  /** 文档标题与该段落所属小节，供 agent 组织回答。 */
  docTitle: string;
  sectionPath: readonly string[];
  /** 段落原文（Markdown）。 */
  text: string;
  /** 主题标签（语言无关；按主题限定检索用）。 */
  topic: "training" | "nutrition" | "recovery" | "exercise" | "any";
  /** 检索关键词（中文与英文；英文页会补中文对译词），构建时抽取。 */
  keywords: readonly string[];
  /** 该段落引用的文献 id（可解析为 EvidenceCitation）。 */
  citationRefs: readonly string[];
  /** 证据等级：段落里的声称属于哪一档。 */
  tier: "A" | "B" | "C" | "D" | "U";
  /** 内容哈希，用于增量更新与审计。 */
  contentHash: string;
}

/**
 * 文献引用（版本化知识资产）。
 *
 * 用途：让计划里的每条建议都能指回一手来源——用户点得开、我们对得账。
 * 纪律（四标签）：
 *   tier A/B = 同行评议证据（立场声明/系统综述/RCT）
 *   tier C   = 课程或从业资料
 *   tier D   = 产品默认规则（无外部声称）
 *   tier U   = 待核验，**不得**用于面向用户的声称
 * `claim` 是我们从该来源实际采用的结论；`cannotSupport` 明确它**不能**推出什么——
 * 这一栏是防过度声称的主要手段。
 */
export interface EvidenceCitation {
  id: string;
  /** **来源质量**：A/B = 同行评议（立场声明/系统综述/RCT）；C = 课程资料；D = 产品规则；U = 未知。 */
  tier: "A" | "B" | "C" | "D" | "U";
  /**
   * **结论映射状态**（与来源质量正交）：
   * curated = 已人工确认"我们从这篇采用什么结论、它不能推出什么"，可用于面向用户的声称；
   * pending_review = 文献真实可核验，但结论尚未映射——**不得用于支撑具体建议**，
   *   只能作为"延伸阅读"列出。这样引用库可以诚实地增长，而不会因为条数多就滥用。
   */
  claimStatus: "curated" | "pending_review";
  /** 英文标题（面向海外市场时的主标题；引用时优先展示）。 */
  titleEn: string;
  /** 中文标题（中文用户界面展示）。 */
  titleZh: string;
  authorsShort: string;
  year: number;
  venue?: string;
  /** 免费可达链接（PubMed/PMC/官方 PDF 优先，不用付费 DOI）。 */
  url?: string;
  /** PubMed 标识（最标准的可核验引用 id）。 */
  pmid?: string;
  /** PMC 标识（开放全文）。 */
  pmcid?: string;
  /** 我们采用的结论（英文，海外优先）。 */
  claimEn: string;
  /** 我们采用的结论（中文）。 */
  claimZh: string;
  /** 该来源不能推出什么（英文）——防过度声称的主要手段。 */
  cannotSupportEn: readonly string[];
  /** 该来源不能推出什么（中文）。 */
  cannotSupportZh: readonly string[];
  /** 适用人群边界（英文）。 */
  populationEn: string;
  /** 适用人群边界（中文）。 */
  populationZh: string;
}

/**
 * 进食状态 × 训练类型的编排策略（版本化知识，不写在代码里）。
 * 数值、文案、优势/风险、证据引用全部是数据；代码只负责选与解析。
 */
export interface SessionFuelingPolicy {
  workType: "strength" | "high_intensity_aerobic" | "low_intensity_aerobic" | "walking";
  preferredState: "fasted" | "light_snack" | "fed" | "post_strength";
  acceptableStates: readonly ("fasted" | "light_snack" | "fed" | "post_strength")[];
  /** 距正餐的建议最小间隔（分钟）；null = 无需间隔（散步）。 */
  minMinutesAfterFullMeal: number | null;
  /** 距小份加餐的建议最小间隔（分钟）。 */
  minMinutesAfterSnack: number | null;
  rationaleZh: string;
  advantagesZh: readonly string[];
  risksZh: readonly string[];
  evidenceRefs: readonly string[];
  tier: "A" | "B" | "C" | "D" | "U";
}

/** 空腹训练适格性规则表（数据驱动，代码只做匹配）。 */
export interface FastedTrainingRule {
  id: string;
  when: {
    workTypeIn?: readonly ("strength" | "high_intensity_aerobic" | "low_intensity_aerobic" | "walking")[];
    plannedMinutesOver?: number;
    ageUnder?: number;
    adultNotConfirmed?: boolean;
    healthFlagIn?: readonly string[];
    professionalClearanceRequired?: boolean;
  };
  severity: "block" | "caution";
  reasonZh: string;
  alternativeZh?: string;
  evidenceRefs: readonly string[];
}

export interface DietStrategyDeclaration {
  id: string;
  nameZh: string;
  /** 碳水可用性：恒定 / 周期化 / 极低。 */
  carbAvailability: {
    pattern: "constant" | "cycled" | "very_low";
    /** 各档位的相对碳水量（g/kg 体重/天）。减脂期受赤字约束，实际会落在区间下段。 */
    byDayType: {
      high: { min: number; max: number };
      moderate: { min: number; max: number };
      low: { min: number; max: number };
    };
  };
  proteinPolicy: { perKgMin: number; perKgMax: number };
  fatFloorPercentOfEnergy: number;
  /** 该策略能支撑哪些类型的训练工作（C1/C2/C5 边的输入）。 */
  supports: {
    highIntensityWork: "full" | "limited" | "poor";
    highVolumeWork: "full" | "limited" | "poor";
    lowIntensityAerobic: "full";
  };
  /** 与各目标的适配度（用于向用户说明取舍，不用于替用户决定）。 */
  goalFit: {
    hypertrophy: "good" | "workable_with_tradeoffs" | "poor";
    strength: "good" | "workable_with_tradeoffs" | "poor";
    fatLoss: "good" | "workable_with_tradeoffs" | "poor";
  };
  goalFitNote?: string;
  /** 证据等级：A/B=文献证据；D=产品默认规则；U=未知待核验。 */
  evidenceTier: "A" | "B" | "C" | "D" | "U";
  sourceRefs: readonly string[];
}

export interface ProgramStrategies {
  semanticVersion: string;
  /** 饮食策略库（供需图的供给侧声明）。 */
  dietStrategies?: readonly DietStrategyDeclaration[];
  /** 文献引用库：计划里的 evidenceRef 由此解析为可展示的一手来源。 */
  citations?: readonly EvidenceCitation[];
  /** Agent 可检索的知识段落（客户端知识库，L0 原文层）。 */
  passages?: readonly KnowledgePassage[];
  /** L2 摘要层（检索默认命中）。 */
  gists?: readonly KnowledgeGist[];
  /** L1 事实层（下钻中间层）。 */
  keypoints?: readonly KnowledgeKeypoint[];
  /** 进食状态编排策略（按训练类型）。 */
  sessionFuelingPolicies?: readonly SessionFuelingPolicy[];
  /** 空腹训练适格性规则表。 */
  fastedTrainingRules?: readonly FastedTrainingRule[];
  splitRotations: readonly SplitRotationTemplate[];
  /** 周量目标（直接组/肌群/周）：TP-VOL-BASE 分档。 */
  weeklyDirectSetTargets: {
    beginner: { min: number; default: number; max: number };
    intermediate: { min: number; default: number; max: number };
    advanced: { min: number; default: number; max: number };
  };
  /** 组成本（分钟/组，估算用，标注为估计；实测后按个人节奏校准）。 */
  setCostModel: {
    warmupMinutes: number;
    transitionMinutesPerSwitch: number;
    workSetMinutes: number;
    restSecondsByPriority: { primary: number; maintenance: number; optional: number; high_fatigue: number };
  };
}

/** 禁止声称规则：patterns 全部命中（AND）才拦截，降低误伤。 */
export interface ForbiddenClaimRule {
  id: string;
  patterns: readonly string[];
  replacement: string;
}

export interface SafetyLexicon {
  semanticVersion: string;
  forbiddenClaims: readonly ForbiddenClaimRule[];
  /** 领域锚定词（运动/健康/饮食），用于领域边界判定（ticket 07）。 */
  domainAnchors: readonly string[];
}

export interface MotionCapabilitySet {
  countPhase: "available" | "unavailable";
  tempo: "available" | "unavailable";
  calibratedTrajectoryComparison: "available" | "unavailable";
  evidenceLinkedCue: "available" | "unavailable";
  fallback: "manual_recording" | "video_only" | "count_tempo_only";
  evidenceRefs: readonly string[];
}

export interface SubstitutionCandidate {
  exercise: ExerciseVariant;
  hardConstraintsSatisfied: boolean;
  eligibility: "eligible" | "needs_equipment_confirmation";
  satisfiedFields: readonly string[];
  deviatedFields: readonly string[];
  rankingReasons: readonly string[];
  coldStart: {
    loadHistory: "known" | "unknown";
    exerciseHistory: "known" | "unknown";
  };
  requiredEquipment: readonly string[];
  performanceComparability: "exact_variant" | "cold_start";
  timeImpactMinutes: number;
  fatigueImpact: StimulusContract["fatigueCost"];
  motionCapability: MotionCapabilitySet;
  ruleVersion: VersionPin;
}

export type ExerciseConstraintState =
  | {
      kind: "cannot_do";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reason: string;
      priority: "hard";
      scope: "current_session" | "future_policy";
    }
  | {
      kind: "dislike";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reason?: string;
      priority: "preference";
      scope: "current_session" | "future_policy";
    }
  | {
      kind: "temporary_unavailable";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reason?: string;
      priority: "session_hard";
      scope: "current_session";
    }
  | {
      kind: "do_not_recommend";
      exerciseVariantId?: string;
      movementPattern?: MovementPattern;
      reasonCode: string;
      priority: "policy";
      scope: "future_policy";
    };

export interface KnowledgeLayerRefs {
  recognitionProfileId?: string;
  trajectoryEvidenceId?: string;
  expectedMuscleAssociationId?: string;
  coachingClaimId?: string;
}

export interface CustomExerciseVariantView {
  id: string;
  userId: string;
  name: string;
  movement?: MovementPattern;
  prescriptionMode: StimulusContract["prescriptionMode"];
  equipmentRequirement: EquipmentRequirement;
  unknownFields: readonly string[];
  motionCapability: "unknown";
  createdAt: string;
  revision: number;
  status: "active" | "archived";
}

export interface CustomExerciseMetadataProposal {
  kind: "custom_exercise_metadata_proposal";
  customExerciseId: string;
  proposed: {
    movement?: MovementPattern;
    expectedMuscleIds?: readonly string[];
    stimulusContractId?: string;
    substitutionIds?: readonly string[];
  };
  authority: "non_authoritative_pending_user_confirmation";
  source: "llm" | "user";
  unlocksPlannerEligibility: false;
  unlocksMotionCapability: false;
}

export class KnowledgePackValidationError extends Error {
  constructor(
    readonly code:
      | "schema_incompatible"
      | "hash_mismatch"
      | "signature_invalid"
      | "catalog_invalid"
      | "missing_reference",
    readonly details: readonly string[] = [],
  ) {
    super(`${code}${details.length ? `: ${details.join(", ")}` : ""}`);
    this.name = "KnowledgePackValidationError";
  }
}
