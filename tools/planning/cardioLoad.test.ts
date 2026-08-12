import assert from "node:assert/strict";
import test from "node:test";

import type { PlannedSessionData, TimelineProjectionEvent } from "../../src/coach/domain";
import { forecastCardioLoad } from "../../src/planning/cardioLoad";
import { buildContinuousTrainingQueue } from "../../src/planning/continuousTrainingQueue";
import type { SplitRotationTemplate } from "../../src/knowledge/model";

function activity(date: string, activityType: string, minutes: number, intensity: "easy" | "moderate" | "hard", rpe?: number): TimelineProjectionEvent {
  return {
    eventId: `activity-${date}`, revision: 1, occurredAt: `${date}T08:00:00.000Z`, recordedAt: `${date}T09:00:00.000Z`, timezoneOffsetMinutes: 480,
    fact: { kind: "activity", activityType, duration: { value: minutes, unit: "minutes" }, intensity, ...(rpe === undefined ? {} : { perceivedExertion: rpe }), confidence: "confirmed" },
  };
}

function planned(date: string): PlannedSessionData {
  return {
    id: `planned-${date}`, title: "胸 + 三头", scheduledFor: date, knowledgePins: {} as PlannedSessionData["knowledgePins"], kind: "weighted_reps",
    tasks: [{ id: "cardio", exerciseVariantId: "walk.treadmill", mode: "timed", sets: [] }],
    aerobicBlock: { placement: "after_strength", role: "fat_loss_acceleration", intensity: "moderate", targetRpe: { min: 3, max: 4 }, talkTest: "能说短句", minutes: 25, fastedEligible: false, reasonCodes: [] },
  };
}

test("实际有氧按方式、时长和实际 RPE 建立系统与下肢负荷，不把它伪装成力量组数", () => {
  const forecast = forecastCardioLoad({
    timeline: [activity("2026-08-11", "跑步", 30, "moderate", 8)],
    sessions: [],
  });
  const day = forecast.days[0];
  assert.equal(day?.impact, "high");
  assert.ok((day?.addedSystemLoad ?? 0) > 0);
  assert.ok((day?.addedLowerBodyLoad ?? 0) > 0);
  assert.ok((day?.addedSystemLoad ?? 0) > (30 * 1.2), "实际 RPE 8 应覆盖粗强度 moderate");
});

test("同日已经有实际有氧时，不把原计划有氧重复记入负荷", () => {
  const forecast = forecastCardioLoad({
    timeline: [activity("2026-08-12", "单车", 20, "easy")],
    sessions: [planned("2026-08-12")],
  });
  const day = forecast.days[0];
  assert.deepEqual(day?.sources, ["actual_activity"]);
  assert.ok((day?.addedSystemLoad ?? 0) < 30, "应只使用实际完成的 20 分钟，而非再加计划的 25 分钟");
});

test("计划中的力量后有氧也进入未来恢复队列，但标明是计划而非已完成事实", () => {
  const forecast = forecastCardioLoad({ timeline: [], sessions: [planned("2026-08-13")] });
  assert.deepEqual(forecast.days[0]?.sources, ["planned_cardio"]);
  assert.equal(forecast.days[0]?.impact, "low");
});

test("昨天高冲击有氧的残余负荷会成为明天腿课的条件门，而不是被有氧热量记录吞掉", () => {
  const sessions = [planned("2026-08-12"), { ...planned("2026-08-13"), aerobicBlock: undefined }];
  const cardio = forecastCardioLoad({ timeline: [activity("2026-08-12", "跑步", 30, "hard")], sessions });
  const queue = buildContinuousTrainingQueue({
    currentDate: "2026-08-12",
    weeklyIntents: [{ id: "week", ordinal: 1, startDate: "2026-08-10", endDate: "2026-08-16", intent: "test", materialization: "materialized", stimulusBudget: [] }],
    materializedSessions: [],
    schedule: [{ weekday: 4, availableMinutes: 60, locationId: "gym" }],
    rotation: { id: "legs", nameZh: "腿", sessionCount: 1, suitableWeeklyDays: [1, 7], exposuresPerCycle: 1, sessions: [{ id: "legs", focusZh: "腿", slots: [{ movementPattern: "squat", muscleGroups: ["quadriceps"], priority: "primary", fatigueIntent: "high" }] }] } as SplitRotationTemplate,
    startingTrainingOrdinal: 0,
    fatigueForecast: { policy: { id: "test", version: "1", evidenceTier: "D_product_policy", unit: "relative_load" }, days: [] },
    cardioLoadForecast: cardio,
  });
  assert.ok(queue.entries[0]?.readinessGates.includes("cardio_lower_body_load_not_high_before_lower_body_session"));
  assert.ok((queue.entries[0]?.cardioLoadBefore?.lowerBody ?? 0) > 0);
});
