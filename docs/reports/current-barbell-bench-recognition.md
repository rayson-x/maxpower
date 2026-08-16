# 当前杠铃卧推识别能力

**状态：CURRENT**  
**更新日期：2026-08-13**

这是 `barbell_bench_press` 当前唯一可用于能力声明和后续验收的报告。后续卧推实验更新本文件，不再新增按日期命名的卧推能力报告。历史实验不属于当前能力事实；底层冻结预测和揭盲评测继续保存在 `data/workflows/` 作为可复查证据。

## 当前结论

当前高识别率确实来自 **杠铃轨迹主导的阶段边界 + RTMPose Halpe-26 骨架观测 + Rust Motion SDK 因果状态机**，不是单独依赖骨架。

运行链路为：

```text
视频帧
  -> ONNX Runtime Web：YOLOX 人体候选 + RTMPose-m Halpe-26
  -> 因果杠铃轴检测与连续轨迹
  -> Rust Motion SDK：主体关联、器械/骨架融合、阶段和 Rep 封口
  -> Canonical Motion Output / Realtime Agent 报告
```

所有帧按视频时间顺序只处理一次；不读取未来帧、不回看、不重复推理，`pythonVisionUsed=false`。本轮 Web 验证的最低有效观测频率为 10.04 FPS，最大单帧推理为 150.6 ms。

## 人工真值和样本

- 动作：杠铃卧推。
- 机位：`front`、`frontLeft45`、`frontRight45`。
- 用户：1 人。
- 视频：6 条个人卧推视频。
- 人工真值：46 个 Rep；每个 Rep 均有人工 start、turnaround、end。
- 预测协议：冻结单次因果预测后才读取人工真值评分。
- 46 个可观察 Rep 全部包含 `equipment_primary_boundary`，说明计次和阶段边界实际使用了杠铃轨迹。

这组结果属于同一用户既有六条视频的客户端自回放验证，用于证明真实 Web/Rust 链路和现有个人数据的对齐能力；它不是新用户、新场地或训练来源隔离的泛化结果。

## 当前验收结果

### 高置信确认通道

| 指标 | 结果 |
|---|---:|
| 人工 Rep | 46 |
| Rust confirmed | 45 |
| 匹配 | 45 |
| Precision | 100.0% |
| Recall | 97.8% |
| 整组计次完全一致 | 83.3% |
| Start ±500 ms | 95.7% |
| Turnaround ±250 ms | 97.8% |
| End ±500 ms | 97.8% |
| Start + turnaround + end 全部对齐 | 95.7% |

### 包含 needs-review 的可观察通道

其中 1 个真实 Rep 因杠铃轨迹覆盖率不足进入 `needs_review`，没有被丢弃。将其计入可观察结果：

| 指标 | 结果 |
|---|---:|
| 预测 / 匹配 | 46 / 46 |
| Precision | 100.0% |
| Recall | 100.0% |
| 整组计次完全一致 | 100.0% |
| 人工区间对齐 | 97.8% |
| Start ±500 ms | 97.8% |
| Turnaround ±250 ms | 97.8% |
| End ±500 ms | 100.0% |
| Start + turnaround + end 全部对齐 | 95.7% |

因此当前卧推结论是：**可观察通道已完整找回 46/46 Rep；严格高置信通道为 45/46，剩余 1 个正确进入人工复核，而不是被错误确认。**

## 杠铃轨迹为什么是关键

同一批冻结客户端观测关闭杠铃主阶段逻辑、只运行 pose 稳定周期的消融结果：

| 指标 | 杠铃 + 骨架当前链路 | Pose-only 消融 |
|---|---:|---:|
| Recall | 97.8%（confirmed）/ 100.0%（含复核） | 21.7% |
| Precision | 100.0% | 90.9% |
| 整组计次完全一致 | 83.3% / 100.0% | 0% |
| 三端点全部对齐 | 95.7% | 0% |

这说明在正面仰卧、腕肘被杠铃遮挡和镜面干扰的情况下，杠铃轨迹不是可有可无的附加信号，而是卧推离心、最低点、向心和 Rep 边界的核心观测；骨架负责主体关联、身体运动策略、可见关节与器械一致性等辅助证据。

## 当前可以与不能声称的能力

当前可以声称：

- 在这 1 名用户、6 条已审核卧推视频、3 种已覆盖机位上，Web 可运行的单次因果链路可以稳定识别杠铃卧推 Rep 和离心/向心 turnaround。
- Rust 输出每个 Rep 的 start、turnaround、end、阶段时长、器械轨迹覆盖率、骨架观测和 pose/equipment 一致性。
- 当前高结果依赖器械轨迹与骨架联合理解，不能退回 pose-only。

当前不能声称：

- 对新用户、新场地、新镜面布局或训练来源隔离视频仍有相同准确率。
- 已有骨架关键点像素级真值，因此不能把 Rep/阶段准确率称为“骨架准确率”。
- 已经能可靠判断标准动作、借力、刺激偏移、左右真实力量、RPE/RIR 或肌肉激活。
- Web 结果已经等价完成 Android/iOS 实机性能和摄像头实时流验收。

## 当前证据入口

- 冻结输入包：`data/workflows/client-realtime-agent/web-rust-barbell-v1/test-pack-six-barbell-primary-before-truth.json`
- 揭盲前单次因果预测：`data/workflows/client-realtime-agent/web-rust-barbell-v1/prediction-six-barbell-fixed-15hz-v23-before-truth.json`
- 揭盲后评测：`data/workflows/client-realtime-agent/web-rust-barbell-v1/evaluation-six-barbell-fixed-15hz-v23-after-truth.json`
- Pose-only 消融：`data/workflows/client-realtime-agent/web-rust-barbell-v1/ablation-six-pose-only-stable-cycle-after-truth.json`
- Realtime Agent 输入与输出：`data/workflows/client-realtime-agent/web-rust-barbell-v1/realtime-agent-six-barbell-fixed-15hz-v23-before-truth.json`

评测文件通过 `predictionSha256` 绑定揭盲前预测；当前预测 SHA-256 为 `16901e87b8049aa0292c58ba75354b3e96b2188b5b1c4fce1123d3f4be7d8179`。

## 下一次单变量实验

保持模型、Rust profile、阈值、动作和机位不变，只把输入从既有视频单次因果回放替换为 Web 实时摄像头流。成功信号是：计次、start、turnaround、end 和 needs-review 分流均不低于本报告结果；随后再使用来源隔离的新 session 验收泛化能力。
