# 当前 Rust v7 已有视频 Rep 标注对齐报告

## 技术结论

可以使用现有视频验证当前 Rust 引擎的实际效果，但本轮结果只能解释为**同一训练者、已知视频的回归效果**，不能解释为陌生用户或新视频识别率。

当前 v7 在 53 个可评估动作记录、455 个人工 Rep 区间上的结果是：

- 候选 Rep：预测 435 次，匹配 379 次，precision 87.1%，recall 83.3%。
- 精确计次：16/53 组预测次数与人工次数完全一致，整组正确率 30.2%。
- 严格边界：238/455 个 Rep 同时满足起点误差 ≤500 ms、终点误差 ≤500 ms、区间 IoU ≥0.60，对齐率 52.3%。
- 完整成功：只有 1/53 组同时做到次数完全一致且所有 Rep 边界严格对齐，占 1.9%。
- 负样本误触发：435 个预测 Rep 中有 32 个预测中点落入 237 个人工审核过的非动作窗口。

因此，当前能力已经足以定位“哪些动作、机位和视频会失败”，也能为下一轮 RepEngine/RecognitionProfile 调整建立回归基线；但还不足以把整组 Rep 次数和每次边界当成稳定产品结论。质量结论的准确率目前无法验证，因为现有人工标注只有 Rep 区间与负窗口，没有动作质量或器械轨迹真值。

## 不同动作的差异很大

候选匹配使用宽容的动作识别条件；“严格边界”才表示起止点能否支撑后续阶段、轨迹和质量分析。单样本动作不能用于稳定性判断。

| 动作 | 记录 | 人工 Rep | 预测 Rep | 候选 precision | 候选 recall | 整组次数正确 | 严格边界对齐 | 负窗口误触发 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| barbell_bench_press | 6 | 46 | 50 | 80.0% | 87.0% | 16.7% | 60.9% | 6 |
| barbell_row | 6 | 58 | 59 | 91.5% | 93.1% | 16.7% | 31.0% | 7 |
| lat_pulldown | 4 | 28 | 25 | 100.0% | 89.3% | 25.0% | 85.7% | 0 |
| lateral_raise | 7 | 65 | 66 | 98.5% | 100.0% | 85.7% | 83.1% | 1 |
| machine_chest_press | 4 | 29 | 30 | 96.7% | 100.0% | 75.0% | 65.5% | 1 |
| pull_up | 1 | 5 | 5 | 100.0% | 100.0% | 100.0% | 60.0% | 0 |
| push_up | 1 | 14 | 13 | 100.0% | 92.9% | 0.0% | 0.0% | 4 |
| rear_delt_fly | 4 | 50 | 8 | 100.0% | 16.0% | 0.0% | 8.0% | 0 |
| seated_row | 3 | 24 | 26 | 88.5% | 95.8% | 33.3% | 25.0% | 5 |
| seated_shoulder_press | 6 | 44 | 43 | 81.4% | 79.5% | 33.3% | 38.6% | 6 |
| single_arm_cable_lateral_raise | 8 | 68 | 94 | 71.3% | 98.5% | 0.0% | 75.0% | 1 |
| straight_arm_pulldown | 3 | 24 | 16 | 93.8% | 62.5% | 0.0% | 58.3% | 1 |

从这些结果可以直接得到下一轮优先级：

1. `rear_delt_fly` 是漏检主问题。4 个记录中有 2 个完全没有非 rejected Rep，整体只识别到 8/50。
2. `straight_arm_pulldown` 有 1 个记录完全没有 Rep，导致整体 recall 只有 62.5%。
3. `single_arm_cable_lateral_raise` 是明显过计数：68 个真值预测成 94 个，虽然 recall 高，但 precision 只有 71.3%，8 组没有一组精确计次。
4. `barbell_row` 能找到大部分动作，但严格边界对齐只有 31.0%，说明周期相位与人工“完整 Rep”定义没有对齐。
5. `push_up` 的候选次数接近正确，但严格边界为 0%；它只有 1 个视频，既不能证明已支持，也不能证明稳定失败。
6. 当前相对最稳定的是 `lateral_raise`、`machine_chest_press` 和 `lat_pulldown`，但仍需新视频验证，不能依据已知视频结果直接开放为泛化能力。

## 数据范围与质量检查

本轮输入来自两个受治理资产：人工 Rep 区间 `personal-human-rep-ranges-v2`，以及只作为特征输入的 RTMPose Halpe-26 观察 `personal-native-rtmpose-halpe26-observations`。

- 标注库有 54 个 action×view 记录，覆盖 50 个源视频；按排除规则去掉 1 个低帧率且计数/边界不一致的记录后，评估 53 个记录、49 个源视频。
- 53 个记录覆盖当前 v7 的 12 个动作、24 个精确 action×view 上下文。
- 455 个 `expectedCount` 全部有对应人工起止区间；没有缺失 Rep 边界。
- 237 个审核过的负窗口可用于检查非动作时段误触发。
- action×view×source 复合键无重复，pose sidecar 连接覆盖率为 100%。
- `single_arm_cable_lateral_raise` 的同一源视频按左右 exact context 形成多个记录，因此 53 个记录不是 53 个独立视频。

这些检查说明数据足以做当前已知视频回归和错误定位。它不能支撑陌生用户泛化结论：样本主要来自同一位有训练经验的用户，当前 Profile/阈值也曾参考这些视频。

## 评估方法

运行时只输入视频基础上下文、Halpe-26 姿态观察和当前 v7 Profile/Bundle。所有 53 个 Rust 输出先整体序列化并计算 SHA-256，之后才读取人工 `expectedCount`、Rep 起止区间和负窗口。

匹配保持时间顺序且一对一：

- 候选 Rep 匹配：区间 IoU ≥0.10，或起点和终点误差都 ≤1500 ms。它回答“是否找到了同一次动作”。
- 严格边界对齐：区间 IoU ≥0.60，并且起点和终点误差都 ≤500 ms。它回答“边界是否足以支撑精确阶段与轨迹分析”。
- 负窗口误触发：预测 Rep 的时间中点落入人工审核过的非动作窗口。
- `confirmed` 和 `needs_review` 都计入预测；`rejected` 不计入用户 Rep。

本轮执行共处理 15,879 个 canonical packet，并为 53/53 个报告生成完整九阶段因果链。所有预测的内容哈希、Bundle 哈希、Rep slice 哈希和 Trace 哈希都保留在机器可读结果中。

## 当前质量报告能验证到哪里

当前运行能输出完整的 `SetAssessment` 和因果 Trace，但不能据此声称“动作质量判断准确”：

- 53 个记录都没有人工器械轨迹，运行中 `equipmentChannelFrames = 0`；只能使用 pose-only 局部坐标证据。
- 人工标注没有阶段控制、支撑稳定、双侧协调、轨迹控制或标准变式兼容性的质量真值。
- 当前 53 个报告对上述五个维度全部选择 `CannotJudge`，这是正确的拒答行为，不是已验证的质量识别能力。
- `RangeOfMotion` 只有 18/53 个报告给出可判定结论，其余 35 个拒答；`ObservationConfidence` 有 21/53 可判定。

所以本轮能验证的是 Rep 候选、Rep 边界、负窗口、报告封装和 Trace 完整性。要验证用户最终看到的“动作质量报告”，下一步需要在标注台补充 Rep 级/整组级质量审核，而不是把当前 Rust 自己的结论回填为真值。

## 与旧报告不能直接横向比较

旧的 personal Halpe-26 报告使用按动作单独调优的 source-held-out temporal template 流程；本报告运行的是当前统一 `ExecutionAssessmentEngine` v7 Bundle。两者的 Runtime、Profile、上下文范围和匹配目的不同，不能用旧报告的更高数字替换当前 v7 的真实回放结果。

本轮结论是描述性回归，不是独立测试：预测虽然在读取 Rep 区间前被冻结，但当前 Runtime/Profile 曾在这些视频上开发和调试，因此严禁标为 blind、held-out、production accuracy 或 72 动作覆盖率。

## 下一步

1. 先修复 3 个完全无 Rep 的记录，并以 `rear_delt_fly`、`straight_arm_pulldown` 为第一优先级。
2. 再修复相位边界定义，重点处理 `barbell_row`、`seated_row`、`push_up` 和 `seated_shoulder_press` 的“次数接近但边界错位”。
3. 为 `single_arm_cable_lateral_raise` 增加防重复/左右侧归属约束，降低过计数。
4. 每次修改都复跑同一冻结协议，要求不能牺牲已稳定的 `lateral_raise`、`lat_pulldown` 和 `machine_chest_press`。
5. 新视频到位后，按 `sourceCaptureId` 隔离并在预测冻结后揭示标注，才开始报告真实泛化识别率。
6. 质量标注开始后，另建 technique-quality 评估；不要把 Rep 对齐率当作质量判断准确率。

机器可读明细见 `current-rust-v7-known-video-alignment-2026-08-15.json`。评估协议见 `rust/motion-sdk/tests/fixtures/current_v7_known_video_alignment_protocol_v1.json`。
