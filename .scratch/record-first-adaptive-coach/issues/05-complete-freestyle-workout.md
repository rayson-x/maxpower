# 05 — 无计划用户完成一次完整自由训练

**What to build:** record-first 用户从 Home 进入 freestyle Workout session，自行选择动作并记录组数、重量、次数、RPE/RIR 和备注。自由训练不需要 Plan reference，也不会被解释为计划外失败；最终结果进入同一 Timeline 和 Daily Health Ledger。

**Blocked by:** 04 — 无目标用户完成建档后进入记录首页.

**Status:** completed

## Existing foundation and required change

- 保留现有 Workout session 的手动组记录、休息、暂停、恢复、跳过、修正和完成逻辑。
- 现有完整 Session 强制 PlannedSessionRef、无计划只能使用简化 reportedSession 的结构不符合业务；直接使 planned 与 freestyle 成为同一 Session 的两种正式来源。
- 本 ticket 不实现、扩展或验收 Realtime Agent、相机、动作识别、Canonical packet 或实时提示。

## Acceptance criteria

- [x] Workout session 正式支持 planned 与 freestyle 两种来源，freestyle 不需要 Goal 或 Plan。
- [x] 用户可在自由训练中选择动作并记录重量、次数、RPE/RIR、组结果和备注。
- [x] 计划训练与自由训练产生同一种 performed Record；只有计划训练携带 Plan revision 引用。
- [x] 中断、部分完成、修正、暂停、重启和最终完成保持一致语义。
- [x] 自由训练结果进入 Timeline、Daily Health Ledger、训练摘要和长期趋势。
- [x] Record admission 保持来源无关，使未来 finalized Workout Record 可接入，但当前 Session 不依赖任何 realtime 状态。
- [x] 既有计划训练的手动开始、当前组、休息、替换、完成和更正场景全部回归通过。
- [x] 默认客户端从 record-first Home 完成无计划训练、重启恢复、结果修正和 replay。
- [x] 旧 reportedSession 完整体验旁路、PlanRef 假值和重复 Session 结构同次删除。

