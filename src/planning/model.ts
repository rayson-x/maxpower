import type {
  CoachingMandateData,
  DomainAggregateRef,
  EquipmentProfileData,
  GoalContractData,
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
  priorPlan?: { revision: number; value: PlanRevisionData };
}
