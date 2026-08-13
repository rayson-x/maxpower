# 02 — 输出器械通道的每组局部动作坐标

**What to build:** 在真实 Rust set lifecycle 内，用准备阶段和早期因果杠铃运动建立一套每组局部动作坐标，并将器械沿轴进度、横向偏移、动态轴角、稳定尺度及状态作为 shadow evidence 输出到同一 CanonicalMotionOutput。用户可以在 Web 审核页查看该坐标，但现有 Rep 和 phase 结果不会因此改变。

**Blocked by:** 01 — 无损传递真实杠铃轴与粗机位。

**Status:** code-complete

- [x] `begin_set → chronological observations → finish_set` 会产生版本化 coordinate-frame identity、state、primary axis、cross axis、origin、set scale、scale source、confidence 和 failure/degrade reason。
- [x] 坐标生命周期至少公开 `uninitialized`、`provisional`、`learning`、`frozen` 和 `degraded` 外部状态，并且每个状态转换只依赖当时及过去观测。
- [x] 准备基线由多帧可靠 measured shaft observations 的稳健统计建立，不使用单一首帧；运动轴结合准备杠轴先验和早期真实中心路径后冻结。
- [x] 坐标冻结后不会跟随疲劳或路径漂移重新定向；相机/crop/orientation 变化、主体切换、长时间缺失或明显几何断裂会显式 degrade/reset。
- [x] 输出包含 equipment along-axis progress、cross-axis displacement、左右端点相对各自准备基线的 progress、raw image angle 和 baseline-corrected dynamic angle。
- [x] 全组使用同一个冻结尺度；实现不得对每个 Rep 单独 min/max 归一化到 `[0,1]`。
- [x] 原始杠铃像素坐标和 provenance 与规范特征同时存在，规范特征不会覆盖 source observation。
- [x] Shadow 模式开启或关闭时，当前 Canonical Rep、phase、endpoint 和 quality 结果保持相同；只有 additive coordinate evidence 不同。
- [x] Web 审核页可以分别切换 raw shaft 和 normalized equipment trajectory，并显示状态、尺度来源、置信度和弃权原因。
- [x] 合成旋转、平移和均匀缩放同一输入后，离散 coordinate state 相同，规范进度在声明的浮点容差内不变，raw coordinates 保留相应变换。
- [x] Causality 测试修改未来帧时，已经输出的早期 coordinate facts 不发生变化。
