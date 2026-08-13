import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { stableHash } from "../../src/coach/stable";

function fixture() {
  return fixtureWithLedger().app;
}

function fixtureWithLedger() {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  return {
    ledger,
    app: new CoachApplication(ledger, {
      now: () => "2026-08-08T12:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    }),
  };
}

async function bootstrap(app: CoachApplication, userId: string) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId, actor: { kind: "user", id: userId }, deviceId: "phone-1", occurredAt: "2026-08-08T12:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: `bootstrap-${userId}` },
    profile: { id: `profile-${userId}`, trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: `goal-${userId}`, primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08", endDate: "2026-12-08" } },
    mandate: { id: `mandate-${userId}`, mode: "collaborative" },
  });
}

test("便携导出按用户隔离、默认排除凭据/Token/ToolAudit/媒体，并可通过 dry-run 校验", async () => {
  const app = fixture();
  await bootstrap(app, "u1");
  await bootstrap(app, "u2");
  const bundle = await app.exportPortableData("u1");
  assert.equal(bundle.manifest.userId, "u1");
  assert.equal(bundle.payload.domainEvents.length, 3);
  assert.ok(bundle.manifest.excludes.includes("credentials"));
  assert.ok(bundle.manifest.excludes.includes("media_bytes"));
  assert.equal("actionTokens" in bundle.payload, false);
  assert.equal("toolAudit" in bundle.payload, false);
  assert.equal("outbox" in bundle.payload, false);
  assert.equal(app.inspectPortableRestore(bundle).status, "ready");
  const exportAction = (await app.listActionLog("u1")).find((event) => event.intent === "portable.export");
  assert.deepEqual(exportAction?.after, {
    contentHash: bundle.manifest.contentHash,
    eventCount: bundle.manifest.counts.domainEvents,
    mediaAvailability: "excluded",
  });
  assert.doesNotMatch(JSON.stringify(exportAction), /credential|media_bytes/);
});

test("便携包只导出经过直接身份清理的会话文本副本", async () => {
  const { app, ledger } = fixtureWithLedger();
  await bootstrap(app, "u1");
  const snapshot = await ledger.read();
  await ledger.replace({
    ...snapshot,
    workingMemory: [{
      id: "memory-u1",
      userId: "u1",
      kind: "preference",
      content: "请联系 zhang@example.com 或 13812345678",
      evidenceRefs: [],
      provenance: { actor: "user" },
      authority: "non_authoritative",
      confidence: 0.8,
      version: 1,
      sensitivity: "private",
      pinned: true,
      createdAt: "2026-08-08T12:00:00.000+08:00",
      updatedAt: "2026-08-08T12:00:00.000+08:00",
    }],
    actionEvents: snapshot.actionEvents.map((event, index) => index === 0
      ? { ...event, before: { note: "导出联系 ops@example.com，地址：上海市审计路 2 号" } }
      : event),
  });
  const session = await app.startSession({ userId: "u1", context: { kind: "today", ref: "2026-08-08" } });
  await app.sendCoachTurn({ sessionId: session.id, text: "我是张三，邮箱 zhang@example.com，电话 13812345678，住址：上海市测试路 1 号" });

  const bundle = await app.exportPortableData("u1");
  assert.doesNotMatch(JSON.stringify(bundle), /zhang@example\.com|13812345678|上海市测试路|ops@example\.com|上海市审计路/);
  assert.match(bundle.payload.messages.find((message) => message.role === "user")?.content ?? "", /我是张三/);
});

test("篡改导出内容或跨用户记录会被恢复预检拒绝", async () => {
  const app = fixture();
  await bootstrap(app, "u1");
  const bundle = await app.exportPortableData("u1");
  const tampered = structuredClone(bundle);
  tampered.payload.domainEvents = [];
  assert.ok(app.inspectPortableRestore(tampered).errors.includes("content_hash_mismatch"));

  const crossUser = structuredClone(bundle);
  crossUser.payload.sessions = [{
    id: "session-x", userId: "u2", status: "completed", context: { kind: "today", ref: "2026-08-08" },
    revision: 1, contextRefs: [], messageIds: [], runIds: [], toolCallIds: [], artifactIds: [], presentationIds: [], pendingHumanActionIds: [], createdAt: "2026-08-08T12:00:00.000+08:00", updatedAt: "2026-08-08T12:00:00.000+08:00",
  }];
  crossUser.manifest.contentHash = "tampered";
  assert.ok(app.inspectPortableRestore(crossUser).errors.includes("cross_user_payload"));
});

test("便携包会先计划并在 staging 重放后原子恢复；empty profile 不覆盖已有事实", async () => {
  const source = fixture();
  await bootstrap(source, "u1");
  const bundle = await source.exportPortableData("u1");

  const { app: clean, ledger: cleanLedger } = fixtureWithLedger();
  const plan = await clean.planPortableRestore({ bundle, mode: "empty_profile" });
  assert.equal(plan.canRestore, true);
  assert.equal(plan.mediaAvailability, "excluded");
  const receipt = await clean.restorePortableData({ bundle, mode: "empty_profile" });
  assert.equal(receipt.importedEventCount, 3);
  const restored = await cleanLedger.read();
  assert.equal(restored.domainEvents.filter((event) => event.userId === "u1").length, 3);
  assert.ok(restored.actionEvents.some((event) => event.id === receipt.actionEventId));
  assert.equal((await clean.readDomainProjection({ userId: "u1" })).profile?.value.trainingExperience, "beginner");

  const blocked = await clean.planPortableRestore({ bundle, mode: "empty_profile" });
  assert.equal(blocked.canRestore, false);
  assert.ok(blocked.conflicts.includes("target_profile_not_empty"));

  const merge = await clean.restorePortableData({ bundle, mode: "merge" });
  assert.equal(merge.importedEventCount, 0);
});

test("Ledger 拒绝把 restore staging 覆盖到并发写入后的快照", async () => {
  const { app, ledger } = fixtureWithLedger();
  const before = await ledger.read();
  await bootstrap(app, "u1");
  await assert.rejects(
    ledger.swapRestoredSnapshot({ expectedSnapshotHash: stableHash(before), nextSnapshot: before }),
    /stale_snapshot/,
  );
  assert.equal((await ledger.read()).domainEvents.length, 3);
});
