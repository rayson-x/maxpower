import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import {
  createInstalledKnowledgePack,
  KnowledgePackRegistry,
  KnowledgePackValidationError,
  lintKnowledgePack,
} from "../../src/knowledge";

function createApp(ledger = new InMemoryCoachLedger()) {
  let sequence = 0;
  return {
    ledger,
    app: new CoachApplication(ledger, {
      now: () => "2026-08-08T12:00:00.000+08:00",
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    }),
  };
}

test("MaxPower 离线加载固定版本 KnowledgePack，并保持 Wiki 与 RulePack 分离", async () => {
  const { app } = createApp();
  const pack = app.inspectInstalledKnowledgePack();

  assert.equal(pack.manifest.id, "maxpower.core-fitness-knowledge");
  assert.match(pack.manifest.semanticVersion, /^1\./);
  assert.equal(pack.manifest.schemaVersion, 1);
  assert.match(pack.manifest.contentHash, /^fnv1a-/);
  assert.ok(pack.manifest.sourceRefs.length >= 4);
  assert.deepEqual(pack.classifications, [
    "EvidenceFact",
    "ProductPolicy",
    "Unknown",
    "SafetyBoundary",
    "CompetitorPrecedent",
  ]);
  assert.equal(pack.executableRulePacks.every((rule) => rule.reviewed && rule.contentHash), true);
  assert.equal(pack.wikiDocuments.every((wiki) => wiki.executable === false), true);
  assert.ok(pack.exerciseCatalog.count >= 200 && pack.exerciseCatalog.count <= 400);
  assert.equal(app.runtimeStatus().remoteProviderRequests, 0);
});

test("精确 ExerciseVariant 可离线搜索，身份维度不会合并历史", async () => {
  const { app } = createApp();
  const bench = app.searchExerciseCatalog({ query: "卧推" });
  assert.ok(bench.length >= 6);
  const barbell = bench.find((item) => item.equipment.loadMode === "barbell");
  const dumbbell = bench.find((item) => item.equipment.loadMode === "dumbbell");
  assert.ok(barbell && dumbbell);
  assert.notEqual(barbell.performanceIdentity, dumbbell.performanceIdentity);
  assert.equal(barbell.identity.cameraView, undefined);
  assert.ok(barbell.sourceRefs.length > 0);
  assert.equal(barbell.identity.loadMeasurement, "external_mass");
  assert.match(barbell.identity.equipmentConfiguration, /^barbell:/);
  assert.ok(barbell.identity.setup);
});

test("ExerciseConcept 旧名称可解析到稳定 ID，目录把概念、变式和可比上下文分层", () => {
  const pack = createInstalledKnowledgePack();
  const registry = new KnowledgePackRegistry(pack);
  assert.ok(pack.exerciseCatalog.concepts.length >= 30);
  const conceptId = registry.resolveExerciseConceptId("推胸");
  assert.equal(conceptId, "concept.bench_press");
  assert.equal(registry.exerciseConcept(conceptId!)?.license.media, "none_bundled");

  const context = registry.comparableExerciseContext(
    "bench_press.barbell.flat.standard.bilateral.full_rom",
    "bench_press.dumbbell.flat.standard.bilateral.full_rom",
  );
  assert.equal(context.comparable, "not_comparable");
  assert.equal(context.loadTransfer, "forbidden_cold_start");
  assert.deepEqual(context.observationContextExcluded, [
    "camera_view",
    "lens",
    "pose_model",
    "recognition_profile",
  ]);
});

test("硬约束平替返回 satisfied/deviated/cold-start，camera capability 只作 bonus", async () => {
  const { app } = createApp();
  const alternatives = app.resolveExerciseSubstitutions({
    originalExerciseId: "bench_press.barbell.flat.standard.bilateral.full_rom",
    goalPack: "hypertrophy",
    availableEquipment: ["bodyweight", "floor_space"],
    constraints: { noise: "quiet", space: "small", unavailableToday: [] },
  });

  assert.ok(alternatives.length > 0);
  assert.equal(alternatives[0]?.exercise.identity.movement, "push_up");
  assert.equal(alternatives[0]?.hardConstraintsSatisfied, true);
  assert.ok(alternatives[0]?.satisfiedFields.includes("movement_pattern"));
  assert.ok(alternatives[0]?.deviatedFields.includes("load_mode"));
  assert.equal(alternatives[0]?.coldStart.loadHistory, "unknown");
  assert.notEqual(alternatives[0]?.rankingReasons[0], "camera_capability");
  assert.equal(alternatives[0]?.ruleVersion.id, "maxpower.training.hypertrophy");
});

test("结构化器材状态不会把 unknown 当 available，busy/broken 候选被 hard filter", () => {
  const { app } = createApp();
  const alternatives = app.resolveExerciseSubstitutions({
    originalExerciseId: "bench_press.barbell.flat.standard.bilateral.full_rom",
    goalPack: "strength",
    availableEquipment: [],
    equipmentStates: [
      { id: "barbell", status: "busy" },
      { id: "weight_plates", status: "available" },
      { id: "dumbbell_pair", status: "unknown" },
    ],
    constraints: { noise: "quiet", space: "small", unavailableToday: [] },
  });
  assert.ok(alternatives.length > 0);
  assert.equal(alternatives.some((item) => item.requiredEquipment.includes("barbell")), false);
  assert.ok(alternatives.some((item) => item.eligibility === "needs_equipment_confirmation"));
  assert.equal(
    alternatives
      .filter((item) => item.eligibility === "needs_equipment_confirmation")
      .every((item) => item.deviatedFields.includes("equipment_unknown")),
    true,
  );
});

test("地点器材、训练中临时占用与显式长期偏好/锁定各自独立持久化", async () => {
  const { app } = createApp();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "location-user",
      actor: { kind: "user", id: "location-user" },
      deviceId: "device-1",
      occurredAt: "2026-08-08T11:59:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap-location-user",
    },
    profile: { id: "profile-location", trainingExperience: "intermediate", locale: "zh-CN" },
    goalContract: { id: "goal-location", primaryGoal: "strength", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "mandate-location", mode: "collaborative" },
  });
  const authorization = { kind: "local_user_presence" as const, verifiedAt: "2026-08-08T12:00:00.000+08:00", nonce: "location-presence" };
  const proposal = app.proposeEquipmentProfileChange({
    userId: "location-user",
    baseRevision: 0,
    source: "agent",
    profile: {
      id: "gym-a",
      name: "公司健身房",
      equipmentIds: ["barbell", "weight_plates", "bodyweight", "floor_space"],
      equipment: [
        { id: "barbell", status: "available" },
        { id: "weight_plates", status: "available", discreteLoads: [{ value: 1.25, unit: "kg" }] },
        { id: "bodyweight", status: "available" },
        { id: "floor_space", status: "available" },
      ],
    },
  });
  assert.equal(proposal.authority, "pending_local_user_confirmation");
  await app.commitEquipmentProfileChange({
    userId: "location-user",
    expectedRevision: 0,
    profile: proposal.profile,
    authorization,
    idempotencyKey: "commit-gym-a",
  });
  const alternatives = await app.resolveSubstitutionsAtLocation({
    userId: "location-user",
    equipmentProfileId: "gym-a",
    originalExerciseId: "bench_press.barbell.flat.standard.bilateral.full_rom",
    goalPack: "strength",
    temporaryStates: [{ equipmentId: "barbell", status: "busy", scope: "current_session", observedAt: "2026-08-08T12:00:00.000+08:00" }],
    constraints: { noise: "quiet", space: "small", unavailableToday: [] },
  });
  assert.equal(alternatives.some((item) => item.requiredEquipment.includes("barbell")), false);
  const afterTemporary = await app.readDomainProjection({ userId: "location-user" });
  assert.equal(afterTemporary.equipmentProfiles[0]?.value.equipment?.find((item) => item.id === "barbell")?.status, "available");

  await app.persistExerciseSelection({
    userId: "location-user",
    exerciseVariantId: "push_up.bodyweight.floor.standard.bilateral.full_rom",
    scope: "future_preference",
    authorization,
    idempotencyKey: "prefer-push-up",
  });
  await app.persistExerciseSelection({
    userId: "location-user",
    exerciseVariantId: "bench_press.barbell.flat.standard.bilateral.full_rom",
    scope: "lock",
    authorization,
    idempotencyKey: "lock-bench",
  });
  const facts = await app.readDomainProjection({ userId: "location-user" });
  assert.equal(facts.profile?.value.exercisePreferences?.[0]?.exerciseVariantId, "push_up.bodyweight.floor.standard.bilateral.full_rom");
  assert.equal(facts.mandate?.value.locks?.[0]?.value, "bench_press.barbell.flat.standard.bilateral.full_rom");
});

test("Catalog maturity 不授权运行能力；未安装 exact capability 时只能手工记录", async () => {
  const { app } = createApp();
  const capability = app.resolveMotionCapabilities({
    exerciseVariantId: "bench_press.barbell.flat.standard.bilateral.full_rom",
    cameraView: "side",
  });
  assert.deepEqual(capability, {
    countPhase: "unavailable",
    tempo: "unavailable",
    calibratedTrajectoryComparison: "unavailable",
    evidenceLinkedCue: "unavailable",
    fallback: "manual_recording",
    evidenceRefs: [],
  });
});

test("用户自定义动作跨重启保留，未知肌群、设备和 motion 能力不会被补造", async () => {
  const fixture = createApp();
  await fixture.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "device-1",
      occurredAt: "2026-08-08T11:59:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap-user-1",
    },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      modifiers: ["health"],
      horizon: { startDate: "2026-08-08" },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  const created = await fixture.app.createCustomExerciseVariant({
    userId: "user-1",
    name: "酒店毛巾划船",
    movement: "horizontal_pull",
    equipmentRequirement: { kind: "all", items: [{ kind: "item", id: "towel" }] },
    idempotencyKey: "custom-towel-row",
  });
  assert.deepEqual([...created.unknownFields].sort(), [
    "difficulty",
    "expected_muscles",
    "load_history",
    "motion_capability",
    "stimulus",
  ]);
  const unknownEquipment = await fixture.app.createCustomExerciseVariant({
    userId: "user-1",
    name: "自定义动作",
    movement: "mobility",
    idempotencyKey: "custom-unknown-equipment",
  });
  assert.ok(unknownEquipment.unknownFields.includes("equipment"));

  const restarted = createApp(fixture.ledger).app;
  const custom = await restarted.listCustomExerciseVariants("user-1");
  assert.equal(custom.find((item) => item.id === created.id)?.motionCapability, "unknown");

  const revised = await restarted.reviseCustomExerciseVariant({
    userId: "user-1",
    customExerciseId: created.id,
    expectedRevision: 1,
    patch: { name: "酒店毛巾划船（坐姿）", prescriptionMode: "bodyweight_reps" },
    idempotencyKey: "revise-custom-towel-row",
  });
  assert.equal(revised.revision, 2);
  assert.equal(revised.name, "酒店毛巾划船（坐姿）");
  await restarted.setCustomExerciseArchived({
    userId: "user-1",
    customExerciseId: created.id,
    expectedRevision: 2,
    archived: true,
    idempotencyKey: "archive-custom-towel-row",
  });
  assert.equal((await restarted.listCustomExerciseVariants("user-1")).some((item) => item.id === created.id), false);
  const archived = (await restarted.listCustomExerciseVariants("user-1", { includeArchived: true }))
    .find((item) => item.id === created.id)!;
  assert.equal(archived.status, "archived");
  assert.equal(archived.revision, 3);
  await restarted.setCustomExerciseArchived({
    userId: "user-1",
    customExerciseId: created.id,
    expectedRevision: 3,
    archived: false,
    idempotencyKey: "restore-custom-towel-row",
  });
  assert.equal((await restarted.listCustomExerciseVariants("user-1")).find((item) => item.id === created.id)?.status, "active");

  const metadata = restarted.proposeCustomExerciseMetadata({
    customExerciseId: created.id,
    proposed: { expectedMuscleIds: ["back"], substitutionIds: ["row"] },
  });
  assert.equal(metadata.authority, "non_authoritative_pending_user_confirmation");
  assert.equal(metadata.unlocksPlannerEligibility, false);
  assert.equal(metadata.unlocksMotionCapability, false);
});

test("计划动作可通过 typed Proposal 新增、重排、替换、删除并补偿撤销，当前动作被冻结", async () => {
  const fixture = createApp();
  await fixture.app.seedUserState({
    userId: "editor",
    profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "上肢训练",
      tasks: [
        { id: "bench", name: "卧推", exerciseVariantId: "bench_press.barbell.flat.standard.bilateral.full_rom", sets: 3, reps: "8", loadKg: 60 },
        { id: "row", name: "划船", sets: 3, reps: "10", loadKg: 40 },
      ],
    },
  });
  const session = await fixture.app.startSession({
    userId: "editor",
    context: { kind: "calendar", ref: "2026-08-08" },
  });
  let sequence = 0;
  const apply = async (change: Parameters<typeof fixture.app.proposePlanChange>[0]["change"]) => {
    const proposal = await fixture.app.proposePlanChange({
      sessionId: session.id,
      change,
      reason: `edit-${++sequence}`,
    });
    return fixture.app.actOnArtifact({
      sessionId: session.id,
      artifactId: proposal.artifact.id,
      action: "apply",
      actionToken: proposal.actionToken,
      idempotencyKey: `apply-edit-${sequence}`,
    });
  };

  await apply({ kind: "add_task", index: 1, task: { id: "pulldown", name: "高位下拉", sets: 3, reps: "10" } });
  await apply({ kind: "reorder_task", taskId: "pulldown", toIndex: 0 });
  await apply({
    kind: "replace_task",
    taskId: "pulldown",
    preserveStimulusIntent: true,
    scope: "this_session_only",
    replacement: { id: "pullup", name: "引体向上", sets: 3, reps: "6" },
  });
  const removed = await apply({ kind: "remove_task", taskId: "pullup" });
  assert.equal(removed.status, "applied");
  const afterRemove = await fixture.app.readUserProjection("editor");
  assert.deepEqual(afterRemove.plan.tasks.map((task) => task.id), ["bench", "row"]);
  if (removed.status !== "applied") throw new Error("Expected applied result");
  await fixture.app.undoPlanChange({
    sessionId: session.id,
    receiptArtifactId: removed.receipt.id,
    actionToken: removed.undoActionToken,
    idempotencyKey: "undo-remove-pullup",
  });
  assert.deepEqual((await fixture.app.readUserProjection("editor")).plan.tasks.map((task) => task.id), ["pullup", "bench", "row"]);

  await assert.rejects(
    () => fixture.app.proposePlanChange({
      sessionId: session.id,
      change: { kind: "remove_task", taskId: "bench" },
      reason: "不应修改正在执行的动作",
      protectedTaskIds: ["bench"],
    }),
    /invalid_change/,
  );
});

test("Pack loader 拒绝未知 schema、hash 篡改和目录跨层错误", () => {
  const installed = createInstalledKnowledgePack();
  assert.equal(createInstalledKnowledgePack().manifest.contentHash, installed.manifest.contentHash);
  assert.throws(
    () =>
      new KnowledgePackRegistry({
        ...installed,
        manifest: { ...installed.manifest, schemaVersion: 999 as never },
      }),
    (error: unknown) =>
      error instanceof KnowledgePackValidationError && error.code === "schema_incompatible",
  );
  assert.throws(
    () =>
      new KnowledgePackRegistry({
        ...installed,
        manifest: {
          ...installed.manifest,
          signature: { ...installed.manifest.signature, status: "unsigned" },
        },
      }),
    (error: unknown) =>
      error instanceof KnowledgePackValidationError && error.code === "signature_invalid",
  );
  assert.throws(
    () =>
      new KnowledgePackRegistry({
        ...installed,
        exerciseCatalog: {
          ...installed.exerciseCatalog,
          variants: [
            { ...installed.exerciseCatalog.variants[0]!, displayName: { zh: "被篡改", en: "tampered" } },
            ...installed.exerciseCatalog.variants.slice(1),
          ],
        },
      }),
    (error: unknown) =>
      error instanceof KnowledgePackValidationError && error.code === "hash_mismatch",
  );
  const duplicate = {
    ...installed,
    exerciseCatalog: {
      ...installed.exerciseCatalog,
      variants: [
        installed.exerciseCatalog.variants[0]!,
        ...installed.exerciseCatalog.variants,
      ],
    },
  };
  assert.ok(lintKnowledgePack(duplicate).some((error) => error.startsWith("duplicate:")));
});

test("Catalog、KnowledgePack 与 RulePack pins 独立保存并可按历史 hash replay", async () => {
  const fixture = createApp();
  const pins = fixture.app.getInstalledKnowledgeVersionPins();
  assert.notEqual(pins.knowledgePack.contentHash, pins.exerciseCatalog.contentHash);
  assert.ok(pins.rulePacks.length >= 2);
  const replayed = fixture.app.replayExerciseVariant(
    pins.exerciseCatalog,
    "bench_press.barbell.flat.standard.bilateral.full_rom",
  );
  assert.equal(replayed.identity.loadMode, "barbell");

  await fixture.app.seedUserState({
    userId: "user-1",
    profile: { goal: "strength", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "力量日",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "5", loadKg: 60 }],
    },
  });
  const session = await fixture.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });
  const proposal = await fixture.app.proposePlanChange({
    sessionId: session.id,
    change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5 },
    reason: "已完成可比表现",
  });
  assert.deepEqual(proposal.artifact.knowledgePins, pins);
  const applied = await fixture.app.actOnArtifact({
    sessionId: session.id,
    artifactId: proposal.artifact.id,
    action: "apply",
    actionToken: proposal.actionToken,
    idempotencyKey: "apply-pinned-proposal",
  });
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.receipt.knowledgePins, pins);
  assert.deepEqual((await fixture.app.readUserProjection("user-1")).plan.knowledgePins, pins);
});

test("平替 fixtures 覆盖深蹲、下拉与安静环境，不把 camera 变成 hard filter", () => {
  const { app } = createApp();
  const squat = app.resolveExerciseSubstitutions({
    originalExerciseId: "squat.barbell.shoulder_width.standard.bilateral.full_rom",
    goalPack: "strength",
    availableEquipment: ["bodyweight", "floor_space"],
    constraints: { noise: "quiet", space: "small", unavailableToday: [] },
  });
  assert.equal(squat[0]?.exercise.equipment.loadMode, "bodyweight");

  const pulldownOriginal = app.searchExerciseCatalog({ query: "高位下拉", loadModes: ["cable"] })[0]!;
  const pulldown = app.resolveExerciseSubstitutions({
    originalExerciseId: pulldownOriginal.id,
    goalPack: "hypertrophy",
    availableEquipment: ["resistance_band"],
    constraints: { noise: "quiet", space: "small", unavailableToday: [] },
  });
  assert.equal(pulldown[0]?.exercise.equipment.loadMode, "band");

  const stair = app.searchExerciseCatalog({ query: "爬楼", loadModes: ["cardio_machine"] })[0]!;
  const quiet = app.resolveExerciseSubstitutions({
    originalExerciseId: stair.id,
    goalPack: "conditioning",
    availableEquipment: [],
    constraints: { noise: "quiet", space: "small", unavailableToday: [] },
  });
  assert.equal(quiet[0]?.exercise.identity.movement, "walk");
  assert.notEqual(quiet[0]?.rankingReasons[0], "camera_capability");
});
