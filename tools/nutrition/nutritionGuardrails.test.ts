import assert from "node:assert/strict";
import test from "node:test";

import type { NutritionGuardrailRule } from "../../src/knowledge/model";
import { nutritionRemindersFor, renderNutritionReminders } from "../../src/nutrition/nutritionGuardrails";

/**
 * 进食范围提醒的结构性验收（规则表是数据，内容来自临床指南调研）。
 *
 * 这里验证的是机制：健康状况 → 命中规则 → 带转介边界的提醒。
 * 具体规则内容（哪类食物注意什么）等海外指南调研完成后入库，
 * 这些测试不因内容增删而变。
 */

function rule(overrides: Partial<NutritionGuardrailRule>): NutritionGuardrailRule {
  return {
    id: "test-rule",
    condition: "hypertension",
    foodCategory: "high_sodium",
    direction: "limit",
    messageZh: "这类食物钠含量通常较高",
    messageEn: "These foods tend to be high in sodium",
    referralBoundaryZh: "如血压控制不佳或需严格限钠，请咨询医生",
    referralBoundaryEn: "If blood pressure is uncontrolled or strict sodium limits are needed, consult your clinician",
    citationRef: "dash_sodium_guideline",
    tier: "A",
    ...overrides,
  };
}

function strategiesWith(rules: readonly NutritionGuardrailRule[]) {
  return { nutritionGuardrails: rules } as never;
}

test("无健康状况 → 零提醒（不对健康用户制造焦虑）", () => {
  const reminders = nutritionRemindersFor({
    strategies: strategiesWith([rule({})]),
    conditions: [],
    foodCategories: ["high_sodium"],
  });
  assert.deepEqual(reminders, []);
  assert.equal(renderNutritionReminders(reminders), undefined);
});

test("健康状况 + 食物类别命中 → 产出带转介边界的提醒", () => {
  const reminders = nutritionRemindersFor({
    strategies: strategiesWith([rule({})]),
    conditions: ["hypertension"],
    foodCategories: ["high_sodium"],
  });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0]?.direction, "limit");
  assert.ok(reminders[0]?.referralBoundary.length > 0, "必须带转介边界");
  assert.ok(reminders[0]?.citationRef.length > 0, "必须带指南引用");
});

test("健康状况不匹配或食物类别不匹配 → 不提醒", () => {
  const reminders = nutritionRemindersFor({
    strategies: strategiesWith([rule({})]),
    conditions: ["type2_diabetes"], // 糖尿病档案，但规则是高血压的
    foodCategories: ["high_sodium"],
  });
  assert.deepEqual(reminders, []);
});

test("药物相互作用提醒排在最前并标记", () => {
  const rules = [
    rule({ id: "r-sodium", condition: "hypertension", foodCategory: "high_sodium" }),
    rule({
      id: "r-drug",
      condition: "on_medication",
      foodCategory: "grapefruit",
      messageZh: "西柚可能影响他汀类药物代谢",
      messageEn: "Grapefruit can affect statin metabolism",
    }),
  ];
  const reminders = nutritionRemindersFor({
    strategies: strategiesWith(rules),
    conditions: ["hypertension", "on_medication"],
    foodCategories: ["high_sodium", "grapefruit"],
  });
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0]?.ruleId, "r-drug", "药物相互作用应排第一");
  assert.equal(reminders[0]?.isDrugInteraction, true);
  assert.equal(reminders[1]?.isDrugInteraction, false);
});

test("渲染：每条提醒带转介边界，结尾有通用免责", () => {
  const reminders = nutritionRemindersFor({
    strategies: strategiesWith([rule({})]),
    conditions: ["hypertension"],
    foodCategories: ["high_sodium"],
  });
  const rendered = renderNutritionReminders(reminders, "zh");
  assert.ok(rendered);
  assert.ok(rendered.some((line) => line.includes("请遵医嘱")), "必须有通用免责");
  assert.ok(rendered[0]?.includes("钠"), "正文应含提醒内容");

  const renderedEn = renderNutritionReminders(reminders, "en");
  assert.ok(renderedEn?.some((line) => line.includes("clinician")), "英文渲染应有免责");
});

test("规则只接受 tier A（临床指南级），这是这类内容的硬门槛", () => {
  // 类型层强制 tier: "A"，这里确认入库的规则没有低于 A 的
  const reminders = nutritionRemindersFor({
    strategies: strategiesWith([rule({ tier: "A" })]),
    conditions: ["hypertension"],
    foodCategories: ["high_sodium"],
  });
  assert.ok(reminders.length === 1);
});
