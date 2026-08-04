# 高位下拉：模拟 profile × 已标注档案轨迹对照

这份报告将已有人工 rep 边界的真实观测轨迹，与 `simulated_nominal` 高位下拉 profile 比较。它不使用用户动作生成标准，也不输出质量分数。

## 固定假设

- 实际机位：`rear`。旧 labels 标为 `front`，与现场确认不一致，因此本次显式覆盖；未确认前不可将结果升级为校准依据。
- 器械/变式：直杆正握高位下拉；双侧；MediaPipe heavy。
- 参考来源：模拟 phase-direction corridor，宽容差，未校准。

## 汇总

- 已读取人工标注 rep：22
- 可比较 rep：22
- 被拒绝 rep：0
- 可比较节点：6516
- 模拟带外节点：455

## 逐 rep 结果

| 录像 | rep | 状态 | 可比较节点 | 带外节点 | 说明 |
| --- | ---: | --- | ---: | ---: | --- |
| field-capture-2026-08-02T18-41-55-780Z | 1 | comparison_available | 288 | 6 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 2 | comparison_available | 288 | 6 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 3 | comparison_available | 288 | 6 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 4 | comparison_available | 288 | 9 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 5 | comparison_available | 288 | 5 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 6 | comparison_available | 288 | 11 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 7 | comparison_available | 288 | 8 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 8 | comparison_available | 288 | 7 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-41-55-780Z | 9 | comparison_available | 271 | 149 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-44-00-128Z | 1 | comparison_available | 332 | 18 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-44-00-128Z | 2 | comparison_available | 328 | 4 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-44-00-128Z | 3 | comparison_available | 332 | 26 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-44-00-128Z | 4 | comparison_available | 320 | 10 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-44-00-128Z | 5 | comparison_available | 312 | 12 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-44-00-128Z | 6 | comparison_available | 314 | 15 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-46-52-295Z | 1 | comparison_available | 288 | 6 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-46-52-295Z | 2 | comparison_available | 288 | 11 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-46-52-295Z | 3 | comparison_available | 288 | 3 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-46-52-295Z | 4 | comparison_available | 288 | 5 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-46-52-295Z | 5 | comparison_available | 288 | 3 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-46-52-295Z | 6 | comparison_available | 288 | 9 | 模拟参考带偏离证据；不是动作总分。 |
| field-capture-2026-08-02T18-46-52-295Z | 7 | comparison_available | 275 | 126 | 模拟参考带偏离证据；不是动作总分。 |

## 如何用真实录像修正模拟基线

1. 先在审核页确认每组实际八向机位、直杆变式和 rep 边界。
2. 将可比较 rep 分成‘可作为校准样本’与‘仅挑战样本’；不得因为用户做得不标准就自动将其带外路径吸收为标准。
3. 同一 identity 至少积累 6 个确认 rep 后，生成个人/器械/机位 corridor；保留 simulated baseline 以便追溯校准前后的差异。
