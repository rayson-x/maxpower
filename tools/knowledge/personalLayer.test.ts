import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  InMemoryPersonalKnowledgeStore,
  PersonalKnowledgeConflictError,
  PersonalKnowledgeLayer,
  PersonalKnowledgeValidationError,
} from "../../src/knowledge/personalLayer";

const T0 = "2026-08-08T08:00:00.000Z";
const T1 = "2026-08-09T08:00:00.000Z";

function layer() {
  let sequence = 0;
  return new PersonalKnowledgeLayer(new InMemoryPersonalKnowledgeStore(), {
    now: () => T1,
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  });
}

test("观测校准值与用户偏好可写入、读取、supersede、forget", async () => {
  const store = layer();
  const calibration = await store.put({
    userId: "user-1",
    key: "maintenance_calories",
    kind: "observed_calibration",
    value: { kcalPerDay: 2400 },
    evidenceWindow: { from: T0, to: T1 },
    sourceFactRefs: ["timeline:ev-1", "timeline:ev-2"],
  });
  assert.equal(calibration.version, 1);

  const preference = await store.put({
    userId: "user-1",
    key: "tuesday_time_cap",
    kind: "user_preference",
    value: { minutes: 30 },
    confirmedAt: T0,
    locked: false,
  });

  const v2 = await store.supersede({
    userId: "user-1",
    id: calibration.id,
    expectedVersion: 1,
    next: {
      kind: "observed_calibration",
      value: { kcalPerDay: 2350 },
      evidenceWindow: { from: T0, to: T1 },
      sourceFactRefs: ["timeline:ev-1", "timeline:ev-2", "timeline:ev-3"],
    },
  });
  assert.equal(v2.version, 2);
  assert.equal((await store.get("user-1", calibration.id))?.value?.kcalPerDay, 2350);

  await store.forget({ userId: "user-1", id: preference.id, expectedVersion: 1 });
  assert.equal((await store.get("user-1", preference.id))?.forgottenAt, T1);
});

test("CAS 冲突抛 typed error", async () => {
  const store = layer();
  const entry = await store.put({
    userId: "user-1",
    key: "pref",
    kind: "user_preference",
    value: { note: "a" },
    confirmedAt: T0,
    locked: false,
  });
  await assert.rejects(
    store.forget({ userId: "user-1", id: entry.id, expectedVersion: 99 }),
    (error) => error instanceof PersonalKnowledgeConflictError,
  );
});

test("system_inference 必须带置信度与证据窗；unknown 禁止携带数值", async () => {
  const store = layer();
  await assert.rejects(
    store.put({
      userId: "user-1",
      key: "deadlift_recovery",
      kind: "system_inference",
      value: { slowerThanBaseline: true },
      confidence: Number.NaN,
      evidenceWindow: { from: T0, to: T1 },
      sourceFactRefs: ["timeline:ev-1"],
    }),
    (error) => error instanceof PersonalKnowledgeValidationError,
  );
  await assert.rejects(
    store.put({
      userId: "user-1",
      key: "low_carb_adherence",
      kind: "unknown",
      value: { guessed: true },
    } as never),
    (error) => error instanceof PersonalKnowledgeValidationError,
  );
  const unknown = await store.put({ userId: "user-1", key: "low_carb_adherence", kind: "unknown" });
  assert.equal(unknown.status, "active");
});

test("correction 使引用被更正事实的条目失效", async () => {
  const store = layer();
  const entry = await store.put({
    userId: "user-1",
    key: "maintenance_calories",
    kind: "observed_calibration",
    value: { kcalPerDay: 2400 },
    evidenceWindow: { from: T0, to: T1 },
    sourceFactRefs: ["timeline:ev-1"],
  });
  const other = await store.put({
    userId: "user-1",
    key: "pref",
    kind: "user_preference",
    value: { minutes: 30 },
    confirmedAt: T0,
    locked: false,
  });
  const invalidated = await store.invalidateEntriesCiting("user-1", ["timeline:ev-1"]);
  assert.deepEqual(invalidated, [entry.id]);
  assert.equal((await store.get("user-1", entry.id))?.status, "invalidated");
  assert.equal((await store.get("user-1", other.id))?.status, "active");
});

test("引擎不直接消费个人知识层（值只经 facade 以显式入参传递）", () => {
  // plan-pipeline-observability ticket 05 起：facade（createCoachApplication）是允许的接线点；
  // 引擎（规则包/营养/恢复/planning）仍不得直接 import，只能消费 facade 传入的显式值。
  const forbiddenConsumers = ["src/training-rules", "src/nutrition", "src/recovery", "src/planning"];
  for (const dir of forbiddenConsumers) {
    for (const file of readdirSync(join(process.cwd(), dir))) {
      if (!file.endsWith(".ts")) continue;
      const content = readFileSync(join(process.cwd(), dir, file), "utf8");
      assert.ok(
        !content.includes("personalLayer"),
        `${dir}/${file} 不应引用 personalLayer（引擎只消费 facade 传入的显式值）`,
      );
    }
  }
  const facade = readFileSync(join(process.cwd(), "src/coach/createCoachApplication.ts"), "utf8");
  assert.ok(
    facade.includes("personalKnowledge"),
    "facade 应支持 personalKnowledge 依赖注入（ticket 05 接线点）",
  );
});
