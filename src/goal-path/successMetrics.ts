import type { GoalContractData } from "../coach/domain";

/**
 * Goal contract successMetrics 默认值（判据体系 2026-08-16）：
 * 围度 / 训练表现 / 执行率是一等指标；体重只以周均趋势出现，永不以「减到 X 斤」
 * 或单日读数出现。模型给出的 successMetrics 优先；缺省时按主目标生成。
 */
export function defaultSuccessMetrics(goal: Pick<GoalContractData, "primaryGoal">): readonly string[] {
  switch (goal.primaryGoal) {
    case "fat_loss_preserve_lean_mass":
      return ["waist_circumference_trend", "key_lift_performance_maintenance", "weekly_weight_trend", "training_adherence"];
    case "hypertrophy":
      return ["target_muscle_circumference_trend", "key_lift_performance_progression", "training_adherence"];
    case "strength":
      return ["key_lift_performance_progression", "training_adherence", "weekly_weight_trend"];
    case "physique":
      return ["waist_shoulder_circumference_trend", "physique_satisfaction_trend", "training_adherence"];
    default:
      return ["training_adherence", "weekly_weight_trend", "subjective_wellbeing_notes"];
  }
}
