# Rust 动作质量审核交接

Status: calibration-audit-open / model-acceptance-data-gated

本交接只保留当前证据语义。旧的 proposal 数量、旧的 cable 子集统计和旧的整体百分比均已撤销；它们来自已失效或容易被误读的产物，不得继续引用。新的生成数量、哈希和测试计数只能从当前代码重新生成的 fresh artifacts 写入。

## 固定语料范围

- 50 个唯一个人视频。
- 54 个精确 action × view × side/window 上下文。
- 464 个人工 start/end 区间；既有 expected count 与 interval count 的差异保持可见，不自动修复。
- 已有 action、view、Rep 与 start/end 标注直接复用，不要求用户重新标注。
- Historical peak 不是人工 turnaround 真值；Rust 先提案，用户再逐项审核。

## A — Human calibration audit

目的：审核 full-data Rust proposals，逐 Rep 核对 `start_anchor`、`primary_turnaround`、`end_return` 以及每条质量结论。它用于形成校准数据，不用于证明泛化。

当前 A 发布包的 Halpe-26 观测来自离线 Python ONNX 参考提取，且在产物中明确记录 `pythonVisionUsed=true`、`clientVisualAcceptanceEligible=false`。因此 A 只校准 Rust 对既定观测的端点与规则解释；它不验收 Web、Android 或 iOS 的视觉模型。客户端视觉链必须使用另行冻结的 ONNX Runtime Web/native → Rust 单次因果结果验收，二者不得混写。

启动条件：

- [x] 用当前代码重新生成冻结 full-data release，并记录 release ID、source digest、proposal count 与 capability count。
- [x] 审核页加载的 proposal bytes、hash 和 lineage 与该 release 完全一致。
- [x] 视频、帧步进、骨架、器械、proposal timeline 与人工 start/end overlay 同步。
- [x] review document、UI、只读媒体服务和 export round-trip 测试在 fresh release 上通过，并把实际测试计数写入下方记录。
- [x] 页面操作自动保存到按 release ID 与冻结 hash 隔离的浏览器本地草稿；刷新后恢复。只有用户点击“导出审核 JSON”才产生正式可携带文件。

上述清单已在 2026-08-13 的 fresh release 上完成，A 审核状态为 `open`；人工校准可以开始，不需要等待新的盲测语料。

审核入口预留为 `http://127.0.0.1:4318/quality-review.html`。每个 endpoint/结论分别选择 `correct`、`incorrect` 或 `cannot_judge`；修正值和备注可为空，`incorrect + corrected_value=null` 必须原样保存。页面会自动保存浏览器本地草稿，但不会写入服务器、自动训练、修改 Profile/RulePack 或 promotion；正式文件仍需手动导出。

## B — Model-acceptance audit

Status: `data-gated`

- 现有 6 条卧推视频参与过阈值选择，证据类别是 `touched_benchmark`，不是 pristine blind 或 held-out generalization。
- 其余大多数精确上下文在排除目标 source/session 及其衍生数据后，没有 source-independent executable Profile/RulePack；这些上下文必须 fail closed，而不是借用 full-data 配置强行评分。
- 因此当前不能发布全语料或分动作的 model-acceptance precision、recall、exact-set、phase/endpoint accuracy，也不能声称达到 95%。
- B 只能在取得从未参与训练、阈值/策略选择或结果检查的新用户或新 source/session 集合后开始。新的推理必须先冻结，再揭示人工真值。

## Fresh artifact record

| 字段 | Fresh value |
| --- | --- |
| full-data release ID / digest | `personal-motion-quality-review-v1` / `sha256:f3ad0153ceab61bcfa4d245e0269d38bf9c2e8e0da22cdcbfa4174bc4f12aaf2` |
| source full-data run / digest | `personal-full-data-proposal-rust-qlt1-v1` / `4bf32a61c1d9f6e3918c65014b3d35074bda1e0aec07e6293d137de5dfe76df4` |
| touched benchmark run / digest | `personal-touched-benchmark-rust-qlt1-v1` / `97d4bb61935ad683f52adf29c8285d8db3f7c1499db006a2c29a9bc05bc57e53` |
| Rust proposal count | `501` Reps / `5511` independent endpoint-or-conclusion review targets |
| capability counts | `quality_supported=0`, `phase_supported=53`, `observation_only=1`, `unsupported=0` exact contexts |
| conclusion states | `observed_acceptable=2030`, `observed_deviation=110`, `cannot_judge=1868`; these are proposals awaiting Audit A, not accepted truth |
| calibration visual provenance | `offline_python_onnx_reference_only`; `pythonVisionUsed=true`; client visual acceptance ineligible |
| equipment evidence | `2625` submitted equipment frames, `2357` Rust-observed frames, `135` equipment-measured endpoints |
| review document/UI/server/export tests | public review document/UI `12/12`; review data/media/server `38/38`; fresh browser load/playback/toggle smoke passed |
| runtime/contract tests | Rust `135/135`; Web verified-byte ONNX→Rust causal chain `11/11`; native prerequisite/timestamp preflight `5/5`; QLT1 native projection `5/5`; native Halpe-26/equipment contract `7/7`; iOS Rust-byte parity `14/14` frames; Android Rust/CMake `4/4` ABI; full proposal/release `19/19`; quality contracts `16/16`; ablation `6/6`; governance `3/3`; full release contract `8/8` |
| governed input catalog | `maxpower-motion-training-data-v1`; local runner catalog SHA-256 `7c6f86d7ced060c6e15abb9459303b1f44bb184052ad5734cde3b7b16b35da51`; Rust WASM SHA-256 `176da2451d029e170243cac4f2df6a92aeb9464c901bef75586066fa93a7c8b6` |
| model-acceptance metrics | data-gated |

Native 验证边界：Android Rust/CMake 已覆盖 4 个 ABI，标准 Android/iOS 构建入口已对模型与 Rust 产物 fail closed，CameraX 时间轴也改为相机帧时间；但本轮没有连接真机，因此完整 Kotlin instrumentation/真实相机运行仍不在通过声明内。编译与预检不得替代真机客户端验收。

完整性边界：release builder 会重算 full-data digest、校验 54 个上下文完整覆盖、保留离线 Python 视觉来源，并在构建与媒体服务时验证视频 SHA-256。Web 冻结结果绑定 YOLOX、RTMPose、Rust WASM、Profile archive、逐视频 Profile 和运行时身份；本地 Web 请求仍不具备硬件级来源证明，因此明确标记 `acceptanceEligible=false`，只能作为客户端运行诊断，不能替代 B 类 model acceptance。

## 已交付能力与仍待证据

已交付的实现能力可以单独审核：Rust canonical set lifecycle、QLT1 三端点与八维提案契约、action contracts、capability/abstention 表达、骨架/器械 lineage、host 只投影、逐项人工审核和手动导出。这些是软件能力声明，不等于动作识别准确率声明。

票据 06–16 的 action contract、capability 与 abstention 路径记录为 delivered implementation；其 blind-run acceptance 记录为 `evidence-gated`。卧推 full-data/touched-benchmark 结果只可用于 A 审核和诊断。票据状态以各 issue 文件为准。

## 可声称与不可声称

可以声称：现有 50/54/464 语料可以无重标进入 full-data Rust proposal 校准流程；Rust proposal 保留 endpoint、质量维度、骨架/器械证据、abstention 与 lineage；Web/Native host 不建立第二套动作理解。

不能声称：full-data proposal 或 touched benchmark 是陌生视频准确率；当前单用户语料证明新用户、新场地或新机位泛化；二维视频测得力量、力矩、肌肉激活或伤病风险；缺少 executable profile 的 unsupported 结果等于通过。

## 审核输出的用途

A 审核导出的 JSON 是下一轮离线校准候选输入。导出本身不会改变运行中的 SDK。任何 Profile/RulePack 更新、B 类 model-acceptance audit 或生产 promotion 都必须是后续显式、版本化且重新治理的步骤。
