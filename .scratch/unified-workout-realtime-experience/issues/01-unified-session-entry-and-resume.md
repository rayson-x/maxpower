# 01 — 统一训练入口与会话恢复

**What to build:** 用户从 Today 一次点击即可开始或恢复唯一的 WorkoutSession，直接进入当前组，不再选择“普通记录”或“AI 监控”模式；应用中断后恢复到同一会话和下一项未完成内容。

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] Today 的开始与继续训练都进入统一训练执行界面，最多一次主要点击，不再出现训练模式选择。
- [x] 旧的未完成记录或监控会话以 Realtime 未开启为安全默认值恢复，不复制 WorkoutSession、task 或 set。
- [x] 当前动作、当前 set、执行草稿、休息状态和已确认结果具有稳定身份，并能在进程重启后恢复。
- [x] 现有 WorkoutSession 手动训练与会话持久化高层回归保持通过。

## Comments

- 2026-08-14：`tools/workout/workoutExecution.test.ts` 10/10 通过；覆盖同一 set 的 Realtime 开关、draft identity、休息与重启恢复。遗留 `coach_monitor` 进程恢复时强制关闭 Realtime 的迁移仍待补齐。
- 2026-08-14：已补齐旧 `coach_monitor` 会话的 cloud-confirmed 安全迁移；恢复同一 WorkoutSession 且默认回到手动记录。本 ticket 完成。
