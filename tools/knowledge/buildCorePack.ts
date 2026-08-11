import type { EquipmentRequirement } from "../../src/coach/domain";
import { stableHash } from "../../src/coach/stable";
import { buildKnowledgePassages } from "./buildPassages";
import {
  EXERCISE_CATALOG_SCHEMA_VERSION,
  KNOWLEDGE_PACK_SCHEMA_VERSION,
  RULE_PACK_SCHEMA_VERSION,
  type BodyweightDifficultyGraph,
  type ExerciseCatalogArtifact,
  type ExerciseConcept,
  type ExerciseConceptId,
  type DietStrategyDeclaration,
  type EvidenceCitation,
  type FastedTrainingRule,
  type SessionFuelingPolicy,
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
  /** 结构化冲击/关节负荷（供低冲击约束硬过滤）。 */
  impact?: { level: "low" | "moderate" | "high"; loadedJoints: readonly string[] };
  /** 力学分类：复合（多关节）/ 孤立（单关节）。主项优先复合。 */
  mechanic?: "compound" | "isolation";
}

const FAMILIES: readonly FamilySeed[] = [
  { movement: "bench_press", mechanic: "compound", nameZh: "卧推", nameEn: "Bench press", pattern: "horizontal_push", primary: ["chest"], secondary: ["triceps", "anterior_deltoid"], loadModes: ["barbell", "dumbbell", "machine", "cable"], variations: ["standard"], angles: ["flat", "incline", "decline"], grips: ["standard", "close"], supports: ["bench"], aliases: ["推胸"] },
  { movement: "push_up", mechanic: "compound", nameZh: "俯卧撑", nameEn: "Push-up", pattern: "horizontal_push", primary: ["chest"], secondary: ["triceps", "anterior_deltoid"], loadModes: ["bodyweight", "band"], variations: ["standard", "knee", "incline", "decline", "paused"], angles: ["floor"], supports: ["free"], prescriptionMode: "bodyweight_reps" },
  { movement: "chest_fly", mechanic: "isolation", nameZh: "飞鸟", nameEn: "Chest fly", pattern: "horizontal_push", primary: ["chest"], secondary: ["anterior_deltoid"], loadModes: ["dumbbell", "cable", "machine", "band"], variations: ["standard"], angles: ["flat", "incline"], supports: ["supported"] },
  { movement: "overhead_press", mechanic: "compound", nameZh: "肩上推举", nameEn: "Overhead press", pattern: "vertical_push", primary: ["deltoids"], secondary: ["triceps"], loadModes: ["barbell", "dumbbell", "machine", "kettlebell"], variations: ["standard"], angles: ["standing", "seated"], supports: ["free", "back_supported"] },
  { movement: "row", mechanic: "compound", nameZh: "划船", nameEn: "Row", pattern: "horizontal_pull", primary: ["back"], secondary: ["biceps", "rear_deltoid"], loadModes: ["barbell", "dumbbell", "machine", "cable", "band", "kettlebell"], variations: ["standard"], angles: ["bent_over", "seated"], grips: ["neutral", "pronated"], supports: ["free", "chest_supported"] },
  { movement: "lat_pulldown", mechanic: "compound", nameZh: "高位下拉", nameEn: "Lat pulldown", pattern: "vertical_pull", primary: ["back"], secondary: ["biceps"], loadModes: ["cable", "machine", "band"], variations: ["standard"], angles: ["seated", "kneeling"], grips: ["wide", "neutral", "supinated"], supports: ["supported"] },
  { movement: "pull_up", mechanic: "compound", nameZh: "引体向上", nameEn: "Pull-up", pattern: "vertical_pull", primary: ["back"], secondary: ["biceps"], loadModes: ["bodyweight", "band"], variations: ["standard"], angles: ["hanging"], grips: ["pronated", "neutral", "supinated"], supports: ["free"], prescriptionMode: "bodyweight_reps" },
  { movement: "straight_arm_pulldown", mechanic: "compound", nameZh: "直臂下压", nameEn: "Straight-arm pulldown", pattern: "vertical_pull", primary: ["back"], secondary: [], loadModes: ["cable", "band"], variations: ["standard", "rope"], angles: ["standing", "kneeling"] },
  { movement: "squat", mechanic: "compound", nameZh: "深蹲", nameEn: "Squat", pattern: "squat", primary: ["quadriceps", "glutes"], secondary: ["adductors"], loadModes: ["bodyweight", "barbell", "dumbbell", "kettlebell", "machine", "band"], variations: ["standard"], angles: ["shoulder_width", "wide", "narrow"], supports: ["free"] },
  { movement: "deadlift", mechanic: "compound", nameZh: "硬拉", nameEn: "Deadlift", pattern: "hip_hinge", primary: ["posterior_chain"], secondary: ["back"], loadModes: ["barbell", "dumbbell", "kettlebell", "band"], variations: ["conventional", "romanian"], angles: ["standard"], supports: ["free"], fatigue: "high" },
  { movement: "hip_thrust", mechanic: "compound", nameZh: "臀推", nameEn: "Hip thrust", pattern: "hip_hinge", primary: ["glutes"], secondary: ["hamstrings"], loadModes: ["bodyweight", "barbell", "dumbbell", "machine"], variations: ["standard"], angles: ["floor", "bench_supported"], supports: ["supported"] },
  { movement: "lunge", mechanic: "compound", nameZh: "弓步", nameEn: "Lunge", pattern: "lunge", primary: ["quadriceps", "glutes"], secondary: ["adductors"], loadModes: ["bodyweight", "barbell", "dumbbell", "kettlebell"], variations: ["reverse", "forward", "walking"], angles: ["standard"], unilateral: ["alternating"] },
  { movement: "split_squat", mechanic: "compound", nameZh: "分腿蹲", nameEn: "Split squat", pattern: "lunge", primary: ["quadriceps", "glutes"], secondary: [], loadModes: ["bodyweight", "barbell", "dumbbell", "kettlebell"], variations: ["standard", "rear_foot_elevated"], angles: ["standard"], unilateral: ["left", "right"] },
  { movement: "leg_press", mechanic: "compound", nameZh: "腿举", nameEn: "Leg press", pattern: "squat", primary: ["quadriceps", "glutes"], secondary: [], loadModes: ["machine"], variations: ["standard"], angles: ["shoulder_width", "wide", "narrow", "high_foot"], supports: ["supported"] },
  { movement: "knee_extension", mechanic: "isolation", nameZh: "腿屈伸", nameEn: "Knee extension", pattern: "knee_extension", primary: ["quadriceps"], secondary: [], loadModes: ["machine", "band"], variations: ["standard"], angles: ["seated"], unilateral: ["bilateral", "left", "right"], supports: ["supported"] },
  { movement: "knee_flexion", mechanic: "isolation", nameZh: "腿弯举", nameEn: "Leg curl", pattern: "knee_flexion", primary: ["hamstrings"], secondary: [], loadModes: ["machine", "band"], variations: ["seated", "lying", "standing"], angles: ["standard"], supports: ["supported"] },
  { movement: "lateral_raise", mechanic: "isolation", nameZh: "侧平举", nameEn: "Lateral raise", pattern: "shoulder_abduction", primary: ["lateral_deltoid"], secondary: [], loadModes: ["dumbbell", "cable", "band", "machine"], variations: ["standard", "lean_away"], angles: ["standing"], unilateral: ["bilateral", "left", "right"] },
  { movement: "front_raise", mechanic: "compound", nameZh: "前平举", nameEn: "Front raise", pattern: "shoulder_flexion", primary: ["anterior_deltoid"], secondary: [], loadModes: ["dumbbell", "cable", "band", "barbell"], variations: ["standard"], angles: ["standing"], unilateral: ["bilateral", "alternating"] },
  { movement: "rear_delt_fly", mechanic: "isolation", nameZh: "后束飞鸟", nameEn: "Rear-delt fly", pattern: "shoulder_horizontal_abduction", primary: ["rear_deltoid"], secondary: ["upper_back"], loadModes: ["dumbbell", "cable", "band", "machine"], variations: ["standard"], angles: ["standing", "chest_supported"] },
  { movement: "external_rotation", mechanic: "compound", nameZh: "肩外旋", nameEn: "Shoulder external rotation", pattern: "shoulder_external_rotation", primary: ["rotator_cuff"], secondary: [], loadModes: ["cable", "band"], variations: ["elbow_at_side", "ninety_degree"], angles: ["standing"], unilateral: ["left", "right"], fatigue: "low" },
  { movement: "biceps_curl", mechanic: "isolation", nameZh: "肱二头弯举", nameEn: "Biceps curl", pattern: "elbow_flexion", primary: ["biceps"], secondary: ["forearms"], loadModes: ["barbell", "dumbbell", "cable", "band", "machine"], variations: ["standard"], angles: ["standing", "seated"], grips: ["supinated", "neutral", "pronated"] },
  { movement: "triceps_extension", mechanic: "isolation", nameZh: "肱三头伸展", nameEn: "Triceps extension", pattern: "elbow_extension", primary: ["triceps"], secondary: [], loadModes: ["dumbbell", "cable", "band", "machine"], variations: ["pushdown", "overhead", "lying"], angles: ["standard"] },
  { movement: "calf_raise", mechanic: "isolation", nameZh: "提踵", nameEn: "Calf raise", pattern: "ankle_plantarflexion", primary: ["calves"], secondary: [], loadModes: ["bodyweight", "barbell", "dumbbell", "machine"], variations: ["standing", "seated"], angles: ["standard"], unilateral: ["bilateral", "left", "right"] },
  { movement: "plank", mechanic: "isolation", nameZh: "平板支撑", nameEn: "Plank", pattern: "core_anti_extension", primary: ["core"], secondary: [], loadModes: ["bodyweight"], variations: ["kneeling", "standard", "long_lever", "side_left", "side_right", "body_saw"], angles: ["floor"], prescriptionMode: "timed", fatigue: "low" },
  { movement: "anti_rotation_press", mechanic: "compound", nameZh: "抗旋推", nameEn: "Anti-rotation press", pattern: "core_anti_rotation", primary: ["core"], secondary: [], loadModes: ["cable", "band"], variations: ["standing", "half_kneeling"], angles: ["standard"], unilateral: ["left", "right"], fatigue: "low" },
  { movement: "crunch", mechanic: "isolation", nameZh: "卷腹", nameEn: "Crunch", pattern: "core_flexion", primary: ["core"], secondary: [], loadModes: ["bodyweight", "cable", "machine"], variations: ["standard", "reverse"], angles: ["floor"], fatigue: "low" },
  { movement: "march", mechanic: "compound", nameZh: "踏步", nameEn: "March", pattern: "locomotion", primary: ["legs"], secondary: [], loadModes: ["bodyweight"], variations: ["in_place", "lateral", "knee_raise", "step_jack"], angles: ["standing"], impact: { level: "low", loadedJoints: ["knee", "ankle"] }, prescriptionMode: "timed", fatigue: "low" },
  { movement: "walk", mechanic: "compound", nameZh: "步行", nameEn: "Walk", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["none", "cardio_machine"], variations: ["easy", "brisk", "incline"], angles: ["standard"], impact: { level: "low", loadedJoints: ["knee", "ankle"] }, prescriptionMode: "distance", fatigue: "low" },
  { movement: "cycle", mechanic: "compound", nameZh: "骑行", nameEn: "Cycling", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["cardio_machine"], variations: ["upright", "recumbent", "spin"], angles: ["standard"], impact: { level: "low", loadedJoints: ["knee"] }, prescriptionMode: "timed", fatigue: "medium" },
  { movement: "elliptical", mechanic: "compound", nameZh: "椭圆机", nameEn: "Elliptical", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["cardio_machine"], variations: ["steady", "interval"], angles: ["standard"], impact: { level: "low", loadedJoints: ["knee"] }, prescriptionMode: "timed" },
  { movement: "stair_climb", mechanic: "compound", nameZh: "爬楼", nameEn: "Stair climb", pattern: "cardio", primary: ["cardiorespiratory"], secondary: ["legs"], loadModes: ["none", "cardio_machine"], variations: ["steady", "interval"], angles: ["standard"], impact: { level: "moderate", loadedJoints: ["knee"] }, prescriptionMode: "timed" },
  { movement: "mobility_flow", mechanic: "compound", nameZh: "灵活性活动", nameEn: "Mobility flow", pattern: "mobility", primary: [], secondary: [], loadModes: ["none"], variations: ["ankle", "hip", "thoracic", "shoulder", "wrist", "full_body"], angles: ["gentle"], prescriptionMode: "timed", fatigue: "low" },
  { movement: "recovery_activity", mechanic: "compound", nameZh: "恢复活动", nameEn: "Recovery activity", pattern: "recovery", primary: [], secondary: [], loadModes: ["none"], variations: ["breathing", "easy_walk", "gentle_stretch", "rest"], angles: ["gentle"], prescriptionMode: "timed", fatigue: "low" },
];

/**
 * 器械需求 = 负荷来源 + **结构支撑**。
 * 只看 loadMode 会得出"靠凳臀推只需要 bodyweight"、"引体只需要 bodyweight"这类
 * 用户根本无法执行的方案（真实缺陷，2026-08-11 修）。
 * 支撑维度（angleOrStance / support）必须叠加到需求里。
 */
function equipmentFor(
  movement: string,
  loadMode: ExerciseEquipmentDescriptor["loadMode"],
  angleOrStance?: string,
  support?: string,
): ExerciseEquipmentDescriptor {
  const item = (id: string): EquipmentRequirement => ({ kind: "item", id });
  const base: EquipmentRequirement = (() => {
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

  // 结构支撑需求：与负荷来源无关，缺了动作就做不了
  const structural: EquipmentRequirement[] = [];
  if (angleOrStance === "hanging") structural.push(item("pull_up_bar"));
  if (angleOrStance === "bench_supported" || support === "bench") structural.push(item("bench"));
  if (angleOrStance === "incline" || angleOrStance === "decline") structural.push(item("adjustable_bench"));
  if (angleOrStance === "flat" && (loadMode === "barbell" || loadMode === "dumbbell")) structural.push(item("bench"));
  if (support === "chest_supported" || support === "back_supported") structural.push(item("bench"));
  if (!structural.length) return { loadMode, requirement: base };

  const flatten = (requirement: EquipmentRequirement): EquipmentRequirement[] =>
    requirement.kind === "all" ? [...requirement.items] : [requirement];
  return {
    loadMode,
    requirement: { kind: "all", items: [...flatten(base), ...structural] },
  };
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
                    equipment: equipmentFor(family.movement, loadMode, angle, support),
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
                    ...(family.impact ? { impact: family.impact } : {}),
                    ...(family.mechanic ? { mechanic: family.mechanic } : {}),
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
/**
 * 饮食策略库（供需图供给侧）。每条只声明四维供给与目标适配度，不含训练规则。
 * 证据说明：碳水 g/kg 区间来自 AND/DC/ACSM 联合立场（Thomas 2016）——那是**能量平衡下
 * 为表现供能**的标准；减脂期总能量受赤字约束，实际会落在区间下段甚至更低。
 * 蛋白区间来自 ISSN 2017（1.4-2.0 g/kg；减脂保肌取上段）。
 * supports 与 goalFit 的档位是产品规则（D），依据是糖原依赖性与容量驱动的方向性结论。
 */
const DIET_STRATEGIES: readonly DietStrategyDeclaration[] = [
  {
    id: "carb_cycling",
    nameZh: "碳循环",
    carbAvailability: {
      pattern: "cycled",
      byDayType: { high: { min: 4, max: 6 }, moderate: { min: 2.5, max: 4 }, low: { min: 1, max: 2.5 } },
    },
    proteinPolicy: { perKgMin: 1.6, perKgMax: 2.2 },
    fatFloorPercentOfEnergy: 20,
    supports: { highIntensityWork: "full", highVolumeWork: "full", lowIntensityAerobic: "full" },
    goalFit: { hypertrophy: "good", strength: "good", fatLoss: "good" },
    goalFitNote: "碳水集中在糖原需求大的训练日，非训练日下调——按需供能的天然形式",
    evidenceTier: "D",
    sourceRefs: ["impey_2018_fuel_for_the_work_required", "thomas_2016_nutrition_athletic_performance"],
  },
  {
    id: "even_carbs",
    nameZh: "均衡碳水（不循环）",
    carbAvailability: {
      pattern: "constant",
      byDayType: { high: { min: 3, max: 5 }, moderate: { min: 3, max: 5 }, low: { min: 3, max: 5 } },
    },
    proteinPolicy: { perKgMin: 1.6, perKgMax: 2.2 },
    fatFloorPercentOfEnergy: 20,
    supports: { highIntensityWork: "full", highVolumeWork: "full", lowIntensityAerobic: "full" },
    goalFit: { hypertrophy: "good", strength: "good", fatLoss: "good" },
    goalFitNote: "最简单可执行；等热量下与碳循环的减脂效果无差异",
    evidenceTier: "B",
    sourceRefs: ["hall_guo_controlled_feeding", "thomas_2016_nutrition_athletic_performance"],
  },
  {
    id: "low_carb",
    nameZh: "低碳",
    carbAvailability: {
      pattern: "cycled",
      byDayType: { high: { min: 2, max: 3 }, moderate: { min: 1.5, max: 2 }, low: { min: 0.8, max: 1.5 } },
    },
    proteinPolicy: { perKgMin: 1.8, perKgMax: 2.2 },
    fatFloorPercentOfEnergy: 25,
    supports: { highIntensityWork: "limited", highVolumeWork: "limited", lowIntensityAerobic: "full" },
    goalFit: { hypertrophy: "workable_with_tradeoffs", strength: "workable_with_tradeoffs", fatLoss: "good" },
    goalFitNote: "减脂由赤字驱动，低碳本身无额外优势；高强度容量会受一定限制",
    evidenceTier: "B",
    sourceRefs: ["hall_2015_cell_metabolism_fat_vs_carb_restriction"],
  },
  {
    id: "ketogenic",
    nameZh: "生酮",
    carbAvailability: {
      pattern: "very_low",
      byDayType: { high: { min: 0.3, max: 0.7 }, moderate: { min: 0.2, max: 0.5 }, low: { min: 0.2, max: 0.5 } },
    },
    proteinPolicy: { perKgMin: 1.6, perKgMax: 2.0 },
    fatFloorPercentOfEnergy: 60,
    supports: { highIntensityWork: "poor", highVolumeWork: "poor", lowIntensityAerobic: "full" },
    goalFit: { hypertrophy: "poor", strength: "workable_with_tradeoffs", fatLoss: "workable_with_tradeoffs" },
    goalFitNote: "减脂可行（赤字仍是驱动力），但糖原长期很低会压住高强度容量——而容量是增肌的主驱动，所以增肌适配度低",
    evidenceTier: "D",
    sourceRefs: ["hall_guo_controlled_feeding", "impey_2018_fuel_for_the_work_required"],
  },
  {
    id: "higher_carb_surplus",
    nameZh: "高碳（增肌期）",
    carbAvailability: {
      pattern: "cycled",
      byDayType: { high: { min: 5, max: 7 }, moderate: { min: 4, max: 5.5 }, low: { min: 3, max: 4.5 } },
    },
    proteinPolicy: { perKgMin: 1.6, perKgMax: 2.0 },
    fatFloorPercentOfEnergy: 20,
    supports: { highIntensityWork: "full", highVolumeWork: "full", lowIntensityAerobic: "full" },
    goalFit: { hypertrophy: "good", strength: "good", fatLoss: "workable_with_tradeoffs" },
    goalFitNote: "支撑高容量训练；增肌期不需要低碳日，用中碳作下限",
    evidenceTier: "B",
    sourceRefs: ["thomas_2016_nutrition_athletic_performance", "acsm_2026_resistance_training"],
  },
];

/**
 * 文献引用库（版本化）。全部使用免费可达链接（PubMed/PMC/官方 PDF），不用付费 DOI。
 * `cannotSupport` 是防过度声称的主要手段——它写明该来源**不能**推出什么。
 */
const EVIDENCE_CITATIONS: readonly EvidenceCitation[] = [
  {
    id: "impey_2018_fuel_for_the_work_required",
    tier: "B",
    titleEn: "Fuel for the Work Required: A Theoretical Framework for Carbohydrate Periodization and the Glycogen Threshold Hypothesis",
    titleZh: "按需供能：碳水周期化的理论框架与糖原阈值假说",
    authorsShort: "Impey SG, Hearris MA, Hammond KM, et al.",
    year: 2018,
    venue: "Sports Medicine 48(5):1031-1048",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5889771/",
    pmid: "29453741",
    pmcid: "PMC5889771",
    claimEn: "Carbohydrate availability should be matched to the demands of the upcoming session: glycogen-dependent work is scheduled when glycogen is adequate, while work that does not depend on glycogen can be placed when glycogen is lower.",
    claimZh: "碳水可用性应按即将进行的训练的需求匹配：依赖糖原的工作安排在糖原充足时，不依赖糖原的工作可安排在糖原较低时",
    cannotSupportEn: [
      "Does not support the claim that low glycogen availability increases net fat loss",
      "Does not support chronically suppressed glycogen; the framework requires that absolute training intensity is not compromised and applies train-low to roughly 30-50% of sessions",
    ],
    cannotSupportZh: [
      "不能推出低糖原状态能提高净减脂量",
      "不能推出长期压低糖原是有益的（框架要求不损害绝对训练强度，train-low 仅用于约 30-50% 课次）",
    ],
    populationEn: "Endurance and strength-trained populations; original context is performance, not fat loss",
    populationZh: "耐力与力量训练人群；原始语境为运动表现而非减脂",
  },
  {
    id: "schoenfeld_2014_fasted_vs_fed",
    tier: "A",
    titleEn: "Body composition changes associated with fasted versus non-fasted aerobic exercise",
    titleZh: "空腹与非空腹有氧运动的体成分变化",
    authorsShort: "Schoenfeld BJ, Aragon AA, Wilborn CD, Krieger JW, Sonmez GT",
    year: 2014,
    venue: "Journal of the International Society of Sports Nutrition 11:54",
    url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4242477/",
    pmcid: "PMC4242477",
    claimEn: "With a matched hypocaloric diet and volume-equated aerobic exercise, body composition changes did not differ significantly between fasted and fed training.",
    claimZh: "在匹配低热量饮食与等量有氧的条件下，空腹与进食后有氧的体成分变化无显著差异",
    cannotSupportEn: [
      "Does not support fasted cardio being superior for fat loss",
      "Does not support fasted cardio being harmful",
    ],
    cannotSupportZh: ["不能推出空腹有氧更优", "不能推出空腹有氧有害"],
    populationEn: "20 healthy young women, 4 weeks",
    populationZh: "20 名健康年轻女性，4 周",
  },
  {
    id: "postprandial_walking_meta_2023",
    tier: "A",
    titleEn: "After Dinner Rest a While, After Supper Walk a Mile? A Systematic Review with Meta-analysis on the Acute Postprandial Glycemic Response to Exercise Before and After Meal Ingestion",
    titleZh: "餐前与餐后运动对餐后血糖反应的系统综述与 Meta 分析",
    authorsShort: "Systematic review with meta-analysis",
    year: 2023,
    venue: "Sports Medicine",
    url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10036272/",
    pmcid: "PMC10036272",
    claimEn: "Exercise performed after meal ingestion significantly reduces postprandial glucose excursions; benefits are greater the sooner activity begins.",
    claimZh: "餐后进行运动可显著降低餐后血糖波动；越早开始效果越好",
    cannotSupportEn: [
      "Does not support performing moderate-to-high intensity training immediately after a meal (the finding applies to light walking)",
    ],
    cannotSupportZh: ["不能推出餐后立刻做中高强度训练是合适的（该结论适用于轻度步行）"],
    populationEn: "Healthy adults and people with impaired glucose tolerance",
    populationZh: "健康人群与糖耐量受损者",
  },
  {
    id: "postprandial_walking_glucose_response_2022",
    tier: "B",
    titleEn: "The Effects of Postprandial Walking on the Glucose Response after Meals with Different Characteristics",
    titleZh: "餐后步行对不同特征餐食的血糖反应影响",
    authorsShort: "Bellini A, et al.",
    year: 2022,
    venue: "Nutrients",
    url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8912639/",
    pmcid: "PMC8912639",
    claimEn: "Short bouts of postprandial walking (roughly 10-15 minutes) improve the postprandial glucose response; distributed short bouts outperform a single longer session.",
    claimZh: "短时（约 10-15 分钟）餐后步行即可改善餐后血糖反应，分次优于集中一次",
    cannotSupportEn: ["Does not support walking as a substitute for structured training"],
    cannotSupportZh: ["不能推出步行可替代结构化训练"],
    populationEn: "Adults",
    populationZh: "成人",
  },
  {
    id: "acsm_2026_resistance_training",
    tier: "A",
    titleEn: "American College of Sports Medicine Position Stand: Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews",
    titleZh: "ACSM 立场声明：健康成人的抗阻训练处方（综述之综述）",
    authorsShort: "Currier BS, et al.",
    year: 2026,
    venue: "Medicine & Science in Sports & Exercise",
    url: "https://pubmed.ncbi.nlm.nih.gov/41843416/",
    pmid: "41843416",
    claimEn: "Strength benefits most from full range of motion, 2-3 sets per exercise, at least two weekly exposures and heavier loads (about >=80% 1RM); hypertrophy benefits most from higher weekly volume per target muscle (about >=10 sets/week).",
    claimZh: "力量更受益于完整动作范围、每动作 2-3 组、每周至少 2 次暴露与较重负荷（约 ≥80% 1RM）；增肌更受益于按目标肌群计的较高周量（约 ≥10 组/周）",
    cannotSupportEn: [
      "Does not apply to minors, pregnancy, clinically restricted populations or elite sport-specific athletes",
      "Population-level direction is not an individual hard threshold",
    ],
    cannotSupportZh: [
      "不适用于未成年人、孕期、临床限制人群或高水平专项运动员",
      "群体方向不等于个人硬门槛",
    ],
    populationEn: "Healthy adults",
    populationZh: "健康成人",
  },
  {
    id: "schoenfeld_2017_load_range",
    tier: "A",
    titleEn: "Strength and Hypertrophy Adaptations Between Low- vs. High-Load Resistance Training: A Systematic Review and Meta-analysis",
    titleZh: "低负荷与高负荷抗阻训练的力量与肌肥大适应：系统综述与 Meta 分析",
    authorsShort: "Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW",
    year: 2017,
    venue: "Journal of Strength and Conditioning Research 31(12):3508-3523",
    url: "https://pubmed.ncbi.nlm.nih.gov/28834797/",
    pmid: "28834797",
    claimEn: "When sets are taken close to failure, hypertrophy is similar between low load (<=60% 1RM) and high load training; however 1RM strength gains clearly favour high load.",
    claimZh: "接近力竭时，低负荷（≤60% 1RM）与高负荷的肌肉增长无实质差异；但 1RM 力量增长高负荷显著更优",
    cannotSupportEn: [
      "Does not support load being irrelevant (strength goals still require heavy load)",
      "Does not support training far from failure",
    ],
    cannotSupportZh: ["不能推出负荷完全无关（力量目标仍需重负荷）", "不能推出无需接近力竭"],
    populationEn: "Trained and untrained adults, 21 studies",
    populationZh: "训练与未训练成人，21 项研究",
  },
  {
    id: "grgic_2022_failure_vs_nonfailure",
    tier: "A",
    titleEn: "Effects of resistance training performed to repetition failure or non-failure on muscular strength and hypertrophy: A systematic review and meta-analysis",
    titleZh: "训练至力竭与非力竭对力量与肌肥大的影响：系统综述与 Meta 分析",
    authorsShort: "Grgic J, Schoenfeld BJ, Orazem J, Sabol F",
    year: 2022,
    venue: "Journal of Sport and Health Science",
    url: "https://pubmed.ncbi.nlm.nih.gov/33497853/",
    pmid: "33497853",
    claimEn: "Training to muscular failure is not required for strength and hypertrophy gains in generally healthy adults.",
    claimZh: "力竭训练对一般健康成人的力量与肌肥大并非必要",
    cannotSupportEn: ["Does not support leaving a very large margin (for example RIR 5+) being equally effective"],
    cannotSupportZh: ["不能推出保留很大余量（如 RIR 5+）也同等有效"],
    populationEn: "Healthy adults",
    populationZh: "健康成人",
  },
  {
    id: "murphy_koehler_2022_energy_deficiency",
    tier: "A",
    titleEn: "Energy deficiency impairs resistance training gains in lean mass but not strength: A meta-analysis and meta-regression",
    titleZh: "能量不足削弱抗阻训练的瘦体重增长（但不削弱力量）：Meta 分析与 Meta 回归",
    authorsShort: "Murphy C, Koehler K",
    year: 2022,
    venue: "Scandinavian Journal of Medicine & Science in Sports",
    url: "https://pubmed.ncbi.nlm.nih.gov/34623696/",
    pmid: "34623696",
    claimEn: "Larger energy deficits are associated with impaired lean mass gains; training volume during a deficit should aim at maintenance.",
    claimZh: "较大的能量赤字与瘦体重增长受阻相关；赤字期训练量应以维持为目标",
    cannotSupportEn: ["The specific kcal values in the regression are not an individual prescription"],
    cannotSupportZh: ["回归中的具体千卡数值不是对个人的处方"],
    populationEn: "Resistance-trained populations",
    populationZh: "抗阻训练人群",
  },
  {
    id: "issn_2017_protein",
    tier: "A",
    titleEn: "International Society of Sports Nutrition Position Stand: Protein and exercise",
    titleZh: "ISSN 立场声明：蛋白质与运动",
    authorsShort: "Jager R, Kerksick CM, Campbell BI, et al.",
    year: 2017,
    venue: "Journal of the International Society of Sports Nutrition 14:20",
    url: "https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0177-8",
    pmid: "28642676",
    claimEn: "For healthy exercising individuals, daily protein intake of 1.4-2.0 g/kg is generally sufficient; higher intakes may be needed to preserve lean mass during energy restriction.",
    claimZh: "健康运动人群每日 1.4-2.0 g/kg 蛋白通常足够；能量限制期为保留瘦体重可能需要更高摄入",
    cannotSupportEn: [
      "Not a prescription for people with kidney disease, pregnancy or eating disorders",
      "Does not replace total energy intake or dietary quality",
    ],
    cannotSupportZh: ["不是肾病、孕期或饮食障碍人群的处方", "不能替代总能量与膳食质量"],
    populationEn: "Healthy exercising individuals",
    populationZh: "健康运动人群",
  },
  {
    id: "thomas_2016_nutrition_athletic_performance",
    tier: "A",
    titleEn: "Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: Nutrition and Athletic Performance",
    titleZh: "营养与运动表现（AND / DC / ACSM 联合立场声明）",
    authorsShort: "Thomas DT, Erdman KA, Burke LM",
    year: 2016,
    venue: "Journal of the Academy of Nutrition and Dietetics 116(3):501-528",
    url: "https://www.jandonline.org/article/S2212-2672(15)01802-X/abstract",
    pmid: "26920240",
    claimEn: "Carbohydrate needs scale with training load: about 5-7 g/kg/day for moderate exercise (about 1 h/day) and 6-10 g/kg/day for moderate to high intensity exercise (1-3 h/day).",
    claimZh: "碳水需求随训练负荷变化：中等运动（约 1 小时/天）5-7 g/kg/天；中高强度（1-3 小时/天）6-10 g/kg/天",
    cannotSupportEn: [
      "These ranges are for fuelling performance at energy balance and do not apply during an energy deficit, where intakes commonly fall well below them",
    ],
    cannotSupportZh: [
      "这些区间是能量平衡下为表现供能的标准，不适用于能量赤字期（减脂期常落在更低区间）",
    ],
    populationEn: "Athletes and regularly training individuals",
    populationZh: "运动员与规律训练人群",
  },
  {
    id: "who_2020_physical_activity",
    tier: "A",
    titleEn: "WHO guidelines on physical activity and sedentary behaviour",
    titleZh: "WHO 身体活动与久坐行为指南",
    authorsShort: "World Health Organization",
    year: 2020,
    venue: "World Health Organization",
    url: "https://iris.who.int/bitstream/handle/10665/336656/9789240015128-eng.pdf",
    claimEn: "Adults should do 150-300 minutes of moderate intensity or 75-150 minutes of vigorous intensity aerobic activity per week, plus muscle-strengthening activities covering major muscle groups on at least 2 days per week.",
    claimZh: "成人每周 150-300 分钟中等强度或 75-150 分钟高强度有氧，加每周至少 2 天覆盖主要肌群的肌力活动",
    cannotSupportEn: [
      "This is a public health weekly baseline, not a therapeutic prescription that every week must precisely meet",
    ],
    cannotSupportZh: ["这是公共健康周量基线，不是每周必须精确达到的治疗处方"],
    populationEn: "General adult population",
    populationZh: "一般成人",
  },
  {
    id: "acsm_2009_progression",
    tier: "A",
    titleEn: "American College of Sports Medicine Position Stand: Progression models in resistance training for healthy adults",
    titleZh: "ACSM 立场声明：健康成人抗阻训练的进阶模型",
    authorsShort: "Ratamess NA, et al. (ACSM)",
    year: 2009,
    venue: "Medicine & Science in Sports & Exercise 41(3):687-708",
    url: "https://pubmed.ncbi.nlm.nih.gov/19204579/",
    pmid: "19204579",
    claimEn: "When the current load allows 1-2 repetitions above the target, load may be increased by roughly 2-10%.",
    claimZh: "当当前负荷能比目标多完成 1-2 次时，可增加约 2-10% 负荷",
    cannotSupportEn: ["Some 2009 recommendations are superseded by the 2026 update; prefer the newer conclusions"],
    cannotSupportZh: ["2009 版的部分建议已被 2026 更新取代，优先采用新版结论"],
    populationEn: "Healthy adults",
    populationZh: "健康成人",
  },
];

/** 进食状态编排策略（数据；代码只做选择与解析）。间隔分钟为产品规则 D。 */
const SESSION_FUELING_POLICIES: readonly SessionFuelingPolicy[] = [
  {
    workType: "strength",
    preferredState: "fed",
    acceptableStates: ["fed", "light_snack"],
    minMinutesAfterFullMeal: 120,
    minMinutesAfterSnack: 60,
    rationaleZh:
      "力量训练依赖糖原（糖解供能），糖原不足时负荷和容量都会掉——而保住负荷正是保住肌肉的关键。所以力量训练要在吃过、且消化过一段时间的状态做。",
    advantagesZh: ["负荷与容量不受限", "训练质量稳定，进阶可持续"],
    risksZh: ["间隔不足会有胃部不适与表现下降", "大餐尤其高脂餐会延长胃排空，需要更长间隔"],
    evidenceRefs: ["impey_2018_fuel_for_the_work_required", "acsm_2026_resistance_training"],
    tier: "D",
  },
  {
    workType: "high_intensity_aerobic",
    preferredState: "fed",
    acceptableStates: ["fed", "light_snack"],
    minMinutesAfterFullMeal: 150,
    minMinutesAfterSnack: 60,
    rationaleZh:
      "间歇/高强度有氧最依赖糖原，同时对胃内容物最不耐受（易恶心、侧腹痛）。它也和下肢力量训练抢同一份恢复，所以既要吃过，也不要排在腿日相邻。",
    advantagesZh: ["强度能拉到位，时间效率高"],
    risksZh: ["空腹或餐后过近都会明显掉质量", "与力量训练争夺恢复，每周次数需设上限"],
    evidenceRefs: ["impey_2018_fuel_for_the_work_required"],
    tier: "D",
  },
  {
    workType: "low_intensity_aerobic",
    preferredState: "post_strength",
    acceptableStates: ["post_strength", "fasted", "fed", "light_snack"],
    minMinutesAfterFullMeal: 60,
    minMinutesAfterSnack: 30,
    rationaleZh:
      "低强度有氧主要靠脂肪供能，不依赖糖原——所以放在空腹或力量训练后（糖原已部分消耗）都不会损失表现。这不是妥协，是按需供能：不需要糖原的工作放在糖原低的时候，需要糖原的工作留在糖原足的时候，两边都不打折。",
    advantagesZh: [
      "空腹或练后做都不损失表现（它本来不需要糖原）",
      "放在力量训练后可避免干扰力量表现",
      "时间灵活，容易长期坚持",
    ],
    risksZh: [
      "空腹时长过长（超过 60 分钟）会提高低血糖与表现下降风险",
      "空腹本身不带来额外减脂——它是时间与依从性的选择，不是代谢杠杆",
    ],
    evidenceRefs: ["impey_2018_fuel_for_the_work_required", "schoenfeld_2014_fasted_vs_fed"],
    tier: "B",
  },
  {
    workType: "walking",
    preferredState: "fed",
    acceptableStates: ["fed", "fasted", "light_snack", "post_strength"],
    minMinutesAfterFullMeal: null,
    minMinutesAfterSnack: null,
    rationaleZh:
      "散步是唯一餐后立刻做最好的活动：餐后步行能显著降低餐后血糖波动，而且越早开始效果越好，分次（每餐后 10 分钟）优于集中一次。它同时是日常活动量的主要来源——赤字期最容易悄悄流失的那部分。",
    advantagesZh: [
      "降低餐后血糖波动（餐后立刻开始效果最好）",
      "守住日常活动量：赤字期自发活动下降是掉秤停滞的主因",
      "零门槛、零恢复成本、不与任何训练冲突",
    ],
    risksZh: ["强度必须保持轻松（能正常说话）；走成快走或慢跑就变成有氧训练，需遵守间隔规则"],
    evidenceRefs: ["postprandial_walking_meta_2023", "postprandial_walking_glucose_response_2022"],
    tier: "A",
  },
];

/** 空腹训练适格性规则表（数据；命中即阻止或提示）。 */
const FASTED_TRAINING_RULES: readonly FastedTrainingRule[] = [
  {
    id: "fasted_blocks_strength",
    when: { workTypeIn: ["strength"] },
    severity: "block",
    reasonZh: "力量训练依赖糖原，空腹会直接压低负荷与容量，而保住负荷是保住肌肉的关键。",
    alternativeZh: "改到正餐后约 2 小时，或小份加餐后约 1 小时。",
    evidenceRefs: ["impey_2018_fuel_for_the_work_required"],
  },
  {
    id: "fasted_blocks_high_intensity_aerobic",
    when: { workTypeIn: ["high_intensity_aerobic"] },
    severity: "block",
    reasonZh: "间歇/高强度有氧最依赖糖原，空腹时质量会明显下降。",
    alternativeZh: "改到吃过之后做，或本次改为低强度有氧（低强度不依赖糖原）。",
    evidenceRefs: ["impey_2018_fuel_for_the_work_required"],
  },
  {
    id: "fasted_aerobic_duration_cap",
    when: { workTypeIn: ["low_intensity_aerobic"], plannedMinutesOver: 60 },
    severity: "block",
    reasonZh: "空腹超过 60 分钟的有氧会提高头晕与表现下降的风险，收益并不增加。",
    alternativeZh: "起床后补少量碳水（如一根香蕉）再做，或把时长压到 45 分钟内。",
    evidenceRefs: ["schoenfeld_2014_fasted_vs_fed"],
  },
  {
    id: "fasted_not_for_minors",
    when: { ageUnder: 18, adultNotConfirmed: true },
    severity: "block",
    reasonZh: "未成年人不建议空腹训练。",
    alternativeZh: "安排在正常进餐之后进行。",
    evidenceRefs: [],
  },
  {
    id: "fasted_metabolic_behavioral_history",
    when: {
      healthFlagIn: ["hypoglycemia_history", "eating_disorder_history", "insulin_or_secretagogue_use"],
    },
    severity: "block",
    reasonZh: "档案里有低血糖史、进食障碍史或胰岛素/促泌剂用药记录，空腹训练需要专业指导后才考虑。",
    alternativeZh: "先在进食后训练；如需空腹方案请与医生或注册营养师确认。",
    evidenceRefs: [],
  },
  {
    id: "fasted_requires_clearance",
    when: { professionalClearanceRequired: true },
    severity: "block",
    reasonZh: "档案里有需要专业许可的限制，在取得许可前不安排空腹训练。",
    alternativeZh: "按现有医嘱在进食后训练。",
    evidenceRefs: [],
  },
];

const PROGRAM_STRATEGIES: ProgramStrategies = {
  semanticVersion: "1.1.0",
  dietStrategies: DIET_STRATEGIES,
  citations: EVIDENCE_CITATIONS,
  sessionFuelingPolicies: SESSION_FUELING_POLICIES,
  passages: buildKnowledgePassages().passages,
  fastedTrainingRules: FASTED_TRAINING_RULES,
  splitRotations: [
    {
      id: "full_body",
      nameZh: "全身训练",
      sessions: [
        {
          id: "full_a",
          focusZh: "全身 A",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], directMuscles: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], directMuscles: ["lateral_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "core_anti_extension", muscleGroups: ["core"], directMuscles: ["core"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "full_b",
          focusZh: "全身 B",
          slots: [
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], directMuscles: ["hamstrings", "glutes"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], directMuscles: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], directMuscles: ["biceps"], priority: "optional", fatigueIntent: "low" },
          ],
        },
        {
          id: "full_c",
          focusZh: "全身 C",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], directMuscles: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], directMuscles: ["hamstrings", "glutes"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_extension", muscleGroups: ["triceps"], directMuscles: ["triceps"], priority: "optional", fatigueIntent: "low" },
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
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], directMuscles: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], directMuscles: ["deltoids"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "vertical_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], directMuscles: ["biceps"], priority: "optional", fatigueIntent: "low" },
          ],
        },
        {
          id: "lower_a",
          focusZh: "下肢",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], directMuscles: ["hamstrings", "glutes"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "knee_flexion", muscleGroups: ["hamstrings"], directMuscles: ["hamstrings"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "core_anti_extension", muscleGroups: ["core"], directMuscles: ["core"], priority: "optional", fatigueIntent: "low" },
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
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], directMuscles: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], directMuscles: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], directMuscles: ["lateral_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "elbow_extension", muscleGroups: ["triceps"], directMuscles: ["triceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "pull",
          focusZh: "拉（背二头）",
          slots: [
            { movementPattern: "vertical_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "shoulder_horizontal_abduction", muscleGroups: ["rear_deltoid"], directMuscles: ["rear_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], directMuscles: ["biceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "legs",
          focusZh: "腿",
          slots: [
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], directMuscles: ["hamstrings", "glutes"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "knee_flexion", muscleGroups: ["hamstrings"], directMuscles: ["hamstrings"], priority: "optional", fatigueIntent: "medium" },
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
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], directMuscles: ["chest"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_push", muscleGroups: ["chest"], directMuscles: ["chest"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_extension", muscleGroups: ["triceps"], directMuscles: ["triceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "back_biceps",
          focusZh: "背+二头",
          slots: [
            { movementPattern: "vertical_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "horizontal_pull", muscleGroups: ["back"], directMuscles: ["back"], priority: "maintenance", fatigueIntent: "medium" },
            { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], directMuscles: ["biceps"], priority: "maintenance", fatigueIntent: "low" },
          ],
        },
        {
          id: "shoulders_legs",
          focusZh: "肩+腿",
          slots: [
            { movementPattern: "vertical_push", muscleGroups: ["deltoids"], directMuscles: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
            { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], directMuscles: ["quadriceps"], priority: "primary", fatigueIntent: "high" },
            { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], directMuscles: ["lateral_deltoid"], priority: "maintenance", fatigueIntent: "low" },
            { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], directMuscles: ["hamstrings", "glutes"], priority: "maintenance", fatigueIntent: "medium" },
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
