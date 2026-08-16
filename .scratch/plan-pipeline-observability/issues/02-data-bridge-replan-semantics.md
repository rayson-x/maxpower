# 02 — 数据断桥修复与重排语义

**What to build:** 用户完成的每组训练（实际重量/次数/RIR，user_confirmed）在完成整场时逐条写成 timeline historicalSet 事实，成为 planner 的 history——之后的计划按真实表现进阶（负荷锚定、工作 RIR 区间、正常组数），而不是永远从空白开始。四个 replan 入口（完成训练/周复盘/deload 结束/恢复约束变化）都组装 historicalPerformance 传入。修复恢复约束永不过期的 bug（strongestRecovery 改为对比请求日期）。session_completed 语义改为"历史更新后重算，diff 非空才出新 PlanRevision"；missed-session 检测对照计划表 scheduledFor，没开始的课也算缺席。

**Blocked by:** None — can start immediately.

**Status:** wontfix

- [x] 完成一场含 user_confirmed 负荷数据的训练后，timeline 出现对应 historicalSet 事实，planner 的 deriveHistory 返回非空
- [x] 四个 replan 入口的 plan 请求均携带从 workout 聚合组装的 historicalPerformance
- [x] 有历史后的新计划：负荷锚定上次表现、RIR 切工作区间、不再全部 unknown
- [x] 过期恢复约束不再生效（恢复后训练量恢复）
- [x] 完成训练且历史有实质变化时出新 PlanRevision 且 diff 非空；无变化时 no_change
- [x] 未开始且已过期望日期的课计入 missed（触发重排路径可达）
- [x] 全量回归绿色

## Comments

- 2026-08-11 完成：completeWorkoutSession 把 user_confirmed 组写成 timeline historicalSet（带 sourceRecordId 防止 source 级去重误吞）；previewGoalCycle 统一从 workout 聚合组装 historicalPerformance（四个入口同时受益）；strongestRecovery 过期比较修复；session_completed 改为重算+diff 语义；missed 检测含未开始的课。另修两个深层 bug：week-plan id 混入 factFrontier 导致同输入不同 id、goalCycleRef.revision provenance 污染 computeDiff。顺手修了并行会话 WIP 的一个类型错误（rustCanonicalWasm.ts 元组转换，编译器建议的最小修复，不提交）。测试：replanSemantics 2 例 + dataBridge 1 例，全量 740 绿。
