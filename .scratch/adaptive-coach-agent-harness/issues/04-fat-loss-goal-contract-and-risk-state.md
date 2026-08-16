# 04 — 减脂目标合同与基础风险状态

**What to build:** 用户的目标结果、截止日、执行档位、护栏和测量计划形成不可静默改写的 Goal contract；同一偏差对大体重减脂、保肌减脂和力量优先减脂得出不同可达性状态。

**Blocked by:** 03 — TimelineChanged 风险触发与定时检查.

**Status:** wontfix

- [ ] 风险结果只产生 on_path、at_risk、infeasible_under_guardrails 或 insufficient_evidence，不向用户展示未经校准的概率。
- [ ] 聚餐、缺训和恢复事件根据目标模式、原截止日与护栏产生不同的可见判断和 reason code。
- [ ] 默认保护原路径；仅明确 slowdown consent 能改变日期、目标或执行负担。
