import type {
  CoachingMandateData,
  DomainAggregateRef,
  EquipmentProfileData,
  GoalContractData,
  GoalCycleData,
  MassQuantity,
  NutritionStrategyData,
  PlanRevisionData,
  RecoveryConstraintData,
  SafetyConstraintData,
  TimelineProjectionEvent,
  UserProfileData,
} from "../coach/domain";
import type { FactRef } from "../coach/model";
import type { KnowledgeVersionPins } from "../knowledge/model";
export type {
  AdaptiveForecastScenario,
  AppliedPhaseStrategy,
  PlanningNutritionStrategy,
  RecommendationExplanation,
  RecoveryStrategy,
  StrategyId,
  StrategySelection,
  TrainingStrategy,
} from "./adaptiveStrategy";
import type {
  AdaptiveForecastScenario,
  AppliedPhaseStrategy,
  PlanningNutritionStrategy,
  RecommendationExplanation,
  RecoveryStrategy,
  StrategySelection,
  TrainingStrategy,
} from "./adaptiveStrategy";

export type PlannerTrigger =
  | "initial_plan"
  | "session_completed"
  | "recovery_downgraded"
  | "repeated_missed_sessions"
  | "schedule_changed"
  | "equipment_changed"
  | "goal_changed"
  | "deload_ended"
  | "user_requested";

export interface HistoricalPerformance {
  exerciseVariantId: string;
  occurredAt: string;
  load: MassQuantity;
  reps: number;
  rir?: number;
  confidence: "confirmed" | "estimated";
  evidenceRef: string;
}

export interface ScheduleAvailability {
  weekday: number;
  availableMinutes: number;
  locationId: string;
}

export interface TemporaryExerciseAvailability {
  exerciseVariantId: string;
  status: "available" | "unavailable" | "busy";
}

export interface PlannerManualChoice {
  stimulusSlotId?: string;
  exerciseVariantId: string;
  scope: "this_session_only" | "future_preference" | "lock";
}

export interface PlannerFacts {
  userId: string;
  profile: { revision: number; value: UserProfileData };
  goalContract: { revision: number; value: GoalContractData };
  mandate: { revision: number; value: CoachingMandateData };
  safetyConstraints: readonly { revision: number; value: SafetyConstraintData }[];
  equipmentProfiles: readonly { revision: number; value: EquipmentProfileData }[];
  recoveryConstraints: readonly { revision: number; value: RecoveryConstraintData }[];
  nutritionStrategies: readonly { revision: number; value: NutritionStrategyData }[];
  timeline: readonly TimelineProjectionEvent[];
  priorGoalCycle?: { revision: number; value: GoalCycleData };
  priorPlan?: { revision: number; value: PlanRevisionData };
}

export interface PlannerRequest {
  trigger: PlannerTrigger;
  currentDate: string;
  facts: PlannerFacts;
  schedule?: readonly ScheduleAvailability[];
  equipmentProfileId?: string;
  temporaryExerciseAvailability?: readonly TemporaryExerciseAvailability[];
  directChoices?: readonly PlannerManualChoice[];
  historicalPerformance?: readonly HistoricalPerformance[];
  /** 个人实测休息节奏（秒，observed_calibration 中位数）；休息建议按其在安全带宽内个性化。 */
  personalRestTempoSeconds?: number;
  /** 用户偏好的分化轮转模板 id（策略集 splitRotations）；不提供时按可执行性自动选择。 */
  preferredSplitId?: string;
  /**
   * 仅用于待确认预览的、由明确的定性恢复事实推导出的短时约束。它不是用户
   * 自报分数，确认前不写入 RecoveryConstraint 聚合；预览确认时必须重放。
   */
  transientRecoveryConstraint?: RecoveryConstraintData;
  /**
   * 仅用于已请求换课的恢复预览。它把下一次未开始的训练移到明确的轮转课，
   * 后续课从该课继续；确认前绝不改写当前 PlanRevision。
   */
  transientNextSessionFocus?: "shoulders";
  consecutiveDeviationCount?: number;
  missedSessionDates?: readonly string[];
  requestedScope?: "this_session_only" | "future_preference" | "lock" | "future_plan";
}

export interface PlanDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
  reasonCode: string;
}

/** 规划推理链（ticket 04）：每次规划产出，随 PlanRevision 幂等持久化；无 trace 不提交。 */
export interface PlannerTrace {
  /** 输入指纹：request 参数 + 事实修订集。同指纹必出同计划（确定性回放）。 */
  inputFingerprint: string;
  historySummary: { count: number; exerciseIds: readonly string[] };
  splitSelection?: {
    rotationId: string;
    exposuresPerWeek: number;
    reasonCode: string;
    /** 结构质量判断的输入与结论，供用户/评估器复核，不是黑箱匹配。 */
    rationale?: readonly string[];
  };
  slots: readonly {
    slotId: string;
    date: string;
    movementPattern: string;
    selectedExerciseId?: string;
    selectedScore?: number;
    hardFilteredCount: number;
    dropReasons: readonly string[];
    setCount?: number;
    repRange?: { min: number; max: number };
    targetRirRange?: { min: number; max: number };
    loadStatus: "anchored" | "calibration" | "unknown" | "none";
  }[];
  constraintEvents: readonly string[];
  weeklyVolume: Readonly<Record<string, number>>;
  outcome: { kind: "plan_proposal" | "no_change" | "infeasible_plan"; reasonCodes: readonly string[] };
}

export interface PlanProposal {
  kind: "plan_proposal";
  id: string;
  baseRevisions: readonly DomainAggregateRef[];
  goalCycle: GoalCycleData;
  planRevision: PlanRevisionData;
  diff: readonly PlanDiffEntry[];
  scope: NonNullable<PlannerRequest["requestedScope"]>;
  reasonCodes: readonly string[];
  evidenceRefs: readonly FactRef[];
  missing: readonly string[];
  conflicts: readonly string[];
  knowledgePins: KnowledgeVersionPins;
  confidence: number;
  requiresConfirmation: boolean;
  executionClass: "silent_eligible" | "notify_with_undo" | "confirmation_required";
  expectedReviewAt: string;
  forecasts: readonly PathForecastScenario[];
  adaptiveForecasts?: readonly AdaptiveForecastScenario[];
  strategySelection?: StrategySelection;
  appliedPhaseStrategy?: AppliedPhaseStrategy;
  trainingStrategy?: TrainingStrategy;
  nutritionStrategy?: PlanningNutritionStrategy;
  recoveryStrategy?: RecoveryStrategy;
  explanation?: RecommendationExplanation;
  trace: PlannerTrace;
}

export interface InfeasiblePlan {
  kind: "infeasible_plan";
  id: string;
  reasonCodes: readonly string[];
  suppressedGoals: readonly string[];
  hardConflicts: readonly string[];
  minimumRelaxations: readonly {
    field: string;
    option: string;
    impact: string;
  }[];
  evidenceRefs: readonly FactRef[];
  knowledgePins: KnowledgeVersionPins;
  /** 结构化转介（人群边界触发时必填）：给谁、说什么。非诊断性表述。 */
  referral?: {
    audience: string;
    message: string;
  };
}

export interface NoPlanChange {
  kind: "no_change";
  reasonCodes: readonly string[];
  factFrontier: readonly DomainAggregateRef[];
  forecastUpdate?: {
    scenarios: readonly PathForecastScenario[];
    reviewKind: "session_outcome" | "weekly" | "mesocycle_end";
    shouldProposeAdjustment: false;
  };
}

export type PlannerDecision = PlanProposal | InfeasiblePlan | NoPlanChange;

export interface PathForecastScenario {
  scenario: "conservative" | "base" | "aggressive";
  milestones: readonly { reviewDate: string; description: string }[];
  assumptions: readonly string[];
  dataCoverage: number;
  confidenceRange: { min: number; max: number };
  deviation: string;
  disclaimer: "directional_not_guaranteed";
}
