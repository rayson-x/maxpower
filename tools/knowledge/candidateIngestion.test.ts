import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInstalledKnowledgePack, validateKnowledgePack } from "../../src/knowledge";
import type { KnowledgePack } from "../../src/knowledge";
import { buildCoreKnowledgePack } from "./buildCorePack";
import {
  buildCandidatePack,
  CandidatePipelineError,
  loadAdjudications,
  loadMuscleMap,
  parseDatasetRecords,
} from "../knowledge/candidateIngestion";

const DATASET_PATH = "data/external/exercises-dataset/data/exercises.json";
const MUSCLE_MAP_PATH = "tools/knowledge/candidate-adjudications/muscle-map.v1.json";
const ADJUDICATIONS_PATH = "tools/knowledge/candidate-adjudications/identity-adjudications.v1.json";

function loadFixtures() {
  return {
    // 候选管线的输入是未应用候选的基础包（内置资产已含首批候选）。
    basePack: buildCoreKnowledgePack(),
    records: parseDatasetRecords(readFileSync(DATASET_PATH, "utf8")),
    muscleMap: loadMuscleMap(MUSCLE_MAP_PATH),
    adjudications: loadAdjudications(ADJUDICATIONS_PATH),
  };
}

test("一条裁定记录走通：数据集记录 → 裁定文件 → 构建进包，钉版与资格正确", () => {
  const { basePack, records, muscleMap, adjudications } = loadFixtures();
  const pack = buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications, semanticVersion: "1.2.0" });
  validateKnowledgePack(pack);
  const variant = pack.exerciseCatalog.variants.find((candidate) => candidate.id === "bench_press.machine.inner.seated.bilateral.full_rom");
  assert.ok(variant);
  assert.deepEqual(variant!.sourceRefs, ["source.exercise.exercises-dataset-hasaneyldrm"]);
  assert.equal(variant!.dataEligibility.plannerEligible, false);
  assert.equal(variant!.dataEligibility.recordable, false);
  assert.equal(variant!.dataEligibility.expectedMuscleMetadata, "unknown");
  assert.equal(variant!.expectedMuscleAssociation.status, "unknown");
  assert.equal(variant!.expectedMuscleAssociation.disclaimer, "expected_participation_not_observed_activation");
  assert.deepEqual(variant!.stimulusContractIds, ["stimulus.bench_press.v1"]);
  assert.equal(variant!.conceptId, "concept.bench_press");
  assert.equal(pack.manifest.semanticVersion, "1.2.0");
  assert.ok(pack.manifest.sourceRefs.some((source) => source.id === "source.exercise.exercises-dataset-hasaneyldrm" && source.uri.includes("7455efae")));
  // 既有内容不回归：首批 6 个新 variant 全部进包
  assert.equal(pack.exerciseCatalog.variants.length, basePack.exerciseCatalog.variants.length + 6);
  for (const id of [
    "bench_press.machine.inner.seated.bilateral.full_rom",
    "deadlift.barbell.standard.standard.bilateral.full_rom.trap_bar",
    "pull_up.machine.hanging.pronated.bilateral.full_rom.assisted",
    "pull_up.machine.hanging.supinated.bilateral.full_rom.assisted",
    "bench_press.machine.flat.wide.bilateral.full_rom",
    "bench_press.machine.decline.wide.bilateral.full_rom",
  ]) {
    assert.ok(pack.exerciseCatalog.variants.some((candidate) => candidate.id === id), `缺少 ${id}`);
  }
  // 首批 alias 归并生效：smith 机卧推可检索到 machine 桶 variant
  const machineFlat = pack.exerciseCatalog.variants.find((candidate) => candidate.id === "bench_press.machine.flat.standard.bilateral.full_rom");
  assert.ok(machineFlat!.aliases.includes("smith bench press"));
});

test("媒体字段在适配器入口结构性剥离，不存在于任何中间产物", () => {
  const raw = readFileSync(DATASET_PATH, "utf8");
  assert.ok(raw.includes("gif_url"), "原始数据集确实带媒体字段");
  const records = parseDatasetRecords(raw);
  assert.ok(records.length > 1000);
  assert.equal(JSON.stringify(records).includes("gif_url"), false);
  assert.equal(JSON.stringify(records).includes("media_id"), false);
  assert.equal(JSON.stringify(records).includes('"image"'), false);
});

test("未映射肌群词导致构建失败并点名记录", () => {
  const { basePack, records, adjudications } = loadFixtures();
  assert.throws(
    () => buildCandidatePack({ basePack, datasetRecords: records, muscleMap: { version: 1, ontology: [], map: {} }, adjudications, semanticVersion: "1.2.0" }),
    (cause: unknown) => cause instanceof CandidatePipelineError && cause.code === "unmapped_muscle_term" && cause.recordIds.length > 0,
  );
});

test("范围内未裁定记录导致构建失败并点名", () => {
  const { basePack, records, muscleMap, adjudications } = loadFixtures();
  const broken = { ...adjudications, scope: ["1301", "9999"] };
  assert.throws(
    () => buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications: broken, semanticVersion: "1.2.0" }),
    (cause: unknown) => cause instanceof CandidatePipelineError && cause.code === "unadjudicated_record" && cause.recordIds.includes("9999"),
  );
});

test("新 variant 缺刺激合约归属导致构建失败", () => {
  const { basePack, records, muscleMap, adjudications } = loadFixtures();
  const broken = {
    ...adjudications,
    records: adjudications.records.map((record) => ({ ...record, stimulusContractId: "stimulus.nonexistent.v9" })),
  };
  assert.throws(
    () => buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications: broken, semanticVersion: "1.2.0" }),
    (cause: unknown) => cause instanceof CandidatePipelineError && cause.code === "missing_stimulus_contract",
  );
});

test("deferred 与 alias_of 不产生进包 variant", () => {
  const { basePack, records, muscleMap, adjudications } = loadFixtures();
  const onlyDeferred = {
    ...adjudications,
    scope: ["1301"],
    records: [{ datasetId: "1301", decision: "deferred" as const }],
  };
  const pack = buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications: onlyDeferred, semanticVersion: "1.2.0" });
  validateKnowledgePack(pack);
  assert.equal(pack.exerciseCatalog.variants.length, basePack.exerciseCatalog.variants.length);
});

test("alias_of 把数据集名称并入目标 variant 检索别名（去重），目标缺失则构建失败", () => {
  const { basePack, records, muscleMap, adjudications } = loadFixtures();
  const target = "bench_press.barbell.flat.standard.bilateral.full_rom";
  const aliasOnly = {
    ...adjudications,
    scope: ["0025"],
    records: [{ datasetId: "0025", decision: "alias_of" as const, targetVariantId: target, alias: "barbell bench press" }],
  };
  const pack = buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications: aliasOnly, semanticVersion: "1.2.0" });
  validateKnowledgePack(pack);
  assert.equal(pack.exerciseCatalog.variants.length, basePack.exerciseCatalog.variants.length, "alias 不新增 variant");
  const patched = pack.exerciseCatalog.variants.find((variant) => variant.id === target);
  assert.ok(patched!.aliases.includes("barbell bench press"));
  const baseVariant = basePack.exerciseCatalog.variants.find((variant) => variant.id === target);
  assert.equal(baseVariant!.aliases.includes("barbell bench press"), false, "既有包对象不被原地改写");

  const missingTarget = {
    ...adjudications,
    scope: ["0025"],
    records: [{ datasetId: "0025", decision: "alias_of" as const, targetVariantId: "variant.nonexistent", alias: "x" }],
  };
  assert.throws(
    () => buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications: missingTarget, semanticVersion: "1.2.0" }),
    (cause: unknown) => cause instanceof CandidatePipelineError && cause.code === "alias_target_missing" && cause.recordIds[0]!.includes("0025"),
  );
});

test("构建产物经 packLoader 校验通道安装；损坏时回退内置包", async () => {
  const { loadKnowledgePack } = await import("../../src/knowledge/packLoader");
  const { basePack, records, muscleMap, adjudications } = loadFixtures();
  const pack = buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications, semanticVersion: "1.2.0" });
  const installed = loadKnowledgePack(JSON.stringify(pack));
  assert.equal(installed.source, "installed");
  assert.equal(installed.pack.manifest.semanticVersion, "1.2.0");
  // 旧版本可回退：内置包自身经同一通道仍然可装。
  const rolledBack = loadKnowledgePack(JSON.stringify(basePack));
  assert.equal(rolledBack.source, "installed");
  assert.equal(rolledBack.pack.exerciseCatalog.variants.length, basePack.exerciseCatalog.variants.length);
  // 损坏（篡改内容导致 hash 不符）回退内置。
  const tampered = JSON.parse(JSON.stringify(pack)) as KnowledgePack;
  tampered.exerciseCatalog.variants = [...tampered.exerciseCatalog.variants.slice(1)];
  const rejected = loadKnowledgePack(JSON.stringify(tampered));
  assert.equal(rejected.source, "builtin");
});

test("随包内置资产与「基础包 + 首批裁定」管线输出逐字节一致（可复现）", () => {
  const { basePack, records, muscleMap, adjudications } = loadFixtures();
  const pack = buildCandidatePack({ basePack, datasetRecords: records, muscleMap, adjudications, semanticVersion: "1.2.0" });
  const bundled = createInstalledKnowledgePack();
  assert.equal(JSON.stringify(bundled), JSON.stringify(pack), "内置资产必须由同一管线复现");
});
