# 05 — 组级 Realtime 能力入口与无损退出

**What to build:** Realtime 成为当前 set 上按需开启的增强能力；只有 exact capability 允许时显示，拒绝权限、不支持、失败或退出都返回同一组继续手动训练。

**Blocked by:** 02 — 当前组卡片、实际组记录与翻转历史。

**Status:** in-progress

- [x] 入口复用 exact runtime capability resolver 授权，名称相似不能放行。
- [x] 打开 Realtime 时继承稳定的 WorkoutSession、set、动作、组序、计划快照、本组重量和目标次数上下文。
- [x] 仅在用户点击入口后请求相机权限；拒绝权限可退出回到同一当前组。
- [ ] unsupported、关键点缺失、低置信度、native runtime 错误或中途退出均保留本组草稿，并允许立即手动完成。
- [x] Realtime 开关不会复制 WorkoutSession、set、result 或 task-scoped CoachSession，且保留同一 draft identity。

## Comments

- 2026-08-14：关键点缺失、低置信度与 native runtime error 的 Android 真机无损回退矩阵仍待 issue 09 验收。
- [ ] 支持和不支持动作分别具有端到端验证，且手动训练永远不依赖相机。
