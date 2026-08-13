# 04 — 建立可选择的规范轨迹卧推 Profile

**What to build:** 让一个版本化杠铃卧推 Recognition Profile 可以显式选择局部坐标中的命名信号，并在真实单次因果 Rust 流中为正面和左右前斜方视频输出 Rep、开始、主要反向点、返回端点和完整端点快照。候选 Profile 默认不替换当前正式 Profile，便于在相同输入上并行比较。

**Blocked by:** 03 — 加入独立骨架通道和晚期证据融合。

**Status:** code-complete

- [x] Recognition Profile schema 支持命名 normalized signals，包括 along-axis progress、cross-axis displacement、endpoint-relative progress、dynamic bar angle、channel agreement 和 observability。
- [x] 旧 raw landmark/distance signals 继续可用；没有选择 normalized signal 的 Profile 保持现有行为。
- [x] 新卧推候选 Profile 精确绑定 `barbell_bench_press × barbell × front/front_oblique_left/front_oblique_right`，错误器械、错误动作或不支持机位 fail closed。
- [x] Profile 使用器械进度理解离心/向心与主要反向点，并保留 independent pose corroboration/conflict；它不会把骨架或器械任一通道声明为普遍优先级。
- [x] 每个 sealed Rep 输出 `start_anchor`、`primary_turnaround`、`end_return` 的 occurred/confirmed timestamps、完整 normalized feature snapshot、raw evidence lineage 和 disposition。
- [x] 第一 Rep 在坐标尚未冻结时被明确标为 provisional/needs-review 或按 Profile 声明的因果策略处理，不会暗中使用未来 Rep 重写其早期输出。
- [x] 左前和右前斜方使用同一规则族但保留 handedness；compatibility aliases 得到相同规则语义。
- [x] 原始屏幕 `center_y` Profile 和 normalized candidate 可以针对同一冻结 observation stream 独立运行并产出可比较版本，互不修改历史结果。
- [x] Profile resolver 默认保持当前已启用版本；候选只有通过显式实验选择才能运行，不因代码存在自动 promotion。
- [x] Set lifecycle、finish-set idempotence、future-frame mutation 和 phase occurred/confirmed separation通过契约测试。
