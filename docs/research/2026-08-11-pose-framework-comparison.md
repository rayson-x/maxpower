# 姿态识别框架选型对比：YOLO、MediaPipe、OpenPose、MMPose（2026-08-11）

## 结论先行

对 MaxPower 这个**商业闭源 Android 客户端**而言，四个框架里只有两个通得过授权关：MediaPipe（Apache-2.0）和 MMPose（Apache-2.0）。

- **OpenPose 直接出局，双重否决。** 它的授权明确限定为学术/非营利机构的非商业研究用途，且 LICENSE 中不存在任何商业授权通道；同时它最后一个 release 是 `v1.7.0`（2020-11-17），距今约 5 年 9 个月，已无实质维护。
- **Ultralytics YOLO 是一笔要付钱的授权。** 代码库是 AGPL-3.0，把它放进闭源商业 App 意味着必须公开整个衍生作品的源码（按厂商自己的说明，还包括模型权重），否则必须购买 Enterprise License。这是采购决策，不是技术决策。
- **MMPose / RTMPose 是唯一值得评估的 MediaPipe 替代或补充。** Apache-2.0 授权干净，端侧数据具体（骁龙 865 上 RTMPose-s 达 70+ FPS），且官方支持导出到 ncnn / ONNX / CoreML。但仓库最后一个 release 停在 2024-07-12。
- **建议保持 MediaPipe 作为关键点来源，不要换。** 决定性理由不是精度，而是本仓库 Rust Motion SDK 安装 profile 时接受的 contract **固定为 BlazePose33**（见 [`current-capability-audit-2026-08-04.md`](../reports/current-capability-audit-2026-08-04.md)）。更换关键点格式会让现有全部已训练 profile、kinematics profile 和参考轨迹样本一次性失效。

> 边界：本篇只解决「用哪个框架产出关键点」。它不评估动作识别与计次方法、商业健身 SDK、端侧推理运行时 —— 那三块见 [`2026-08-10-recognition-tech-scope-expansion.md`](2026-08-10-recognition-tech-scope-expansion.md)。本篇也不重复 [`2026-08-06-dominant-subject-pose-tracking.md`](2026-08-06-dominant-subject-pose-tracking.md) 已确立的结论：MediaPipe 不提供稳定 track id、主体选择必须由 MaxPower 自己的追踪层负责。

## 一手证据

### 1. 授权：唯一的硬约束

四个 LICENSE 文件均直接取自各仓库主分支原文。

| 框架 | 授权 | 商业闭源可用性 | 出处 |
| --- | --- | --- | --- |
| OpenPose | CMU 非商业学术授权 | **否** | [LICENSE](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/LICENSE) |
| Ultralytics YOLO | AGPL-3.0 | **需购买 Enterprise License** | [LICENSE](https://github.com/ultralytics/ultralytics/blob/main/LICENSE) |
| MediaPipe | Apache-2.0 | 是 | [LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) |
| MMPose | Apache-2.0 | 是 | [LICENSE](https://github.com/open-mmlab/mmpose/blob/main/LICENSE) |

**OpenPose** 的授权原文限定使用主体为「academic institution or non-profit organization」，用途为「NONCOMMERCIAL RESEARCH USE ONLY」，并写明「The Software may be used for your own noncommercial internal research purposes」。同时禁止转售、分授权与向第三方提供访问：「You may not sell, rent, lease, sublicense, lend, time-share or transfer, in whole or in part, or provide third parties access to prior or present versions (or any parts thereof) of the Software.」LICENSE 全文未提供任何商业授权联系方式或付费通道。

**Ultralytics** 的 LICENSE 文件是标准的 GNU Affero General Public License Version 3（2007-11-19）原文。AGPL-3.0 的网络 copyleft 意味着衍生作品必须以同等授权公开源码。厂商在自己的授权说明中把 Enterprise License 定位为「在专有闭源产品中嵌入 YOLO 而不承担开源义务」的付费方案，并说明 AGPL-3.0 合规要求公开整个衍生作品的完整对应源码，包括更大的应用、修改、脚本、配置文件，以及在适用情况下的模型权重。[Ultralytics License](https://www.ultralytics.com/license)、[AGPL-3.0 说明](https://www.ultralytics.com/legal/agpl-3-0-software-license)

**MediaPipe** 主授权为 Apache-2.0，另含一段用于 UTF 工具的 Lucent Technologies 授权（Rob Pike / Ken Thompson，2002），该段比 Apache-2.0 更宽松，仅要求保留完整声明。

**MMPose** 为标准 Apache-2.0，版权归 Open-MMLab（2018-2020），无非标准条款，仅含 Apache 常规的专利终止条款与商标限制。

> 边界：「YOLO」不是单一授权对象。上表只针对 **Ultralytics** 的实现。YOLO 系列的其他实现（如 YOLOX 等）由不同团队以不同授权发布，不能用本行结论套用。若确需 YOLO 路线，必须逐个实现单独核对 LICENSE。

> 未验证：MediaPipe 与 Ultralytics 的**模型权重**是否与代码库适用同一授权，本轮未逐个查证 model card。Ultralytics 一侧厂商说明提到权重「在适用情况下」纳入 AGPL 公开义务，但未取得权重文件自身的授权原文。做采购决策前必须补齐这一条。

### 2. 维护活跃度：用 release 日期作证据

| 框架 | 最新 release | 发布时间 | 距今 |
| --- | --- | --- | --- |
| Ultralytics | `v8.4.117` | 2026-08-09 | 2 天 |
| MediaPipe | `v1.0.0` | 2026-07-28 | 约 2 周 |
| MMPose | `v1.3.2` | 2024-07-12 | 约 2 年 |
| OpenPose | `v1.7.0` | 2020-11-17 | 约 5 年 9 个月 |

数据取自各仓库 GitHub Releases API 的 `tag_name` 与 `published_at` 字段。

OpenPose 近六年无 release，这一条独立于授权问题，本身就足以排除它进入生产路径。MMPose 停更两年是一个需要正视的风险：它仍可用，但不应假设会有针对新 Android 版本或新硬件的适配。

### 3. RTMPose：MMPose 一侧唯一有完整端侧数据的方案

MMPose 是工具箱而非单一模型，其中面向实时端侧场景的是 RTMPose。官方 README 公布的数据如下。

**COCO AP 精度**

| 模型 | AP | 参数量 |
| --- | --- | --- |
| RTMPose-t | 68.5% | 3.34M |
| RTMPose-s | 72.2% | 5.47M |
| RTMPose-m | 75.8% | 13.59M |
| RTMPose-l | 76.5% | 27.66M |
| RTMPose-l-384 | 78.3% | — |

**推理延迟（官方标注硬件）**

| 硬件 | 模型 | 延迟 / 吞吐 |
| --- | --- | --- |
| Intel i7-11700 (CPU) | RTMPose-m | 11.06 ms，90+ FPS |
| NVIDIA GTX 1660 Ti | RTMPose-m | 2.29 ms，430+ FPS |
| **骁龙 865** | RTMPose-s | **70+ FPS** |
| **骁龙 865** | RTMPose-m | **26.44 ms** |

**部署后端**：官方支持 ONNX、TensorRT、ncnn、OpenVINO，另有 CoreML、RKNN、TorchScript，均通过 MMDeploy 转换。

出处：[RTMPose 官方 README](https://github.com/open-mmlab/mmpose/blob/main/projects/rtmpose/README.md)

骁龙 865 的数字是关键：它证明 Apache-2.0 授权下存在端侧实时可行的方案，MaxPower 若要摆脱对 MediaPipe 的单点依赖，RTMPose 是当前唯一有公开端侧实测数据支撑的候选。

> 边界：上述 AP 是 COCO 通用人体姿态基准，**不能外推为健身动作的计次或质量判断准确率**。本仓库 [`unified-recognition-corpus-gate-2026-08-09.md`](../reports/unified-recognition-corpus-gate-2026-08-09.md) 已确立按「动作 × 变式 × 器械 × 机位」逐组验证的口径，COCO AP 不能替代它。

### 4. Ultralytics YOLO：当前是 YOLO26 世代，pose 为 17 点

当前文档中的模型线是 **YOLO26**，不是 YOLO11。官方描述其为统一模型family，引入 native end-to-end 推理、更轻的检测头、去掉 Distribution Focal Loss、使用 MuSGD 优化器，并声称 YOLO26n 相比 YOLO11n 有「up to 43% faster CPU ONNX inference」，pose 任务上「up to +7.2 AP over YOLO11 on COCO pose estimation」（使用 Residual Log-Likelihood Estimation 做关键点定位）。[YOLO26 文档](https://github.com/ultralytics/ultralytics/blob/main/docs/en/models/yolo26.md)

**关键点格式**：17 点，COCO 约定，索引 0（Nose）至 16（Right Ankle），覆盖眼、耳、肩、肘、腕、髋、膝、踝。官方表述为「The locations of the keypoints are usually represented as a set of 2D [x, y] coordinates, optionally with a visibility flag [x, y, visible]」，数据集侧为「using a 17-keypoint schema for the single 'person' class」。[Pose 任务文档](https://github.com/ultralytics/ultralytics/blob/main/docs/en/tasks/pose.md)

**官方性能表**（COCO pose，输入 640px，e2e）：

| 模型 | mAP50-95 | mAP50 | CPU ONNX (ms) | T4 TensorRT10 (ms) | 参数量 (M) | FLOPs (B) |
| --- | --- | --- | --- | --- | --- | --- |
| YOLO26n-pose | 57.2 | 83.3 | 40.3 ± 0.5 | 1.8 ± 0.0 | 2.9 | 7.5 |
| YOLO26s-pose | 63.0 | 86.6 | 85.3 ± 0.9 | 2.7 ± 0.0 | 10.4 | 23.9 |
| YOLO26m-pose | 68.8 | 89.6 | 218.0 ± 1.5 | 5.0 ± 0.1 | 21.5 | 73.1 |
| YOLO26l-pose | 70.4 | 90.5 | 275.4 ± 2.4 | 6.5 ± 0.1 | 25.9 | 91.3 |
| YOLO26x-pose | 71.6 | 91.6 | 565.4 ± 3.0 | 12.2 ± 0.2 | 57.6 | 201.7 |

出处：[yolo-pose-perf 性能表](https://github.com/ultralytics/ultralytics/blob/main/docs/macros/yolo-pose-perf.md)。Pose 文档标注速度测量使用 Amazon EC2 P4d 实例。

**导出格式**：TensorRT、ONNX、CoreML、LiteRT、OpenVINO。

**授权（补充确认）**：YOLO26 文档明确写明「Code and models are available under AGPL-3.0 and Enterprise licenses」—— 即**模型权重与代码适用同一授权**，此前标为未验证的那一条在 Ultralytics 一侧现已确认。

> 边界：上表**没有任何移动端 SoC 的实测数据**。CPU 数字来自服务器/桌面级 ONNX 推理（EC2 P4d），GPU 数字来自 NVIDIA T4。这与 RTMPose 公布的骁龙 865 实测数据**不可直接比较**。

> 边界：YOLO26-pose 的 mAP 与 RTMPose 的 COCO AP **不能直接并列比较**。YOLO26-pose 是单阶段 e2e，指标包含人体检测本身；RTMPose 是自顶向下方案，需要先有人体框。两者的评测口径不同，本轮未逐一核对各自的 eval protocol。

### 5. MediaPipe 一侧的既有事实

MediaPipe Pose Landmarker 的 API 行为、`numPoses` 语义、`visibility` 含义、以及 stream 模式下 ROI 回用不构成稳定主体 ID 这几点，已在 [`2026-08-06-dominant-subject-pose-tracking.md`](2026-08-06-dominant-subject-pose-tracking.md) 中以官方文档与源码逐条论证，本篇不重复。BlazePose 输出 33 个关键点、可在 Pixel 2 上超过 30 FPS 的原始结论出自 [BlazePose 论文](https://arxiv.org/abs/2006.10204)。

> 未验证：本轮尝试抓取 `ai.google.dev` 上 Pose Landmarker 的模型变体（Lite / Full / Heavy）体积与官方延迟表时连接中断，未取得数据。该页面的模型规格、world landmarks 输出细节与模型自身授权仍需补查。这一缺口不影响本篇的选型结论（该结论由授权与 contract 锁定驱动），但影响后续任何「换用更重/更轻档位」的调参决策。

## 关键点格式：真正锁死选型的因素

三种格式互不兼容：BlazePose 33 点（MediaPipe）、COCO 17 点（RTMPose、Ultralytics YOLO-pose 等主流实现）、BODY_25（OpenPose）。

本仓库的约束是硬的：Rust Motion SDK 当前接受的 profile contract **固定为 BlazePose33、image-normalized-y、固定状态图**（[`current-capability-audit-2026-08-04.md`](../reports/current-capability-audit-2026-08-04.md) 的「已有但受限」第 2 条，证据指向 [`rustCanonicalWasm.ts`](../../src/motion/rustCanonicalWasm.ts) 与 [`lib.rs`](../../rust/motion-sdk/src/lib.rs)）。

这意味着换用任何输出 COCO 17 的框架，都不是替换一个依赖，而是：既有全部已训练的分割/计次 profile 作废、高位下拉参考轨迹样本作废、MMFit 语料上跑出的全部 benchmark 作废、Rust 侧的 contract 与状态机需要重写。

> 未验证：COCO 17 与 BODY_25 的具体关键点定义本轮未逐点核对官方定义文件。上述「互不兼容」的判断基于关键点数量差异，若要做真正的迁移评估，需要逐点映射并确认缺失关节（COCO 17 无手部与足部细分点，而 BlazePose 33 含之）对现有 kinematics profile 的影响。

## 对 MaxPower 的选型建议

1. **保持 MediaPipe 作为关键点来源，不要迁移。** 理由不是它精度最高，而是 BlazePose33 已被 Rust contract 锁定，迁移成本是全部既有 profile 与语料资产。它同时满足 Apache-2.0 与活跃维护两个条件。
2. **OpenPose 从所有候选中移除。** 非商业授权 + 近六年无 release，两条中任意一条都足以否决。不要再在后续调研中把它列为选项。
3. **Ultralytics YOLO 只在预算内作为采购项讨论。** 技术上它维护最活跃（2 天前刚发版），但 AGPL-3.0 对闭源商业 App 的要求是公开整个衍生作品源码。要么买 Enterprise License，要么不用。不存在「先用着以后再说」的合规路径。
4. **把 RTMPose 列为唯一的备选评估对象，但现在不要动手。** 它是 Apache-2.0 且有骁龙 865 的公开端侧数据，是 MediaPipe 出问题时的现实退路。但在 BlazePose33 contract 解耦之前，评估它没有落地价值。
5. **最小验证方式**：若未来要真正评估 RTMPose，第一步不是跑精度，而是先确认 Rust SDK 的 profile contract 能否参数化关键点拓扑。这个前置条件不成立，后面的精度对比都是沉没成本。

## 未取得官方数据的条目

- MediaPipe Pose Landmarker 模型变体体积、官方延迟表、world landmarks 规格、模型自身授权（`ai.google.dev` 连接中断）。
- MediaPipe 与 Ultralytics 模型权重是否与代码库适用同一授权（未查证 model card 原文）。
- COCO 17 与 BODY_25 的逐点关键点定义。
- Ultralytics Enterprise License 的定价（未查证）。
