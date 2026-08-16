import assert from "node:assert/strict";
import test from "node:test";

import { planningPhrase, strategyName } from "../../src/mobile/ui/planningReport";

test("计划报告不会把内部策略与规则码直接暴露给用户", () => {
  assert.equal(strategyName("conservative_gain", "zh"), "保守增肌");
  assert.equal(planningPhrase("record_comparable_trends", "zh"), "持续记录可比较的训练与身体趋势");
  assert.equal(planningPhrase("general fitness planning", "zh"), "一般健身训练人群");
  assert.equal(planningPhrase("constraint_priority:hash", "zh"), "先满足安全、恢复与时间约束，再分配训练量");
  // 英文为权威源：缺省 locale 走英文，不再泄漏内部 token
  assert.equal(strategyName("conservative_gain"), "Conservative gain");
  assert.equal(planningPhrase("record_comparable_trends"), "Keep recording comparable training and body trends");
});
