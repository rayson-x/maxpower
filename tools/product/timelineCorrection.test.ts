import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { buildTimelineCorrectionRequest } from "../../src/product/timelineCorrection";
import { projectTimelineEvent } from "../../src/timeline";

test("Timeline 更正请求只通过 Facade 追加更正事实，保留原事实与审计链", async () => {
  let sequence = 0;
  const application = new LocalProductKernel(new InMemoryCoachLedger(), {
    now: () => "2026-08-09T10:30:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  const userId = "timeline-correction-user";
  await application.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId,
      actor: { kind: "user", id: userId },
      deviceId: "phone-1",
      occurredAt: "2026-08-09T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "strength", horizon: { startDate: "2026-08-09" } },
    mandate: { id: "mandate-1", mode: "manual", planChangeAuthorization: "always_ask" },
  });
  await application.recordTimelineFact({
    userId,
    idempotencyKey: "walk-original",
    fact: {
      kind: "activity",
      activityType: "散步",
      duration: { value: 20, unit: "minutes" },
      intensity: "easy",
      confidence: "confirmed",
    },
    envelope: {
      time: { startedAt: "2026-08-09T09:00:00.000+08:00", timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", deviceId: "scale-1", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "private",
      causalRefs: [],
      evidenceRefs: [],
      layer: "raw_observation",
    },
  });
  const before = await application.readDomainProjection({ userId });
  const original = projectTimelineEvent(before.timeline.current[0]!);

  const request = buildTimelineCorrectionRequest({
    entry: original,
    reason: "时长记少了",
    actor: { kind: "user", id: userId },
    recordedAt: "2026-08-09T10:30:00.000+08:00",
    fact: {
      kind: "activity",
      activityType: "散步",
      duration: { value: 35, unit: "minutes" },
      intensity: "easy",
      confidence: "confirmed",
    },
  });
  assert.equal(request.correction.correctsEventId, original.eventId);
  assert.equal(request.envelope.layer, "canonical_projection");
  assert.equal(request.envelope.privacyClass, "private");
  assert.deepEqual(request.envelope.causalRefs, [original.eventId]);
  assert.deepEqual(request.envelope.time, original.envelope?.time);
  assert.equal(request.envelope.provenance.deviceId, undefined);

  await application.correctTimelineFact({
    userId,
    idempotencyKey: "walk-corrected",
    ...request,
  });
  const after = await application.readDomainProjection({ userId });
  assert.equal(after.timeline.events.length, 2);
  assert.equal(after.timeline.events[0]?.lifecycle, "superseded");
  assert.equal(after.timeline.current.length, 1);
  assert.deepEqual(after.timeline.current[0]?.fact, request.fact);
  assert.equal(after.timeline.current[0]?.correctsEventId, original.eventId);

  const actions = await application.listActionLog(userId);
  const correctionAction = actions.find((event) => event.action === "timeline.corrected");
  assert.ok(correctionAction);
  assert.equal(correctionAction.intent, "timeline.correct");
  assert.equal(correctionAction.reversible, true);
});

test("Timeline 更正请求拒绝历史、无包络、跨类型和空原因，避免 UI 形成直接编辑路径", () => {
  const entry = {
    eventId: "activity-1",
    revision: 1,
    fact: {
      kind: "activity" as const,
      activityType: "骑行",
      confidence: "confirmed" as const,
    },
    envelope: {
      id: "entry-1",
      schemaVersion: 1 as const,
      factType: "activity" as const,
      time: { startedAt: "2026-08-09T09:00:00.000+08:00", timezoneOffsetMinutes: 480 },
      recordedAt: "2026-08-09T09:00:00.000+08:00",
      actor: { kind: "user" as const, id: "u1" },
      provenance: { origin: "manual" as const, recordingMethod: "manual_entry" as const, dataStatus: "available" as const, confidence: "confirmed" as const },
      privacyClass: "sensitive" as const,
      causalRefs: [],
      evidenceRefs: [],
      layer: "raw_observation" as const,
    },
    occurredAt: "2026-08-09T09:00:00.000+08:00",
    recordedAt: "2026-08-09T09:00:00.000+08:00",
    timezoneOffsetMinutes: 480,
    lifecycle: "active" as const,
  };
  const input = {
    entry,
    actor: { kind: "user" as const, id: "u1" },
    recordedAt: "2026-08-09T10:30:00.000+08:00",
    fact: { kind: "activity" as const, activityType: "骑行", confidence: "confirmed" as const },
  };
  assert.throws(() => buildTimelineCorrectionRequest({ ...input, reason: " " }), /correction_reason_required/);
  assert.throws(() => buildTimelineCorrectionRequest({
    ...input,
    reason: "记录类型错误",
    fact: { kind: "rest", confidence: "confirmed" },
  }), /timeline_correction_fact_kind_mismatch/);
  assert.throws(() => buildTimelineCorrectionRequest({
    ...input,
    reason: "历史记录不再可更正",
    entry: { ...entry, lifecycle: "superseded" },
  }), /timeline_correction_target_not_active/);
});
