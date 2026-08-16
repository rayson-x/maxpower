import { readFileSync } from "node:fs";

import type { ExerciseVariant, KnowledgePack } from "../../src/knowledge/model";
import { computeCatalogHash, computePackHash } from "../../src/knowledge/KnowledgePackRegistry";
import { stableHash } from "../../src/coach/stable";

/**
 * 候选动作知识管线（离线构建期工具，非运行时）。
 *
 * exercises-dataset 记录经「LLM 起草 → 人工逐条裁定 → 版本化裁定文件」进入
 * 构建；构建只读裁定结果，模型输出永远不会自我提升为产品事实。媒体字段
 * （image/gif_url/media_id）在适配器入口结构性剥离，不进入任何中间产物。
 */

export class CandidatePipelineError extends Error {
  constructor(
    readonly code: "unmapped_muscle_term" | "unadjudicated_record" | "missing_stimulus_contract" | "dataset_record_missing" | "adjudication_invalid" | "dataset_missing" | "alias_target_missing",
    readonly recordIds: readonly string[],
  ) {
    super(`${code}:${recordIds.join(",")}`);
    this.name = "CandidatePipelineError";
  }
}

const MEDIA_KEYS = new Set(["image", "gif_url", "media_id"]);

export interface DatasetExerciseRecord {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly body_part: string;
  readonly equipment: string;
  readonly target: string;
  readonly secondary_muscles: readonly string[];
}

/** 适配器入口：解析并结构性剥离媒体字段。任何中间产物都不含媒体键。 */
export function parseDatasetRecords(jsonText: string): readonly DatasetExerciseRecord[] {
  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) throw new CandidatePipelineError("adjudication_invalid", ["dataset_not_an_array"]);
  return parsed.map((entry) => {
    const record = Object.fromEntries(Object.entries(entry as Record<string, unknown>).filter(([key]) => !MEDIA_KEYS.has(key)));
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.target !== "string") {
      throw new CandidatePipelineError("adjudication_invalid", [String(record.id ?? "unknown")]);
    }
    return {
      id: record.id,
      name: record.name,
      category: typeof record.category === "string" ? record.category : "",
      body_part: typeof record.body_part === "string" ? record.body_part : "",
      equipment: typeof record.equipment === "string" ? record.equipment : "",
      target: record.target,
      secondary_muscles: Array.isArray(record.secondary_muscles) ? record.secondary_muscles.filter((item): item is string => typeof item === "string") : [],
    };
  });
}

export interface MuscleMapFile {
  readonly version: number;
  /** 自有肌群本体的合法值全集；裁定角色只允许落在这里。 */
  readonly ontology: readonly string[];
  readonly map: Readonly<Record<string, string>>;
}

export interface IdentityAdjudicationFile {
  readonly version: number;
  readonly datasetSource: { readonly id: string; readonly upstreamCommit: string; readonly snapshotSha256: string };
  /** 声明进本批范围的记录；其中任何一条无裁定即构建失败。 */
  readonly scope: readonly string[];
  readonly records: readonly {
    readonly datasetId: string;
    readonly decision: "alias_of" | "new_variant_of" | "deferred";
    readonly conceptId?: string;
    readonly stimulusContractId?: string;
    /** alias_of 必填：目标 variant（可指向既有 variant 或本批新 variant）与并入的检索别名。 */
    readonly targetVariantId?: string;
    readonly alias?: string;
    readonly variant?: {
      readonly id: string;
      readonly displayName: { readonly zh: string; readonly en: string };
      readonly aliases: readonly string[];
      readonly identity: ExerciseVariant["identity"];
      readonly movementPattern: ExerciseVariant["movementPattern"];
      readonly equipment: ExerciseVariant["equipment"];
      readonly mechanic?: "compound" | "isolation";
      readonly muscleAssociation: readonly { readonly muscleId: string; readonly role: "primary_intent" | "secondary_intent" | "stabilizer" }[];
    };
  }[];
}

export function loadMuscleMap(path: string): MuscleMapFile {
  return JSON.parse(readFileSync(path, "utf8")) as MuscleMapFile;
}

export function loadAdjudications(path: string): IdentityAdjudicationFile {
  return JSON.parse(readFileSync(path, "utf8")) as IdentityAdjudicationFile;
}

/** 数据集词表 → 自有肌群本体；任何未映射值点名失败。 */
function mapMuscle(map: Readonly<Record<string, string>>, term: string, recordId: string): string {
  const mapped = map[term.trim().toLowerCase()];
  if (!mapped) throw new CandidatePipelineError("unmapped_muscle_term", [`${recordId}:${term}`]);
  return mapped;
}

/**
 * 消费裁定文件构建候选包：basePack 内容 + 裁定进包的 variant。
 * 未映射肌群词 / 未裁定记录 / 缺刺激合约归属 → 构建直接失败并点名记录。
 */
export function buildCandidatePack(input: {
  readonly basePack: KnowledgePack;
  readonly datasetRecords: readonly DatasetExerciseRecord[];
  readonly muscleMap: MuscleMapFile;
  readonly adjudications: IdentityAdjudicationFile;
  readonly semanticVersion: string;
}): KnowledgePack {
  const { adjudications } = input;
  const adjudicatedIds = new Set(adjudications.records.map((record) => record.datasetId));
  const missing = adjudications.scope.filter((id) => !adjudicatedIds.has(id));
  if (missing.length) throw new CandidatePipelineError("unadjudicated_record", missing);

  const recordsById = new Map(input.datasetRecords.map((record) => [record.id, record]));
  const contractIds = new Set(input.basePack.exerciseCatalog.stimulusContracts.map((contract) => contract.id));
  const conceptContractIds = new Map<string, Set<string>>();
  for (const variant of input.basePack.exerciseCatalog.variants) {
    const set = conceptContractIds.get(variant.conceptId) ?? new Set<string>();
    for (const id of variant.stimulusContractIds) set.add(id);
    conceptContractIds.set(variant.conceptId, set);
  }

  const newVariants: ExerciseVariant[] = [];
  const aliasPatches = new Map<string, Set<string>>();
  for (const adjudication of adjudications.records) {
    if (adjudication.decision === "deferred") continue;
    const source = recordsById.get(adjudication.datasetId);
    if (!source) throw new CandidatePipelineError("dataset_record_missing", [adjudication.datasetId]);
    // 词表纪律在裁定内容之外独立成立：记录用到的每个数据集肌群词都必须有映射。
    mapMuscle(input.muscleMap.map, source.target, source.id);
    for (const secondary of source.secondary_muscles) mapMuscle(input.muscleMap.map, secondary, source.id);

    if (adjudication.decision === "alias_of") {
      // 补 alias 是判定的实质：目标必须显式存在（既有或本批新 variant），别名非空。
      if (!adjudication.targetVariantId || !adjudication.alias?.trim()) {
        throw new CandidatePipelineError("adjudication_invalid", [adjudication.datasetId]);
      }
      const exists = input.basePack.exerciseCatalog.variants.some((variant) => variant.id === adjudication.targetVariantId)
        || newVariants.some((variant) => variant.id === adjudication.targetVariantId);
      if (!exists) throw new CandidatePipelineError("alias_target_missing", [`${adjudication.datasetId}:${adjudication.targetVariantId}`]);
      const set = aliasPatches.get(adjudication.targetVariantId) ?? new Set<string>();
      set.add(adjudication.alias.trim());
      aliasPatches.set(adjudication.targetVariantId, set);
      continue;
    }
    const variant = adjudication.variant;
    if (!adjudication.conceptId || !adjudication.stimulusContractId || !variant || !variant.muscleAssociation.length) {
      throw new CandidatePipelineError("adjudication_invalid", [adjudication.datasetId]);
    }
    if (!contractIds.has(adjudication.stimulusContractId)) {
      throw new CandidatePipelineError("missing_stimulus_contract", [`${adjudication.datasetId}:${adjudication.stimulusContractId}`]);
    }
    const conceptContracts = conceptContractIds.get(adjudication.conceptId);
    if (!conceptContracts?.has(adjudication.stimulusContractId)) {
      throw new CandidatePipelineError("missing_stimulus_contract", [`${adjudication.datasetId}:${adjudication.conceptId}`]);
    }
    // 裁定给出的肌群角色也逐项过本体（ontology 之外的 muscleId 不允许出现）。
    const ontology = new Set(input.muscleMap.ontology);
    for (const association of variant.muscleAssociation) {
      if (!ontology.has(association.muscleId)) throw new CandidatePipelineError("unmapped_muscle_term", [`${adjudication.datasetId}:${association.muscleId}`]);
    }
    newVariants.push({
      id: variant.id,
      conceptId: adjudication.conceptId as ExerciseVariant["conceptId"],
      schemaVersion: 1 as ExerciseVariant["schemaVersion"],
      semanticVersion: input.semanticVersion,
      displayName: variant.displayName,
      aliases: variant.aliases,
      identity: variant.identity,
      performanceIdentity: stableHash(variant.identity),
      movementPattern: variant.movementPattern,
      equipment: variant.equipment,
      stimulusContractIds: [adjudication.stimulusContractId],
      expectedMuscleAssociation: {
        exerciseVariantId: variant.id,
        contextHash: stableHash({ variant: variant.id, adjudicatedAt: adjudication.datasetId }),
        status: "unknown",
        associations: variant.muscleAssociation.map((association) => ({ ...association, evidenceStatus: "unknown" as const })),
        disclaimer: "expected_participation_not_observed_activation",
      },
      motionEvidenceRequirements: [],
      ...(variant.mechanic ? { mechanic: variant.mechanic } : {}),
      status: "active",
      sourceRefs: [adjudications.datasetSource.id],
      unknownFields: [],
      dataEligibility: {
        recordable: false,
        plannerEligible: false,
        expectedMuscleMetadata: "unknown",
        motionCapabilityRequirement: "independent_exact_resolver",
      },
    });
  }

  const datasetSourceRef = {
    id: adjudications.datasetSource.id,
    title: "exercises-dataset (hasaneyldrm) adjudicated subset",
    uri: `commit:${adjudications.datasetSource.upstreamCommit}#sha256:${adjudications.datasetSource.snapshotSha256}`,
    // 第三方元数据经人工裁定入包；分类沿用现有受控词表中最贴近的一类。
    classification: "ProductPolicy" as const,
    reviewedAt: "2026-08-16T00:00:00.000Z",
  };

  // alias 并入目标 variant 的检索别名（大小写不敏感去重；与既有名称相同则跳过）。
  const applyAliases = (variant: ExerciseVariant): ExerciseVariant => {
    const patches = aliasPatches.get(variant.id);
    if (!patches) return variant;
    const known = new Set([variant.displayName.zh, variant.displayName.en, ...variant.aliases].map((name) => name.trim().toLowerCase()));
    const added = [...patches].filter((alias) => !known.has(alias.trim().toLowerCase()));
    return added.length ? { ...variant, aliases: [...variant.aliases, ...added] } : variant;
  };

  const catalog = {
    ...input.basePack.exerciseCatalog,
    semanticVersion: input.semanticVersion,
    variants: [...input.basePack.exerciseCatalog.variants.map(applyAliases), ...newVariants.map(applyAliases)],
  };
  const catalogWithHash = { ...catalog, contentHash: computeCatalogHash({ ...input.basePack, exerciseCatalog: catalog } as KnowledgePack) };
  const manifestBase = {
    ...input.basePack.manifest,
    semanticVersion: input.semanticVersion,
    sourceRefs: [...input.basePack.manifest.sourceRefs, datasetSourceRef],
  };
  const packWithoutHash: KnowledgePack = {
    ...input.basePack,
    manifest: { ...manifestBase, contentHash: "", signature: { status: "reviewed_digest", algorithm: "fnv1a-32", value: "" } },
    exerciseCatalog: catalogWithHash,
  };
  const packHash = computePackHash(packWithoutHash);
  return {
    ...packWithoutHash,
    manifest: {
      ...manifestBase,
      contentHash: packHash,
      signature: { status: "reviewed_digest", algorithm: "fnv1a-32", value: packHash },
    },
  };
}

/** CLI：由裁定文件 + 数据集快照构建候选知识包（人工裁定批次的编译器）。
 *  输入是 buildCorePack 的基础包（非内置资产——内置资产就是本 CLI 的产物），
 *  输出直接替换随包发布的内置 JSON。 */
if (require.main === module) {
  const { buildCoreKnowledgePack } = require("./buildCorePack");
  const { validateKnowledgePack } = require("../../src/knowledge");
  const { writeFileSync, mkdirSync } = require("node:fs");
  const { join } = require("node:path");
  const basePack = buildCoreKnowledgePack();
  const records = parseDatasetRecords(readFileSync("data/external/exercises-dataset/data/exercises.json", "utf8"));
  const muscleMap = loadMuscleMap("tools/knowledge/candidate-adjudications/muscle-map.v1.json");
  const adjudications = loadAdjudications("tools/knowledge/candidate-adjudications/identity-adjudications.v1.json");
  const pack = buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications, semanticVersion: "1.1.0" });
  validateKnowledgePack(pack);
  const dir = join(process.cwd(), "src/knowledge/packs");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "core-fitness-knowledge.v1.json");
  writeFileSync(out, JSON.stringify(pack));
  console.log(`written ${out} (${pack.exerciseCatalog.variants.length} variants, hash ${pack.manifest.contentHash})`);
}
