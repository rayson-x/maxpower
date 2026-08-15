# 00 — 冻结动作识别回归基线与分任务评价口径

**What to build:** 在改变动作语义、主轨迹或 Rep 生命周期前，解析受治理的 v11 known-video evaluation，冻结 aggregate 与 exact action×view 的 Rep、边界、负窗口、器械覆盖和不可评价状态。该基线只防止已知视频回归并定位失败，不用于 truth reveal 后调参、held-out 声明或生产晋升。

**Blocked by:** none

**Status:** in-progress

- [ ] 通过治理 catalog 按 asset ID 解析 `current-rust-v11-multirate-equipment-alignment-report` 与 `personal-human-rep-ranges-v2`，验证 admission、authority、allowed fields、group key、来源位置和 SHA-256；禁止递归发现数据或消费未声明字段。
- [ ] 冻结 aggregate 和 exact action×view 的 candidate precision/recall、exact-set rate、start/end boundary error、strict boundary alignment、negative-window false trigger 与失败记录，不用一个混合识别率替代分动作结果。
- [ ] 分开记录 Rep count/boundary、phase/turnaround、equipment detection、subject association、grip establishment/release、track geometry、Feature、quality 与 trace 指标；缺少合格人类真值的任务固定为 `not_evaluable`。
- [ ] 已知视频只能作为 regression/diagnosis evidence。任何阈值、走廊或模型选择后的准确率晋升都使用新的 participant/source/session/view 隔离冻结集，并保留 prediction-before-truth hash。
- [ ] 建立 ticket checkpoint 格式：每轮报告相对 v11 的 aggregate 与逐 context 变化、coverage/risk 变化、新拒绝原因和仍不可评价任务；aggregate 改善不能掩盖单动作显著退化。
- [ ] 把冻结记录 `a44741cba03352f1e689fd51276dfec5` 的 5400 ms / frame 162 登记为 pre-contact association regression：允许 raw bar detection，但预期 `fusionEligible=false`、`turnaroundEligible=false` 且不会推进 Rep。该记录不是握持标注或训练 truth。
- [ ] 把冻结记录 `field-capture-2026-08-02T18-34-19-006Z` 的 16609 ms / frame 498 登记为 pose-bridge honesty regression：现有 `Fused` 手腕桥接线只能成为 display estimate，不能计为真实杠轴检测、canonical observation、fusion 或 Rep evidence。该帧不是人工杠轴坐标 truth。
