import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledKnowledgePack } from "../../src/knowledge/installedPack";
import { loadKnowledgePack } from "../../src/knowledge/packLoader";
import type { KnowledgePack } from "../../src/knowledge/model";

const builtinJson = () => JSON.stringify(createInstalledKnowledgePack());

test("无数据包时使用内置包", () => {
  const load = loadKnowledgePack(null);
  assert.equal(load.source, "builtin");
  assert.equal(load.rejectionReason, undefined);
  assert.equal(load.pack.manifest.id, "maxpower.core-fitness-knowledge");
});

test("合法数据包覆盖内置包", () => {
  const load = loadKnowledgePack(builtinJson());
  assert.equal(load.source, "installed");
  assert.equal(load.pack.exerciseCatalog.variants.length, 379);
});

test("签名不符的数据包回退内置包并记录原因", () => {
  const pack = createInstalledKnowledgePack() as KnowledgePack;
  const tampered = {
    ...pack,
    manifest: {
      ...pack.manifest,
      signature: { status: "reviewed_digest" as const, algorithm: "fnv1a-32", value: "fnv1a-deadbeef" },
    },
  };
  const load = loadKnowledgePack(JSON.stringify(tampered));
  assert.equal(load.source, "builtin");
  assert.match(load.rejectionReason ?? "", /signature_invalid/);
});

test("内容被篡改（hash 不符）的数据包回退内置包", () => {
  const pack = JSON.parse(builtinJson()) as KnowledgePack;
  pack.manifest.scope = [...pack.manifest.scope, "smuggled_scope"];
  const load = loadKnowledgePack(JSON.stringify(pack));
  assert.equal(load.source, "builtin");
  assert.match(load.rejectionReason ?? "", /hash_mismatch|catalog_invalid/);
});

test("schema 不兼容的数据包回退内置包", () => {
  const pack = JSON.parse(builtinJson()) as KnowledgePack;
  (pack.manifest as { schemaVersion: number }).schemaVersion = 999;
  const load = loadKnowledgePack(JSON.stringify(pack));
  assert.equal(load.source, "builtin");
  assert.match(load.rejectionReason ?? "", /schema_incompatible|hash_mismatch/);
});

test("无法解析的数据包回退内置包", () => {
  const load = loadKnowledgePack("{not json");
  assert.equal(load.source, "builtin");
  assert.equal(load.rejectionReason, "parse_error");
});

test("内置包与生成器输出一致（单一事实来源）", () => {
  const pack = createInstalledKnowledgePack();
  assert.equal(pack.manifest.contentHash, pack.manifest.signature.value);
  assert.equal(pack.manifest.schemaVersion, 1);
});
