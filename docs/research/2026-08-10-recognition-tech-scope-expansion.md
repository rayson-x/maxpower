# 识别技术调研范围扩展：动作识别方法、商业健身 SDK、端侧推理运行时（2026-08-10）

> 状态：进行中。本文件按「查证一块写一块」的方式增量落盘，未完成小节以 `> 未完成` 标记。

## 结论先行

> 未完成

## 与前作的关系

### 分工声明

- 本篇**不覆盖姿态估计框架的横向对比与授权**（YOLO / MediaPipe / OpenPose / MMPose）。该主题由并行进行的 `docs/research/2026-08-10-pose-framework-comparison.md` 负责，本文不重复其内容，也不修改该文件。本文默认「产品继续以 MediaPipe Pose Landmarker 为端侧生产骨架、RTMPose 为离线 evaluator」这一已有结论，只在需要引用时指向该篇。
- 本篇覆盖三块前作没有系统查证过的范围：**（A）动作识别与计次的方法族边界**、**（B）商业健身动作识别 SDK 的可验证事实**、**（C）端侧推理运行时在 Android + Expo/RN 场景下的真实可行性**。

### 各前作已确立、本篇沿用的结论

| 前作 | 已确立、本篇沿用的结论 |
| --- | --- |
| [`2026-08-09-skeleton-tracking-action-recognition-expansion.md`](2026-08-09-skeleton-tracking-action-recognition-expansion.md) | ST-GCN / PoseC3D 属于「离线研究路线」，不作为首版移动端依赖；公开动作数据集（NTU RGB+D、Fitness-AQA、FLEX）有明确非商业限制；代码许可 ≠ 权重许可 ≠ 训练数据许可。 |
| [`2026-08-09-rep-completion-recognition-technical-selection.md`](2026-08-09-rep-completion-recognition-technical-selection.md) | 不为点数自研 111/113 点骨架；DTW/HMM/GCN 不得重新决定 rep 边界；Kemtai 专利 US11727726B2 的技术事实核验（不构成 FTO 结论）。 |
| [`2026-08-09-path-to-95-percent-pose-rep-counting.md`](2026-08-09-path-to-95-percent-pose-rep-counting.md) | MM-Fit skeleton 基线 69.81% vs 本项目 69.48%；RepNet/TransRAC/PoseRAC 的 OBO 口径不等于 exact-set；推荐「轻量因果相位头 + Rust 受约束状态图」。 |
| [`2026-08-09-barbell-dumbbell-equipment-detection-tracking.md`](2026-08-09-barbell-dumbbell-equipment-detection-tracking.md) | Android 推理路径先 ONNX Runtime Mobile、ncnn 作为性能备选；Ultralytics AGPL-3.0 商业限制。 |
| [`2026-08-08-rust-motion-profiles-android-injection.md`](2026-08-08-rust-motion-profiles-android-injection.md) | Rust 是唯一 rep/phase engine；65/65 推荐机位可装载 executable profile；Android 已有 data-profile JNI 安装链路（ABI 1.5）。 |
| [`docs/reports/current-capability-audit-2026-08-04.md`](../reports/current-capability-audit-2026-08-04.md) | 现有能力只到「可比较/证据不足」，无已批准质量参考；性能证据只有 PC host 微基准。 |

### 本篇新增了什么

> 未完成（待各章节查证后回填）

### 本篇推翻/修正了什么

> 未完成（待各章节查证后回填）

## 一手证据 A：动作识别与计次方法

### A1 骨架序列方法（ST-GCN / CTR-GCN / PoseC3D）

> 未完成

### A2 基于视频（RGB）的方法

> 未完成

### A3 周期性信号方法（RepNet 一类）

> 未完成

### A4 规则 / 状态机方法

> 未完成

### A5 方法横向对比表

> 未完成

## 一手证据 B：商业健身动作识别 SDK

### B1 Sency

> 未完成

### B2 Kemtai

> 未完成

### B3 Exer Health

> 未完成

### B4 Vay Sports

> 未完成

### B5 Qinematic

> 未完成

### B6 其他厂商

> 未完成

### B7 厂商横向对比表

> 未完成

## 一手证据 C：端侧推理运行时

### C1 LiteRT（原 TensorFlow Lite）

> 未完成

### C2 ONNX Runtime Mobile / React Native

> 未完成

### C3 NCNN

> 未完成

### C4 MNN

> 未完成

### C5 ExecuTorch

> 未完成

### C6 Core ML

> 未完成

### C7 运行时横向对比表

> 未完成

## 对 MaxPower 的可执行建议

> 未完成

## 未找到官方数据的条目

> 未完成
