# 11 — 减脂用户获得当前计划路径判断

**What to build:** 减脂用户可以查看：结合 Goal contract、Active plan、Nutrition strategy、Daily Health Ledger、关键训练、恢复、执行证据和剩余时间，当前计划是 on-path、at-risk、infeasible-under-guardrails 还是 insufficient-evidence。一次饮食或训练事件只是证据，不能脱离目标和计划判定失败。

**Blocked by:** 06 — 多周记录形成可信趋势与个人能量校准; 10 — 计划执行产生计划与实际的正式证据.

**Status:** completed

## Existing foundation and required change

- 迁移现有 fat-loss、Goal forecast、Timeline trigger 和 trace 中符合新业务的确定性规则。
- 直接删除只读取 Goal contract 与 Timeline 的 risk snapshot、默认 fat-loss evaluator 和公开 evaluator 组合，建立唯一 Goal Path Module。
- Module 自行读取一致版本的 Goal、Active plan、Nutrition strategy、Readiness、Ledger、mandate 和规则钉；调用方不得组装 snapshot 或选择目标 evaluator。

## Acceptance criteria

- [x] 判断绑定同一复合版本的 Goal、Active plan、Nutrition strategy、Readiness、Ledger、mandate 和规则/知识钉。
- [x] 只输出 on-path、at-risk、infeasible-under-guardrails 和 insufficient-evidence，不显示未校准成功率百分比。
- [x] 单次聚餐或缺训只有侵蚀剩余路径时才成为风险，存在缓冲时继续观察。
- [x] higher-body-mass、保肌减脂和力量优先减脂使用各自条件与保护约束。
- [x] 摄入只来自 confirmed Ledger；食物身份、份量或计划菜单不能被用来推断营养事实。
- [x] 缺记录降低证据质量，不被解释为超额饮食或未执行。
- [x] 安全、恢复和极端限制护栏优先于期限与更快结果。
- [x] 本 ticket 先评估当前计划，只产生判断和证据请求，不修改 Plan。
- [x] 相同事实前沿和版本钉稳定重放相同结果与 reason code。
- [x] 默认客户端从真实手动计划执行和饮食记录显示判断卡；失败不修改 Record 或 Active plan。
- [x] 删除旧 risk snapshot、fat-loss-only 默认接线、公开 evaluator 组合和手工注入产品验收测试。

