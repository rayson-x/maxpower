# 03 — 加入独立骨架通道和晚期证据融合

**What to build:** 在同一 Rust 局部动作坐标中独立投影 Halpe-26 骨架轨迹，并在保留器械与骨架各自来源、不确定性和覆盖率的前提下，输出按动作结论区分的一致、冲突或不可判断状态。审核者能够看见两个通道分别观察到了什么，而不是只看到一个被平均后的轨迹。

**Blocked by:** 02 — 输出器械通道的每组局部动作坐标。

**Status:** code-complete

- [x] CanonicalMotionOutput 同时包含 independent pose along-axis/cross-axis facts 和 equipment facts，并为每个通道保留 coverage、confidence、uncertainty 与 provenance。
- [x] Pose channel 只使用该时刻实际可用的 canonical landmarks；缺失 landmark 保持 unknown，不通过镜像、其他人物或无来源预测补齐。
- [x] Equipment-constrained 或 temporally predicted wrist 仍标记为 predicted，并明确排除在“独立 pose corroboration”之外。
- [x] Fusion 在两个通道分别形成事实后进行，不先平均坐标；输出至少可区分 `agreement`、`equipment_only`、`pose_only`、`conflict` 和 `cannot_judge`。
- [x] Claim-specific observability 决定是否融合：器械可以独立支持 phase，骨架可以独立支持 visible movement strategy；一个通道缺失不会自动抹除另一个通道的有效事实。
- [x] 两个高可信通道发生实质冲突时，依赖该冲突的结论会输出 conflict/cannot_judge 和原因，不会选择置信度较高者后伪装成一致。
- [x] Endpoint order、feed mirroring 和 coarse view mapping 一起决定 anatomical side；映射不充分时，左右骨架/器械比较弃权。
- [x] 审核页面能够分别显示 raw skeleton、raw equipment、normalized pose、normalized equipment 和 fusion status，并标出 predicted 点。
- [x] Provenance 测试证明一条 measured equipment observation 通过 wrist repair 后不会被计入两次或提高独立双通道置信度。
- [x] Equipment loss、pose loss、腕肘低置信、镜面竞争主体和两个通道反向运动均有完整 set-lifecycle fixture。
