import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { coachDrawerAvailableForRoute } from "../../src/product";

function fixture() {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T08:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  return app;
}

test("没有档案时 Today 仍可进入仅记录模式，而不是捏造训练任务", async () => {
  const app = fixture();
  const screen = await app.readProductProjection({
    userId: "new-user",
    date: "2026-08-08",
    timezoneOffsetMinutes: 480,
    calendarMode: "month",
    calendarAnchorDate: "2026-08-08",
  });

  assert.equal(screen.today.state, "record_first");
  assert.equal(screen.today.action, "record_activity");
  assert.equal(screen.today.session, undefined);
  assert.equal(screen.calendar.dates.length, 31);
});

test("所有产品页面共享同一 Coach 抽屉", () => {
  assert.equal(coachDrawerAvailableForRoute("profile"), true);
  assert.equal(coachDrawerAvailableForRoute("today"), true);
  assert.equal(coachDrawerAvailableForRoute("calendar"), true);
  assert.equal(coachDrawerAvailableForRoute("plan"), true);
  assert.equal(coachDrawerAvailableForRoute("workout"), true);
});

test("计划调整授权从正式档案投影读取，并可由本地设置持续修改", async () => {
  const app = fixture();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "settings-user", actor: { kind: "user", id: "settings-user" }, deviceId: "phone", occurredAt: "2026-08-08T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "settings-bootstrap" },
    profile: { id: "settings-profile", locale: "zh-CN" },
    mandate: { id: "settings-mandate", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  let screen = await app.readProductProjection({ userId: "settings-user", date: "2026-08-08", timezoneOffsetMinutes: 480, calendarMode: "month", calendarAnchorDate: "2026-08-08" });
  assert.equal(screen.profile.planAuthorization?.mandate.planChangeAuthorization, "always_ask");

  await app.updateCoachingMandateFromSettings({
    userId: "settings-user",
    mandateId: "settings-mandate",
    expectedRevision: screen.profile.planAuthorization!.revision,
    mandate: { ...screen.profile.planAuthorization!.mandate, planChangeAuthorization: "allow_similar_small" },
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-08T08:01:00.000+08:00", nonce: "settings-user-presence" },
    idempotencyKey: "settings-update-plan-authorization",
  });
  screen = await app.readProductProjection({ userId: "settings-user", date: "2026-08-08", timezoneOffsetMinutes: 480, calendarMode: "month", calendarAnchorDate: "2026-08-08" });
  assert.equal(screen.profile.planAuthorization?.mandate.planChangeAuthorization, "allow_similar_small");
  assert.equal(screen.profile.planAuthorization?.revision, 2);
});
