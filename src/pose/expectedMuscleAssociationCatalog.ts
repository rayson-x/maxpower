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
  | "posterior_deltoids"
  | "latissimus_dorsi"
  | "elbow_flexors"
  | "scapular_retractors"
  | "lower_trapezius"
  | "rotator_cuff"
  | "spinal_erectors"
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
  | "external_rotation"
  | "internal_rotation"
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
  { id: "posterior_deltoids", labelZh: "三角肌后束", labelEn: "Posterior deltoids" },
  { id: "latissimus_dorsi", labelZh: "背阔肌", labelEn: "Latissimus dorsi" },
  { id: "elbow_flexors", labelZh: "屈肘肌群", labelEn: "Elbow flexors" },
  { id: "scapular_retractors", labelZh: "肩胛后缩肌群", labelEn: "Scapular retractors" },
  { id: "lower_trapezius", labelZh: "下斜方肌", labelEn: "Lower trapezius" },
  { id: "rotator_cuff", labelZh: "肩袖肌群", labelEn: "Rotator cuff" },
  { id: "spinal_erectors", labelZh: "竖脊肌群", labelEn: "Spinal erectors" },
  { id: "serratus_anterior", labelZh: "前锯肌", labelEn: "Serratus anterior" },
  { id: "trunk_stabilizers", labelZh: "躯干稳定肌群", labelEn: "Trunk stabilizers" },
] as const;

const exactExerciseSource = (
  id: string,
  title: string,
  url: string,
  exactExerciseId: string,
): AssociationSource => ({
  id,
  title,
  url,
  evidenceKind: "exercise_reference",
  exactExerciseId,
});

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
    id: "acsm-free-weights",
    title: "ACSM: Selecting and Effectively Using Free Weights",
    url: "https://www.acsm.org/docs/default-source/files-for-resource-library/selecting-and-effectively-using-free-weights.pdf",
    evidenceKind: "exercise_reference",
    exactExerciseId: null,
  },
  exactExerciseSource("ace-barbell-bench-press", "ACE: Barbell Chest Press", "https://www.acefitness.org/resources/everyone/exercise-library/5/chest-press/", "barbell_bench_press"),
  exactExerciseSource("ace-dumbbell-bench-press", "ACE: Dumbbell Chest Press", "https://www.acefitness.org/resources/everyone/exercise-library/19/chest-press/", "dumbbell_bench_press"),
  exactExerciseSource("ace-incline-dumbbell-press", "ACE: Incline Chest Press", "https://www.acefitness.org/resources/everyone/exercise-library/25/incline-chest-press/", "incline_dumbbell_press"),
  exactExerciseSource("ace-machine-chest-press", "ACE: Seated Chest Press", "https://www.acefitness.org/resources/everyone/exercise-library/188/seated-chest-press/", "machine_chest_press"),
  exactExerciseSource("ace-push-up", "ACE: Push-up", "https://www.acefitness.org/resources/everyone/exercise-library/41/push-up/", "push_up"),
  exactExerciseSource("ace-barbell-row", "ACE: Bent-over Row", "https://www.acefitness.org/resources/everyone/exercise-library/12/bent-over-row/", "barbell_row"),
  exactExerciseSource("exrx-wide-grip-lat-pulldown", "ExRx: Cable Pulldown", "https://exrx.net/WeightExercises/LatissimusDorsi/CBFrontPulldown", "wide_grip_lat_pulldown"),
  exactExerciseSource("exrx-assisted-pull-up", "ExRx: Machine-assisted Pull-up", "https://exrx.net/WeightExercises/LatissimusDorsi/AsPullupOpen", "assisted_pull_up"),
  exactExerciseSource("ace-barbell-back-squat", "ACE: Back Squat", "https://www.acefitness.org/resources/everyone/exercise-library/11/back-squat/", "barbell_back_squat"),
  exactExerciseSource("ace-leg-press", "ACE: Seated Leg Press", "https://www.acefitness.org/resources/everyone/exercise-library/154/seated-leg-press/", "leg_press"),
  exactExerciseSource("ace-romanian-deadlift", "ACE: Romanian Deadlift", "https://www.acefitness.org/resources/everyone/exercise-library/317/romanian-deadlift/", "romanian_deadlift"),
  exactExerciseSource("ace-conventional-deadlift", "ACE: Deadlift", "https://www.acefitness.org/resources/everyone/exercise-library/6/deadlift/", "conventional_deadlift"),
  exactExerciseSource("ace-bulgarian-split-squat", "ACE: Bulgarian Split Squat", "https://www.acefitness.org/resources/everyone/exercise-library/366/bulgarian-split-squat/", "bulgarian_split_squat"),
  exactExerciseSource("ace-leg-extension", "ACE: Seated Leg Extension", "https://www.acefitness.org/resources/everyone/exercise-library/183/seated-leg-extension/", "leg_extension"),
  exactExerciseSource("exrx-hip-thrust", "ExRx: Barbell Hip Thrust", "https://exrx.net/WeightExercises/GluteusMaximus/BBHipThrust", "hip_thrust"),
  exactExerciseSource("nasm-face-pull", "NASM: Face Pull", "https://www.nasm.org/resource-center/exercise-library/face-pull", "face_pull"),
  exactExerciseSource("exrx-single-arm-cable-lateral-raise", "ExRx: Cable One-arm Lateral Raise", "https://exrx.net/WeightExercises/DeltoidLateral/CBOneArmLateralRaise", "single_arm_cable_lateral_raise"),
  exactExerciseSource("ace-barbell-biceps-curl", "ACE: Barbell Bicep Curl", "https://www.acefitness.org/resources/everyone/exercise-library/70/bicep-curl/", "barbell_biceps_curl"),
  exactExerciseSource("ace-hammer-curl", "ACE: Hammer Curl", "https://www.acefitness.org/resources/everyone/exercise-library/10/hammer-curl/", "hammer_curl"),
  exactExerciseSource("exrx-cable-biceps-curl", "ExRx: Cable Curl", "https://exrx.net/WeightExercises/Biceps/CBCurl", "cable_biceps_curl"),
  exactExerciseSource("exrx-triceps-pushdown", "ExRx: Cable Pushdown", "https://exrx.net/WeightExercises/Triceps/CBPushdown", "triceps_pushdown"),
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

const HORIZONTAL_PRESS_PHASES = [
  phase(
    "lowering",
    "下放",
    [
      motion("elbow", "flexion", "肘部投影趋向屈曲。"),
      motion("shoulder", "horizontal_abduction", "上臂相对躯干向外展开。"),
    ],
    ["pectorals", "triceps", "anterior_deltoids"],
    "水平推类动作的下放相位只提供预计机械关联，不能显示胸、肩、三头的实际分担。",
  ),
  phase(
    "pressing",
    "推起",
    [
      motion("elbow", "extension", "肘部投影趋向伸展。"),
      motion("shoulder", "horizontal_adduction", "上臂向躯干前方合拢。"),
    ],
    ["pectorals", "triceps", "anterior_deltoids"],
    "推起轨迹支持水平推语义，不支持肌肉激活比例。",
  ),
] as const;

const CHEST_FLY_PHASES = [
  phase(
    "opening",
    "打开",
    [motion("shoulder", "horizontal_abduction", "双臂相对胸廓向外打开。")],
    ["pectorals", "anterior_deltoids"],
    "打开阶段为胸部飞鸟动作的预计离心控制关系。",
  ),
  phase(
    "closing",
    "合拢",
    [motion("shoulder", "horizontal_adduction", "双臂向身体前方合拢。")],
    ["pectorals", "anterior_deltoids"],
    "合拢轨迹不能证明胸肌收缩质量。",
  ),
] as const;

const ROW_PHASES = [
  phase(
    "pulling",
    "拉向躯干",
    [
      motion("shoulder", "extension", "上臂相对躯干向后移动。"),
      motion("elbow", "flexion", "肘部投影趋向屈曲。"),
    ],
    ["latissimus_dorsi", "scapular_retractors", "posterior_deltoids", "elbow_flexors"],
    "划船轨迹不直接观察肩胛运动，也不能分配背部与手臂的真实发力。",
  ),
  phase(
    "returning",
    "伸臂回程",
    [
      motion("shoulder", "flexion", "上臂回到起始方向。"),
      motion("elbow", "extension", "肘部投影趋向伸展。"),
    ],
    ["latissimus_dorsi", "scapular_retractors", "posterior_deltoids", "elbow_flexors"],
    "回程只描述预计机械参与。",
  ),
] as const;

const VERTICAL_PULL_PHASES = [
  phase(
    "pulling",
    "向下拉",
    [
      motion("shoulder", "adduction", "上臂从高位向躯干方向移动。"),
      motion("elbow", "flexion", "肘部投影趋向屈曲。"),
    ],
    ["latissimus_dorsi", "scapular_retractors", "elbow_flexors"],
    "垂直拉轨迹不能证明背阔肌相对屈肘肌群的实际贡献。",
  ),
  phase(
    "returning",
    "回到高位",
    [
      motion("shoulder", "abduction", "上臂回到高位。"),
      motion("elbow", "extension", "肘部投影趋向伸展。"),
    ],
    ["latissimus_dorsi", "scapular_retractors", "elbow_flexors"],
    "回程为预计机械关联。",
  ),
] as const;

const STRAIGHT_ARM_PULL_PHASES = [
  phase(
    "pulling",
    "直臂下拉",
    [motion("shoulder", "extension", "手臂从高位向躯干两侧移动。")],
    ["latissimus_dorsi", "triceps"],
    "肩伸轨迹与背阔肌等肌群的预计参与相关，绳索张力不可由骨架测量。",
  ),
  phase(
    "returning",
    "回到高位",
    [motion("shoulder", "flexion", "手臂回到头顶方向。")],
    ["latissimus_dorsi", "triceps"],
    "回程只描述预计机械控制。",
  ),
] as const;

const SQUAT_PHASES = [
  phase(
    "lowering",
    "下降",
    [
      motion("hip", "flexion", "髋部投影趋向屈曲。"),
      motion("knee", "flexion", "膝部投影趋向屈曲。"),
    ],
    ["quadriceps", "gluteals", "hamstrings"],
    "深蹲类下降相位为预计机械关联，不等于实测离心激活。",
  ),
  phase(
    "rising",
    "起身",
    [
      motion("hip", "extension", "髋部投影趋向伸展。"),
      motion("knee", "extension", "膝部投影趋向伸展。"),
    ],
    ["quadriceps", "gluteals", "hamstrings"],
    "髋膝伸展不显示各肌群实际输出比例。",
  ),
] as const;

const HIP_HINGE_PHASES = [
  phase(
    "lowering",
    "髋铰链下降",
    [motion("hip", "flexion", "骨盆相对大腿趋向屈曲，躯干随之俯身。")],
    ["gluteals", "hamstrings", "spinal_erectors"],
    "髋铰链轨迹不等于后侧链肌肉激活测量。",
  ),
  phase(
    "rising",
    "伸髋站起",
    [motion("hip", "extension", "髋部投影趋向伸展，躯干回到直立。")],
    ["gluteals", "hamstrings", "spinal_erectors"],
    "伸髋相位只给出预计机械贡献。",
  ),
] as const;

const DEADLIFT_PHASES = [
  phase(
    "lifting",
    "离地站起",
    [
      motion("hip", "extension", "髋部投影趋向伸展。"),
      motion("knee", "extension", "膝部投影趋向伸展。"),
    ],
    ["quadriceps", "gluteals", "hamstrings", "spinal_erectors"],
    "传统硬拉的髋膝共同伸展必须与罗马尼亚硬拉分开解释。",
  ),
  phase(
    "lowering",
    "下放",
    [
      motion("hip", "flexion", "髋部投影趋向屈曲。"),
      motion("knee", "flexion", "膝部投影趋向屈曲。"),
    ],
    ["quadriceps", "gluteals", "hamstrings", "spinal_erectors"],
    "下放轨迹不能判断腰背负荷或握力。",
  ),
] as const;

const KNEE_EXTENSION_PHASES = [
  phase("extending", "伸膝", [motion("knee", "extension", "小腿相对大腿趋向伸直。")], ["quadriceps"], "伸膝轨迹不等于股四头肌激活百分比。"),
  phase("returning", "屈膝回程", [motion("knee", "flexion", "小腿回到起始角度。")], ["quadriceps"], "回程为预计离心控制关系。"),
] as const;

const KNEE_FLEXION_PHASES = [
  phase("curling", "屈膝", [motion("knee", "flexion", "足跟向大腿后侧靠近。")], ["hamstrings", "calves"], "屈膝轨迹不能区分腘绳肌各肌束的分担。"),
  phase("returning", "伸膝回程", [motion("knee", "extension", "小腿回到起始方向。")], ["hamstrings", "calves"], "回程为预计离心控制关系。"),
] as const;

const VERTICAL_PRESS_PHASES = [
  phase("pressing", "向上推举", [motion("shoulder", "abduction", "上臂相对躯干抬高。"), motion("elbow", "extension", "肘部投影趋向伸展。")], ["anterior_deltoids", "medial_deltoids", "triceps"], "推举轨迹不显示肩袖或三角肌的真实激活。"),
  phase("lowering", "下放", [motion("shoulder", "adduction", "上臂回到肩侧。"), motion("elbow", "flexion", "肘部投影趋向屈曲。")], ["anterior_deltoids", "medial_deltoids", "triceps"], "下放阶段为知识库关联。"),
] as const;

const LATERAL_RAISE_PHASES = [
  phase("raising", "侧向抬臂", [motion("shoulder", "abduction", "手腕和肘部相对躯干向侧方升高。")], ["medial_deltoids", "anterior_deltoids", "posterior_deltoids"], "肩外展轨迹不等于三角肌激活读数。"),
  phase("lowering", "落臂", [motion("shoulder", "adduction", "上臂回到躯干两侧。")], ["medial_deltoids", "anterior_deltoids", "posterior_deltoids"], "落臂速度可观察，离心发力质量不可直接确认。"),
] as const;

const SINGLE_ARM_CABLE_LATERAL_RAISE_PHASES = [
  phase("raising", "单臂侧向抬起", [motion("shoulder", "abduction", "工作侧手腕和肘部相对躯干向侧方升高。")], ["medial_deltoids", "anterior_deltoids", "lower_trapezius", "serratus_anterior", "rotator_cuff"], "绳索负载和肩胛上旋肌群的实际分担不可由普通骨架测量。"),
  phase("lowering", "单臂落下", [motion("shoulder", "adduction", "工作侧上臂回到躯干旁。")], ["medial_deltoids", "anterior_deltoids", "lower_trapezius", "serratus_anterior", "rotator_cuff"], "回程为预计机械关联。"),
] as const;

const REAR_DELT_PHASES = [
  phase("opening", "向后打开", [motion("shoulder", "horizontal_abduction", "上臂相对躯干向后外侧移动。")], ["posterior_deltoids", "scapular_retractors"], "普通骨架不能直接观察肩胛后缩或后束激活。"),
  phase("returning", "回到起点", [motion("shoulder", "horizontal_adduction", "上臂回到起始方向。")], ["posterior_deltoids", "scapular_retractors"], "回程为预计机械关联。"),
] as const;

const REAR_DELT_ROW_PHASES = [
  phase(
    "pulling",
    "高肘拉入",
    [
      motion("shoulder", "horizontal_abduction", "高位上臂相对躯干向后外侧移动。"),
      motion("elbow", "flexion", "肘部投影趋向屈曲。"),
    ],
    ["posterior_deltoids", "scapular_retractors", "elbow_flexors"],
    "高肘后束划船以肩水平外展区别于普通肘贴身划船；肩胛后缩仍不可由普通骨架直接测量。",
  ),
  phase(
    "returning",
    "伸臂回程",
    [
      motion("shoulder", "horizontal_adduction", "上臂回到起始方向。"),
      motion("elbow", "extension", "肘部投影趋向伸展。"),
    ],
    ["posterior_deltoids", "scapular_retractors", "elbow_flexors"],
    "回程为预计机械关联。",
  ),
] as const;

const FACE_PULL_PHASES = [
  phase("pulling", "拉向面部", [motion("shoulder", "horizontal_abduction", "上臂向后外侧移动。"), motion("shoulder", "external_rotation", "肩部预计外旋，但普通二维骨架只提供弱代理。"), motion("elbow", "flexion", "肘部投影趋向屈曲。")], ["posterior_deltoids", "scapular_retractors", "elbow_flexors", "rotator_cuff"], "面拉包含骨架难以直接观察的肩外旋与肩胛运动。"),
  phase("returning", "伸臂回程", [motion("elbow", "extension", "肘部投影趋向伸展。")], ["posterior_deltoids", "scapular_retractors", "elbow_flexors", "rotator_cuff"], "回程只描述预计机械参与。"),
] as const;

const FRONT_RAISE_PHASES = [
  phase("raising", "前向抬臂", [motion("shoulder", "flexion", "手腕相对肩部向前上方移动。")], ["anterior_deltoids", "pectorals"], "肩屈轨迹不等于三角肌前束激活读数。"),
  phase("lowering", "落臂", [motion("shoulder", "extension", "手腕回到身体前侧起点。")], ["anterior_deltoids", "pectorals"], "落臂阶段为预计机械关联。"),
] as const;

const LANDMINE_PRESS_PHASES = [
  phase("pressing", "斜向推举", [motion("shoulder", "flexion", "上臂沿斜上方向抬起。"), motion("elbow", "extension", "肘部投影趋向伸展。")], ["anterior_deltoids", "pectorals", "triceps", "serratus_anterior"], "地雷管路径和负载不可由普通骨架完整测量。"),
  phase("lowering", "下放", [motion("shoulder", "extension", "上臂回到肩前。"), motion("elbow", "flexion", "肘部投影趋向屈曲。")], ["anterior_deltoids", "pectorals", "triceps", "serratus_anterior"], "下放为预计机械关联。"),
] as const;

const Y_RAISE_PHASES = [
  phase("raising", "Y 形抬臂", [motion("shoulder", "abduction", "双臂沿斜上方展开成 Y 形。")], ["medial_deltoids", "posterior_deltoids", "lower_trapezius", "serratus_anterior", "rotator_cuff"], "肩胛上旋与下斜方肌、前锯肌的实际分担不由普通骨架直接测量。"),
  phase("lowering", "落臂", [motion("shoulder", "adduction", "双臂回到起始方向。")], ["medial_deltoids", "posterior_deltoids", "lower_trapezius", "serratus_anterior", "rotator_cuff"], "回程为预计机械关联。"),
] as const;

const EXTERNAL_ROTATION_PHASES = [
  phase("rotating_out", "向外旋", [motion("shoulder", "external_rotation", "肩部预计外旋；普通二维骨架通常只能看到前臂向外移动这一弱代理。")], ["rotator_cuff", "posterior_deltoids"], "二维骨架不能直接测量盂肱外旋角或肩袖激活。"),
  phase("returning", "回到起点", [motion("shoulder", "internal_rotation", "肩部预计内旋回到起点；二维画面通常只能弱观察。")], ["rotator_cuff", "posterior_deltoids"], "回程为预计机械关联。"),
] as const;

const CURL_PHASES = [
  phase("curling", "屈肘举起", [motion("elbow", "flexion", "手腕靠近肩部，肘部投影趋向屈曲。")], ["elbow_flexors"], "骨架不能区分肱二头肌、肱肌和肱桡肌的实际分担。"),
  phase("lowering", "伸肘下放", [motion("elbow", "extension", "手腕远离肩部，肘部投影趋向伸展。")], ["elbow_flexors"], "下放轨迹不等于实测离心激活。"),
] as const;

const TRICEPS_EXTENSION_PHASES = [
  phase("extending", "伸肘", [motion("elbow", "extension", "前臂远离上臂，肘部投影趋向伸展。")], ["triceps"], "伸肘轨迹不等于肱三头肌激活读数。"),
  phase("returning", "屈肘回程", [motion("elbow", "flexion", "前臂回到起始方向。")], ["triceps"], "回程为预计机械控制关系。"),
] as const;

const gymAssociation = (
  exerciseId: string,
  muscles: readonly ExpectedMuscleRole[],
  phases: readonly TrajectoryMusclePhase[],
  exactSourceId?: string,
): ExpectedMuscleAssociation =>
  association(
    exerciseId,
    muscles,
    phases,
    exactSourceId ? [exactSourceId] : ["ace-exercise-library", "acsm-free-weights"],
    exactSourceId ? "exact_exercise_reference" : "curated_general_reference",
  );

export const SEED_ASSOCIATIONS: readonly ExpectedMuscleAssociation[] = [
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
    ["ace-push-up"],
    "exact_exercise_reference",
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
    [role("gluteals", "primary"), role("quadriceps", "secondary"), role("hamstrings", "stabilizer"), role("spinal_erectors", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    [
      phase("rising", "伸髋抬起", [motion("hip", "extension", "骨盆相对足部上升，髋部投影趋向伸展。")], ["gluteals", "hamstrings"], "髋伸轨迹只支持预计机械贡献。"),
      phase("lowering", "屈髋下放", [motion("hip", "flexion", "骨盆下放，髋部投影趋向屈曲。")], ["gluteals", "hamstrings"], "下放不能用于判断臀肌是否保持张力。"),
    ],
    ["exrx-hip-thrust"],
    "exact_exercise_reference",
  ),

  // Chest split: each registered equipment variation keeps its own identity.
  gymAssociation(
    "barbell_bench_press",
    [role("pectorals", "primary"), role("triceps", "secondary"), role("anterior_deltoids", "secondary"), role("serratus_anterior", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    HORIZONTAL_PRESS_PHASES,
    "ace-barbell-bench-press",
  ),
  gymAssociation(
    "dumbbell_bench_press",
    [role("pectorals", "primary"), role("triceps", "secondary"), role("anterior_deltoids", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    HORIZONTAL_PRESS_PHASES,
    "ace-dumbbell-bench-press",
  ),
  gymAssociation(
    "incline_dumbbell_press",
    [role("pectorals", "primary"), role("anterior_deltoids", "primary"), role("triceps", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    HORIZONTAL_PRESS_PHASES,
    "ace-incline-dumbbell-press",
  ),
  gymAssociation(
    "machine_chest_press",
    [role("pectorals", "primary"), role("triceps", "secondary"), role("anterior_deltoids", "secondary"), role("serratus_anterior", "stabilizer")],
    HORIZONTAL_PRESS_PHASES,
    "ace-machine-chest-press",
  ),
  gymAssociation(
    "cable_chest_fly",
    [role("pectorals", "primary"), role("anterior_deltoids", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    CHEST_FLY_PHASES,
  ),

  // Back split.
  gymAssociation(
    "barbell_row",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "primary"), role("posterior_deltoids", "secondary"), role("elbow_flexors", "secondary"), role("spinal_erectors", "stabilizer"), role("hamstrings", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    ROW_PHASES,
    "ace-barbell-row",
  ),
  gymAssociation(
    "pull_up",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "secondary"), role("elbow_flexors", "secondary"), role("posterior_deltoids", "secondary"), role("trunk_stabilizers", "stabilizer")],
    VERTICAL_PULL_PHASES,
  ),
  gymAssociation(
    "lat_pulldown",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "secondary"), role("elbow_flexors", "secondary"), role("posterior_deltoids", "secondary"), role("trunk_stabilizers", "stabilizer")],
    VERTICAL_PULL_PHASES,
  ),
  gymAssociation(
    "seated_row",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "primary"), role("posterior_deltoids", "secondary"), role("elbow_flexors", "secondary"), role("trunk_stabilizers", "stabilizer")],
    ROW_PHASES,
  ),
  gymAssociation(
    "straight_arm_pulldown",
    [role("latissimus_dorsi", "primary"), role("triceps", "secondary"), role("pectorals", "secondary"), role("trunk_stabilizers", "stabilizer")],
    STRAIGHT_ARM_PULL_PHASES,
  ),
  gymAssociation(
    "wide_grip_lat_pulldown",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "primary"), role("elbow_flexors", "secondary"), role("posterior_deltoids", "secondary"), role("trunk_stabilizers", "stabilizer")],
    VERTICAL_PULL_PHASES,
    "exrx-wide-grip-lat-pulldown",
  ),
  gymAssociation(
    "one_arm_dumbbell_row",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "primary"), role("posterior_deltoids", "secondary"), role("elbow_flexors", "secondary"), role("trunk_stabilizers", "stabilizer")],
    ROW_PHASES,
  ),
  gymAssociation(
    "chest_supported_row",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "primary"), role("posterior_deltoids", "secondary"), role("elbow_flexors", "secondary"), role("rotator_cuff", "stabilizer")],
    ROW_PHASES,
  ),
  gymAssociation(
    "single_arm_cable_row",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "primary"), role("posterior_deltoids", "secondary"), role("elbow_flexors", "secondary"), role("trunk_stabilizers", "stabilizer")],
    ROW_PHASES,
  ),
  gymAssociation(
    "assisted_pull_up",
    [role("latissimus_dorsi", "primary"), role("scapular_retractors", "secondary"), role("elbow_flexors", "secondary"), role("posterior_deltoids", "secondary"), role("trunk_stabilizers", "stabilizer")],
    VERTICAL_PULL_PHASES,
    "exrx-assisted-pull-up",
  ),

  // Leg split.
  gymAssociation(
    "barbell_back_squat",
    [role("quadriceps", "primary"), role("gluteals", "primary"), role("hamstrings", "secondary"), role("hip_adductors", "secondary"), role("calves", "stabilizer"), role("spinal_erectors", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    SQUAT_PHASES,
    "ace-barbell-back-squat",
  ),
  gymAssociation(
    "leg_press",
    [role("quadriceps", "primary"), role("gluteals", "primary"), role("hamstrings", "secondary"), role("calves", "secondary"), role("hip_adductors", "stabilizer")],
    SQUAT_PHASES,
    "ace-leg-press",
  ),
  gymAssociation(
    "romanian_deadlift",
    [role("hamstrings", "primary"), role("gluteals", "primary"), role("spinal_erectors", "secondary"), role("hip_adductors", "secondary"), role("trunk_stabilizers", "stabilizer")],
    HIP_HINGE_PHASES,
    "ace-romanian-deadlift",
  ),
  gymAssociation(
    "conventional_deadlift",
    [role("gluteals", "primary"), role("quadriceps", "primary"), role("hamstrings", "primary"), role("spinal_erectors", "secondary"), role("hip_adductors", "secondary"), role("trunk_stabilizers", "stabilizer")],
    DEADLIFT_PHASES,
    "ace-conventional-deadlift",
  ),
  gymAssociation(
    "bulgarian_split_squat",
    [role("quadriceps", "primary"), role("gluteals", "primary"), role("hamstrings", "secondary"), role("hip_abductors", "stabilizer"), role("hip_adductors", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    SQUAT_PHASES,
    "ace-bulgarian-split-squat",
  ),
  gymAssociation(
    "leg_extension",
    [role("quadriceps", "primary"), role("hip_flexors", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    KNEE_EXTENSION_PHASES,
    "ace-leg-extension",
  ),
  gymAssociation(
    "leg_curl",
    [role("hamstrings", "primary"), role("calves", "secondary"), role("gluteals", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    KNEE_FLEXION_PHASES,
  ),

  // Shoulder split.
  gymAssociation(
    "seated_shoulder_press",
    [role("anterior_deltoids", "primary"), role("medial_deltoids", "primary"), role("triceps", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    VERTICAL_PRESS_PHASES,
  ),
  gymAssociation(
    "lateral_raise",
    [role("medial_deltoids", "primary"), role("anterior_deltoids", "secondary"), role("posterior_deltoids", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    LATERAL_RAISE_PHASES,
  ),
  gymAssociation(
    "rear_delt_fly",
    [role("posterior_deltoids", "primary"), role("scapular_retractors", "primary"), role("rotator_cuff", "secondary"), role("trunk_stabilizers", "stabilizer")],
    REAR_DELT_PHASES,
  ),
  gymAssociation(
    "face_pull",
    [role("posterior_deltoids", "primary"), role("scapular_retractors", "primary"), role("elbow_flexors", "secondary"), role("rotator_cuff", "secondary"), role("trunk_stabilizers", "stabilizer")],
    FACE_PULL_PHASES,
    "nasm-face-pull",
  ),
  gymAssociation(
    "front_raise",
    [role("anterior_deltoids", "primary"), role("pectorals", "secondary"), role("medial_deltoids", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    FRONT_RAISE_PHASES,
  ),
  gymAssociation(
    "single_arm_cable_lateral_raise",
    [role("medial_deltoids", "primary"), role("anterior_deltoids", "secondary"), role("lower_trapezius", "secondary"), role("serratus_anterior", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    SINGLE_ARM_CABLE_LATERAL_RAISE_PHASES,
    "exrx-single-arm-cable-lateral-raise",
  ),
  gymAssociation(
    "landmine_press",
    [role("anterior_deltoids", "primary"), role("pectorals", "secondary"), role("triceps", "secondary"), role("serratus_anterior", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    LANDMINE_PRESS_PHASES,
  ),
  gymAssociation(
    "cable_y_raise",
    [role("medial_deltoids", "primary"), role("lower_trapezius", "primary"), role("posterior_deltoids", "secondary"), role("serratus_anterior", "secondary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    Y_RAISE_PHASES,
  ),
  gymAssociation(
    "cable_external_rotation",
    [role("rotator_cuff", "primary"), role("posterior_deltoids", "secondary"), role("scapular_retractors", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    EXTERNAL_ROTATION_PHASES,
  ),
  gymAssociation(
    "rear_delt_row",
    [role("posterior_deltoids", "primary"), role("scapular_retractors", "primary"), role("elbow_flexors", "secondary"), role("rotator_cuff", "secondary"), role("trunk_stabilizers", "stabilizer")],
    REAR_DELT_ROW_PHASES,
  ),

  // Arm split.
  gymAssociation(
    "barbell_biceps_curl",
    [role("elbow_flexors", "primary"), role("anterior_deltoids", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    CURL_PHASES,
    "ace-barbell-biceps-curl",
  ),
  gymAssociation(
    "dumbbell_biceps_curl",
    [role("elbow_flexors", "primary"), role("anterior_deltoids", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    CURL_PHASES,
  ),
  gymAssociation(
    "hammer_curl",
    [role("elbow_flexors", "primary"), role("anterior_deltoids", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    CURL_PHASES,
    "ace-hammer-curl",
  ),
  gymAssociation(
    "cable_biceps_curl",
    [role("elbow_flexors", "primary"), role("anterior_deltoids", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    CURL_PHASES,
    "exrx-cable-biceps-curl",
  ),
  gymAssociation(
    "triceps_pushdown",
    [role("triceps", "primary"), role("latissimus_dorsi", "stabilizer"), role("posterior_deltoids", "stabilizer"), role("pectorals", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    TRICEPS_EXTENSION_PHASES,
    "exrx-triceps-pushdown",
  ),
  gymAssociation(
    "overhead_triceps_extension",
    [role("triceps", "primary"), role("rotator_cuff", "stabilizer"), role("trunk_stabilizers", "stabilizer")],
    TRICEPS_EXTENSION_PHASES,
  ),
  gymAssociation(
    "skull_crusher",
    [role("triceps", "primary"), role("anterior_deltoids", "stabilizer"), role("rotator_cuff", "stabilizer")],
    TRICEPS_EXTENSION_PHASES,
  ),
];
