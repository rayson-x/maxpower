import { projectDomainEvents } from "./domain";
import type { LedgerSnapshot } from "./model";
import type { CoachToolManifest, CoachToolRegistry } from "./toolRegistry";

/**
 * Derives the model-visible capabilities from one local fact frontier.
 *
 * This is deliberately a fact/policy boundary, not an intent classifier:
 * user wording never decides which tool is visible. The model may select only
 * a capability justified by the snapshot and the current Coaching mandate.
 */
export function resolveCoachCapabilities(input: {
  snapshot: LedgerSnapshot;
  userId: string;
  tools?: CoachToolRegistry;
}): readonly CoachToolManifest[] {
  if (!input.tools) return [];
  const domain = projectDomainEvents(input.snapshot.domainEvents, { userId: input.userId });
  const legacy = input.snapshot.users.find((user) => user.userId === input.userId);
  const hasPlan = Boolean(domain.plan ?? legacy?.plan);
  const hasTimeline = domain.timeline.current.length > 0 || Boolean(legacy?.timeline.length);
  const hasGoalCycle = domain.goalCycles.length > 0;
  const hasNutrition = domain.nutritionStrategies.some((item) => item.value.status === "active");
  const hasRecoveryConstraint = domain.recoveryConstraints.length > 0;
  const hasSafetyConstraint = domain.safetyConstraints.length > 0 || legacy?.safetyHold === true;
  const hasForecast = input.snapshot.artifacts.some((artifact) => artifact.kind === "goal_forecast" || artifact.kind === "replan_evaluation");
  const hasWorkout = domain.workouts.some((workout) => workout.status === "planned" || workout.status === "partial");
  const mandate = domain.mandate?.value ?? legacy?.mandate;
  const permissions = domain.permissions?.value;

  const hasScope = (scope: string) => {
    if (scope === "coaching_mandate") return mandate?.mode === "collaborative" || mandate?.mode === "managed";
    if (scope === "health") return permissions?.health === "granted";
    if (scope === "camera") return permissions?.camera === "granted";
    if (scope === "notifications") return permissions?.notifications === "granted";
    if (scope === "remote_llm") return permissions?.remoteLlm === "granted";
    return false;
  };

  const hasEvidence = (requirement: string) => {
    switch (requirement) {
      case "current_local_plan":
      case "current_materialized_plan":
      case "current_plan":
      case "fact_frontier":
        return hasPlan;
      case "committed_nutrition_strategy":
      case "nutrition_review_window":
        return hasNutrition;
      case "committed_goal_cycle":
        return hasGoalCycle;
      case "confirmed_timeline":
      case "confirmed_timeline_or_workout_facts":
        return hasTimeline || hasWorkout;
      case "confirmed_recovery_constraint":
      case "active_recovery_constraint":
        return hasRecoveryConstraint;
      case "confirmed_safety_constraint":
        return hasSafetyConstraint;
      case "registered_local_replan_evaluation":
        return hasForecast;
      case "active_workout_session":
        return hasWorkout;
      // The current message is a provenance-bearing user statement. The tool
      // still validates its typed input and the mandate at execution time.
      case "current_user_statement":
      case "user_stated_items":
      case "user_stated_performance":
      case "user_stated_context":
      case "explicit_user_choice":
      case "mandate":
      case "stimulus_equivalence_check":
      case "installed_knowledge_pack":
        return true;
      default:
        return false;
    }
  };

  return input.tools.manifest().filter((tool) => {
    // Read and human-input tools stay discoverable even when their result
    // will truthfully be an unknown/empty local artifact. Hiding them would
    // make a missing record indistinguishable from an unsupported feature.
    if (tool.accessClass === "read" || tool.accessClass === "human_input") return true;
    // Permission/mandate is an eligibility gate. Evidence is intentionally
    // carried in the local context and verified by the typed handler: a
    // model may ask to record a fresh user statement even though the prior
    // Timeline is empty. Read-only tools are separately filtered above only
    // when a result is impossible for every fact frontier.
    return tool.permissionScopes.every(hasScope)
      && (!tool.name.startsWith("nutrition.propose_") || hasEvidence("committed_nutrition_strategy"));
  });
}
