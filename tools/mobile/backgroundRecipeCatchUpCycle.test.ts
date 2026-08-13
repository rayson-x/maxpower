import assert from "node:assert/strict";
import test from "node:test";

import { runLocalRecipeCatchUpCycle } from "../../src/mobile/native/LocalRecipeCatchUpCycle";

test("后台 Health 刷新失败时仍生成保守的晨间 check-in，而不会让旧的提醒作业失修", async () => {
  const calls: string[] = [];
  const application = {
    async catchUpRecipes() { calls.push("recipes"); },
    async readDomainProjection() {
      calls.push("projection");
      return { profile: { id: "profile" }, permissions: { value: { health: "granted" as const } } };
    },
    async catchUpHealthEvidence() {
      calls.push("health");
      throw new Error("store_locked");
    },
    async triggerMorningRecoveryCheckIn() { calls.push("morning"); return { recoveryEvidence: "unavailable" as const }; },
  };
  const health = { platform: "health_connect" as const };

  await runLocalRecipeCatchUpCycle({
    application,
    health,
    userId: "local-primary-user",
    now: () => new Date(2026, 7, 9, 7, 30),
    metricTypes: ["sleep"],
    adapterSchemaVersion: "android-health-connect-v1",
  });

  assert.deepEqual(calls, ["recipes", "projection", "health", "morning", "recipes"]);
});

test("一次后台唤醒固定同一个本地时刻，不能跨过上午边界后漏掉已开始的晨间 check-in", async () => {
  const calls: string[] = [];
  let morningOccurredAt: string | undefined;
  let nowCalls = 0;
  const application = {
    async catchUpRecipes() { calls.push("recipes"); },
    async readDomainProjection() {
      return { profile: { id: "profile" }, permissions: { value: { health: "granted" as const } } };
    },
    async catchUpHealthEvidence() { calls.push("health"); },
    async triggerMorningRecoveryCheckIn(input: { occurredAt: string }) {
      morningOccurredAt = input.occurredAt;
      calls.push("morning");
      return { recoveryEvidence: "unavailable" as const };
    },
  };

  await runLocalRecipeCatchUpCycle({
    application,
    health: { platform: "health_connect" },
    userId: "local-primary-user",
    now: () => {
      nowCalls += 1;
      return nowCalls === 1 ? new Date(2026, 7, 9, 11, 59) : new Date(2026, 7, 9, 12, 0);
    },
    metricTypes: ["sleep"],
    adapterSchemaVersion: "android-health-connect-v1",
  });

  assert.deepEqual(calls, ["recipes", "health", "morning", "recipes"]);
  assert.equal(new Date(morningOccurredAt ?? "").getHours(), 11);
});

test("未授权健康数据时不读取平台数据，仍保留本地晨间自检路径", async () => {
  const calls: string[] = [];
  const application = {
    async catchUpRecipes() { calls.push("recipes"); },
    async readDomainProjection() {
      return { profile: { id: "profile" }, permissions: { value: { health: "denied" as const } } };
    },
    async catchUpHealthEvidence() { calls.push("health"); },
    async triggerMorningRecoveryCheckIn() { calls.push("morning"); return { recoveryEvidence: "unavailable" as const }; },
  };

  const result = await runLocalRecipeCatchUpCycle({
    application,
    health: { platform: "health_connect" },
    userId: "local-primary-user",
    now: () => new Date(2026, 7, 9, 8, 0),
    metricTypes: ["sleep", "hrv_rmssd"],
    adapterSchemaVersion: "android-health-connect-v1",
  });

  assert.deepEqual(calls, ["recipes", "morning", "recipes"]);
  assert.deepEqual(result, { healthRefresh: "skipped", morningCheckIn: "scheduled" });
});

test("后台 Health 页数预算无效时回退到小的固定上限，而不是把 NaN 传入导入循环", async () => {
  let receivedPageBudget: number | undefined;
  const application = {
    async catchUpRecipes() {},
    async readDomainProjection() {
      return { profile: undefined, permissions: { value: { health: "granted" as const } } };
    },
    async catchUpHealthEvidence(input: { maxPages: number }) { receivedPageBudget = input.maxPages; },
    async triggerMorningRecoveryCheckIn() { throw new Error("should_not_run_without_profile"); },
  };

  await runLocalRecipeCatchUpCycle({
    application,
    health: { platform: "health_connect" },
    userId: "local-primary-user",
    now: () => new Date(2026, 7, 9, 8, 0),
    metricTypes: ["sleep"],
    adapterSchemaVersion: "android-health-connect-v1",
    maxHealthPages: Number.NaN,
  });

  assert.equal(receivedPageBudget, 4);
});
