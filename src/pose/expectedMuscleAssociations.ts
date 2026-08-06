import { EXERCISE_REGISTRY, type ExerciseRegistry } from "./exerciseRegistry";

export type MuscleId =
  | "quadriceps"
  | "gluteals"
  | "hamstrings"
  | "calves"
  | "hip_flexors"
  | "hip_abductors"
  | "hip_adductors"
  | "pectorals"
  | "triceps"
  | "anterior_deltoids"
  | "medial_deltoids"
  | "serratus_anterior"
  | "trunk_stabilizers";

export type MuscleRole = "primary" | "secondary" | "stabilizer";

export type ObservableJoint =
  | "trunk"
  | "shoulder"
  | "elbow"
  | "hip"
  | "knee"
  | "ankle";

export type JointAction =
  | "flexion"
  | "extension"
  | "abduction"
  | "adduction"
  | "horizontal_abduction"
  | "horizontal_adduction"
  | "plantarflexion"
  | "dorsiflexion"
  | "lateral_translation";

export interface MuscleDefinition {
  id: MuscleId;
  labelZh: string;
  labelEn: string;
}

export interface ExpectedMuscleRole {
  muscleId: MuscleId;
  role: MuscleRole;
}

export interface ExpectedJointMotion {
  joint: ObservableJoint;
  action: JointAction;
  noteZh: string;
}

export interface TrajectoryMusclePhase {
  id: string;
  labelZh: string;
  expectedJointMotions: readonly ExpectedJointMotion[];
  expectedMechanicalContributors: readonly MuscleId[];
  interpretationZh: string;
}

export interface AssociationSource {
  id: string;
  title: string;
  url: string;
  evidenceKind: "exercise_reference" | "modeling_boundary";
  exactExerciseId: string | null;
}

export interface ExpectedMuscleAssociation {
  exerciseId: string;
  claimLevel: "expected_participation";
  contextRequirement: "exact_exercise_identity";
  evidenceStatus: "exact_exercise_reference" | "curated_general_reference";
  muscles: readonly ExpectedMuscleRole[];
  phases: readonly TrajectoryMusclePhase[];
  sourceIds: readonly string[];
  disclaimerZh: string;
}

export interface ExpectedMusclePresentation {
  titleZh: "预计参与肌群";
  evidenceStatus: ExpectedMuscleAssociation["evidenceStatus"];
  primaryZh: readonly string[];
  secondaryZh: readonly string[];
  stabilizerZh: readonly string[];
  disclaimerZh: string;
  sourceUrls: readonly string[];
}

export const EXPECTED_MUSCLE_ASSOCIATION_SCHEMA =
  "form-coach-expected-muscle-associations/v1" as const;

export const MUSCLE_CATALOG: readonly MuscleDefinition[] = [
  { id: "quadriceps", labelZh: "股四头肌群", labelEn: "Quadriceps" },
  { id: "gluteals", labelZh: "臀肌群", labelEn: "Gluteals" },
  { id: "hamstrings", labelZh: "腘绳肌群", labelEn: "Hamstrings" },
  { id: "calves", labelZh: "小腿后侧肌群", labelEn: "Calves" },
  { id: "hip_flexors", labelZh: "髋屈肌群", labelEn: "Hip flexors" },
  { id: "hip_abductors", labelZh: "髋外展肌群", labelEn: "Hip abductors" },
  { id: "hip_adductors", labelZh: "髋内收肌群", labelEn: "Hip adductors" },
  { id: "pectorals", labelZh: "胸肌群", labelEn: "Pectorals" },
  { id: "triceps", labelZh: "肱三头肌", labelEn: "Triceps" },
  { id: "anterior_deltoids", labelZh: "三角肌前束", labelEn: "Anterior deltoids" },
  { id: "medial_deltoids", labelZh: "三角肌中束", labelEn: "Medial deltoids" },
  { id: "serratus_anterior", labelZh: "前锯肌", labelEn: "Serratus anterior" },
  { id: "trunk_stabilizers", labelZh: "躯干稳定肌群", labelEn: "Trunk stabilizers" },
] as const;

export const MUSCLE_ASSOCIATION_SOURCES: readonly AssociationSource[] = [
  {
    id: "nike-calisthenics-2026",
    title: "Nike: What Is a Calisthenics Workout?",
    url: "https://www.nike.com/a/what-is-calisthenics-workout",
    evidenceKind: "exercise_reference",
    exactExerciseId: null,
  },
  {
    id: "nike-home-no-equipment",
    title: "Nike: No-Equipment Workouts",
    url: "https://www.nike.com/a/exercise-with-no-equipment",
    evidenceKind: "exercise_reference",
    exactExerciseId: null,
  },
  {
    id: "ace-exercise-library",
    title: "ACE Exercise Library",
    url: "https://www.acefitness.org/resources/everyone/exercise-library/",
    evidenceKind: "exercise_reference",
    exactExerciseId: null,
  },
  {
    id: "ace-bodyweight-squat",
    title: "ACE: Bodyweight Squat",
    url: "https://www.acefitness.org/resources/everyone/exercise-library/135/bodyweight-squat/",
    evidenceKind: "exercise_reference",
    exactExerciseId: "bodyweight_squat",
  },
  {
    id: "opensim-inverse-dynamics",
    title: "OpenSim: Getting Started with Inverse Dynamics",
    url: "https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting+Started+with+Inverse+Dynamics",
    evidenceKind: "modeling_boundary",
    exactExerciseId: null,
  },
  {
    id: "opencap-2023",
    title: "OpenCap: Human movement dynamics from smartphone videos",
    url: "https://doi.org/10.1371/journal.pcbi.1011462",
    evidenceKind: "modeling_boundary",
    exactExerciseId: null,
  },
] as const;

const DEFAULT_DISCLAIMER =
  "预计参与肌群来自动作知识库；摄像头只能观察关节轨迹，不能直接测量肌肉激活、肌肉力或训练效果。";

const role = (muscleId: MuscleId, muscleRole: MuscleRole): ExpectedMuscleRole => ({
  muscleId,
  role: muscleRole,
});

const motion = (
  joint: ObservableJoint,
  action: JointAction,
  noteZh: string,
): ExpectedJointMotion => ({ joint, action, noteZh });

const phase = (
  id: string,
  labelZh: string,
  expectedJointMotions: readonly ExpectedJointMotion[],
  expectedMechanicalContributors: readonly MuscleId[],
  interpretationZh: string,
): TrajectoryMusclePhase => ({
  id,
  labelZh,
  expectedJointMotions,
  expectedMechanicalContributors,
  interpretationZh,
});

const association = (
  exerciseId: string,
  muscles: readonly ExpectedMuscleRole[],
  phases: readonly TrajectoryMusclePhase[],
  sourceIds: readonly string[],
  evidenceStatus: ExpectedMuscleAssociation["evidenceStatus"] = "curated_general_reference",
): ExpectedMuscleAssociation => ({
  exerciseId,
  claimLevel: "expected_participation",
  contextRequirement: "exact_exercise_identity",
  evidenceStatus,
  muscles,
  phases,
  sourceIds,
  disclaimerZh: DEFAULT_DISCLAIMER,
});

const SEED_ASSOCIATIONS: readonly ExpectedMuscleAssociation[] = [
  association(
    "march_in_place",
    [
      role("hip_flexors", "primary"), role("quadriceps", "primary"),
      role("calves", "secondary"), role("gluteals", "secondary"),
      role("hip_abductors", "stabilizer"), role("trunk_stabilizers", "stabilizer"),
    ],
    [
      phase("leg_lift", "抬腿", [motion("hip", "flexion", "抬起侧髋部投影趋向屈曲。"), motion("knee", "flexion", "抬起侧膝部投影趋向屈曲。")], ["hip_flexors", "quadriceps"], "这是抬腿阶段的知识库机械关联，不是当前用户的肌肉激活测量。"),
      phase("support_switch", "落脚换侧", [motion("hip", "extension", "抬起侧髋部回到站立构型。"), motion("ankle", "plantarflexion", "落脚与支撑转换可伴随踝部推进。")], ["gluteals", "calves", "hip_abductors"], "支撑转换需要下肢与躯干稳定，但摄像头不能分配各肌肉的实际贡献。"),
    ],
    ["nike-calisthenics-2026"],
  ),
  association(
    "side_step_touch",
    [
      role("hip_abductors", "primary"), role("gluteals", "primary"),
      role("quadriceps", "secondary"), role("calves", "secondary"),
      role("hip_adductors", "secondary"), role("trunk_stabilizers", "stabilizer"),
    ],
    [
      phase("step_out", "侧向迈步", [motion("hip", "abduction", "迈步腿相对骨盆向侧方移动。"), motion("trunk", "lateral_translation", "骨盆和躯干随支撑侧发生横向位移。")], ["hip_abductors", "gluteals"], "侧向位移可与髋外展机械参与相关，但不是臀肌激活读数。"),
      phase("touch_in", "并步回收", [motion("hip", "adduction", "回收腿向身体中线并拢。")], ["hip_adductors", "gluteals"], "回收阶段只描述预计机械参与。"),
    ],
    ["nike-calisthenics-2026"],
  ),
  association(
    "alternating_knee_raise",
    [
      role("hip_flexors", "primary"), role("quadriceps", "secondary"),
      role("gluteals", "stabilizer"), role("hip_abductors", "stabilizer"),
      role("trunk_stabilizers", "stabilizer"),
    ],
    [
      phase("knee_lift", "提膝", [motion("hip", "flexion", "提膝侧髋部投影趋向屈曲。"), motion("knee", "flexion", "提膝侧膝部投影趋向屈曲。")], ["hip_flexors", "quadriceps"], "轨迹支持提膝相位，不支持髋屈肌激活百分比。"),
      phase("return", "回到站立", [motion("hip", "extension", "提膝侧髋部回到站立构型。")], ["gluteals", "hip_abductors"], "回落和单腿支撑的肌群关联属于动作知识。"),
    ],
    ["nike-home-no-equipment"],
  ),
  association(
    "step_jack",
    [
      role("hip_abductors", "primary"), role("medial_deltoids", "primary"),
      role("gluteals", "secondary"), role("calves", "secondary"),
      role("hip_adductors", "secondary"),
      role("trunk_stabilizers", "stabilizer"),
    ],
    [
      phase("open", "开步举臂", [motion("hip", "abduction", "侧点腿相对骨盆向侧方移动。"), motion("shoulder", "abduction", "双臂相对躯干向侧上方展开。")], ["hip_abductors", "medial_deltoids"], "开步和举臂的同步轨迹只支持预计参与关系。"),
      phase("close", "并步落臂", [motion("hip", "adduction", "侧点腿回到中线。"), motion("shoulder", "adduction", "双臂回到躯干两侧。")], ["hip_adductors", "medial_deltoids"], "回收阶段不能用来断言肌肉是否充分发力。"),
    ],
    ["nike-calisthenics-2026"],
  ),
  association(
    "bodyweight_squat",
    [
      role("quadriceps", "primary"), role("gluteals", "primary"),
      role("hamstrings", "secondary"), role("calves", "secondary"),
      role("trunk_stabilizers", "stabilizer"),
    ],
    [
      phase("lowering", "下蹲", [motion("hip", "flexion", "髋部投影趋向屈曲。"), motion("knee", "flexion", "膝部投影趋向屈曲。")], ["quadriceps", "gluteals", "hamstrings"], "在重力与足部支撑条件成立时，这些肌群通常参与控制下降；激活程度不可由轨迹确定。"),
      phase("rising", "起立", [motion("hip", "extension", "髋部投影趋向伸展。"), motion("knee", "extension", "膝部投影趋向伸展。")], ["quadriceps", "gluteals"], "髋膝伸展与相应肌群的预计机械贡献相关，不等于实测发力。"),
    ],
    ["ace-bodyweight-squat"],
    "exact_exercise_reference",
  ),
  association(
    "push_up",
    [
      role("pectorals", "primary"), role("triceps", "primary"),
      role("anterior_deltoids", "secondary"), role("serratus_anterior", "stabilizer"),
      role("trunk_stabilizers", "stabilizer"),
    ],
    [
      phase("lowering", "下降", [motion("elbow", "flexion", "肘部投影趋向屈曲。"), motion("shoulder", "horizontal_abduction", "上臂相对躯干展开。")], ["pectorals", "triceps", "anterior_deltoids"], "下降阶段的预计控制肌群来自动作知识，肩胛和肌电不可由普通骨架观察。"),
      phase("pressing", "推起", [motion("elbow", "extension", "肘部投影趋向伸展。"), motion("shoulder", "horizontal_adduction", "上臂相对躯干回到支撑构型。")], ["pectorals", "triceps", "anterior_deltoids"], "推起轨迹支持水平推与肘伸语义，不支持胸肌或三头肌激活比例。"),
    ],
    ["nike-calisthenics-2026", "ace-exercise-library"],
  ),
  association(
    "walking_lunge",
    [
      role("quadriceps", "primary"), role("gluteals", "primary"),
      role("hamstrings", "secondary"), role("calves", "secondary"),
      role("hip_abductors", "stabilizer"), role("trunk_stabilizers", "stabilizer"),
    ],
    [
      phase("lowering", "前腿下降", [motion("hip", "flexion", "前腿髋部投影趋向屈曲。"), motion("knee", "flexion", "前腿膝部投影趋向屈曲。")], ["quadriceps", "gluteals", "hamstrings"], "左右腿必须分开解释，不能把步次平均成肌肉激活。"),
      phase("rising", "前腿起身", [motion("hip", "extension", "前腿髋部投影趋向伸展。"), motion("knee", "extension", "前腿膝部投影趋向伸展。")], ["quadriceps", "gluteals"], "起身阶段只给预计参与肌群。"),
    ],
    ["nike-home-no-equipment", "ace-exercise-library"],
  ),
  association(
    "calf_raise",
    [role("calves", "primary"), role("quadriceps", "stabilizer"), role("gluteals", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    [
      phase("rising", "提踵", [motion("ankle", "plantarflexion", "脚跟相对前足上升。")], ["calves"], "脚跟上升是可见轨迹，肌肉激活与负荷仍不可见。"),
      phase("lowering", "落踵", [motion("ankle", "dorsiflexion", "脚跟回落到起点。")], ["calves"], "回落阶段为预计机械控制关系。"),
    ],
    ["ace-exercise-library"],
  ),
  association(
    "hip_thrust",
    [role("gluteals", "primary"), role("hamstrings", "secondary"), role("quadriceps", "secondary"), role("trunk_stabilizers", "stabilizer")],
    [
      phase("rising", "伸髋抬起", [motion("hip", "extension", "骨盆相对足部上升，髋部投影趋向伸展。")], ["gluteals", "hamstrings"], "髋伸轨迹只支持预计机械贡献。"),
      phase("lowering", "屈髋下放", [motion("hip", "flexion", "骨盆下放，髋部投影趋向屈曲。")], ["gluteals", "hamstrings"], "下放不能用于判断臀肌是否保持张力。"),
    ],
    ["ace-exercise-library"],
  ),
];

const MUSCLE_IDS = new Set<MuscleId>(MUSCLE_CATALOG.map((muscle) => muscle.id));
const SOURCE_BY_ID = new Map(MUSCLE_ASSOCIATION_SOURCES.map((source) => [source.id, source]));

export class ExpectedMuscleAssociationDatabase {
  readonly schemaVersion = EXPECTED_MUSCLE_ASSOCIATION_SCHEMA;
  private readonly byExerciseId: ReadonlyMap<string, ExpectedMuscleAssociation>;

  constructor(readonly records: readonly ExpectedMuscleAssociation[]) {
    this.byExerciseId = new Map(records.map((record) => [record.exerciseId, record]));
  }

  get(exerciseId: string): ExpectedMuscleAssociation | undefined {
    return this.byExerciseId.get(exerciseId);
  }
}

export function loadExpectedMuscleAssociationDatabase(
  records: readonly ExpectedMuscleAssociation[],
  exerciseRegistry: ExerciseRegistry = EXERCISE_REGISTRY,
): ExpectedMuscleAssociationDatabase {
  const seen = new Set<string>();

  for (const record of records) {
    if ("activationPercent" in record) {
      throw new Error(`${record.exerciseId}: activationPercent is forbidden`);
    }
    if (seen.has(record.exerciseId)) {
      throw new Error(`Duplicate muscle association for ${record.exerciseId}`);
    }
    seen.add(record.exerciseId);

    if (!exerciseRegistry.get(record.exerciseId)) {
      throw new Error(`${record.exerciseId}: unknown exercise`);
    }
    if (record.claimLevel !== "expected_participation") {
      throw new Error(`${record.exerciseId}: invalid claim level`);
    }
    if (record.contextRequirement !== "exact_exercise_identity") {
      throw new Error(`${record.exerciseId}: must require exact exercise identity`);
    }
    if (
      record.evidenceStatus !== "exact_exercise_reference" &&
      record.evidenceStatus !== "curated_general_reference"
    ) {
      throw new Error(`${record.exerciseId}: invalid evidence status`);
    }
    if (!record.muscles.some((muscle) => muscle.role === "primary")) {
      throw new Error(`${record.exerciseId}: expected at least one primary muscle`);
    }
    const declaredMuscles = new Set<MuscleId>();
    for (const muscle of record.muscles) {
      if (!MUSCLE_IDS.has(muscle.muscleId)) {
        throw new Error(`${record.exerciseId}: unknown muscle ${muscle.muscleId}`);
      }
      if (declaredMuscles.has(muscle.muscleId)) {
        throw new Error(`${record.exerciseId}: duplicate muscle ${muscle.muscleId}`);
      }
      declaredMuscles.add(muscle.muscleId);
    }
    if (record.phases.length === 0) {
      throw new Error(`${record.exerciseId}: expected at least one phase`);
    }
    const phaseIds = new Set<string>();
    for (const item of record.phases) {
      if (phaseIds.has(item.id)) {
        throw new Error(`${record.exerciseId}: duplicate phase ${item.id}`);
      }
      phaseIds.add(item.id);
      if (item.expectedJointMotions.length === 0) {
        throw new Error(`${record.exerciseId}/${item.id}: expected at least one joint motion`);
      }
      for (const muscleId of item.expectedMechanicalContributors) {
        if (!MUSCLE_IDS.has(muscleId)) {
          throw new Error(`${record.exerciseId}/${item.id}: unknown muscle ${muscleId}`);
        }
        if (!declaredMuscles.has(muscleId)) {
          throw new Error(
            `${record.exerciseId}/${item.id}: phase references undeclared muscle ${muscleId}`,
          );
        }
      }
    }
    if (record.sourceIds.length === 0) {
      throw new Error(`${record.exerciseId}: expected at least one source`);
    }
    for (const sourceId of record.sourceIds) {
      if (!SOURCE_BY_ID.has(sourceId)) {
        throw new Error(`${record.exerciseId}: unknown source ${sourceId}`);
      }
    }
    if (
      record.evidenceStatus === "exact_exercise_reference" &&
      !record.sourceIds.some(
        (sourceId) => SOURCE_BY_ID.get(sourceId)?.exactExerciseId === record.exerciseId,
      )
    ) {
      throw new Error(`${record.exerciseId}: exact evidence must match the exercise identity`);
    }
    if (!record.disclaimerZh.includes("不能直接测量肌肉激活")) {
      throw new Error(`${record.exerciseId}: missing activation boundary`);
    }
  }

  return new ExpectedMuscleAssociationDatabase(records);
}

export const EXPECTED_MUSCLE_ASSOCIATIONS = loadExpectedMuscleAssociationDatabase(
  SEED_ASSOCIATIONS,
);

const MUSCLE_BY_ID = new Map(MUSCLE_CATALOG.map((muscle) => [muscle.id, muscle]));

export function presentExpectedMuscleAssociation(
  exerciseId: string,
): ExpectedMusclePresentation | undefined {
  const record = EXPECTED_MUSCLE_ASSOCIATIONS.get(exerciseId);
  if (!record) return undefined;

  const labelsFor = (targetRole: MuscleRole): string[] =>
    record.muscles
      .filter((muscle) => muscle.role === targetRole)
      .map((muscle) => MUSCLE_BY_ID.get(muscle.muscleId)?.labelZh)
      .filter((label): label is string => Boolean(label));

  return {
    titleZh: "预计参与肌群",
    evidenceStatus: record.evidenceStatus,
    primaryZh: labelsFor("primary"),
    secondaryZh: labelsFor("secondary"),
    stabilizerZh: labelsFor("stabilizer"),
    disclaimerZh: record.disclaimerZh,
    sourceUrls: record.sourceIds
      .map((sourceId) => SOURCE_BY_ID.get(sourceId)?.url)
      .filter((url): url is string => Boolean(url)),
  };
}
