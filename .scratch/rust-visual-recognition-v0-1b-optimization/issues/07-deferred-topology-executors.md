# 07 — 补齐未被当前动作资产选中的通用拓扑执行器

**What to build:** 在不增加动作名称分支的前提下，为当前动作目录实际选择的 `locomotion_step_cycle/v1` 与 `multi_stage_cycle/v1` 实现 Rust Rep executor，并让动作资产只通过 `RepTopologyProfile` 选择它们。

**Blocked by:** 01–04。保持动作不在当前 248 个动作中，已按依赖不足拆到 Ticket 12，不能为了勾选本票据而发明保持动作语义。

**Status:** complete — 当前目录中的行走/侧向步态与箱式深蹲已由资产选择独立 topology；保持动作验收已集中拆到 Ticket 12。

## Why this was split from Ticket 02

Ticket 02 的 shared-cycle 路径已由 `RepTopologyProfile` 驱动。当前目录新增 4 个 locomotion 动作和 1 个 multi-stage 动作：资产明确阶段、边界与 dwell，Rust 根据 topology ID 分派执行器，不根据 action ID 分派。

## Acceptance

- [x] `walking_lunge`、`side_step_touch`、`resistance_band_lateral_walk`、`crossover_side_step` 选择 locomotion；`box_squat` 选择 multi-stage，并保留各自阶段语义。
- [x] `MotionSession` 只按资产编译出的 topology state-machine ID 分派；没有动作名称 switch。
- [x] lifecycle 测试证明两种 topology 走不同执行条件：locomotion 按资产阶段数要求下一步准备端持续，multi-stage 按资产 dwell 要求可见换向端停顿；通用 typed gap、IncompleteCycle、future truncation 与 formal-volume 合同继续适用。
- [x] action×view 漏斗与边界输出由 Ticket 10 的同一冻结评测器承接，不在本票据伪造人工匹配。

## Completion evidence

生成资产的 topology 分布不再把上述 5 个动作压回通用 cycle。locomotion 使用双踝关系形成 step candidate，并按 3/4 阶段资产要求 terminal next-step dwell；`walking_lunge` 还必须在主关系换向阶段出现独立膝屈伸周期，只迈步不能确认为弓步。multi-stage 使用资产 phase count 与 turnaround dwell，要求可见的下降端停顿再回程；这是一项骨架/轨迹可见事实，在没有箱面观测时不会伪称确认了物理接触。完整周期执行测试和 248-action 编译测试通过。当前没有一个已安装动作声明 hold interval，因此 hold 的目标带、开始/结束、持续时长和计次单位留给 Ticket 12 的真实动作资产，而不是在这里猜测。
