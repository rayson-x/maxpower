import type { EquipmentRequirement } from "../../src/coach/domain";
import { stableHash } from "../../src/coach/stable";
import {
  EXERCISE_CATALOG_SCHEMA_VERSION,
  KNOWLEDGE_PACK_SCHEMA_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  type BodyweightDifficultyGraph,
  type ExerciseCatalogArtifact,
  type ExerciseConcept,
  type ExerciseConceptId,
  type ExerciseEquipmentDescriptor,
  type ExerciseVariant,
  type KnowledgeClassification,
  type KnowledgePack,
  type MovementPattern,
  type RulePackArtifact,
  type SourceRef,
  type StimulusContract,
} from "../../src/knowledge/model";
import type { ProgramStrategies } from "../../src/knowledge/model";

const CLASSIFICATIONS: readonly KnowledgeClassification[] = [
  "EvidenceFact",
  "ProductPolicy",
  "Unknown",
  "SafetyBoundary",
  "CompetitorPrecedent",
];

const SOURCES: readonly SourceRef[] = [
  {
    id: "maxpower.exercise-wiki.v1",
    title: "MaxPower Exercise and Stimulus Knowledge Base",
    uri: "docs/wiki/exercise-and-stimulus-knowledge.md",
    classification: "ProductPolicy",
    reviewedAt: "2026-08-08T00:00:00.000Z",
  },
  {
    id: "maxpower.training-wiki.v1",
    title: "MaxPower Training Programming Knowledge Base",
    uri: "docs/wiki/training-programming.md",
    classification: "EvidenceFact",
    reviewedAt: "2026-08-08T00:00:00.000Z",
  },
  {
    id: "maxpower.recovery-wiki.v1",
    title: "MaxPower Recovery and Health Signals Knowledge Base",
    uri: "docs/wiki/recovery-and-health-signals.md",
    classification: "SafetyBoundary",
    reviewedAt: "2026-08-08T00:00:00.000Z",
  },
  {
    id: "maxpower.nutrition-wiki.v1",
    title: "MaxPower Nutrition Strategy Knowledge Base",
    uri: "docs/wiki/nutrition-strategy.md",
    classification: "EvidenceFact",
    reviewedAt: "2026-08-08T00:00:00.000Z",
  },
  {
    id: "maxpower.competitor-research.v1",
    title: "Fitness Coach Competitor Precedent Research",
    uri: "docs/research/2026-08-08-adaptive-fitness-coach-deep-dive.md",
    classification: "CompetitorPrecedent",
    reviewedAt: "2026-08-08T00:00:00.000Z",
  },
];

interface FamilySeed {
  movement: string;
  nameZh: string;
  nameEn: string;
  pattern: MovementPattern;
  primary: readonly string[];
  secondary: readonly string[];
  loadModes: readonly ExerciseEquipmentDescriptor["loadMode"][];
  variations: readonly string[];
  angles: readonly string[];
  grips?: readonly string[];
  supports?: readonly string[];
  unilateral?: readonly ExerciseVariant["identity"]["unilateralContext"][];
  roms?: readonly string[];
  aliases?: readonly string[];
  prescriptionMode?: StimulusContract["prescriptionMode"];
  fatigue?: StimulusContract["fatigueCost"];
}

const FAMILIES: readonly FamilySeed[] = [
  { movement: "bench_press", nameZh: "卧推", nameEn: "Bench press", pattern: "horizontal_push", primary: ["chest"], secondary: ["triceps", "anterior_deltoid"], loadModes: ["barbell", "dumbbell", "machine", "cable"], variations: ["standard"], angles: ["flat", "incline", "decline"], grips: ["standard", "close"], supports: ["bench"], aliases: ["推胸"] },
  { movement: "push_up", nameZh: "俯卧撑", nameEn: "Push-up", pattern: "horizontal_push", primary: ["chest"], secondary: ["triceps", "anterior_deltoid"], loadModes: ["bodyweight", "band"], variations: ["standard", "knee", "incline", "decline", "paused"], angles: ["floor"], supports: ["free"], prescriptionMode: "bodyweight_reps" },
  { movement: "chest_fly", nameZh: "飞鸟", nameEn: "Chest fly", pattern: "horizontal_push", primary: ["chest"], secondary: ["anterior_deltoid"], loadModes: ["dumbbell", "cable", "machine", "band"], variations: ["standard"], angles: ["flat", "incline"], supports: ["supported"] },
  { movement: "overhead_press", nameZh: "肩上推举", nameEn: "Overhead press", pattern: "vertical_push", primary: ["deltoids"], secondary: ["triceps"], loadModes: ["barbell", "dumbbell", "machine", "kettlebell"], variations: ["standard"], angles: ["standing", "seated"], supports: ["free", "back_supported"] },
  { movement: "row", nameZh: "划船", nameEn: "Row", pattern: "horizontal_pull", primary: ["back"], secondary: ["biceps", "rear_deltoid"], loadModes: ["barbell", "dumbbell", "machine", "cable", "band", "kettlebell"], variations: ["standard"], angles: ["bent_over", "seated"], grips: ["neutral", "pronated"], supports: ["free", "chest_supported"] },
  { movement: "lat_pulldown", nameZh: "高位下拉", nameEn: "Lat pulldown", pattern: "vertical_pull", primary: ["back"], secondary: ["biceps"], loadModes: ["cable", "machine", "band"], variations: ["standard"], angles: ["seated", "kneeling"], grips: ["wide", "neutral", "supinated"], supports: ["supported"] },
  { movement: "pull_up", nameZh: "引体向上", nameEn: "Pull-up", pattern: "vertical_pull", primary: ["back"], secondary: ["biceps"], loadModes: ["bodyweight", "band"], variations: ["standard"], angles: ["hanging"], grips: ["pronated", "neutral", "supinated"], supports: ["free"], prescriptionMode: "bodyweight_reps" },
  { movement: "straight_arm_pulldown", nameZh: "直臂下压", nameEn: "Straight-arm pulldown", pattern: "vertical_pull", primary: ["back"], secondary: [], loadModes: ["cable", "band"], variations: ["standard", "rope"], angles: ["standing", "kneeling"] },
  { movement: "squat", nameZh: "深蹲", nameEn: "Squat", pattern: "squat", primary: ["quadriceps", "glutes"], secondary: ["adductors"], loadModes: ["bodyweight", "barbell", "dumbbell", "kettlebell", "machine", "band"], variations: ["standard"], angles: ["shoulder_width", "wide", "narrow"], supports: ["free"] },
  { movement: "deadlift", nameZh: "硬拉", nameEn: "Deadlift", pattern: "hip_hinge", primary: ["posterior_chain"], secondary: ["back"], loadModes: ["barbell", "dumbbell", "kettlebell", "band"], variations: ["conventional", "romanian"], angles: ["standard"], supports: ["free"], fatigue: "high" },
  { movement: "hip_thrust", nameZh: "臀推", nameEn: "Hip thrust", pattern: "hip_hinge", primary: ["glutes"], secondary: ["hamstrings"], loadModes: ["bodyweight", "barbell", "dumbbell", "machine"], variations: ["standard"], angles: ["floor", "bench_supported"], supports: ["supported"] },
  { movement: "lunge", nameZh: "弓步", nameEn: "Lunge", pattern: "lunge", primary: ["quadriceps", "glutes"], secondary: ["adductors"], loadModes: ["bodyweight", "barbell", "dumbbell", "kettlebell"], variations: ["reverse", "forward", "walking"], angles: ["standard"], unilateral: ["alternating"] },
  { movement: "split_squat", nameZh: "分腿蹲", nameEn: "Split squat", pattern: "lunge", primary: ["quadriceps", "glutes"], secondary: [], loadModes: ["bodyweight", "barbell", "dumbbell", "kettlebell"], variations: ["standard", "rear_foot_elevated"], angles: ["standard"], unilateral: ["left", "right"] },
  { movement: "leg_press", nameZh: "腿举", nameEn: "Leg press", pattern: "squat", primary: ["quadriceps", "glutes"], secondary: [], loadModes: ["machine"], variations: ["standard"], angles: ["shoulder_width", "wide", "narrow", "high_foot"], supports: ["supported"] },
  { movement: "knee_extension", nameZh: "腿屈伸", nameEn: "Knee extension", pattern: "knee_extension", primary: ["quadriceps"], secondary: [], loadModes: ["machine", "band"], variations: ["standard"], angles: ["seated"], unilateral: ["bilateral", "left", "right"], supports: ["supported"] },
  { movement: "knee_flexion", nameZh: "腿弯举", nameEn: "Leg curl", pattern: "knee_flexion", primary: ["hamstrings"], secondary: [], loadModes: ["machine", "band"], variations: ["seated", "lying", "standing"], angles: ["standard"], supports: ["supported"] },
  { movement: "lateral_raise", nameZh: "侧平举", nameEn: "Lateral raise", pattern: "shoulder_abduction", primary: ["lateral_deltoid"], secondary: [], loadModes: ["dumbbell", "cable", "band", "machine"], variations: ["standard", "lean_away"], angles: ["standing"], unilateral: ["bilateral", "left", "right"] },
  { movement: "front_raise", nameZh: "前平举", nameEn: "Front raise", pattern: "shoulder_flexion", primary: ["anterior_deltoid"], secondary: [], loadModes: ["dumbbell", "cable", "band", "barbell"], variations: ["standard"], angles: ["standing"], unilateral: ["bilateral", "alternating"] },
  { movement: "rear_delt_fly", nameZh: "后束飞鸟", nameEn: "Rear-delt fly", pattern: "shoulder_horizontal_abduction", primary: ["rear_deltoid"], secondary: ["upper_back"], loadModes: ["dumbbell", "cable", "band", "machine"], variations: ["standard"], angles: ["standing", "chest_supported"] },
  { movement: "external_rotation", nameZh: "肩外旋", nameEn: "Shoulder external rotation", pattern: "shoulder_external_rotation", primary: ["rotator_cuff"], secondary: [], loadModes: ["cable", "band"], variations: ["elbow_at_side", "ninety_degree"], angles: ["standing"], unilateral: ["left", "right"], fatigue: "low" },
  { movement: "biceps_curl", nameZh: "肱二头弯举", nameEn: "Biceps curl", pattern: "elbow_flexion", primary: ["biceps"], secondary: ["forearms"], loadModes: ["barbell", "dumbbell", "cable", "band", "machine"], variations: ["standard"], angles: ["standing", "seated"], grips: ["supinated", "neutral", "pronated"] },
  { movement: "triceps_extension", nameZh: "肱三头伸展", nameEn: "Triceps extension", pattern: "elbow_extension", primary: ["triceps"], secondary: [], loadModes: ["dumbbell", "cable", "band", "machine"], variations: ["pushdown", "overhead", "lying"], angles: ["standard"] },
  { movement: "calf_raise", nameZh: "提踵", nameEn: "Calf raise", pattern: "ankle_plantarflexion", primary: ["calves"], secondary: [], loadModes: ["bodyweight", "barbell", "dumbbell", "machine"], variations: ["standing", "seated"], angles: ["standard"], unilateral: ["bilateral", "left", "right"] },
  { movement: "plank", nameZh: "平板支撑", nameEn: "Plank", pattern: "core_anti_extension", primary: ["core"], secondary: [], loadModes: ["bodyweight"], variations: ["kneeling", "standard", "long_lever", "side_left", "side_right", "body_saw"], angles: ["floor"], prescriptionMode: "timed", fatigue: "low" },
  { movement: "anti_rotation_press", nameZh: "抗旋推", nameEn: "Anti-rotation press", pattern: "core_anti_rotation", primary: ["core"], secondary: [], loadModes: ["cable", "band"], variations: ["standing", "half_kneeling"], angles: ["standard"], unilateral: ["left", "right"], fatigue: "low" },
  { movement: "crunch", nameZh: "卷腹", nameEn: "Crunch", pattern: "core_flexion", primary: ["core"], secondary: [], loadModes: ["bodyweight", "cable", "machine"], variations: ["standard", "reverse"], angles: ["floor"], fatigue: "low" },
  { movement: "march", nameZh: "踏步", nameEn: "March", pattern: "locomotion", primary: ["legs"], secondary: [], loadModes: ["bodyweight"], variations: ["in_place", "lateral", "knee_raise", "step_jack"], angles: ["standing"], prescriptionMode: "timed", fatigue: "low" },
  { movement: "walk", nameZh: "步行", nameEn: "Walk", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["none", "cardio_machine"], variations: ["easy", "brisk", "incline"], angles: ["standard"], prescriptionMode: "distance", fatigue: "low" },
  { movement: "cycle", nameZh: "骑行", nameEn: "Cycling", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["cardio_machine"], variations: ["upright", "recumbent", "spin"], angles: ["standard"], prescriptionMode: "timed", fatigue: "medium" },
  { movement: "elliptical", nameZh: "椭圆机", nameEn: "Elliptical", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["cardio_machine"], variations: ["steady", "interval"], angles: ["standard"], prescriptionMode: "timed" },
  { movement: "stair_climb", nameZh: "爬楼", nameEn: "Stair climb", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["none", "cardio_machine"], variations: ["steady", "interval"], angles: ["standard"], prescriptionMode: "timed" },
  { movement: "mobility_flow", nameZh: "灵活性活动", nameEn: "Mobility flow", pattern: "mobility", primary: [], secondary: [], loadModes: ["none"], variations: ["ankle", "hip", "thoracic", "shoulder", "wrist", "full_body"], angles: ["gentle"], prescriptionMode: "timed", fatigue: "low" },
  { movement: "recovery_activity", nameZh: "恢复活动", nameEn: "Recovery activity", pattern: "recovery", primary: [], secondary: [], loadModes: ["none"], variations: ["breathing", "easy_walk", "gentle_stretch", "rest"], angles: ["gentle"], prescriptionMode: "timed", fatigue: "low" },
];

function equipmentFor(
  movement: string,
  loadMode: ExerciseEquipmentDescriptor["loadMode"],
): ExerciseEquipmentDescriptor {
  const item = (id: string): EquipmentRequirement => ({ kind: "item", id });
  const requirement: EquipmentRequirement = (() => {
    switch (loadMode) {
      case "bodyweight":
        return { kind: "all", items: [item("bodyweight"), item("floor_space")] };
      case "barbell":
        return { kind: "all", items: [item("barbell"), item("weight_plates")] };
      case "dumbbell":
        return item("dumbbell_pair");
      case "kettlebell":
        return item("kettlebell");
      case "machine":
        return item(`${movement}_machine`);
      case "cable":
        return { kind: "all", items: [item("cable_stack"), item("cable_attachment")] };
      case "band":
        return item("resistance_band");
      case "cardio_machine":
        return item(`${movement}_machine`);
      case "none":
        return movement === "stair_climb"
          ? { kind: "environment", space: "medium", noise: "moderate", floorImpact: "any" }
          : { kind: "environment", space: "small", noise: "quiet", floorImpact: "low" };
      case "custom":
        return item("custom_equipment");
    }
  })();
  return { loadMode, requirement };
}

function buildCatalog(): ExerciseCatalogArtifact {
  const concepts: ExerciseConcept[] = FAMILIES.map((family) => ({
    id: `concept.${family.movement}` as ExerciseConceptId,
    displayName: { zh: family.nameZh, en: family.nameEn },
    aliases: [family.nameZh, family.nameEn, ...(family.aliases ?? [])],
    sourceRefs: ["maxpower.exercise-wiki.v1"],
    license: {
      content: "project_authored_metadata",
      text: "project_authored",
      media: "none_bundled",
    },
    catalogVersion: "1.0.0",
    status: "active",
    limitations: ["expected_training_identity_not_observed_biomechanics"],
    reviewedAt: "2026-08-08T00:00:00.000Z",
  }));
  const contracts: StimulusContract[] = FAMILIES.map((family) => ({
    id: `stimulus.${family.movement}.v1`,
    movementPattern: family.pattern,
    mechanicalFunctions: [family.pattern],
    jointActions: jointActionsFor(family.pattern),
    primaryMuscleIntent: family.primary,
    secondaryMuscleIntent: family.secondary,
    stability: "either",
    unilateral: "either",
    prescriptionMode: family.prescriptionMode ??
      (family.loadModes.includes("bodyweight") ? "bodyweight_reps" : "weighted_reps"),
    ...(family.prescriptionMode === "timed"
      ? { repOrTimeRange: { min: 20, max: 600, unit: "seconds" as const } }
      : { repOrTimeRange: { min: 1, max: 30, unit: "reps" as const }, targetRir: { min: 0, max: 6 } }),
    fatigueCost: family.fatigue ?? "medium",
    priority: "primary",
    lockedFields: [],
  }));
  const variants: ExerciseVariant[] = [];
  for (const family of FAMILIES) {
    for (const loadMode of family.loadModes) {
      for (const variation of family.variations) {
        for (const angle of family.angles) {
          for (const grip of family.grips ?? ["standard"]) {
            for (const support of family.supports ?? ["free"]) {
              for (const unilateralContext of family.unilateral ?? ["bilateral"]) {
                for (const romContext of family.roms ?? ["full_rom"]) {
                  const id = [
                    family.movement,
                    loadMode,
                    angle,
                    grip,
                    unilateralContext,
                    romContext,
                    ...(variation === "standard" ? [] : [variation]),
                    ...(support === "free" || support === "bench" ? [] : [support]),
                  ].join(".");
                  const identity = {
                    movement: family.movement,
                    variation,
                    loadMode,
                    equipmentConfiguration: `${loadMode}:${family.movement}`,
                    support,
                    setup: `${support}:${angle}`,
                    angleOrStance: angle,
                    grip,
                    unilateralContext,
                    romContext,
                    loadMeasurement: loadMeasurementFor(loadMode, family.prescriptionMode),
                  } as const;
                  variants.push({
                    id,
                    conceptId: `concept.${family.movement}` as ExerciseConceptId,
                    schemaVersion: EXERCISE_CATALOG_SCHEMA_VERSION,
                    semanticVersion: "1.0.0",
                    displayName: {
                      zh: `${family.nameZh} · ${loadMode} · ${variation}`,
                      en: `${family.nameEn} · ${loadMode} · ${variation}`,
                    },
                    aliases: [family.nameZh, family.nameEn, ...(family.aliases ?? [])],
                    identity,
                    performanceIdentity: stableHash(identity),
                    movementPattern: family.pattern,
                    equipment: equipmentFor(family.movement, loadMode),
                    stimulusContractIds: [`stimulus.${family.movement}.v1`],
                    expectedMuscleAssociation: {
                      exerciseVariantId: id,
                      contextHash: stableHash(identity),
                      status: family.primary.length ? "reviewed_expected_participation" : "unknown",
                      associations: [
                        ...family.primary.map((muscleId) => ({
                          muscleId,
                          role: "primary_intent" as const,
                          evidenceStatus: "product_policy" as const,
                        })),
                        ...family.secondary.map((muscleId) => ({
                          muscleId,
                          role: "secondary_intent" as const,
                          evidenceStatus: "product_policy" as const,
                        })),
                      ],
                      disclaimer: "expected_participation_not_observed_activation",
                    },
                    motionEvidenceRequirements: [
                      {
                        cameraView: "front",
                        maturity: "none",
                        fallback: "manual_recording",
                      },
                      {
                        cameraView: "side",
                        maturity: "none",
                        fallback: "manual_recording",
                      },
                    ],
                    ...(loadMode === "bodyweight" ? { bodyweightDifficultyNodeId: id } : {}),
                    status: "active",
                    sourceRefs: ["maxpower.exercise-wiki.v1"],
                    unknownFields: ["individual_load_history", "motion_capability"],
                    dataEligibility: {
                      recordable: true,
                      plannerEligible: true,
                      expectedMuscleMetadata: family.primary.length ? "reviewed" : "unknown",
                      motionCapabilityRequirement: "independent_exact_resolver",
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  const unique = [...new Map(variants.map((variant) => [variant.id, variant])).values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const bodyweightNodes = [
    "push_up.bodyweight.floor.standard.bilateral.full_rom.knee",
    "push_up.bodyweight.floor.standard.bilateral.full_rom.incline",
    "push_up.bodyweight.floor.standard.bilateral.full_rom",
    "push_up.bodyweight.floor.standard.bilateral.full_rom.decline",
    "push_up.band.floor.standard.bilateral.full_rom",
  ].filter((id) => unique.some((variant) => variant.id === id));
  const difficultyGraphs: BodyweightDifficultyGraph[] = [
    {
      id: "bodyweight.push_up.v1",
      nodes: bodyweightNodes,
      edges: [
        {
          from: "push_up.bodyweight.floor.standard.bilateral.full_rom.knee",
          to: "push_up.bodyweight.floor.standard.bilateral.full_rom.incline",
          direction: "progression",
          changes: ["support_points", "body_angle", "safe_stop"],
        },
        {
          from: "push_up.bodyweight.floor.standard.bilateral.full_rom.incline",
          to: "push_up.bodyweight.floor.standard.bilateral.full_rom",
          direction: "progression",
          changes: ["body_angle", "safe_stop"],
        },
        {
          from: "push_up.bodyweight.floor.standard.bilateral.full_rom",
          to: "push_up.bodyweight.floor.standard.bilateral.full_rom.decline",
          direction: "progression",
          changes: ["body_angle", "safe_stop"],
        },
        {
          from: "push_up.bodyweight.floor.standard.bilateral.full_rom",
          to: "push_up.band.floor.standard.bilateral.full_rom",
          direction: "progression",
          changes: ["band", "external_load", "safe_stop"],
        },
      ],
    },
  ];
  const content = {
    id: "maxpower.exercise-catalog",
    semanticVersion: "1.0.0",
    schemaVersion: EXERCISE_CATALOG_SCHEMA_VERSION,
    migrationPolicy: { mode: "additive_deprecation" as const, preservePinnedVersions: true as const },
    substitutionProfiles: [
      {
        goalPack: "hypertrophy" as const,
        weights: { sameMovement: 100, sameMovementPattern: 50, sameLoadMode: 20, cameraCapabilityBonus: 1, cardioOrLocomotionBonus: -10, recoveryActivityBonus: 0 },
      },
      {
        goalPack: "strength" as const,
        weights: { sameMovement: 110, sameMovementPattern: 50, sameLoadMode: 30, cameraCapabilityBonus: 1, cardioOrLocomotionBonus: -20, recoveryActivityBonus: 0 },
      },
      {
        goalPack: "fat_loss" as const,
        weights: { sameMovement: 90, sameMovementPattern: 50, sameLoadMode: 10, cameraCapabilityBonus: 1, cardioOrLocomotionBonus: 5, recoveryActivityBonus: 0 },
      },
      {
        goalPack: "conditioning" as const,
        weights: { sameMovement: 90, sameMovementPattern: 50, sameLoadMode: 10, cameraCapabilityBonus: 1, cardioOrLocomotionBonus: 8, recoveryActivityBonus: 0 },
      },
      {
        goalPack: "health" as const,
        weights: { sameMovement: 90, sameMovementPattern: 50, sameLoadMode: 10, cameraCapabilityBonus: 1, cardioOrLocomotionBonus: 2, recoveryActivityBonus: 3 },
      },
    ],
    concepts,
    variants: unique,
    stimulusContracts: contracts,
    difficultyGraphs,
  };
  return { ...content, contentHash: stableHash(content) };
}

function loadMeasurementFor(
  loadMode: ExerciseEquipmentDescriptor["loadMode"],
  prescriptionMode: StimulusContract["prescriptionMode"] | undefined,
): ExerciseVariant["identity"]["loadMeasurement"] {
  if (prescriptionMode === "timed") return "time";
  if (prescriptionMode === "distance") return "distance";
  if (loadMode === "bodyweight" || prescriptionMode === "bodyweight_reps") return "bodyweight_node";
  if (loadMode === "none") return "none";
  return "external_mass";
}

function jointActionsFor(pattern: MovementPattern): readonly string[] {
  const known: Partial<Record<MovementPattern, readonly string[]>> = {
    horizontal_push: ["shoulder_horizontal_flexion", "elbow_extension"],
    vertical_push: ["shoulder_flexion_or_abduction", "elbow_extension"],
    horizontal_pull: ["shoulder_extension", "elbow_flexion", "scapular_retraction"],
    vertical_pull: ["shoulder_adduction_or_extension", "elbow_flexion"],
    squat: ["hip_and_knee_extension"],
    hip_hinge: ["hip_extension"],
    lunge: ["unilateral_hip_and_knee_extension"],
    cardio: ["cyclic_locomotion"],
    recovery: ["low_intensity_recovery_activity"],
  };
  return known[pattern] ?? [pattern];
}

function rulePack(
  id: string,
  scope: readonly string[],
  sourceRefs: readonly string[] = ["maxpower.exercise-wiki.v1"],
): RulePackArtifact {
  const content = {
    id,
    semanticVersion: "1.0.0",
    schemaVersion: RULE_PACK_SCHEMA_VERSION,
    reviewed: true,
    reviewedAt: "2026-08-08T00:00:00.000Z",
    sourceRefs,
    scope,
    executable: true as const,
  };
  return { ...content, contentHash: stableHash(content) };
}


/**
 * 安全词表（ticket 09/07）：禁止声称清单初始内容来自 workspace wiki 三张知识页
 * （training-programming / nutrition-strategy / recovery-health-signals）的明文化清单。
 * patterns 为 AND 语义（全部子串命中才拦截），降低误伤。
 */
const SAFETY_LEXICON = {
  semanticVersion: "1.0.0",
  forbiddenClaims: [
    { id: "fat-burn-rep-range", patterns: ["燃脂次数区间"], replacement: "该说法不成立：不存在专属\u201c燃脂次数区间\u201d，减脂主要由持续能量缺口驱动。" },
    { id: "camera-verified-load", patterns: ["摄像头确认你举了"], replacement: "摄像头无法确认真实负重；负荷只以你确认的记录为准。" },
    { id: "soreness-mandates-set", patterns: ["没有酸痛", "必须加组"], replacement: "酸痛与否不能单独决定是否加组；调整依据是可比的表现与恢复证据。" },
    { id: "calendar-mandatory-deload", patterns: ["身体必须 deload"], replacement: "不存在\u201c到第几周必须 deload\u201d的生理定律；deload 由表现与恢复信号触发。" },
    { id: "ten-sets-mev", patterns: ["是你的最低有效量"], replacement: "\u201c10 组\u201d是群体层面的增强信号，不是你个人的最低有效量。" },
    { id: "rir-objective", patterns: ["RIR 是客观测得"], replacement: "RIR 是主观估计，不是传感器测得的客观事实。" },
    { id: "high-rep-fat-loss", patterns: ["高次数更燃脂"], replacement: "高次数并不更\u201c燃脂\u201d；减脂期训练核心是保留力量与肌肉刺激。" },
    { id: "hrv-diagnosis", patterns: ["HRV 表明你"], replacement: "HRV 不能诊断生病或过度训练；它只是需要结合其他信号的参考趋势。" },
    { id: "deep-sleep-injury", patterns: ["深睡不足", "会受伤"], replacement: "睡眠分期不能预测受伤；消费级设备的睡眠分期可靠性有限。" },
    { id: "acwr-injury-risk", patterns: ["ACWR", "受伤风险"], replacement: "ACWR 阈值不能预测伤病，也不会据此限制训练。" },
    { id: "readiness-auto-cancel", patterns: ["恢复分", "已取消训练"], replacement: "任何设备分数都不会自动取消你的训练；决定权在你。" },
    { id: "soreness-damage", patterns: ["酸痛说明肌肉尚未修复"], replacement: "酸痛程度不代表肌肉修复进度或损伤程度。" },
    { id: "carb-cycle-fat-loss", patterns: ["碳循环", "燃脂更多"], replacement: "碳循环不比等热量的普通饮食\u201c燃脂更多\u201d；它只是安排碳水的便利方式。" },
    { id: "low-carb-reset", patterns: ["重置代谢"], replacement: "低碳休息日不会\u201c重置代谢\u201d；能量平衡才是主导因素。" },
    { id: "refeed-metabolic", patterns: ["防止代谢适应"], replacement: "没有证据表明 refeed 能\u201c防止代谢适应\u201d。" },
    { id: "keto-required", patterns: ["生酮", "必需"], replacement: "生酮不是减脂必需；持续能量缺口才是主要驱动。" },
  ],
  domainAnchors: [
    "训练", "增肌", "力量", "减脂", "减重", "增重", "饮食", "营养", "蛋白", "碳水", "脂肪",
    "热量", "睡眠", "恢复", "疲劳", "酸痛", "HRV", "心率", "动作", "重量", "次数", "组数",
    "RIR", "RPE", "器械", "有氧", "热身", "拉伸", "关节", "肌肉", "健康",
  ],
};


/** 编排策略种子（ticket 03）：源自 program-strategy-set.md（四标签纪律见该文档）。 */
const PROGRAM_STRATEGIES: ProgramStrategies = {
  semanticVersion: "1.0.0",
  splitRotations: [
    {
      id: "full_body",
      nameZh: "全身训练",
      sessions: [
        {
          id: "full_a",
          focusZh: "全身 A",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "core_anti_extension", muscleGroups: ["core"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "full_b",
          focusZh: "全身 B",
          slots: [
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], priority: "optional", fatigueIntent: "low" },
          ],
        },
        {
          id: "full_c",
          focusZh: "全身 C",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_extension", muscleGroups: ["triceps"], priority: "optional", fatigueIntent: "low" },
          ],
        },
      ],
      exposuresPerCycle: 3,
      suitableWeeklyDays: [2, 3],
    },
    {
      id: "upper_lower",
      nameZh: "上下肢分化",
      sessions: [
        {
          id: "upper_a",
          focusZh: "上肢",
          slots: [
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], priority: "optional", fatigueIntent: "low" },
          ],
        },
        {
          id: "lower_a",
          focusZh: "下肢",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "knee_flexion", muscleGroups: ["hamstrings"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "core_anti_extension", muscleGroups: ["core"], priority: "optional", fatigueIntent: "low" },
          ],
        },
      ],
      exposuresPerCycle: 1,
      suitableWeeklyDays: [4, 4],
    },
    {
      id: "push_pull_legs",
      nameZh: "推拉腿",
      sessions: [
        {
          id: "push",
          focusZh: "推（胸肩三头）",
          slots: [
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "elbow_extension", muscleGroups: ["triceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "pull",
          focusZh: "拉（背二头）",
          slots: [
            { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "shoulder_horizontal_abduction", muscleGroups: ["rear_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "legs",
          focusZh: "腿",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "knee_flexion", muscleGroups: ["hamstrings"], priority: "optional", fatigueIntent: "medium" },
          ],
        },
      ],
      exposuresPerCycle: 1,
      suitableWeeklyDays: [4, 6],
    },
    {
      id: "three_way_rotation",
      nameZh: "三分化轮转（胸三头/背二头/肩腿）",
      sessions: [
        {
          id: "chest_triceps",
          focusZh: "胸+三头",
          slots: [
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_extension", muscleGroups: ["triceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "back_biceps",
          focusZh: "背+二头",
          slots: [
            { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "shoulders_legs",
          focusZh: "肩+腿",
          slots: [
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], priority: "maintenance", fatigueIntent: "medium" },
          ],
        },
      ],
      exposuresPerCycle: 1,
      suitableWeeklyDays: [3, 6],
    },
  ],
  weeklyDirectSetTargets: {
    beginner: { min: 2, default: 4, max: 8 },
    intermediate: { min: 4, default: 6, max: 10 },
    advanced: { min: 6, default: 8, max: 12 },
  },
  setCostModel: {
    warmupMinutes: 8,
    transitionMinutesPerSwitch: 2,
    workSetMinutes: 0.75,
    restSecondsByPriority: { primary: 120, maintenance: 90, optional: 75, high_fatigue: 180 },
  },
};

export function buildCoreKnowledgePack(): KnowledgePack {
  const exerciseCatalog = buildCatalog();
  const executableRulePacks = [
    rulePack("maxpower.knowledge.compatibility", ["pack_compatibility", "unknown_preservation"]),
    rulePack("maxpower.catalog.constraints", ["equipment_logic", "substitution_constraints"]),
    rulePack(
      "maxpower.training.hypertrophy",
      ["performance_progression", "volume_progression", "bodyweight_progression", "deload"],
      ["maxpower.training-wiki.v1"],
    ),
    rulePack(
      "maxpower.training.strength",
      ["performance_progression", "strength_exposure", "bodyweight_progression", "deload"],
      ["maxpower.training-wiki.v1"],
    ),
    rulePack(
      "maxpower.training.fat_loss_preserve_lean_mass",
      ["performance_progression", "minimum_stimulus", "bodyweight_progression", "deload"],
      ["maxpower.training-wiki.v1"],
    ),
  ];
  const wikiDocuments = [
    "docs/wiki/exercise-and-stimulus-knowledge.md",
    "docs/wiki/training-programming.md",
    "docs/wiki/recovery-and-health-signals.md",
    "docs/wiki/nutrition-strategy.md",
  ].map((path) => ({ path, semanticVersion: "1.0.0", executable: false as const }));
  const classifications = CLASSIFICATIONS;
  const manifestContent = {
    id: "maxpower.core-fitness-knowledge",
    semanticVersion: "1.0.0",
    schemaVersion: KNOWLEDGE_PACK_SCHEMA_VERSION,
    publishedAt: "2026-08-08T00:00:00.000Z",
    reviewedAt: "2026-08-08T00:00:00.000Z",
    sourceRefs: SOURCES,
    population: ["healthy_adults", "beginner_to_advanced_resistance_training"],
    scope: ["exercise_catalog", "stimulus_metadata", "knowledge_governance"],
    capabilityFlags: ["offline_catalog", "typed_rule_manifest", "unknown_preservation"],
    compatibility: { minAppSchema: 1, maxAppSchema: 1 },
  };
  const contentHash = stableHash({
    manifest: manifestContent,
    classifications,
    exerciseCatalog,
    executableRulePacks,
    wikiDocuments,
    safetyLexicon: SAFETY_LEXICON,
    programStrategies: PROGRAM_STRATEGIES,
  });
  return {
    manifest: {
      ...manifestContent,
      contentHash,
      signature: { status: "reviewed_digest", algorithm: "fnv1a-32", value: contentHash },
    },
    classifications,
    exerciseCatalog,
    executableRulePacks,
    wikiDocuments,
    safetyLexicon: SAFETY_LEXICON,
    programStrategies: PROGRAM_STRATEGIES,
  };
}

/**
 * 生成内置知识包 JSON（ticket 02）：知识包是版本化数据资产，
 * 本脚本是它的"编译器"——种子表修改后重新运行本脚本生成新包文件。
 */
if (require.main === module) {
  const { writeFileSync, mkdirSync } = require("node:fs");
  const { join } = require("node:path");
  const pack = buildCoreKnowledgePack();
  const dir = join(process.cwd(), "src/knowledge/packs");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "core-fitness-knowledge.v1.json");
  writeFileSync(out, JSON.stringify(pack));
  console.log(`written ${out} (${pack.exerciseCatalog.variants.length} variants, hash ${pack.manifest.contentHash})`);
}
