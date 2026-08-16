# 07 — 休息、下一组调整与安全暂停

**What to build:** 每次确认结果后进入连续的组间休息；用户可以理解并决定是否应用下一组调整，且普通记录和 Realtime 路径都能随时进入安全暂停。

**Blocked by:** 02 — 当前组卡片、实际组记录与翻转历史；05 — 组级 Realtime 能力入口与无损退出。

**Status:** in-progress

- [x] SetOutcome 确认后自动启动对应休息计时，并显示剩余时间和可调休息时长。
- [ ] NextSetAdjustment 展示 before、after、原因与影响范围，只能改变尚未开始的未来内容。
- [ ] 接受、拒绝和忽略建议具有不同可观察结果；未明确接受时保持原安排，过期建议不能覆盖新事实。
- [x] Coach composer 在 Realtime active set 期间隐藏，不在负重动作进行中抢占界面。
- [x] 尖锐疼痛、胸部不适、眩晕或异常呼吸困难可从手动和 Realtime 路径直接进入同一安全暂停边界。
- [x] 休息状态在应用中断后正确恢复，不重复应用调整。

## Comments

- 2026-08-14：已展示下一组目标、±30 秒，以及 NextSetAdjustment 的 before/after/影响范围和 apply/reject/ignore 操作；Realtime 内也可直接进入统一 safety pause。建议 disposition 的重启留存与 Realtime 真机安全退出仍待验收，因此 checklist 保持未完成。
- 2026-08-14：安全暂停的共享产品流程已完成。NextSetAdjustment 仍需修复重启后提案丢失、直接显示 JSON 和接受/拒绝/忽略结果缺少持续可观察反馈的问题。
