# 08 — 训练结束、确认写入与 Timeline 闭环

**What to build:** 用户结束全部或部分训练时看到按实际发生生成的总结；只有用户确认且通过产品写入契约的结果进入 Timeline 和后续规划。

**Blocked by:** 04 — 剩余训练原地替换与实际结果保护；06 — Realtime 观察进入统一 Set Review；07 — 休息、下一组调整与安全暂停。

**Status:** in-progress

- [ ] 总结展示实际动作、逐组结果、跳过、临时加入、替换、观察覆盖、用户修正和已接受调整，不用计划内容冒充完成结果。
- [ ] 完成、部分完成、跳过、暂停和放弃继续使用现有 SessionOutcome 语义。
- [ ] 只有确认的 SessionOutcome 与 SetOutcome 进入 Timeline 和 planning evaluation；临时帧、草稿和未确认观察不得进入。
- [ ] 云端写入成功、幂等重试、revision conflict 和失败都有明确状态；失败时显示待同步，不宣称已经云端保存。
- [ ] 会话恢复与重试不复制 product resource，替换前后的实际结果仍可追溯。
- [ ] 用户报告聚焦训练语义，诊断指标继续进入 trace 与诊断工具而不是用户总结。

## Comments

- 2026-08-14：沿用 confirmed product bridge、SessionOutcome 与 Timeline；完成前先展示实际完成/跳过、观察覆盖和用户修正，并区分 saving/failed/conflict。逐动作明细、accepted adjustment 汇总以及云端成功/幂等/冲突自动化矩阵尚未补齐，故保持 in-progress。
