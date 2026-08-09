import type { EquipmentRequirement } from "../coach/domain";
import { stableHash } from "../coach/stable";
import {
  KNOWLEDGE_PACK_SCHEMA_VERSION,
  KnowledgePackValidationError,
  type ExerciseConcept,
  type ExerciseConceptId,
  type ComparableExerciseContext,
  type ExerciseVariant,
  type KnowledgeVersionPins,
  type KnowledgePack,
  type MotionCapabilitySet,
  type SubstitutionCandidate,
} from "./model";

export interface ExerciseSearchInput {
  query?: string;
  movementPattern?: ExerciseVariant["movementPattern"];
  loadModes?: readonly ExerciseVariant["equipment"]["loadMode"][];
  limit?: number;
}

export interface SubstitutionInput {
  originalExerciseId: string;
  goalPack: "hypertrophy" | "strength" | "fat_loss" | "conditioning" | "health";
  availableEquipment: readonly string[];
  /** Structured state is authoritative when provided; missing items remain unknown. */
  equipmentStates?: readonly {
    id: string;
    status: "available" | "busy" | "broken" | "unknown";
  }[];
  knownExerciseVariantIds?: readonly string[];
  exactPerformanceHistoryIds?: readonly string[];
  preferredExerciseVariantIds?: readonly string[];
  cameraView?: string;
  rankingPolicy?: {
    weights: {
      sameMovement: number;
      sameMovementPattern: number;
      sameLoadMode: number;
      sameStimulusContract: number;
      exactHistory: number;
      mastery: number;
      explicitPreference: number;
      unknownEquipmentPenalty: number;
      cameraCapabilityBonus: number;
      cardioOrLocomotionBonus: number;
      recoveryActivityBonus: number;
    };
    ruleVersion: import("./model").VersionPin;
  };
  constraints: {
    noise: "quiet" | "moderate" | "any";
    space: "small" | "medium" | "large";
    unavailableToday: readonly string[];
  };
}

export interface MotionCapabilityResolver {
  resolve(input: { exerciseVariantId: string; cameraView: string }): MotionCapabilitySet;
}

const MANUAL_ONLY: MotionCapabilitySet = {
  countPhase: "unavailable",
  tempo: "unavailable",
  calibratedTrajectoryComparison: "unavailable",
  evidenceLinkedCue: "unavailable",
  fallback: "manual_recording",
  evidenceRefs: [],
};

export class KnowledgePackRegistry implements MotionCapabilityResolver {
  private readonly variantsById: ReadonlyMap<string, ExerciseVariant>;
  private readonly conceptsById: ReadonlyMap<ExerciseConceptId, ExerciseConcept>;
  private readonly catalogsByHash: ReadonlyMap<string, KnowledgePack["exerciseCatalog"]>;
  private readonly packsByHash: ReadonlyMap<string, KnowledgePack>;

  constructor(
    private readonly pack: KnowledgePack,
    private readonly appSchemaVersion = 1,
    archivedPacks: readonly KnowledgePack[] = [],
  ) {
    for (const candidate of [pack, ...archivedPacks]) validateKnowledgePack(candidate, appSchemaVersion);
    this.variantsById = new Map(pack.exerciseCatalog.variants.map((variant) => [variant.id, variant]));
    this.conceptsById = new Map(pack.exerciseCatalog.concepts.map((concept) => [concept.id, concept]));
    this.catalogsByHash = new Map(
      [pack, ...archivedPacks].map((candidate) => [
        candidate.exerciseCatalog.contentHash,
        candidate.exerciseCatalog,
      ]),
    );
    this.packsByHash = new Map(
      [pack, ...archivedPacks].map((candidate) => [candidate.manifest.contentHash, candidate]),
    );
  }

  versionPins(): KnowledgeVersionPins {
    return {
      knowledgePack: {
        id: this.pack.manifest.id,
        semanticVersion: this.pack.manifest.semanticVersion,
        schemaVersion: this.pack.manifest.schemaVersion,
        contentHash: this.pack.manifest.contentHash,
      },
      exerciseCatalog: {
        id: this.pack.exerciseCatalog.id,
        semanticVersion: this.pack.exerciseCatalog.semanticVersion,
        schemaVersion: this.pack.exerciseCatalog.schemaVersion,
        contentHash: this.pack.exerciseCatalog.contentHash,
      },
      rulePacks: this.pack.executableRulePacks.map((rule) => ({
        id: rule.id,
        semanticVersion: rule.semanticVersion,
        schemaVersion: rule.schemaVersion,
        contentHash: rule.contentHash,
      })),
    };
  }

  replayExerciseVariant(
    pin: KnowledgeVersionPins["exerciseCatalog"],
    exerciseVariantId: string,
  ): ExerciseVariant {
    const catalog = this.catalogsByHash.get(pin.contentHash);
    if (
      !catalog ||
      catalog.id !== pin.id ||
      catalog.semanticVersion !== pin.semanticVersion ||
      catalog.schemaVersion !== pin.schemaVersion
    ) {
      throw new KnowledgePackValidationError("missing_reference", [
        `${pin.id}@${pin.semanticVersion}#${pin.contentHash}`,
      ]);
    }
    const exercise = catalog.variants.find((variant) => variant.id === exerciseVariantId);
    if (!exercise) throw new KnowledgePackValidationError("missing_reference", [exerciseVariantId]);
    return exercise;
  }

  assertVersionPins(pins: KnowledgeVersionPins): void {
    const pinnedPack = this.packsByHash.get(pins.knowledgePack.contentHash);
    if (
      !pinnedPack ||
      pinnedPack.manifest.id !== pins.knowledgePack.id ||
      pinnedPack.manifest.semanticVersion !== pins.knowledgePack.semanticVersion ||
      pinnedPack.manifest.schemaVersion !== pins.knowledgePack.schemaVersion
    ) {
      throw new KnowledgePackValidationError("missing_reference", ["knowledge_pack_pin"]);
    }
    const catalog = this.catalogsByHash.get(pins.exerciseCatalog.contentHash);
    if (
      !catalog ||
      catalog.id !== pins.exerciseCatalog.id ||
      catalog.semanticVersion !== pins.exerciseCatalog.semanticVersion ||
      catalog.schemaVersion !== pins.exerciseCatalog.schemaVersion
    ) {
      throw new KnowledgePackValidationError("missing_reference", ["catalog_pin"]);
    }
    for (const rulePin of pins.rulePacks) {
      const rule = pinnedPack.executableRulePacks.find(
        (candidate) => candidate.contentHash === rulePin.contentHash,
      );
      if (
        !rule ||
        rule.id !== rulePin.id ||
        rule.semanticVersion !== rulePin.semanticVersion ||
        rule.schemaVersion !== rulePin.schemaVersion
      ) {
        throw new KnowledgePackValidationError("missing_reference", [`rule_pin:${rulePin.id}`]);
      }
    }
  }

  inspect() {
    return {
      manifest: this.pack.manifest,
      classifications: this.pack.classifications,
      exerciseCatalog: {
        id: this.pack.exerciseCatalog.id,
        semanticVersion: this.pack.exerciseCatalog.semanticVersion,
        schemaVersion: this.pack.exerciseCatalog.schemaVersion,
        contentHash: this.pack.exerciseCatalog.contentHash,
        count: this.pack.exerciseCatalog.variants.length,
      },
      executableRulePacks: this.pack.executableRulePacks,
      wikiDocuments: this.pack.wikiDocuments,
    };
  }

  search(input: ExerciseSearchInput): readonly ExerciseVariant[] {
    const query = input.query?.trim().toLocaleLowerCase() ?? "";
    return this.pack.exerciseCatalog.variants
      .filter((variant) => variant.status === "active")
      .filter((variant) => !input.movementPattern || variant.movementPattern === input.movementPattern)
      .filter(
        (variant) =>
          !input.loadModes?.length || input.loadModes.includes(variant.equipment.loadMode),
      )
      .filter((variant) => {
        if (!query) return true;
        return [
          variant.id,
          variant.displayName.zh,
          variant.displayName.en,
          ...variant.aliases,
        ].some((value) => value.toLocaleLowerCase().includes(query));
      })
      .slice(0, input.limit ?? 100);
  }

  exerciseVariant(id: string): ExerciseVariant | undefined {
    return this.variantsById.get(id);
  }

  comparableExerciseContext(
    currentExerciseVariantId: string,
    candidateExerciseVariantId: string,
  ): ComparableExerciseContext {
    const current = this.variantsById.get(currentExerciseVariantId);
    const candidate = this.variantsById.get(candidateExerciseVariantId);
    if (!current || !candidate) {
      throw new KnowledgePackValidationError("missing_reference", [
        currentExerciseVariantId,
        candidateExerciseVariantId,
      ]);
    }
    const comparable = current.performanceIdentity === candidate.performanceIdentity;
    return {
      exerciseVariantId: candidate.id,
      performanceIdentity: candidate.performanceIdentity,
      comparable: comparable ? "exact_variant" : "not_comparable",
      loadTransfer: comparable ? "same_measurement_history_only" : "forbidden_cold_start",
      observationContextExcluded: ["camera_view", "lens", "pose_model", "recognition_profile"],
    };
  }

  exerciseConcept(id: ExerciseConceptId): ExerciseConcept | undefined {
    return this.conceptsById.get(id);
  }

  resolveExerciseConceptId(idOrAlias: string): ExerciseConceptId | undefined {
    const normalized = idOrAlias.trim().toLocaleLowerCase();
    const direct = this.pack.exerciseCatalog.concepts.find(
      (concept) => concept.id.toLocaleLowerCase() === normalized,
    );
    const matched = direct ?? this.pack.exerciseCatalog.concepts.find((concept) =>
      [concept.displayName.zh, concept.displayName.en, ...concept.aliases]
        .some((alias) => alias.toLocaleLowerCase() === normalized),
    );
    if (!matched) return undefined;
    return matched.status === "tombstone" && matched.replacementConceptId
      ? matched.replacementConceptId
      : matched.id;
  }

  stimulusContract(id: string) {
    return this.pack.exerciseCatalog.stimulusContracts.find((contract) => contract.id === id);
  }

  resolveSubstitutions(input: SubstitutionInput): readonly SubstitutionCandidate[] {
    const original = this.variantsById.get(input.originalExerciseId);
    if (!original) throw new KnowledgePackValidationError("missing_reference", [input.originalExerciseId]);
    const available = new Set(input.availableEquipment);
    const structuredStates = input.equipmentStates
      ? new Map(input.equipmentStates.map((state) => [state.id, state.status]))
      : undefined;
    const known = new Set(input.knownExerciseVariantIds ?? []);
    const exactHistory = new Set(input.exactPerformanceHistoryIds ?? []);
    const preferred = new Set(input.preferredExerciseVariantIds ?? []);
    const catalogRule = this.pack.executableRulePacks.find(
      (candidate) => candidate.id === "maxpower.catalog.constraints",
    );
    if (!catalogRule) throw new KnowledgePackValidationError("missing_reference", ["maxpower.catalog.constraints"]);
    const fallback = this.pack.exerciseCatalog.substitutionProfiles.find(
      (profile) => profile.goalPack === input.goalPack,
    )?.weights;
    if (!fallback) throw new KnowledgePackValidationError("missing_reference", [`goal_pack:${input.goalPack}`]);
    const weights = input.rankingPolicy?.weights ?? {
      sameMovement: fallback.sameMovement,
      sameMovementPattern: fallback.sameMovementPattern,
      sameLoadMode: fallback.sameLoadMode,
      sameStimulusContract: 10,
      exactHistory: 8,
      mastery: 4,
      explicitPreference: 3,
      unknownEquipmentPenalty: -25,
      cameraCapabilityBonus: fallback.cameraCapabilityBonus,
      cardioOrLocomotionBonus: fallback.cardioOrLocomotionBonus,
      recoveryActivityBonus: fallback.recoveryActivityBonus,
    };
    const ruleVersion = input.rankingPolicy?.ruleVersion ?? {
      id: catalogRule.id,
      semanticVersion: catalogRule.semanticVersion,
      schemaVersion: catalogRule.schemaVersion,
      contentHash: catalogRule.contentHash,
    };
    const candidates = this.pack.exerciseCatalog.variants
      .filter((candidate) => candidate.id !== original.id)
      .filter((candidate) => candidate.status === "active")
      .filter((candidate) => candidate.movementPattern === original.movementPattern)
      .filter((candidate) => !input.constraints.unavailableToday.includes(candidate.id))
      .map((candidate) => {
        const equipment = evaluateRequirement(
          candidate.equipment.requirement,
          available,
          structuredStates,
          input.constraints,
        );
        const hardConstraintsSatisfied = equipment.state !== "unavailable";
        const eligibility = equipment.state === "unknown"
          ? "needs_equipment_confirmation" as const
          : "eligible" as const;
        const sameMovement = candidate.identity.movement === original.identity.movement;
        const sameLoadMode = candidate.equipment.loadMode === original.equipment.loadMode;
        const sameStimulus = candidate.stimulusContractIds.some((id) =>
          original.stimulusContractIds.includes(id),
        );
        const mastered = known.has(candidate.id);
        const hasExactHistory = exactHistory.has(candidate.id);
        const motionCapability = this.resolve({
          exerciseVariantId: candidate.id,
          cameraView: input.cameraView ?? "unspecified",
        });
        const fatigueImpact = this.stimulusContract(candidate.stimulusContractIds[0] ?? "")
          ?.fatigueCost ?? "medium";
        const score =
          (sameMovement ? weights.sameMovement : weights.sameMovementPattern) +
          (sameLoadMode ? weights.sameLoadMode : 0) +
          (sameStimulus ? weights.sameStimulusContract : 0) +
          (hasExactHistory ? weights.exactHistory : 0) +
          (mastered ? weights.mastery : 0) +
          (preferred.has(candidate.id) ? weights.explicitPreference : 0) +
          (eligibility === "needs_equipment_confirmation" ? weights.unknownEquipmentPenalty : 0) +
          (candidate.movementPattern === "cardio" || candidate.movementPattern === "locomotion"
            ? weights.cardioOrLocomotionBonus
            : 0) +
          (candidate.movementPattern === "recovery" ? weights.recoveryActivityBonus : 0) +
          (motionCapability.countPhase === "available" || motionCapability.evidenceLinkedCue === "available"
            ? weights.cameraCapabilityBonus
            : 0);
        const result: SubstitutionCandidate & { score: number } = {
          exercise: candidate,
          hardConstraintsSatisfied,
          eligibility,
          satisfiedFields: [
            "movement_pattern",
            ...(sameStimulus ? ["stimulus_contract"] : []),
            ...(equipment.state === "available" ? ["equipment", "environment"] : []),
          ],
          deviatedFields: [
            ...(sameMovement ? [] : ["exercise_movement"]),
            ...(sameLoadMode ? [] : ["load_mode"]),
            ...(sameStimulus ? [] : ["stimulus_contract"]),
            ...(equipment.state === "unknown" ? ["equipment_unknown"] : []),
          ],
          rankingReasons: [
            "hard_constraints",
            sameMovement ? "same_movement" : "same_stimulus_pattern",
            `goal_pack:${input.goalPack}`,
            ...(hasExactHistory ? ["exact_variant_history"] : []),
            ...(mastered ? ["user_mastery"] : []),
            ...(preferred.has(candidate.id) ? ["explicit_preference"] : []),
            ...(equipment.state === "unknown" ? ["equipment_confirmation_required"] : []),
            ...(motionCapability.countPhase === "available" || motionCapability.evidenceLinkedCue === "available"
              ? ["camera_capability"]
              : []),
          ],
          coldStart: {
            loadHistory: hasExactHistory ? "known" : "unknown",
            exerciseHistory: known.has(candidate.id) ? "known" : "unknown",
          },
          requiredEquipment: equipment.requiredIds,
          performanceComparability: hasExactHistory ? "exact_variant" : "cold_start",
          timeImpactMinutes: sameLoadMode ? 0 : 2,
          fatigueImpact,
          motionCapability,
          ruleVersion,
          score,
        };
        return result;
      })
      .filter((candidate) => candidate.hardConstraintsSatisfied)
      .sort((left, right) => right.score - left.score || left.exercise.id.localeCompare(right.exercise.id))
      .slice(0, 20)
      .map(({ score: _score, ...candidate }) => candidate);
    return candidates;
  }

  resolve(input: { exerciseVariantId: string; cameraView: string }): MotionCapabilitySet {
    const exercise = this.variantsById.get(input.exerciseVariantId);
    if (!exercise) return MANUAL_ONLY;
    // Evidence maturity describes installed evidence only. It never authorizes
    // runtime behavior. Ticket 10 injects exact validated capabilities here.
    return MANUAL_ONLY;
  }
}

export function validateKnowledgePack(pack: KnowledgePack, appSchemaVersion = 1): void {
  if (
    pack.manifest.schemaVersion !== KNOWLEDGE_PACK_SCHEMA_VERSION ||
    appSchemaVersion < pack.manifest.compatibility.minAppSchema ||
    appSchemaVersion > pack.manifest.compatibility.maxAppSchema
  ) {
    throw new KnowledgePackValidationError("schema_incompatible");
  }
  if (
    pack.manifest.signature.status !== "reviewed_digest" ||
    pack.manifest.signature.value !== pack.manifest.contentHash
  ) {
    throw new KnowledgePackValidationError("signature_invalid");
  }
  if (computePackHash(pack) !== pack.manifest.contentHash) {
    throw new KnowledgePackValidationError("hash_mismatch");
  }
  if (computeCatalogHash(pack) !== pack.exerciseCatalog.contentHash) {
    throw new KnowledgePackValidationError("hash_mismatch", [pack.exerciseCatalog.id]);
  }
  const errors = lintKnowledgePack(pack);
  if (errors.length) throw new KnowledgePackValidationError("catalog_invalid", errors);
}

export function lintKnowledgePack(pack: KnowledgePack): readonly string[] {
  const sourceIds = new Set(pack.manifest.sourceRefs.map((source) => source.id));
  const conceptIds = new Set<ExerciseConceptId>();
  const variantIds = new Set<string>();
  const stimulusIds = new Set(pack.exerciseCatalog.stimulusContracts.map((contract) => contract.id));
  const errors: string[] = [];
  for (const source of pack.manifest.sourceRefs) {
    if (!source.uri || !source.title || !source.reviewedAt) errors.push(`source_manifest:${source.id}`);
  }
  for (const concept of pack.exerciseCatalog.concepts) {
    if (conceptIds.has(concept.id)) errors.push(`duplicate_concept:${concept.id}`);
    conceptIds.add(concept.id);
    if (!concept.id || !concept.displayName.zh || !concept.displayName.en || !concept.catalogVersion) {
      errors.push(`concept_identity:${concept.id}`);
    }
    if (!concept.reviewedAt || concept.sourceRefs.some((source) => !sourceIds.has(source))) {
      errors.push(`concept_source:${concept.id}`);
    }
    if (concept.status === "tombstone" && !concept.replacementConceptId) {
      errors.push(`concept_tombstone_without_replacement:${concept.id}`);
    }
  }
  for (const concept of pack.exerciseCatalog.concepts) {
    if (
      concept.status === "tombstone" &&
      concept.replacementConceptId &&
      !conceptIds.has(concept.replacementConceptId)
    ) {
      errors.push(`concept_replacement:${concept.id}`);
    }
  }
  const goalProfiles = new Set(
    pack.exerciseCatalog.substitutionProfiles.map((profile) => profile.goalPack),
  );
  for (const goal of ["hypertrophy", "strength", "fat_loss", "conditioning", "health"] as const) {
    if (!goalProfiles.has(goal)) errors.push(`goal_profile:${goal}`);
  }
  for (const profile of pack.exerciseCatalog.substitutionProfiles) {
    if (
      profile.weights.cameraCapabilityBonus >= profile.weights.sameMovementPattern ||
      profile.weights.cameraCapabilityBonus < 0
    ) {
      errors.push(`camera_weight:${profile.goalPack}`);
    }
  }
  for (const variant of pack.exerciseCatalog.variants) {
    if (variantIds.has(variant.id)) errors.push(`duplicate:${variant.id}`);
    variantIds.add(variant.id);
    if (!conceptIds.has(variant.conceptId)) errors.push(`concept_reference:${variant.id}`);
    if (variant.performanceIdentity !== stableHash(variant.identity)) {
      errors.push(`identity_hash:${variant.id}`);
    }
    if (variant.identity.cameraView !== undefined) errors.push(`camera_in_identity:${variant.id}`);
    if (variant.expectedMuscleAssociation.exerciseVariantId !== variant.id) {
      errors.push(`muscle_context:${variant.id}`);
    }
    if (variant.expectedMuscleAssociation.disclaimer !== "expected_participation_not_observed_activation") {
      errors.push(`muscle_claim:${variant.id}`);
    }
    if (variant.stimulusContractIds.some((id) => !stimulusIds.has(id))) {
      errors.push(`stimulus_reference:${variant.id}`);
    }
    for (const requirement of variant.motionEvidenceRequirements) {
      if (
        requirement.maturity === "none" &&
        (requirement.recognitionProfileId ||
          requirement.referenceTrajectoryProfileId ||
          requirement.cueMappingId)
      ) {
        errors.push(`motion_layer:${variant.id}:${requirement.cameraView}`);
      }
      if (requirement.referenceTrajectoryProfileId && !requirement.recognitionProfileId) {
        errors.push(`trajectory_without_profile:${variant.id}:${requirement.cameraView}`);
      }
      if (requirement.cueMappingId && !requirement.referenceTrajectoryProfileId) {
        errors.push(`cue_without_trajectory:${variant.id}:${requirement.cameraView}`);
      }
    }
    if (variant.sourceRefs.some((source) => !sourceIds.has(source))) {
      errors.push(`source:${variant.id}`);
    }
    if (variant.status === "deprecated" && !variant.replacementId) {
      errors.push(`deprecated_without_replacement:${variant.id}`);
    }
    lintEquipment(variant.equipment.requirement, variant.id, errors);
  }
  for (const variant of pack.exerciseCatalog.variants) {
    if (
      variant.status === "deprecated" &&
      variant.replacementId &&
      !variantIds.has(variant.replacementId)
    ) {
      errors.push(`deprecated_replacement:${variant.id}`);
    }
  }
  for (const graph of pack.exerciseCatalog.difficultyGraphs) {
    const graphNodes = new Set(graph.nodes);
    if (graph.nodes.some((node) => !variantIds.has(node))) {
      errors.push(`graph_catalog_reference:${graph.id}`);
    }
    if (graph.nodes.length > 1) {
      for (const node of graph.nodes) {
        if (!graph.edges.some((edge) => edge.from === node || edge.to === node)) {
          errors.push(`isolated:${graph.id}:${node}`);
        }
      }
    }
    if (graph.edges.some((edge) => !graphNodes.has(edge.from) || !graphNodes.has(edge.to))) {
      errors.push(`graph_reference:${graph.id}`);
    }
    if (hasDirectedCycle(graph.nodes, graph.edges.map((edge) => [edge.from, edge.to] as const))) {
      errors.push(`graph_cycle:${graph.id}`);
    }
  }
  for (const rule of pack.executableRulePacks) {
    if (!rule.reviewed || !rule.contentHash || rule.sourceRefs.some((source) => !sourceIds.has(source))) {
      errors.push(`rule:${rule.id}`);
    }
  }
  return errors;
}

function computePackHash(pack: KnowledgePack): string {
  const { contentHash: _contentHash, signature: _signature, ...manifest } = pack.manifest;
  return stableHash({
    manifest,
    classifications: pack.classifications,
    exerciseCatalog: pack.exerciseCatalog,
    executableRulePacks: pack.executableRulePacks,
    wikiDocuments: pack.wikiDocuments,
  });
}

function computeCatalogHash(pack: KnowledgePack): string {
  const { contentHash: _contentHash, ...catalog } = pack.exerciseCatalog;
  return stableHash(catalog);
}

interface EquipmentEvaluation {
  state: "available" | "unknown" | "unavailable";
  requiredIds: readonly string[];
}

function evaluateRequirement(
  requirement: EquipmentRequirement,
  available: ReadonlySet<string>,
  structuredStates: ReadonlyMap<string, "available" | "busy" | "broken" | "unknown"> | undefined,
  constraints: SubstitutionInput["constraints"],
): EquipmentEvaluation {
  if (requirement.kind === "unknown") return { state: "unknown", requiredIds: [] };
  if (requirement.kind === "item") {
    const explicit = structuredStates?.get(requirement.id);
    if (explicit === "available" || available.has(requirement.id)) {
      return { state: "available", requiredIds: [requirement.id] };
    }
    if (explicit === "busy" || explicit === "broken") {
      return { state: "unavailable", requiredIds: [requirement.id] };
    }
    return {
      state: structuredStates ? "unknown" : "unavailable",
      requiredIds: [requirement.id],
    };
  }
  if (requirement.kind === "all") {
    return combineEquipment(
      requirement.items.map((item) => evaluateRequirement(item, available, structuredStates, constraints)),
      "all",
    );
  }
  if (requirement.kind === "any") {
    return combineEquipment(
      requirement.items.map((item) => evaluateRequirement(item, available, structuredStates, constraints)),
      "any",
    );
  }
  const spaceOrder = { small: 0, medium: 1, large: 2 } as const;
  const noiseOrder = { quiet: 0, moderate: 1, any: 2 } as const;
  const satisfied = (
    spaceOrder[constraints.space] >= spaceOrder[requirement.space] &&
    noiseOrder[constraints.noise] >= noiseOrder[requirement.noise]
  );
  return {
    state: satisfied ? "available" : "unavailable",
    requiredIds: [
      `environment:${requirement.space}:${requirement.noise}:${requirement.floorImpact}`,
      ...(requirement.fixedConditions ?? []).map((condition) => `condition:${condition}`),
    ],
  };
}

function combineEquipment(
  evaluations: readonly EquipmentEvaluation[],
  mode: "all" | "any",
): EquipmentEvaluation {
  const requiredIds = [...new Set(evaluations.flatMap((item) => item.requiredIds))];
  if (mode === "all") {
    return {
      state: evaluations.some((item) => item.state === "unavailable")
        ? "unavailable"
        : evaluations.some((item) => item.state === "unknown")
          ? "unknown"
          : "available",
      requiredIds,
    };
  }
  return {
    state: evaluations.some((item) => item.state === "available")
      ? "available"
      : evaluations.some((item) => item.state === "unknown")
        ? "unknown"
        : "unavailable",
    requiredIds,
  };
}

function lintEquipment(requirement: EquipmentRequirement, id: string, errors: string[]): void {
  if (requirement.kind === "all" || requirement.kind === "any") {
    if (requirement.items.length === 0) errors.push(`empty_equipment:${id}`);
    for (const item of requirement.items) lintEquipment(item, id, errors);
    return;
  }
  if (requirement.kind === "item") {
    if (!requirement.id) errors.push(`equipment_id:${id}`);
    if (requirement.quantity !== undefined && requirement.quantity < 1) {
      errors.push(`equipment_quantity:${id}`);
    }
    if (requirement.loadRange) {
      const { min, max, increment } = requirement.loadRange;
      if (
        min.unit !== max.unit ||
        min.value > max.value ||
        (increment && (increment.unit !== min.unit || increment.value <= 0))
      ) {
        errors.push(`equipment_load_range:${id}`);
      }
    }
    if (requirement.discreteLoads) {
      const units = new Set(requirement.discreteLoads.map((load) => load.unit));
      if (
        units.size > 1 ||
        requirement.discreteLoads.some((load) => !Number.isFinite(load.value) || load.value < 0)
      ) {
        errors.push(`equipment_discrete_loads:${id}`);
      }
    }
    return;
  }
  if (requirement.kind === "unknown" && !requirement.description) return;
}

function hasDirectedCycle(nodes: readonly string[], edges: readonly (readonly [string, string])[]): boolean {
  const adjacency = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const [from, to] of edges) adjacency.get(from)?.push(to);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if ((adjacency.get(node) ?? []).some(visit)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return nodes.some(visit);
}
