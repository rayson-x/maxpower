import type { CoachingMandateData, GoalContractData, UserProfileData } from "../../src/coach/domain";

export const PERSONAL_PLANNER_CURRENT_DATE = "2026-08-12";

export const PERSONAL_PLANNER_PROFILE: UserProfileData = {
  id: "personal-profile",
  locale: "zh-CN",
  adultConfirmed: true,
  returningStatus: "consistent",
  dailyActivityLevel: "sedentary",
  demographics: {
    ageYears: 30,
    sex: "male",
    height: { value: 178, unit: "cm" },
    currentWeight: { value: 75, unit: "kg" },
  },
  schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 },
  locations: [{
    id: "personal-gym",
    kind: "gym",
    environment: { space: "large", noise: "any" },
    availableEquipment: ["full_gym"],
  }],
  bodyDirection: "decrease_body_fat",
  trainingHistorySummary: {
    recentSplit: ["chest", "back", "legs", "shoulders"],
    weeklyVolume: [
      { muscleGroup: "chest", sets: 10 },
      { muscleGroup: "back", sets: 12 },
      { muscleGroup: "quadriceps", sets: 10 },
      { muscleGroup: "shoulders", sets: 12 },
    ],
  },
  strengthBaseline: {
    squat: { value: 100, unit: "kg" },
    squatReps: 3,
    benchPress: { value: 80, unit: "kg" },
    benchPressReps: 5,
    deadlift: { value: 110, unit: "kg" },
    deadliftReps: 4,
    measuredAt: "2026-08-01",
    source: "user_confirmed",
  },
  nutritionPreferences: ["严格控制饮食"],
};

export const PERSONAL_PLANNER_GOAL: GoalContractData = {
  id: "personal-goal",
  primaryGoal: "fat_loss_preserve_lean_mass",
  status: "active",
  targetMode: "lean_mass_preserving_fat_loss",
  executionTier: "balanced",
  horizon: { startDate: PERSONAL_PLANNER_CURRENT_DATE },
  targetWeeks: 12,
  pace: "standard",
  missedSessionPolicy: "shift",
  successMetrics: ["body_composition_trend", "strength_maintenance", "weekly_training_adherence"],
  measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference", "key_lift"] },
  targets: {
    currentBodyFat: { value: 16.5, unit: "percent" },
    targetBodyFat: { value: 12, unit: "percent" },
    targetWaist: { value: 78, unit: "cm" },
    targetShoulderWaistRatio: 1.5,
    circumferences: {
      waist: { value: 86, unit: "cm" },
      chest: { value: 101, unit: "cm" },
      shoulders: { value: 113, unit: "cm" },
      neck: { value: 44, unit: "cm" },
    },
  },
  emphasisMuscles: ["lateral_deltoid", "rear_deltoid"],
  aerobicPreference: {
    role: "fat_loss_acceleration",
    timingPreference: "after_strength",
    intensityPreference: "easy_moderate",
  },
  commitmentPreferences: { training: "high", nutrition: "strict", recovery: "standard" },
};

export const PERSONAL_PLANNER_MANDATE: CoachingMandateData = {
  id: "personal-mandate",
  mode: "collaborative",
  planChangeAuthorization: "always_ask",
};
