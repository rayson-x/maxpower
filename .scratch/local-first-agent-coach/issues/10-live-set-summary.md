# 10 — Fixture Live SetSummary 与安全边界

**What to build:** 客户端演示面可以接收 FixtureMotionRuntime 的 canonical observation，原位展示 live cue，并在组结束后 seal 为 SetSummary；下一组修改只在安全边界生效，不触碰现有 Android capture/JNI 管线。

**Blocked by:** 05 — PlanChangeProposal、原子应用与 ActionReceipt

**Status:** completed

- [x] 定义 MotionRuntime Port 与 FixtureAdapter；生产 Adapter 未来包装现有 PoseCameraModule/MotionNative JNI bridge，本轮不修改或替换 capture pipeline
- [x] Agent 只接收 confirmed/needs-review counts、observation findings 与 SetSummary，不接收原始帧循环
- [x] `data-live-cue` 使用稳定 presentationId transient 更新，不为每个 rep 新增卡片
- [x] set 结束后 seal 为不可变 SetSummary，明确区分 canonical observation 与 user-reported RIR/load
- [x] Confirmed 才进入 camera-confirmed volume；Needs-review 审批前排除；Rejected 永不进入；profile code 0 不生成 rep/phase/form/correctness
- [x] 当前 set 只允许 stop、skip 或 safety hold；普通修改仅作用于下一安全边界
- [x] Fixture replay 场景与现有 canonical packet invariants 对齐
