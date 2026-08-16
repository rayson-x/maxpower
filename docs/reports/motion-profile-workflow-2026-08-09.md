# Motion Profile Workflow 2026-08-09

结论：**self 与 MM-Fit research candidates 均改善，但冻结门槛未达到 95%，不可 promotion**。self tuning 是 legacy/in-sample；MM-Fit 候选搜索使用 301 段官方 train RGB 的 mmfit_mediapipe33_heavy_cpu，冻结评测仍使用全 616 组 mmfit_openpose18_mapped set-count 弱标签。

## Self：人工逐 rep 标签（不与 MM-Fit 合并）

| 集合 | Profile | 标注 rep | 预测 | 匹配 | Recall | Precision | 负窗口 FP | 精确计数录像 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 兼容性 baseline（历史 replay） | Parent | 89 | 79 | 61 | 68.54% | 77.22% | 21 | 2/11 |
| 全部 11 条端到端 | Parent | 89 | 74 | 60 | 67.42% | 81.08% | 18 | 3/11 |
| 全部 11 条端到端 | Candidate | 89 | 73 | 68 | 76.40% | 93.15% | 6 | 8/11 |
| 4 条 tuning eligible | Candidate | 42 | 42 | 41 | 97.62% | 97.62% | 2 | 4/4 |
| 7 条 challenge（含 3 条当前算法无 profile） | Candidate | 47 | 31 | 27 | 57.45% | 87.10% | 4 | 4/7 |

## MM-Fit 原生 Heavy train-only 诊断（不可称为泛化准确率）

| Bucket | Train clips | Selected profile | Train exact-set | Train MAE | Validation | Accepted |
|---|---:|---|---:|---:|---|---|
| push_up/body-orientation-front | 0 | n/a | n/a | n/a | n/a (0 clips) | no |
| push_up/body-orientation-oblique45 | 16 | secondary-side-direction-auto-fast | 100.00% | 0 | passed (6 clips) | secondary-side-direction-auto-fast |
| push_up/body-orientation-side | 6 | n/a | n/a | n/a | n/a (3 clips) | no |
| push_up/body-orientation-unknown | 10 | direction-auto-fast | 100.00% | 0 | unavailable (0 clips) | no |

## MM-Fit：set-count 弱标签（mmfit_openpose18_mapped）

| Split | Parent exact-set | Candidate exact-set | Parent MAE | Candidate MAE |
|---|---:|---:|---:|---:|
| train | 65.12% | 78.41% | 1.3854 | 0.6611 |
| validation | 66.28% | 84.88% | 1.4651 | 0.4767 |
| test | 77.78% | 88.89% | 0.5333 | 0.1778 |
| unseen_test | 53.96% | 69.78% | 2.0719 | 0.8058 |

## 95% gate

- Self tuning in-sample per-rep：通过（Recall 97.62% / Precision 97.62%），不能当泛化准确率。
- Self 全部 11 条端到端冻结回放：未通过（Recall 76.40% / Precision 93.15%）；当前算法无 exact profile 的录像按预测 0 计入分母。
- MM-Fit unseen exact-set：未通过（69.78%）。
- Promotion：未通过。

## Algorithm diagnosis

- 已修复真实算法缺陷：product set 的 Arming 会被逐帧姿态抖动无限重置；现在保留 500 ms 稳定快速路径，并在持续可观测 2,000 ms 后有界激活。
- 已修复 MM-Fit 评估缺陷：旧工作流把所有动作写死成 front initializer，静默漏掉 320/616 组；现在按动作推荐视角解析 initializer，冻结回放覆盖全部 616 组。
- Candidate 在全部人工标注数据上仍有 21 个漏检、5 个未匹配假检；tuning 数据的漏检为 1。
- 原生 Heavy MM-Fit 俯卧撑是顶部到顶部，旧 initializer 是底部到顶部再回到底部，因此 32 组中 31 组固定少 1；候选搜索已加入不读取标签、只从首个完整动作锁定方向的 Rust auto-direction，并显式搜索固定可见肘信号。
- 原生 Heavy 深蹲暴露单侧遮挡：一侧膝角近乎静止、另一侧保留 10 个周期；候选搜索已加入 Rust 现有 visible-side 状态图。
- 训练数据中的唯一未匹配假检来自俯卧撑：正式标注开始前存在一个完整运动周期，单靠骨架运动无法知道它是“准备”而不是 rep，需要可信 set-start 或明确负语义。
- 3 条正面杠铃卧推共 16 rep 是算法失败，不是视频失败：原始 RGB 已确认清楚，但 exact front profile 缺失，且 MediaPipe Heavy 在仰卧机位对肘/腕给出异常低置信度；它们现在按预测 0 全部计入漏检。
- 负窗口预测与未匹配假检不是同一指标：相位偏早的预测可能落在 rep 间窗口，但仍能与下一条人工 peak 一对一匹配。

## Leakage checks

- same sourceSequenceId has one split
- MM-Fit official subject split preserved
- self data remains legacy_unpartitioned
- self challenge captures are regression-only; selected self candidates list only the 4 admitted capture IDs.
- MM-Fit validation/test/unseen IDs do not enter search traces.

## Implementation and verification

- Rust SetGate 保留 500 ms 稳定快速路径，并增加 2,000 ms noisy-arming fallback；research profile 搜索新增 visible-side、push-up auto-direction 与固定可见肘候选；MM-Fit 回放按动作推荐视角解析 initializer 并覆盖全部 616 组；端到端指标不再删除无 profile 的人工标签，未改 ABI、MotionPacket、Android 或正式 profile。
- 修改范围包含 workflow、MM-Fit RGB Heavy 提取/合并、rolling profile trainer、对应测试及既有 SetGate 修复；完整清单见 JSON report 的 `implementation.sourceFiles`。
- `npm run test:motion-profile-workflow`：22/22 通过。
- `npm run test:external-fitness-data`：56/56 通过。
- `npm run test:mmfit-rgb-extractor`：6/6 通过。
- `npm run test:recognition-profile-tools`：2/2 通过。
- `npm run test:rust`：71/71 通过。
- `npm run test:motion-parity`：54 帧通过，坐标容差 0.00001。
- `npm run gate:recognition-corpus`：正确执行并按策略返回非零；冻结质量与 promotion 门槛未达到。

## Blockers

- self data: legacy_unpartitioned
- MM-Fit license: research-only policy pending formal review
- legacy_unpartitioned self data blocks promotable proposal

## Required next collection

- 为每个 exact exercise/view bucket 采集带 subject_id、session_id、device_id 的独立用户 holdout
- 保留现有 3 条正面杠铃卧推/16 rep 作为冻结算法回归：原始 RGB 中人体、双臂、手腕和杠铃清楚可见；修复仰卧机位姿态信号恢复与 exact-context profile 覆盖，不要求用户重录
- 为俯卧撑录制前准备动作增加明确 set-start 事件或单独负样本；当前准备阶段含一个与真 rep 同形的完整周期
- MM-Fit train RGB 与固定 MediaPipe Heavy 提取已完成；若要证明同域泛化，需另行授权并预先冻结 validation/test/unseen RGB 评测协议，本轮不下载
- 完成 MM-Fit research-only 许可与产品使用边界审查

Run artifacts: `data/workflows/motion-profile/recognition-corpus-v1/80f5e0ae5b0e4e1a980bcf21/`
