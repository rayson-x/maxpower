import type { GoalContractData, UserProfileData } from "../coach/domain";
import { AgentKnowledgeBackend } from "./AgentKnowledgeBackend";
import type {
  AgentKnowledgeArtifact,
  AgentKnowledgeDomainExercise,
} from "./model";
import type { KnowledgeVersionPin } from "./runtimeSelection";

type ValidationStatus = "passed" | "failed";

export interface AgentKnowledgePlanExercise {
  readonly catalogRef: string;
  readonly id: string;
  readonly name: string;
  readonly movementPattern: string;
  readonly sets: number;
  readonly reps?: readonly [number, number];
  readonly durationSeconds?: readonly [number, number];
  readonly rir: readonly [number, number];
  readonly primaryMuscles: readonly string[];
  readonly secondaryMuscles: readonly string[];
  readonly fatigueImpact: Readonly<Record<string, number>>;
}

export interface AgentKnowledgePlanSession {
  readonly id: string;
  readonly focus: string;
  readonly scheduledFor: string;
  readonly dayOffset: number;
  readonly majorRegionFocus: readonly string[];
  readonly estimatedMinutes: number;
  readonly exercises: readonly AgentKnowledgePlanExercise[];
  readonly aerobic?: {
    readonly minutes: number;
    readonly placement: "after_strength";
    readonly intensity: "easy_moderate";
  };
}

export interface AgentKnowledgeInitialPlan {
  readonly status: "ready";
  readonly knowledgeReleasePin: KnowledgeVersionPin;
  readonly catalogPin: { readonly schemaVersion: "agent-domain-catalog/v1"; readonly contentHash: string };
  readonly strategy: {
    readonly methodRef: string;
    readonly name: string;
  };
  readonly week: { readonly sessions: readonly AgentKnowledgePlanSession[] };
  readonly nutrition: {
    readonly bmrKcal: number;
    readonly sedentaryHomeOfficeBaselineKcal: number;
    readonly restDayTargetKcal: number;
    readonly strengthDayTargetKcal: number;
    readonly strengthPlusAerobicDayTargetKcal: number;
    readonly weeklyAverageTargetKcal: number;
    readonly dailyDeficitTargetKcal: number;
    readonly thermicEffectAssumptionPercent: number;
    readonly currentBodyFatEvidence: "user_estimate";
  };
  readonly monitoring: readonly {
    readonly observationRef: string;
    readonly summary: string;
  }[];
  readonly validationResults: readonly {
    readonly validatorRef: string;
    readonly status: ValidationStatus;
    readonly reasonCode: string;
    readonly details?: Readonly<Record<string, unknown>>;
  }[];
  readonly reasons: readonly {
    readonly code: string;
    readonly text: string;
    readonly knowledgeRefs: readonly string[];
  }[];
}

/**
 * Evidence supplied by the onboarding Planner handoff. These are deliberately
 * separate from the legacy Profile trainingExperience selector: a person's
 * stated history and a Coach assessment answer different planning questions.
 */
export interface AgentKnowledgePlanningEvidence {
  readonly recentSplit?: readonly string[];
  readonly trainingContinuity?: "supported" | "provisional" | "unknown" | "contradicted";
  readonly comparablePerformance?: "supported" | "provisional" | "unknown" | "contradicted";
  readonly exactExerciseFamiliarity?: "supported" | "provisional" | "unknown" | "contradicted";
  readonly unknowns?: readonly string[];
}

export interface AgentKnowledgePlanningInput {
  readonly profile: UserProfileData;
  readonly goalContract: GoalContractData;
  readonly currentDate: string;
  readonly evidence?: AgentKnowledgePlanningEvidence;
}

interface SplitSlot {
  readonly movementPattern: string;
  readonly muscleGroups?: readonly string[];
  readonly directMuscles?: readonly string[];
  readonly priority: "primary" | "maintenance" | "optional";
  readonly fatigueIntent?: string;
  readonly preferAngle?: string;
}

interface SplitSession {
  readonly id: string;
  readonly focusZh: string;
  readonly slots: readonly SplitSlot[];
}

interface SplitDefinition {
  readonly id: string;
  readonly nameZh: string;
  readonly sessions: readonly SplitSession[];
  readonly suitableWeeklyDays?: readonly number[];
}

/**
 * Independent initial-planning module for agent-knowledge/v1. It consumes the
 * compiled release only; no legacy KnowledgePack registry or runtime fallback
 * is reachable from this boundary.
 */
export class AgentKnowledgePlanningModule {
  constructor(private readonly knowledge: AgentKnowledgeBackend) {}

  createInitialPlan(input: AgentKnowledgePlanningInput): AgentKnowledgeInitialPlan {
    const readiness = this.knowledge.inspectPlanningReadiness();
    if (readiness.status !== "ready") throw new Error(`agent_knowledge_planning_unsupported:${readiness.missingCapabilities.join(",")}`);
    const schedule = input.profile.schedule;
    if (!schedule) throw new Error("agent_knowledge_planning_missing:profile.schedule");
    const splitArtifact = this.selectSplit(input);
    const split = readSplitDefinition(splitArtifact);
    const scheduleAction = this.requiredArtifact("action", "action.initial-plan.schedule-recovery");
    const aerobicAction = this.requiredArtifact("action", "action.initial-plan.schedule-aerobic");
    const doseAction = this.requiredArtifact("action", "action.initial-plan.allocate-dose");
    const fatigueCalculator = this.requiredArtifact("calculator", "calculator.initial-plan.muscle-fatigue");
    const energyCalculator = this.requiredArtifact("calculator", "calculator.initial-plan.energy-budget");
    const ordered = orderSessions(split.sessions, readStringArray(readObject(scheduleAction.parameters).fourDayOrder));
    const offsets = readNumberArray(readObject(scheduleAction.parameters).fourDayOffsets);
    const usedExerciseIds = new Set<string>();
    const sessions = ordered.map((session, index) => {
      const exercises = session.slots.map((slot) => {
        const exercise = this.selectExercise(slot, usedExerciseIds);
        usedExerciseIds.add(exercise.id);
        return resolveExercisePlan(
          exercise,
          slot,
          doseAction,
          fatigueCalculator,
          this.knowledge.domainCatalog().contentHash,
        );
      });
      const aerobic = aerobicFor(session.id, input.goalContract, aerobicAction);
      return {
        id: session.id,
        focus: session.focusZh,
        scheduledFor: addDays(input.currentDate, offsets[index] ?? index),
        dayOffset: offsets[index] ?? index,
        majorRegionFocus: majorRegions(session),
        estimatedMinutes: estimateSessionMinutes(exercises, aerobic),
        exercises,
        ...(aerobic ? { aerobic } : {}),
      } satisfies AgentKnowledgePlanSession;
    });
    const nutrition = calculateEnergy(input, sessions, energyCalculator);
    const validationResults = this.validate(input, sessions, nutrition, fatigueCalculator);
    if (validationResults.some((result) => result.status === "failed")) {
      throw new Error(`agent_knowledge_plan_validation_failed:${validationResults
        .filter((result) => result.status === "failed").map((result) => result.reasonCode).join(",")}`);
    }
    return {
      status: "ready",
      knowledgeReleasePin: this.knowledge.releasePin(),
      catalogPin: {
        schemaVersion: this.knowledge.domainCatalog().schemaVersion,
        contentHash: this.knowledge.domainCatalog().contentHash,
      },
      strategy: { methodRef: splitArtifact.id, name: split.nameZh },
      week: { sessions },
      nutrition,
      monitoring: this.knowledge.artifacts("observation").map((artifact) => ({
        observationRef: artifact.id,
        summary: String(artifact.comparisonProtocol ?? artifact.title.zh ?? artifact.id),
      })),
      validationResults,
      reasons: [
        {
          code: "split.four_day_evidence_supported",
          text: fourDaySplitEvidenceSupported(input)
            ? "近期四分化、训练连续性与可比力量记录相互支持；分开胸、背、腿、肩能保留单次训练质量。"
            : "当前证据不足以把训练水平压成单一标签；首周保留可执行结构，并用校准点复核训练反应。",
          knowledgeRefs: [
            splitArtifact.id,
            "action.initial-plan.select-split",
            ...this.claimArtifactRefs([
              "claim.training.hypertrophy-frequency-distribution",
              "claim.training.hypertrophy-exercise-selection",
              "claim.training.hypertrophy-weekly-volume",
            ]),
          ],
        },
        {
          code: "schedule.coupled_fatigue_separated",
          text: "背部安排在腿部髋铰链之前，腿与肩之间留出恢复日，胸与肩推举不相邻，避免联动肌群疲劳挤压后续质量。",
          knowledgeRefs: [scheduleAction.id, fatigueCalculator.id],
        },
        {
          code: "aerobic.after_strength_preserves_priority",
          text: "有氧只放在两次力量训练之后，采用轻到中等强度；减脂加速不能以牺牲关键力量训练为代价。",
          knowledgeRefs: [
            aerobicAction.id,
            ...this.claimArtifactRefs([
              "claim.training.hypertrophy-concurrent-training",
              "claim.activity.hhs-adult-aerobic-baseline",
            ]),
          ],
        },
        {
          code: "energy.training_and_rest_days_separated",
          text: "居家办公休息日与训练日分开估算，并显式计入 10% 食物热效应假设；后续用体重和腰围趋势校准。",
          knowledgeRefs: [
            energyCalculator.id,
            "observation.body.weight-waist",
            ...this.claimArtifactRefs([
              "claim.weight.niddk-program-is-multicomponent",
              "claim.weight.niddk-realistic-initial-goal",
            ]),
          ],
        },
      ],
    };
  }

  private selectSplit(input: AgentKnowledgePlanningInput): AgentKnowledgeArtifact {
    const weeklyDays = input.profile.schedule?.weeklyFrequency ?? 0;
    const recent = new Set(input.evidence?.recentSplit ?? input.profile.trainingHistorySummary?.recentSplit ?? []);
    const methods = this.knowledge.artifacts("method")
      .map((artifact) => ({ artifact, definition: tryReadSplitDefinition(artifact) }))
      .filter((candidate): candidate is { artifact: AgentKnowledgeArtifact; definition: SplitDefinition } => candidate.definition !== undefined);
    const ranked = methods.map((candidate) => {
      const suitable = candidate.definition.suitableWeeklyDays ?? [candidate.definition.sessions.length];
      const frequencyCompatible = weeklyDays >= Math.min(...suitable) && weeklyDays <= Math.max(...suitable);
      const recentOverlap = candidate.definition.sessions.filter((session) => recent.has(session.id)).length;
      const isolatedMajorSessions = candidate.definition.sessions.filter((session) => majorRegions(session).length <= 2).length;
      const exactFourDay = candidate.definition.id === "chest_back_shoulders_legs"
        && weeklyDays === 4
        && fourDaySplitEvidenceSupported(input);
      return {
        ...candidate,
        score: (frequencyCompatible ? 20 : -100) + recentOverlap * 8 + isolatedMajorSessions * 2 + (exactFourDay ? 30 : 0),
      };
    }).sort((left, right) => right.score - left.score || left.artifact.id.localeCompare(right.artifact.id));
    const selected = ranked[0];
    if (!selected || selected.score < 0) throw new Error("agent_knowledge_no_compatible_split");
    return selected.artifact;
  }

  private selectExercise(slot: SplitSlot, used: ReadonlySet<string>): AgentKnowledgeDomainExercise {
    const loadPreference = readStringArray(readObject(
      this.requiredArtifact("action", "action.initial-plan.resolve-exercises").parameters,
    ).fullGymLoadPreference);
    const candidates = this.knowledge.domainCatalog().exercises
      .filter((exercise) => exercise.status === "active" && exercise.movementPattern === slot.movementPattern && !used.has(exercise.id))
      .map((exercise) => ({ exercise, score: exerciseScore(exercise, slot, loadPreference) }))
      .sort((left, right) => right.score - left.score || left.exercise.id.localeCompare(right.exercise.id));
    if (!candidates[0]) throw new Error(`agent_knowledge_no_exercise:${slot.movementPattern}`);
    return candidates[0].exercise;
  }

  private validate(
    input: AgentKnowledgePlanningInput,
    sessions: readonly AgentKnowledgePlanSession[],
    nutrition: AgentKnowledgeInitialPlan["nutrition"],
    fatigueCalculator: AgentKnowledgeArtifact,
  ): AgentKnowledgeInitialPlan["validationResults"] {
    const validators = new Map(this.knowledge.artifacts("validator").map((artifact) => [artifact.id, artifact]));
    const result = (
      id: string,
      passed: boolean,
      reasonCode: string,
      details?: Readonly<Record<string, unknown>>,
    ) => {
      if (!validators.has(id)) throw new Error(`agent_knowledge_validator_missing:${id}`);
      return { validatorRef: id, status: passed ? "passed" : "failed", reasonCode, ...(details ? { details } : {}) } as const;
    };
    const fatigue = validateFatigueAdjacency(sessions, fatigueCalculator);
    return [
      result("validator.initial-plan.frequency", sessions.length === input.profile.schedule?.weeklyFrequency, "validation.frequency_matches"),
      result("validator.initial-plan.session-duration", sessions.every((session) => session.estimatedMinutes <= (input.profile.schedule?.sessionDurationMinutes ?? 0)), "validation.duration_within_budget", { estimatedMinutes: sessions.map((session) => session.estimatedMinutes) }),
      result("validator.initial-plan.major-regions", sessions.some((session) => session.id === "legs") && sessions.every((session) => session.majorRegionFocus.length <= 2), "validation.major_regions_separated"),
      result("validator.initial-plan.fatigue-adjacency", fatigue.passed, "validation.coupled_fatigue_within_threshold", fatigue.details),
      result("validator.initial-plan.exercise-equipment", input.profile.locations?.some((location) => location.availableEquipment.includes("full_gym")) === true, "validation.full_gym_catalog_compatible"),
      result("validator.initial-plan.energy-transparency", nutrition.restDayTargetKcal < nutrition.strengthDayTargetKcal && nutrition.thermicEffectAssumptionPercent === 10, "validation.energy_day_types_and_tef_visible"),
    ];
  }

  private requiredArtifact(kind: Parameters<AgentKnowledgeBackend["artifact"]>[0], id: string): AgentKnowledgeArtifact {
    const artifact = this.knowledge.artifact(kind, id);
    if (!artifact) throw new Error(`agent_knowledge_artifact_missing:${id}`);
    return artifact;
  }

  private claimArtifactRefs(sourceClaimRefs: readonly string[]): readonly string[] {
    const wanted = new Set(sourceClaimRefs);
    return this.knowledge.artifacts("claim")
      .filter((artifact) => artifact.sourceClaimRefs.some((claimRef) => wanted.has(claimRef)))
      .map((artifact) => artifact.id)
      .sort();
  }
}

function tryReadSplitDefinition(artifact: AgentKnowledgeArtifact): SplitDefinition | undefined {
  const definition = artifact.definition;
  if (!definition || typeof definition !== "object") return undefined;
  const candidate = definition as Partial<SplitDefinition>;
  if (typeof candidate.id !== "string" || typeof candidate.nameZh !== "string" || !Array.isArray(candidate.sessions)) return undefined;
  return candidate as SplitDefinition;
}

function readSplitDefinition(artifact: AgentKnowledgeArtifact): SplitDefinition {
  const definition = tryReadSplitDefinition(artifact);
  if (!definition) throw new Error(`agent_knowledge_split_invalid:${artifact.id}`);
  return definition;
}

function readObject(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readNumberArray(value: unknown): readonly number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

function orderSessions(sessions: readonly SplitSession[], order: readonly string[]): readonly SplitSession[] {
  if (!order.length) return sessions;
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const ordered = order.map((id) => byId.get(id)).filter((session): session is SplitSession => session !== undefined);
  return ordered.length === sessions.length ? ordered : sessions;
}

function majorRegions(session: SplitSession): readonly string[] {
  const regions = new Set<string>();
  for (const slot of session.slots) {
    for (const muscle of slot.muscleGroups ?? []) {
      if (["chest"].includes(muscle)) regions.add("chest");
      if (["back"].includes(muscle)) regions.add("back");
      if (["quadriceps", "hamstrings", "glutes"].includes(muscle)) regions.add("legs");
      if (["deltoids", "lateral_deltoid", "rear_deltoid"].includes(muscle)) regions.add("shoulders");
    }
  }
  return [...regions];
}

function exerciseScore(exercise: AgentKnowledgeDomainExercise, slot: SplitSlot, loadPreference: readonly string[]): number {
  let score = Math.max(0, 20 - loadPreference.indexOf(exercise.equipment.loadMode) * 2);
  const id = exercise.id;
  if (slot.preferAngle && id.includes(`.${slot.preferAngle}.`)) score += 40;
  const preferredTokens: Readonly<Record<string, readonly string[]>> = {
    horizontal_push: slot.preferAngle ? ["bench_press", "barbell", "incline", "standard", "bilateral"] : ["bench_press", "barbell", ".flat.", "standard", "bilateral"],
    vertical_pull: ["lat_pulldown", "cable", "seated", "neutral", "bilateral"],
    horizontal_pull: ["row", "cable", "seated", "neutral", "bilateral"],
    elbow_flexion: ["biceps_curl", "cable", "standing", "supinated", "bilateral"],
    elbow_extension: ["triceps_extension", "cable", "pushdown", "bilateral"],
    vertical_push: ["overhead_press", "dumbbell", "seated", "back_supported"],
    shoulder_abduction: ["lateral_raise", "cable", "standing", "bilateral"],
    shoulder_horizontal_abduction: ["rear_delt_fly", "machine", "chest_supported", "bilateral"],
    squat: ["squat", "barbell", "shoulder_width", "bilateral"],
    hip_hinge: ["deadlift", "barbell", "conventional", "bilateral"],
    lunge: ["lunge", "dumbbell", "reverse", "alternating"],
    knee_flexion: ["knee_flexion", "machine", "seated", "bilateral"],
    core_anti_extension: ["plank", "bodyweight", "standard", "bilateral"],
  };
  for (const token of preferredTokens[slot.movementPattern] ?? []) if (id.includes(token)) score += 8;
  if (exercise.mechanic === "compound" && slot.priority === "primary") score += 4;
  return score;
}

function resolveExercisePlan(
  exercise: AgentKnowledgeDomainExercise,
  slot: SplitSlot,
  doseAction: AgentKnowledgeArtifact,
  fatigueCalculator: AgentKnowledgeArtifact,
  catalogHash: string,
): AgentKnowledgePlanExercise {
  const parameters = readObject(doseAction.parameters);
  const sets = readObject(parameters.setsByPriority)[slot.priority];
  const reps = readObject(parameters.repsByPriority)[slot.priority];
  const isolationReps = parameters.isolationRepRange;
  const timedRange = parameters.timedRangeSeconds;
  const rir = readObject(parameters.rirByPriority)[slot.priority];
  if (
    typeof sets !== "number"
    || !isNumberPair(reps)
    || !isNumberPair(isolationReps)
    || !isNumberPair(timedRange)
    || !isNumberPair(rir)
  ) throw new Error("agent_knowledge_dose_configuration_invalid");
  const resolvedReps = exercise.mechanic === "isolation" ? isolationReps : reps;
  return {
    catalogRef: `agent-domain-catalog/v1:${catalogHash}:${exercise.id}`,
    id: exercise.id,
    name: planningExerciseName(exercise),
    movementPattern: exercise.movementPattern,
    sets,
    ...(exercise.doseMode === "timed" ? { durationSeconds: timedRange } : { reps: resolvedReps }),
    rir,
    primaryMuscles: exercise.primaryMuscleIntent,
    secondaryMuscles: exercise.secondaryMuscleIntent,
    fatigueImpact: fatigueImpactFor(exercise, slot, sets, fatigueCalculator),
  };
}

function planningExerciseName(exercise: AgentKnowledgeDomainExercise): string {
  const base = exercise.displayName.zh.split(" · ")[0] ?? exercise.displayName.zh;
  const tokens = new Set(exercise.id.split("."));
  const attributes: readonly [string, string][] = [
    ["flat", "平板"],
    ["incline", "上斜"],
    ["decline", "下斜"],
    ["seated", "坐姿"],
    ["standing", "站姿"],
    ["kneeling", "跪姿"],
    ["chest_supported", "胸托"],
    ["back_supported", "背托"],
    ["close", "窄握"],
    ["wide", "宽握"],
    ["neutral", "中立握"],
    ["supinated", "反握"],
    ["pronated", "正握"],
    ["reverse", "反向"],
    ["conventional", "传统式"],
    ["sumo", "相扑式"],
    ["pushdown", "下压"],
  ];
  const details = attributes.filter(([token]) => tokens.has(token)).map(([, label]) => label);
  return [base, exercise.equipment.loadMode, ...details].join(" · ");
}

function fatigueImpactFor(
  exercise: AgentKnowledgeDomainExercise,
  slot: SplitSlot,
  sets: number,
  calculator: AgentKnowledgeArtifact,
): Readonly<Record<string, number>> {
  const configuration = readObject(calculator.configuration);
  const weights = readObject(configuration.roleWeight);
  const propagation = readObject(configuration.movementPatternPropagation);
  const doseFactor = Math.min(1, sets / 3);
  const impacts = new Map<string, number>();
  const assign = (muscle: string, raw: unknown) => {
    if (typeof raw !== "number") return;
    impacts.set(muscle, Math.max(impacts.get(muscle) ?? 0, Math.round(raw * doseFactor)));
  };
  for (const muscle of exercise.primaryMuscleIntent) assign(muscle, weights.primary ?? 100);
  for (const muscle of exercise.secondaryMuscleIntent) assign(muscle, weights.secondary ?? 45);
  for (const muscle of exercise.stabilizerIntent) assign(muscle, weights.stabilizer ?? 20);
  for (const [muscle, weight] of Object.entries(readObject(propagation[slot.movementPattern]))) assign(muscle, weight);
  return Object.fromEntries([...impacts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function isNumberPair(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number");
}

function aerobicFor(
  sessionId: string,
  goal: GoalContractData,
  action: AgentKnowledgeArtifact,
): AgentKnowledgePlanSession["aerobic"] | undefined {
  if (goal.aerobicPreference?.role !== "fat_loss_acceleration") return undefined;
  const parameters = readObject(action.parameters);
  if (!readStringArray(parameters.eligibleSessionIds).includes(sessionId)) return undefined;
  return {
    minutes: Number(parameters.minutesPerBlock ?? 20),
    placement: "after_strength",
    intensity: "easy_moderate",
  };
}

function estimateSessionMinutes(
  exercises: readonly AgentKnowledgePlanExercise[],
  aerobic: AgentKnowledgePlanSession["aerobic"],
): number {
  const sets = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  return Math.round(8 + Math.max(0, exercises.length - 1) * 2 + sets * 3 + (aerobic?.minutes ?? 0));
}

function calculateEnergy(
  input: AgentKnowledgePlanningInput,
  sessions: readonly AgentKnowledgePlanSession[],
  calculator: AgentKnowledgeArtifact,
): AgentKnowledgeInitialPlan["nutrition"] {
  const demographics = input.profile.demographics;
  const weight = demographics?.currentWeight?.unit === "kg" ? demographics.currentWeight.value : undefined;
  const height = demographics?.height?.unit === "cm" ? demographics.height.value : undefined;
  const age = demographics?.ageYears;
  if (!weight || !height || !age || !demographics?.sex) throw new Error("agent_knowledge_energy_facts_missing");
  const configuration = readObject(calculator.configuration);
  const sexOffset = demographics.sex === "male" ? 5 : demographics.sex === "female" ? -161 : -78;
  const bmr = 10 * weight + 6.25 * height - 5 * age + sexOffset;
  const factors = readObject(configuration.nonExerciseActivityFactor);
  const factor = Number(factors[input.profile.dailyActivityLevel ?? "sedentary"] ?? 1.2);
  const baseline = bmr * factor;
  const tef = Number(configuration.thermicEffectFraction ?? 0.1);
  const strengthMinutes = Math.min(60, input.profile.schedule?.sessionDurationMinutes ?? 60);
  const trainingMet = Number(configuration.trainingMet ?? 5);
  const aerobicMet = Number(configuration.aerobicMet ?? 5);
  const strengthExercise = trainingMet * 3.5 * weight / 200 * strengthMinutes;
  const aerobicExercise = aerobicMet * 3.5 * weight / 200 * 20;
  const deficit = targetDeficit(
    input,
    Number(configuration.standardDailyDeficitKcal ?? 400),
    baseline,
    tef,
    configuration,
  );
  const target = (exercise: number) => Math.round((baseline + exercise - deficit) / (1 - tef));
  const rest = target(0);
  const strength = target(strengthExercise);
  const strengthPlusAerobic = target(strengthExercise + aerobicExercise);
  const cardioDays = sessions.filter((session) => session.aerobic).length;
  const strengthOnlyDays = sessions.length - cardioDays;
  const restDays = 7 - sessions.length;
  return {
    bmrKcal: Math.round(bmr),
    sedentaryHomeOfficeBaselineKcal: Math.round(baseline),
    restDayTargetKcal: rest,
    strengthDayTargetKcal: strength,
    strengthPlusAerobicDayTargetKcal: strengthPlusAerobic,
    weeklyAverageTargetKcal: Math.round((rest * restDays + strength * strengthOnlyDays + strengthPlusAerobic * cardioDays) / 7),
    dailyDeficitTargetKcal: deficit,
    thermicEffectAssumptionPercent: Math.round(tef * 100),
    currentBodyFatEvidence: "user_estimate",
  };
}

function targetDeficit(
  input: AgentKnowledgePlanningInput,
  fallback: number,
  nonExerciseBaseline: number,
  tef: number,
  configuration: Readonly<Record<string, unknown>>,
): number {
  const weight = input.profile.demographics?.currentWeight?.unit === "kg"
    ? input.profile.demographics.currentWeight.value : undefined;
  const current = input.goalContract.targets?.currentBodyFat?.value;
  const target = input.goalContract.targets?.targetBodyFat?.value;
  const weeks = input.goalContract.targetWeeks;
  if (!weight || current === undefined || target === undefined || !weeks || current <= target) return fallback;
  const leanMass = weight * (1 - current / 100);
  const targetWeight = leanMass / (1 - target / 100);
  const requiredWeeklyRatePercent = (weight - targetWeight) / weeks / weight * 100;
  const bands = readObject(configuration.requiredWeeklyWeightRateBandsPercent);
  const pace = requiredWeeklyRatePercent <= Number(bands.gentleMax ?? 0.3)
    ? "gentle"
    : requiredWeeklyRatePercent <= Number(bands.standardMax ?? 0.6)
      ? "standard"
      : "aggressive";
  const fractions = readObject(configuration.deficitFractionByRequiredPace);
  const bounds = readObject(configuration.deficitBoundsKcal);
  const initialMaintenance = nonExerciseBaseline / (1 - tef);
  return Math.round(Math.min(
    Number(bounds.max ?? 500),
    Math.max(Number(bounds.min ?? 300), initialMaintenance * Number(fractions[pace] ?? 0.15)),
  ));
}

function fourDaySplitEvidenceSupported(input: AgentKnowledgePlanningInput): boolean {
  const recent = new Set(input.evidence?.recentSplit ?? input.profile.trainingHistorySummary?.recentSplit ?? []);
  return input.profile.schedule?.weeklyFrequency === 4
    && ["chest", "back", "legs", "shoulders"].every((session) => recent.has(session))
    && input.evidence?.trainingContinuity === "supported"
    && input.evidence?.comparablePerformance === "supported";
}

function validateFatigueAdjacency(
  sessions: readonly AgentKnowledgePlanSession[],
  calculator: AgentKnowledgeArtifact,
): { readonly passed: boolean; readonly details: Readonly<Record<string, unknown>> } {
  const configuration = readObject(calculator.configuration);
  const residualFactor = Number(configuration.dailyResidualFactor ?? 0.62);
  const threshold = Number(configuration.adjacencyThreshold ?? 55);
  const fatigueBySession = sessions.map((session) => {
    const fatigue = new Map<string, number>();
    for (const exercise of session.exercises) {
      for (const [muscle, impact] of Object.entries(exercise.fatigueImpact)) {
        const previous = fatigue.get(muscle) ?? 0;
        fatigue.set(muscle, Math.round(100 - (100 - previous) * (1 - impact / 100)));
      }
    }
    return { session, fatigue };
  });
  const comparisons = fatigueBySession.map((previous, index) => {
    const next = fatigueBySession[(index + 1) % fatigueBySession.length];
    const wraps = index === fatigueBySession.length - 1;
    const current = wraps
      ? { ...next, session: { ...next.session, dayOffset: next.session.dayOffset + 7 } }
      : next;
    const gap = current.session.dayOffset - previous.session.dayOffset;
    let peakResidual = 0;
    let peakMuscle = "none";
    for (const muscle of current.fatigue.keys()) {
      const residual = (previous.fatigue.get(muscle) ?? 0) * residualFactor ** gap;
      if (residual > peakResidual) { peakResidual = residual; peakMuscle = muscle; }
    }
    return {
      from: previous.session.id,
      to: next.session.id,
      gapDays: gap,
      peakMuscle,
      peakResidual: Math.round(peakResidual),
      passed: peakResidual <= threshold,
    };
  });
  return { passed: comparisons.every((comparison) => comparison.passed), details: { threshold, comparisons } };
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
