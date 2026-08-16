import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCatalogHash,
  computePackHash,
  createInstalledKnowledgePack,
  KnowledgePackRegistry,
  type KnowledgePack,
} from "../../src/knowledge";

/** 资格强制与两入口一致性：registry 接缝测试。 */

function packWithUnreviewedVariant(): { pack: KnowledgePack; unreviewedId: string; reviewedId: string } {
  const pack = createInstalledKnowledgePack();
  const reviewed = pack.exerciseCatalog.variants.find((variant) => variant.id.includes("bench_press"))!;
  const unreviewed = {
    ...reviewed,
    id: "bench_press.machine.unreviewed.test",
    displayName: { zh: "未审测试机", en: "Unreviewed test press" },
    expectedMuscleAssociation: { ...reviewed.expectedMuscleAssociation, exerciseVariantId: "bench_press.machine.unreviewed.test" },
    dataEligibility: { ...reviewed.dataEligibility, plannerEligible: false, recordable: false },
  };
  const mutated: KnowledgePack = {
    ...pack,
    exerciseCatalog: {
      ...pack.exerciseCatalog,
      variants: [...pack.exerciseCatalog.variants, unreviewed],
    },
  };
  // 构建期同款的 hash 重算：测试夹具走与构建一致的钉版通道。
  const catalogHash = computeCatalogHash(mutated);
  const withCatalogHash: KnowledgePack = {
    ...mutated,
    exerciseCatalog: { ...mutated.exerciseCatalog, contentHash: catalogHash },
  };
  const packHash = computePackHash(withCatalogHash);
  const finalPack: KnowledgePack = {
    ...withCatalogHash,
    manifest: {
      ...withCatalogHash.manifest,
      contentHash: packHash,
      signature: { ...withCatalogHash.manifest.signature, value: packHash },
    },
  };
  return { pack: finalPack, unreviewedId: unreviewed.id, reviewedId: reviewed.id };
}

test("recommendation 搜索过滤未审 variant；browse 不受限（执行者主权）", () => {
  const { pack, unreviewedId, reviewedId } = packWithUnreviewedVariant();
  const registry = new KnowledgePackRegistry(pack);
  const recommended = registry.search({ query: "卧推", purpose: "recommendation" });
  assert.ok(recommended.some((variant) => variant.id === reviewedId));
  assert.equal(recommended.some((variant) => variant.id === unreviewedId), false);
  const browsed = registry.search({ query: "卧推", purpose: "browse" });
  assert.ok(browsed.some((variant) => variant.id === unreviewedId), "手动浏览/选择永远不受限");
});

test("record 入口同步强制 recordable", () => {
  const { pack, unreviewedId } = packWithUnreviewedVariant();
  const registry = new KnowledgePackRegistry(pack);
  const recordable = registry.search({ query: "卧推", purpose: "record" });
  assert.equal(recordable.some((variant) => variant.id === unreviewedId), false);
});

test("替代排序器不返回未审候选", () => {
  const { pack, unreviewedId, reviewedId } = packWithUnreviewedVariant();
  const registry = new KnowledgePackRegistry(pack);
  const candidates = registry.resolveSubstitutions({
    originalExerciseId: reviewedId,
    goalPack: "hypertrophy",
    availableEquipment: ["barbell", "bench", "machine", "dumbbell"],
    constraints: { noise: "any", space: "large", unavailableToday: [] },
  });
  assert.equal(candidates.some((candidate) => candidate.exercise.id === unreviewedId), false);
});

test("同一资格边界在两类入口一致：推荐搜索与替代排序只见审校通过项", () => {
  const { pack, unreviewedId } = packWithUnreviewedVariant();
  const registry = new KnowledgePackRegistry(pack);
  const viaSearch = registry.search({ purpose: "recommendation" }).some((variant) => variant.id === unreviewedId);
  const original = pack.exerciseCatalog.variants.find((variant) => variant.id.includes("bench_press"))!;
  const viaSubstitution = registry.resolveSubstitutions({
    originalExerciseId: original.id,
    goalPack: "hypertrophy",
    availableEquipment: ["barbell", "bench", "machine", "dumbbell"],
    constraints: { noise: "any", space: "large", unavailableToday: [] },
  }).some((candidate) => candidate.exercise.id === unreviewedId);
  assert.equal(viaSearch, false);
  assert.equal(viaSubstitution, false);
});
