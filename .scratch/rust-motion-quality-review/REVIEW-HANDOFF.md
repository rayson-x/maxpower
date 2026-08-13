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

启动条件：

- [x] 用当前代码重新生成冻结 full-data release，并记录 release ID、source digest、proposal count 与 capability count。
- [x] 审核页加载的 proposal bytes、hash 和 lineage 与该 release 完全一致。
- [x] 视频、帧步进、骨架、器械、proposal timeline 与人工 start/end overlay 同步。
- [x] review document、UI、只读媒体服务和 export round-trip 测试在 fresh release 上通过，并把实际测试计数写入下方记录。
- [x] 页面操作只保存在内存；只有用户点击“导出审核 JSON”才产生文件。

上述清单已在 2026-08-13 的 fresh release 上完成，A 审核状态为 `open`；人工校准可以开始，不需要等待新的盲测语料。

审核入口预留为 `http://127.0.0.1:4318/quality-review.html`。每个 endpoint/结论分别选择 `correct`、`incorrect` 或 `cannot_judge`；修正值和备注可为空，`incorrect + corrected_value=null` 必须原样保存。审核不会自动训练、修改 Profile/RulePack 或 promotion。

## B — Model-acceptance audit

Status: `data-gated`

- 现有 6 条卧推视频参与过阈值选择，证据类别是 `touched_benchmark`，不是 pristine blind 或 held-out generalization。
- 其余大多数精确上下文在排除目标 source/session 及其衍生数据后，没有 source-independent executable Profile/RulePack；这些上下文必须 fail closed，而不是借用 full-data 配置强行评分。
- 因此当前不能发布全语料或分动作的 model-acceptance precision、recall、exact-set、phase/endpoint accuracy，也不能声称达到 95%。
- B 只能在取得从未参与训练、阈值/策略选择或结果检查的新用户或新 source/session 集合后开始。新的推理必须先冻结，再揭示人工真值。

## Fresh artifact record

| 字段 | Fresh value |
| --- | --- |
| full-data release ID / digest | `personal-motion-quality-review-v1` / `sha256:69d5efa85a161a875671d0e4fa26cec10c7440cc97385dffe8a9e83c053ce464` |
| source full-data run / digest | `personal-full-data-proposal-rust-qlt1-v1` / `fe1dcf8a423503353984ab9f0ba05b1e36fb329e91509b283222ea8d47bf91e3` |
| touched benchmark run / digest | `personal-touched-benchmark-rust-qlt1-v1` / `151d1c1740c49eb7ae8467e4bc1c92aedb662246e47613b12efc1427ef3aba92` |
| Rust proposal count | `501` Reps / `5511` independent endpoint-or-conclusion review targets |
| capability counts | `quality_supported=3`, `phase_supported=50`, `observation_only=1`, `unsupported=0` exact contexts |
| equipment evidence | `2625` submitted equipment frames, `2357` Rust-observed frames, `135` equipment-measured endpoints |
| review document/UI/server/export tests | public review document/UI `11/11`; review data/media/server `37/37`; fresh browser load/playback/toggle smoke passed |
| runtime/contract tests | Rust `133/133`; QLT1 native projection `5/5`; real Halpe-26 Web parity `3/3`; full proposal/release `12/12`; quality contracts `16/16`; ablation `6/6`; governance `3/3`; full release contract `7/7` |
| governed input catalog | `maxpower-motion-training-data-v1`; local runner catalog SHA-256 `02473226f22c973ee4526820911878e396e737514dc91b0b49eac20c23eb407f` |
| model-acceptance metrics | data-gated |

## 已交付能力与仍待证据

已交付的实现能力可以单独审核：Rust canonical set lifecycle、QLT1 三端点与八维提案契约、action contracts、capability/abstention 表达、骨架/器械 lineage、host 只投影、逐项人工审核和手动导出。这些是软件能力声明，不等于动作识别准确率声明。

票据 06–16 的 action contract、capability 与 abstention 路径记录为 delivered implementation；其 blind-run acceptance 记录为 `evidence-gated`。卧推 full-data/touched-benchmark 结果只可用于 A 审核和诊断。票据状态以各 issue 文件为准。

## 可声称与不可声称

可以声称：现有 50/54/464 语料可以无重标进入 full-data Rust proposal 校准流程；Rust proposal 保留 endpoint、质量维度、骨架/器械证据、abstention 与 lineage；Web/Native host 不建立第二套动作理解。

不能声称：full-data proposal 或 touched benchmark 是陌生视频准确率；当前单用户语料证明新用户、新场地或新机位泛化；二维视频测得力量、力矩、肌肉激活或伤病风险；缺少 executable profile 的 unsupported 结果等于通过。

## 审核输出的用途

A 审核导出的 JSON 是下一轮离线校准候选输入。导出本身不会改变运行中的 SDK。任何 Profile/RulePack 更新、B 类 model-acceptance audit 或生产 promotion 都必须是后续显式、版本化且重新治理的步骤。
