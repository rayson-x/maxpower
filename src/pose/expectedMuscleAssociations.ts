import { EXERCISE_REGISTRY, type ExerciseRegistry } from "./exerciseRegistry";
import {
  EXPECTED_MUSCLE_ASSOCIATION_SCHEMA,
  MUSCLE_ASSOCIATION_SOURCES,
  MUSCLE_CATALOG,
  SEED_ASSOCIATIONS,
  type ExpectedMuscleAssociation,
  type ExpectedMusclePresentation,
  type MuscleId,
  type MuscleRole,
} from "./expectedMuscleAssociationCatalog";

export {
  EXPECTED_MUSCLE_ASSOCIATION_SCHEMA,
  MUSCLE_ASSOCIATION_SOURCES,
  MUSCLE_CATALOG,
} from "./expectedMuscleAssociationCatalog";
export type {
  AssociationSource,
  ExpectedJointMotion,
  ExpectedMuscleAssociation,
  ExpectedMusclePresentation,
  ExpectedMuscleRole,
  JointAction,
  MuscleDefinition,
  MuscleId,
  MuscleRole,
  ObservableJoint,
  TrajectoryMusclePhase,
} from "./expectedMuscleAssociationCatalog";

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
