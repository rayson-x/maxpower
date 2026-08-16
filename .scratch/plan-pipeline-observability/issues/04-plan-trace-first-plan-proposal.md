# 04 — PlannerTrace + 首课计划 Proposal 化

**What to build:** 每次规划产出结构化 PlannerTrace artifact（输入钉：factFrontier/knowledgePins/规则版本/history 条数与来源；逐 slot：模板选择理由、候选评分表与硬过滤原因、每项安排的推导链；约束事件：恢复降级/deload/档位选择；周量账本；结果与逐项 diff），随 PlanRevision 幂等持久化——无 trace 的计划不允许提交；同一输入指纹必出同一计划。首课计划统一走 Proposal→确认→提交管线（复用 ActionBroker/PolicyGate）：用户可在确认前修改动作/组数/负荷，每处修改记录为带 provenance 的定制 diff；托管模式自动 apply 但保留 proposal artifact + 24h undo token。

**Blocked by:** 03. 策略集数据化 + Session 组装器

**Status:** wontfix

- [x] 每份 PlanRevision 有对应 PlannerTrace artifact，内容覆盖输入钉/逐 slot 推理/约束事件/周量账本/逐项 diff
- [x] 无 trace 的计划提交被拒绝；同输入指纹重放产出同计划
- [x] 首课计划不确认不生效（collaborative）；确认后提交且 diff 可审计
- [x] 用户的每处修改（增删动作/改组数负荷/锁定）成为带 provenance 的定制记录
- [x] managed 模式自动 apply + proposal artifact + undo token 可撤销
- [x] trace 查看入口（开发工具）：按 planId 打印中文推理链

## Comments

- 2026-08-11 完成：PlannerTrace 类型（输入指纹/历史摘要/分化选择/逐 slot 推理/约束事件/周量账本/结局）随 PlanProposal 产出并持久化为 plan_trace artifact（含卡片渲染器）；confirm 无 trace 拒绝提交（plan_trace_missing）；同指纹确定性重放一致；confirmPlanningPreview 支持 edits（adjust_task 组数/次数/负荷/RIR/休息 + remove_task），每处定制记录进 PlanRevisionData.customizations（带 provenance），managed 自动 apply + undo 沿用既有机制。测试 3 例（planTrace.test.ts），全量 762 绿。
