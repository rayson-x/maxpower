import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfileData } from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { fuelingAdviceFor, orderingConflict, resolveCitations } from "../../src/planning/sessionFueling";

/**
 * 进食编排验收（架构纪律：知识在包里，代码只消费）。
 *
 * 关键验收点不是"某个数值等于多少"，而是：
 * ① 建议来自知识包（把包里的策略删掉，代码不得用兜底值编造建议）
 * ② 每条建议都能解析出真实文献引用（可展示、带链接、带"不能推出什么"）
 * ③ 适格性由规则表驱动（加一条规则不需要改代码）
 */

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const strategies = registry.programStrategies();

function profile(overrides: Partial<UserProfileData> = {}): UserProfileData {
  return {
    id: "profile-1",
    trainingExperience: "intermediate",
    locale: "zh-CN",
    demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 80, unit: "kg" } },
    adultConfirmed: true,
    schedule: { weeklyFrequency: 4, sessionDurationMinutes: 60 },
    ...overrides,
  };
}

test("知识包含四种工作类型的进食策略，且每条带文案/优势/风险/引用", () => {
  const policies = strategies?.sessionFuelingPolicies;
  assert.ok(policies?.length === 4, "应有四种工作类型的策略");
  for (const policy of policies) {
    assert.ok(policy.rationaleZh.length > 30, `${policy.workType} 缺因果说明`);
    assert.ok(policy.advantagesZh.length > 0, `${policy.workType} 缺优势`);
    assert.ok(policy.risksZh.length > 0, `${policy.workType} 缺风险`);
    assert.ok(policy.evidenceRefs.length > 0, `${policy.workType} 缺证据引用`);
    assert.ok(policy.tier, `${policy.workType} 缺证据等级`);
  }
});

test("① 知识包缺该工作类型时返回 undefined，代码不得编造建议", () => {
  const withoutPolicies = { ...strategies!, sessionFuelingPolicies: [] };
  const advice = fuelingAdviceFor({
    strategies: withoutPolicies,
    workType: "low_intensity_aerobic",
    plannedMinutes: 40,
    profile: profile(),
  });
  assert.equal(advice, undefined, "包里没有策略时必须返回 undefined，不能用代码兜底值");
});

test("② 每条建议都能解析出真实文献引用（带链接与'不能推出什么'）", () => {
  const advice = fuelingAdviceFor({
    strategies,
    workType: "low_intensity_aerobic",
    plannedMinutes: 40,
    profile: profile(),
  });
  assert.ok(advice);
  assert.ok(advice.citations.length >= 1, "必须解析出引用");
  for (const citation of advice.citations) {
    assert.ok(citation.label.includes("("), `引用标签应含年份：${citation.label}`);
    assert.ok(citation.claim.length > 10, "引用要写明我们采用的结论");
    assert.ok(citation.cannotSupport.length > 0, `${citation.id} 必须写明不能推出什么（防过度声称）`);
  }
  // 按需供能框架必须在低强度有氧的依据里
  assert.ok(
    advice.citations.some((citation) => citation.id === "impey_2018_fuel_for_the_work_required"),
    "低强度有氧的安排应引用按需供能框架",
  );
  const impey = advice.citations.find((citation) => citation.id === "impey_2018_fuel_for_the_work_required")!;
  assert.ok(impey.url?.includes("ncbi.nlm.nih.gov"), "引用应有免费可达链接");
  assert.ok(
    impey.cannotSupport.some((item) => item.includes("减脂")),
    "按需供能框架必须标明它不能推出更多减脂",
  );
});

test("② 引用解析不编造：未知 id 被丢弃而不是伪造条目", () => {
  const resolved = resolveCitations(strategies, ["impey_2018_fuel_for_the_work_required", "no_such_citation"]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.id, "impey_2018_fuel_for_the_work_required");
});

test("③ 空腹适格性由规则表驱动：力量与高强度有氧被阻止", () => {
  for (const workType of ["strength", "high_intensity_aerobic"] as const) {
    const advice = fuelingAdviceFor({ strategies, workType, plannedMinutes: 45, profile: profile() });
    assert.ok(advice);
    assert.equal(advice.fastedEligible, false, `${workType} 不应允许空腹`);
    assert.ok(!advice.acceptableStates.includes("fasted"), `${workType} 的可接受状态不应含空腹`);
  }
});

test("③ 低强度有氧可空腹；超时长命中规则表的时长上限", () => {
  const ok = fuelingAdviceFor({ strategies, workType: "low_intensity_aerobic", plannedMinutes: 40, profile: profile() });
  assert.equal(ok?.fastedEligible, true);
  assert.deepEqual(ok?.fastedBlockers, []);

  const tooLong = fuelingAdviceFor({ strategies, workType: "low_intensity_aerobic", plannedMinutes: 75, profile: profile() });
  assert.equal(tooLong?.fastedEligible, false);
  const blocker = tooLong?.fastedBlockers.find((item) => item.ruleId === "fasted_aerobic_duration_cap");
  assert.ok(blocker, "应命中时长上限规则");
  assert.ok(blocker.alternative, "阻止时必须给替代方案");
});

test("③ 人群与病史规则命中即阻止，并给替代方案", () => {
  const teen = fuelingAdviceFor({
    strategies,
    workType: "low_intensity_aerobic",
    plannedMinutes: 30,
    profile: profile({ demographics: { ageYears: 16 }, adultConfirmed: false }),
  });
  assert.equal(teen?.fastedEligible, false);
  assert.ok(teen?.fastedBlockers.some((item) => item.ruleId === "fasted_not_for_minors"));

  for (const flag of ["hypoglycemia_history", "eating_disorder_history", "insulin_or_secretagogue_use"]) {
    const flagged = fuelingAdviceFor({
      strategies,
      workType: "low_intensity_aerobic",
      plannedMinutes: 30,
      profile: profile({ nutritionPreferences: [flag] }),
    });
    assert.equal(flagged?.fastedEligible, false, `${flag} 应阻止空腹`);
    assert.ok(flagged?.fastedBlockers.some((item) => item.ruleId === "fasted_metabolic_behavioral_history"));
  }

  const needsClearance = fuelingAdviceFor({
    strategies,
    workType: "low_intensity_aerobic",
    plannedMinutes: 30,
    profile: profile({
      professionalConstraints: [
        { id: "pc-1", sourceDescription: "医生", scope: ["nutrition"], instruction: "需专业指导", requiresClearance: true },
      ],
    }),
  });
  assert.equal(needsClearance?.fastedEligible, false);
  assert.ok(needsClearance?.fastedBlockers.some((item) => item.ruleId === "fasted_requires_clearance"));
});

test("散步是唯一无需餐后间隔的活动，且说明餐后立刻做最好", () => {
  const walk = fuelingAdviceFor({ strategies, workType: "walking", plannedMinutes: 15, profile: profile() });
  assert.equal(walk?.minMinutesAfterFullMeal, null, "散步无需间隔");
  assert.ok(walk?.rationale.includes("餐后"), "应说明餐后收益");
  assert.ok(walk?.citations.some((citation) => citation.id.includes("postprandial_walking")), "应引用餐后步行证据");
  // 且必须标明它不能替代结构化训练（防过度声称）
  assert.ok(
    walk?.citations.some((citation) => citation.cannotSupport.some((item) => item.includes("替代") || item.includes("中高强度"))),
    "餐后步行的引用应标明边界",
  );

  const strength = fuelingAdviceFor({ strategies, workType: "strength", plannedMinutes: 60, profile: profile() });
  assert.ok((strength?.minMinutesAfterFullMeal ?? 0) >= 120, "力量训练需要餐后间隔");
  const hiit = fuelingAdviceFor({ strategies, workType: "high_intensity_aerobic", plannedMinutes: 25, profile: profile() });
  assert.ok((hiit?.minMinutesAfterFullMeal ?? 0) > (strength?.minMinutesAfterFullMeal ?? 0), "高强度有氧最不耐胃内容物");
});

test("顺序约束：高强度有氧不得排在力量前", () => {
  const forbidden = orderingConflict("high_intensity_aerobic", "strength");
  assert.equal(forbidden?.code, "high_intensity_aerobic_before_strength_forbidden");
  assert.ok(forbidden?.explanation.includes("先力量，后有氧"));
  assert.ok(orderingConflict("low_intensity_aerobic", "strength"));
  assert.equal(orderingConflict("strength", "low_intensity_aerobic"), undefined);
  assert.equal(orderingConflict("walking", "strength"), undefined);
});
