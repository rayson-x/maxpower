import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfileData } from "../../src/coach/domain";
import { describeCycleRange } from "../../src/mobile/ui-kit/calendarModel";
import { deriveStrengthTrendProjection } from "../../src/product/coachProductProjection";

test("计划周期文案同时交代开始进度和距结束天数", () => {
  assert.equal(
    describeCycleRange("2026-08-10", { startDate: "2026-08-01", endDate: "2026-09-01" }, "zh"),
    "已开始 10 天 · 距结束 22 天",
  );
  assert.equal(
    describeCycleRange("2026-08-10", { startDate: "2026-08-15", endDate: "2026-09-15" }, "zh"),
    "距计划开始 5 天 · 距结束 36 天",
  );
});

test("力量趋势把三大项档案基线作为可见起点，不伪造后续变化", () => {
  const profile: UserProfileData = {
    id: "profile-1",
    locale: "zh-CN",
    strengthBaseline: {
      squat: { value: 120, unit: "kg" },
      benchPress: { value: 82.5, unit: "kg" },
      deadlift: { value: 150, unit: "kg" },
      measuredAt: "2026-08-01T12:00:00.000Z",
      source: "user_confirmed",
    },
  };
  const result = deriveStrengthTrendProjection({
    events: [],
    profile,
    fallbackDate: "2026-08-10",
    exerciseLabel: (id) => id,
  });

  assert.deepEqual(result.lifts.map((lift) => [lift.id, lift.latestKg, lift.changePercent]), [
    ["squat", 120, undefined],
    ["bench_press", 82.5, undefined],
    ["deadlift", 150, undefined],
  ]);
  assert.deepEqual(result.composite, [{ date: "2026-08-01", index: 100 }]);
});
