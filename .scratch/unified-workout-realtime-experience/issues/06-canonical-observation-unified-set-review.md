# 06 — Realtime 观察进入统一 Set Review

**What to build:** Realtime 结束后不进入另一套报告或完成流程，而是把 canonical observation 带回与手动训练相同的 Set Review，由用户确认最终实际结果。

**Blocked by:** 05 — 组级 Realtime 能力入口与无损退出。

**Status:** completed

- [x] 相机界面只突出动作、组号、用户提供的重量、目标次数、confirmed reps、构图状态和最多一条当前观察。
- [x] 只有 Rust canonical ConfirmedRep 默认进入 observed count；NeedsReview、Rejected 与 cannot judge 保持可区分且不静默形成训练量。
- [x] Realtime 结束只生成或引用不可变 observation，不直接创建 SetOutcome。
- [x] 手动与 Realtime 路径进入同一 Set Review；用户确认 actual load、performed reps、RIR 和可选主观状态后才写入结果。
- [x] 用户修正次数只改变 performed value，原始 observed dispositions、evidence lineage 和 correction provenance 保持可追溯。
- [x] camera、LLM 和 motion adapter 均不能产生 actual load、RIR、疼痛、肌肉激活或伤害判断；未知保持 unknown/cannot judge。
- [x] 骨架、角度、FPS、runtime 与模型信息默认不占据训练界面，只在组后详情或独立诊断入口可见。

## Comments

- 2026-08-14：已补齐 set context、统一 Set Review，以及 WorkoutSession 内不可变 local canonical observation、packet lineage、cannot-judge 与 performed correction provenance。该 observation 明确不是 cloud-confirmed Result；相机 active UI 仍需进一步收起骨架/角度/Coach captions，并完成真机缺帧矩阵。
- 2026-08-14：训练上下文中已收起骨架、角度、设备叠层和多条 Coach 字幕；手动与 Realtime 共用同一 Set Review，实际数据只在用户确认后写入。视觉理解与真机缺帧矩阵已移出本轮验收；本 ticket 完成。
