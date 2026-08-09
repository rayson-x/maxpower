import assert from "node:assert/strict";
import test from "node:test";

import {
  nutritionDraftDisclosure,
  nutritionDraftRequiresUserEdit,
} from "../../src/mobile/ui/nutritionObservationDraftModel";
import { ArtifactCardRegistry } from "../../src/coach/cards";

test("照片估算卡披露实际 Provider、将发送的输入和本地媒体策略，不泄露媒体路径", () => {
  const disclosure = nutritionDraftDisclosure({
    id: "draft-1",
    schemaVersion: 1,
    observation: { id: "meal-1", occurredAt: "2026-08-08T12:00:00.000+08:00", mode: "estimated", description: "鸡肉饭", provenance: "llm_estimate" },
    estimates: [],
    provider: { id: "nutrition-vision", modelVersion: "2026-08", processingScope: "photo" },
    mediaConsent: "provider_authorized",
    inputMediaRefs: ["local-media-secret-1", "local-media-secret-2"],
    status: "draft",
  });

  assert.equal(disclosure.remoteProcessing, true);
  assert.equal(disclosure.providerLabel, "nutrition-vision · 2026-08");
  assert.deepEqual(disclosure.sentInputs, ["餐食文字", "2 张食物照片"]);
  assert.match(disclosure.mediaPolicy, /本机原图/);
  assert.doesNotMatch(JSON.stringify(disclosure), /local-media-secret/);
});

test("本机照片草稿不宣称已经上传，并要求用户补充后才可确认", () => {
  const draft = {
    id: "draft-2",
    schemaVersion: 1 as const,
    observation: { id: "meal-2", occurredAt: "2026-08-08T12:00:00.000+08:00", mode: "simplified" as const, provenance: "manual" as const },
    estimates: [],
    mediaConsent: "local_only" as const,
    inputMediaRefs: ["local-media-1"],
    clarificationRequired: true,
    status: "draft" as const,
  };
  const disclosure = nutritionDraftDisclosure(draft);
  assert.equal(disclosure.remoteProcessing, false);
  assert.deepEqual(disclosure.sentInputs, []);
  assert.match(disclosure.mediaPolicy, /不会上传/);
  assert.equal(nutritionDraftRequiresUserEdit(draft), true);
});

test("营养草稿卡只能进入审核，不能从卡片直接写入 Timeline", () => {
  const card = new ArtifactCardRegistry().render({
    id: "nutrition-draft-card",
    kind: "nutrition_observation_draft",
    userId: "u1",
    idempotencyKey: "draft-card",
    schemaVersion: 1,
    renderVersion: 1,
    createdAt: "2026-08-08T12:00:00.000+08:00",
    contextRefs: [],
    evidenceRefs: [],
    missingness: [],
    capabilityBoundary: ["估算需要用户确认"],
    hash: "draft-hash",
    knowledgePins: { knowledgePack: { id: "knowledge", semanticVersion: "1", schemaVersion: 1, contentHash: "hash" }, exerciseCatalog: { id: "exercise", semanticVersion: "1", schemaVersion: 1, contentHash: "hash" }, rulePacks: [] },
    draft: {
      id: "draft-card",
      schemaVersion: 1,
      observation: { id: "meal-card", occurredAt: "2026-08-08T12:00:00.000+08:00", mode: "estimated", provenance: "llm_estimate" },
      estimates: [],
      clarificationRequired: true,
      status: "draft",
    },
  }, "awaiting_user");
  assert.deepEqual(card.actions.map((action) => action.id), ["review", "reject"]);
  assert.equal(card.actions[0]?.label, "补充后确认");
});
