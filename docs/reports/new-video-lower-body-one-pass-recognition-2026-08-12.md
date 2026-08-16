# new-video 下肢动作一次顺序识别

这些视频尚未标注，因此本页只报告骨架可观测性和候选 rep，不能报告准确率。每条视频只按时间顺序通过一次 Rust profile。

| 视频 | 暂定动作 / 机位 | 精确 profile | 下肢六点全可见 | 候选 confirmed / review | 器械辅助 |
|---|---|---|---:|---:|---|
| `0509c30c` | `barbell_back_squat` / `left` | 模拟初始化 | 88.2% | 6 / 1 | 已请求但检测器未接入 |
| `1f9b98c3` | `alternating_lunge` / `frontLeft45` | 模拟初始化 | 84.8% | 10 / 1 | 关闭 |
| `25ae9076` | `walking_lunge` / `frontLeft45` | 模拟初始化 | 87.0% | 5 / 2 | 已请求但检测器未接入 |
| `480139c4` | `romanian_deadlift` / `front` | 无 | 83.4% | — / — | 已请求但检测器未接入 |
| `4b49a7b8` | `barbell_back_squat` / `front` | 无 | 98.1% | — / — | 已请求但检测器未接入 |
| `59991a88` | `conventional_deadlift` / `frontLeft45` | 模拟初始化 | 89.8% | 6 / 0 | 已请求但检测器未接入 |
| `8b960133` | `barbell_back_squat` / `front` | 无 | 88.5% | — / — | 已请求但检测器未接入 |
| `8cff47f1` | `conventional_deadlift` / `frontLeft45` | 模拟初始化 | 91.3% | 5 / 0 | 已请求但检测器未接入 |
| `a3cc29e0` | `conventional_deadlift` / `frontLeft45` | 模拟初始化 | 86.4% | 3 / 0 | 已请求但检测器未接入 |
| `af367638` | `romanian_deadlift` / `frontLeft45` | 模拟初始化 | 88.1% | 6 / 0 | 已请求但检测器未接入 |
| `f1158228` | `barbell_back_squat` / `left` | 模拟初始化 | 68.3% | 5 / 1 | 已请求但检测器未接入 |

## 结论边界

- `confirmed` 只是模拟初始化 profile 的候选，不是真值，也不是动作质量结论。
- `front` 机位没有对应的下肢初始化 profile 时直接标为不可运行，没有借用其他机位 profile。
- 要得到准确率，下一步只需标每个 rep 的起止范围；顶点可以由轨迹先提议、再由人审核。
- 本轮没有训练过的杠铃/哑铃检测器，所以即使动作策略请求器械辅助，也没有把虚假的器械观测送进 Rust。
