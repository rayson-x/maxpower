# MaxPower 当前能力审计（2026-08-04）

## 结论

项目已经具备一个可在 **PC Web** 上运行的本地闭环：摄像头/导入视频 → MediaPipe 提取关键点 → Rust WASM 处理 canonical 骨架、人物锁定、连续性和已支持动作的 rep 状态机 → 同一 Rust packet 用于渲染、录制、导出和分析。它不是概念验证，也不是只有 TypeScript 的模拟逻辑。

但它尚未具备“用户标注后自动学得标准动作轨迹，并为任意动作给出校准后的质量结论”的能力。当前标注首先是 **分段、计数、抗干扰真值/候选数据**；高位下拉才有一条受严格门控的、描述性的参考轨迹比较通路，而且现有导出没有专家审核参考，因此不会安装为可运行时比较的标准 profile。

审计范围为当前工作区源码、Rust SDK、测试、归档 manifest、以及本机导出的审批 JSON；没有将历史报告中的推测当成实现事实。

## 已实现且可运行

| 能力 | 当前行为 | 一手证据 |
| --- | --- | --- |
| Web 采集与本地保存 | 摄像头预览与录制分开；点击录制后才重置 canonical 序列并写入录像、关键点、分析/标签模板和 metadata 到浏览器 IndexedDB，同时可导出完整采集包。 | [`CameraPoseView.web.tsx`](../../src/components/CameraPoseView.web.tsx) 的 `start`、`startRecording`、`finalizeRecording`、`exportLocalCapture`（约 1407–1890 行）；[`localCaptureStore.ts`](../../src/pose/localCaptureStore.ts) |
| 本地视频与已归档视频重放 | 支持导入本地视频；审核页读取 `public/archives/confirmed-captures/manifest.json`，逐条加载视频、关键点、labels 与 metadata。 | [`CameraPoseView.web.tsx`](../../src/components/CameraPoseView.web.tsx) 的 `startUrl` / `startFile`；[`CaptureApprovalPanel.web.tsx`](../../src/components/CaptureApprovalPanel.web.tsx#L393) 的 `loadProjectCaptures` |
| 审核标注 | 可选择候选、手工新增/拖动/缩放 rep 时间段、撤回/清空、填写备注；每次编辑通过 `useLayoutEffect` 即时写入 `localStorage`，批准前强制校验动作、实际机位、次数和非重叠边界。 | [`CaptureApprovalPanel.web.tsx`](../../src/components/CaptureApprovalPanel.web.tsx#L132-L211)、[约 526–760 行](../../src/components/CaptureApprovalPanel.web.tsx)、[约 849–929 行](../../src/components/CaptureApprovalPanel.web.tsx)；[`reviewTimeline.ts`](../../src/pose/reviewTimeline.ts) |
| MediaPipe→Rust WASM 推理链路 | 浏览器负责相机与 MediaPipe 候选关键点；WASM 加载成功时为每段序列创建 `RustCanonicalWasmSession`。每帧候选点送入 Rust，Rust packet 再路由给渲染、计数、录制和分析。WASM 加载失败会显式标注为 diagnostic TS fallback。 | [`rustCanonicalWasm.ts`](../../src/motion/rustCanonicalWasm.ts#L216-L233)、[`CameraPoseView.web.tsx`](../../src/components/CameraPoseView.web.tsx#L690-L706)、[约 805–844 与 1019–1253 行](../../src/components/CameraPoseView.web.tsx) |
| 人物锁定与抗串人 | Rust 多人候选追踪有 central-stable 策略；身份边界发生时会清 continuity、终止活动 rep、增加 subject epoch。 | [`web_abi.rs`](../../rust/motion-sdk/src/web_abi.rs#L351-L403)；[`subject_contract.rs`](../../rust/motion-sdk/tests/subject_contract.rs) |
| 骨架连续性修复 | Rust 处理 raw/fusion、短缺失预测、弱点融合、尖峰拒绝；超出可靠窗口会输出 unknown 而不是伪造坐标。 | [`lib.rs`](../../rust/motion-sdk/src/lib.rs#L2075) 的 `ContinuityEngine`；[`continuity_contract.rs`](../../rust/motion-sdk/tests/continuity_contract.rs)；[`README.md`](../../rust/motion-sdk/README.md) 的 data contract |
| rep 状态机与干扰过滤 | Rust 使用 Ready→Effort→Peak→Return 多关节状态机，封存的 rep 带 immutable start/peak/end、hash 与 revision；对平移式移动、短/长丢点、底部抖动有明确处理。 | [`lib.rs`](../../rust/motion-sdk/src/lib.rs#L1472-L1666)；[`rep_contract.rs`](../../rust/motion-sdk/tests/rep_contract.rs) |
| 标注驱动的分段/计数评估 | 训练工具对每个动作+实际机位分桶，使用人工 rep 边界、完整审核时的非 rep 窗口、留一组评估来选参数；未通过验证的档案不发布。 | [`segmentationTraining.ts`](../../src/pose/segmentationTraining.ts)；[`tools/segmentation-training/train.ts`](../../tools/segmentation-training/train.ts)；[`segmentation-training-2026-08-03.md`](segmentation-training-2026-08-03.md) |
| 高位下拉轨迹样本与比较基础 | 已可把经过批准的高位下拉边界转为 32 帧、躯干归一化、多关节轨迹样本；Rust 有严格上下文门控的 16+16 相位 reference corridor 比较，并输出“可比较/未知/带外”的描述证据。 | [`trajectoryDataset.ts`](../../src/pose/trajectoryDataset.ts#L96)、[`referenceTrajectory.ts`](../../src/pose/referenceTrajectory.ts)、[`lib.rs`](../../rust/motion-sdk/src/lib.rs#L2860)、[`reference_match_contract.rs`](../../rust/motion-sdk/tests/reference_match_contract.rs) |
| 同一数据源给渲染与导出 | Rust 输出 versioned MotionPacket；TS 解码一次并将同一 frozen packet 分派给渲染、录制、计数和分析，避免“画面是一套数据、导出是另一套数据”。 | [`rustCanonicalWasm.ts`](../../src/motion/rustCanonicalWasm.ts)、[`CameraPoseView.web.tsx`](../../src/components/CameraPoseView.web.tsx#L1155-L1237)、[`session_contract.rs`](../../rust/motion-sdk/tests/session_contract.rs) |

## 已有但受限/实验性的能力

1. **参考轨迹比较只覆盖高位下拉，且目前是描述证据而不是 form score。** Rust 的输出明确保留 `qualityVerdict: null`；前端也把行程、肩线和向心/离心卡片标为“不可判定/只测量不下结论”，避免伪精确评分。见 [`trajectoryQualityEvidence.ts`](../../src/pose/trajectoryQualityEvidence.ts) 与 [`reference_match_contract.rs`](../../rust/motion-sdk/tests/reference_match_contract.rs)。
2. **内置 Rust 计数 profile 只有四个机位组合：** 高位下拉 `rear` / `rearLeft45`，坐姿推肩 `front` / `frontLeft45`。数据式 profile 安装接口存在，但当前接受的 contract 固定为 BlazePose33、image-normalized-y、固定状态图，maturity 仍为 provisional。见 [`rustCanonicalWasm.ts`](../../src/motion/rustCanonicalWasm.ts#L40-L45)、[`lib.rs`](../../rust/motion-sdk/src/lib.rs#L511-L658)。
3. **DTW 不是当前运行时任意轨迹的万能对齐。** Rust 测试的是带边界的 shadow diagnostic，防止无限 warping；高位下拉运行时使用固定分相位节点。见 [`trajectory_contract.rs`](../../rust/motion-sdk/tests/trajectory_contract.rs)。
4. **性能证据仅是 PC host 微基准。** Apple M4 release 下 canonical core 约 22.2 µs/次、reference matcher 约 24.8 µs/次；不包含 MediaPipe、WASM、渲染、录像，也不能外推 Android/iOS、温升或降频。见 [`rust-motion-host-benchmark-2026-08-03.md`](rust-motion-host-benchmark-2026-08-03.md)。
5. **WASM 文件需构建。** Rust crate 配置为 `cdylib`，构建脚本会写至 `public/motion-sdk/`；该二进制受 gitignore 忽略，因此干净 checkout/部署必须先运行 `npm run build:motion-wasm`。见 [`Cargo.toml`](../../rust/motion-sdk/Cargo.toml)、[`build-wasm.sh`](../../tools/motion-sdk/build-wasm.sh)。

## 当前明确未实现（不能对外声称）

| 目标 | 现状与原因 |
| --- | --- |
| 标注录像自动训练成“标准动作” | 未实现。现有样本字段明确写为 `intendedUse: rep_segmentation_observation` 和 `formReference: not_labeled`；人工次数与时间边界不等于动作质量标签。 |
| 从现有标注直接安装 Rust 质量标准 | 未实现。Rust 只接受 `personal_provisional_expert_reviewed` 的 reference profile；普通人工分段批准生成的是 `human_approved_segmentation`，不会自动升级。 |
| 肩、胸、腿、手臂等任意动作的轨迹质量评分 | 未实现。当前 reference generator 只处理 `lat_pulldown`；目前没有这些动作的已审核 reference schema、profile 或运行时 matcher。 |
| 高低肩、是否到位、向心不足、离心失控的可靠合格/不合格结论 | 未实现。当前高位下拉 schema 未包含肩线，端点方向/节奏带尚未暴露或校准；前端因此不作此类判定。 |
| 已验证的移动端交付性能 | 未实现/未验证。当前审计证据只支持 PC Web。Rust 的相机/MediaPipe 是 host adapter 边界，Rust 本身不直接调用设备相机或 MediaPipe。 |

## 当前本机数据状态

数据读取时间：2026-08-04；仅统计本机文件，不表示云端或 Git 仓库内容。

| 数据项 | 数量 | 依据 |
| --- | ---: | --- |
| 已归档 capture | 39 组 | [`public/archives/confirmed-captures/manifest.json`](../../public/archives/confirmed-captures/manifest.json) 的 `captures` |
| 有 labels 文件的归档 capture | 39 组 | 同一 manifest 的 `labels` 字段 |
| 审批导出草稿 | 39 组 | [`field-capture-approvals-2026-08-03.json`](../../../field-capture-approvals-2026-08-03.json) 的 `drafts` |
| 已批准真值 | 0 组 | 同一文件的 `approvals` |
| 草稿逐 rep 边界 | 375 个 | 同一文件的 `draftSegments` 汇总 |
| 高位下拉草稿 | 4 组 / 28 rep | 同一文件的 `exerciseId: lat_pulldown` 汇总 |
| 数据已证明可用的分段报告范围 | 39 组 / 375 个逐 rep 边界 / 179 个负窗口 | [`segmentation-training-2026-08-03.md`](segmentation-training-2026-08-03.md) |

这解释了“标过但还不能识别标准轨迹”的差异：**数据量与每 rep 边界已存在，但没有一组被批准为质量参考，更没有专家审核的标准轨迹 profile。** 当前 39 组草稿仍然非常有价值——可用于改善分段、计数和走到器械旁等非动作干扰的抑制；不能被误用为“标准姿势”。

## 已有评估信号（不夸大）

- 分段训练报告未发布任何经过留一组验证优于冻结基线的参数档案；它是诚实的“可评估但未推广”状态，而非已达生产准确率。见 [`segmentation-training-2026-08-03.md`](segmentation-training-2026-08-03.md)。
- Rust canonical sidecar 兼容性评估仅覆盖 10/39 组已实现且机位完全匹配的 profile，promotion 未通过；该报告也明确不是 MediaPipe→Rust 端到端准确率。见 [`rust-motion-evaluation-2026-08-03.md`](rust-motion-evaluation-2026-08-03.md)。
- 训练录像重放报告建议人工审核，并明确历史录制 labels 不是人工确认的实际次数。见 [`field-capture-replay-2026-08-03.md`](field-capture-replay-2026-08-03.md)。

## 能力成熟度判断

| 维度 | 判断 |
| --- | --- |
| 本地采集、回放、审核标注、导出 | 可用（PC Web、本机存储） |
| 骨架连续性、多人物锁定、统一数据流 | 可用，已落入 Rust WASM 运行路径并有 contract tests |
| 计数与抗干扰 | 有实现、有初步真实数据评估；尚未达到可宣称准确率/全动作覆盖的阶段 |
| 高位下拉轨迹比较 | 技术链路存在；缺已安装的专家审核参考，当前只能到“准备比较/不足证据” |
| 动作质量指导 | 尚处于 schema、描述证据和数据管线建设阶段，不应把页面展示理解为已可靠纠错 |
| 多动作、移动端产品化 | 设计和部分 Rust 扩展点存在；实际能力尚未完成或验证 |

## 下一条最短的真实闭环

不是继续增加规则或把草稿硬升级为标准，而是：选择若干高覆盖、高位下拉样本 → 确认实际机位、每 rep 时间边界并**另行审核其是否可作为参考动作** → 生成并审核 reference profile → 安装到 Rust → 在留出录像上报告“能比较的比例、带外证据与误判”。在此之前，页面应继续只展示测量与“不足以判断”，而不是动作质量分数。

