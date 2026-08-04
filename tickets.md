# Tickets: SetRecognitionEngine

将 [SetRecognitionEngine PRD](.scratch/set-recognition-engine/PRD.md) 拆为可验证的 Rust/Web 垂直切片。工作时只领取所有 blocker 已完成的 frontier ticket。

## 01. 录制意图与训练组门控

**What to build:** 点击开始录制后，训练组进入 Rust 统一的 `arming / active / paused / finished` 生命周期；准备动作不计数，停止录制封存训练组，训练页显示同一份状态。

**Blocked by:** None — can start immediately.

- [x] 开始/停止录制跨越同一 Rust recognition Seam，并由 immutable canonical packet 驱动可见训练组状态。
- [x] `arming` 期间不封存 rep；短暂休息只进入 `paused`，停止录制才结束训练组。
- [x] Rust contract、WASM parity 与 Web 训练页对相同录制命令一致。

## 02. 候选 rep 的确认、待审核与拒绝证据

**What to build:** Rust 为完整周期输出 `confirmed / needs_review / rejected` 与 canonical slice、原因；正式次数只计 confirmed，训练页展示待审核与拒绝原因。

**Blocked by:** 01. 录制意图与训练组门控.

- [x] 每个完整候选具有不可变的结果类别与可审计证据。
- [x] 短丢点恢复转为待审核，长丢点、主体变化与不完整周期不计数。

## 03. 审核时间轴与版本化分析

**What to build:** 审核页支持完整范围、单个转折点和可选备注；自动产生弱负样本；重新分析创建版本而不覆盖源数据或旧结论。

**Blocked by:** 02. 候选 rep 的确认、待审核与拒绝证据.

- [x] 用户可审核候选并保留转折点语义与备注。
- [x] 历史视频、canonical pose、标注和分析版本均可追溯。

## 04. 五分化模拟 baseline 编译与推荐机位

**What to build:** 将五分化模拟先验编译为 Rust 可消费的 baseline；动作上下文显示推荐机位，并在 sealed rep 后产生明确标注为“模拟、未校准”的描述性轨迹证据。

**Blocked by:** 02. 候选 rep 的确认、待审核与拒绝证据.

- [ ] 支持的动作、变式/器械、训练侧与推荐机位选择 baseline；不自动猜机位。
- [ ] 模拟偏离永远不改变 confirmed count 或生成质量 verdict。

## 05. 正面坐姿推肩试点闭环

**What to build:** 正面坐姿推肩完成多特征分段、训练组门控、候选审核和模拟轨迹对比；以已标注录像的留出 capture 回放报告验收。

**Blocked by:** 02. 候选 rep 的确认、待审核与拒绝证据; 03. 审核时间轴与版本化分析; 04. 五分化模拟 baseline 编译与推荐机位.

- [ ] 报告误计、漏计、待审核与弱负样本误触发，不把 in-sample 结果称为准确率。
- [ ] 同一 canonical slice 支持播放、审核、计数与轨迹证据。

## 06. 高位下拉回归闭环

**What to build:** 正后与左后 45° 高位下拉在新 Module 下保持严格机位隔离、丢点恢复语义与轨迹证据。

**Blocked by:** 02. 候选 rep 的确认、待审核与拒绝证据; 03. 审核时间轴与版本化分析; 04. 五分化模拟 baseline 编译与推荐机位.

- [ ] 新 Module 不跨机位套用 profile 或轨迹 baseline。
- [ ] 已归档背部录像仍可回放并产生可审计结果。

## 07. 迁移完成与旧计数路径下线

**What to build:** 训练页、导出、审核和回放统一使用 SetRecognitionEngine 输出；旧直接 profile 计数路径下线。

**Blocked by:** 05. 正面坐姿推肩试点闭环; 06. 高位下拉回归闭环.

- [ ] 所有消费者读取同一 Rust-produced recognition result。
- [ ] Rust/WASM parity、性能和历史分析版本回归通过。
