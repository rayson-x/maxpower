# 05 — 迁移现有 24 个可执行 Context

**What to build:** 把当前 24 个 exact contexts 迁移到 `ActionMotionDefinition` 单一动作语义权威，并按新的器械边界重新分类。自由杠铃、史密斯杠、哑铃、固定器械把手及无需器械主轨迹的 context 进入统一计划编译；其他器械 context 若器械是 identity-defining required primary 则保持 catalog-only，若独立人体 required motion 足以确认 Rep 则迁移为明确的 pose-supported limited plan。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 24 个现有 executable exact contexts 都拥有完整、受治理且可解析的 `ActionMotionDefinition` 与 projection/plan lineage。
- [ ] 每个 context 的 `ExecutionContract`、`RecognitionProfile`、`FeatureProgram` 和 `RulePack` 均由单一语义权威生成或逐字段验证，不再独立拥有 Rep 或质量语义。
- [ ] 属于当前支持器械范围或无需器械主轨迹的迁移 context 通过真实 set lifecycle 输出 Rep、质量维度、整组报告与完整 Trace。
- [ ] 不支持器械拓扑的迁移 context 按完整动作定义区分：器械必要主运动返回 `UnsupportedEquipmentTopology` 并停止在 catalog-only；独立人体主运动充分时保留 pose-supported Rep，但器械轨迹、协同和器械质量全部 `cannot_judge`，不得用手腕冒充器械或报告 supported-equipment capability。
- [ ] 支持范围内的公开 Rep/报告行为保持等价；确需改变的行为有明确的合同原因、回归 fixture 和可审核记录，不以静默差异通过验收。
- [ ] 每个迁移 checkpoint 对照 Ticket 00 报告 aggregate 与 exact action×view precision/recall、boundary、exact-set 和负窗口变化；已知视频只作为 no-regression/diagnosis，任何准确率晋升使用新的冻结 held-out evidence。
- [ ] 现有受治理视频 replay、native/WASM parity、exact-context refusal 和 set-lifecycle 测试保持通过。
- [ ] 已迁移 context 不再直接消费旧的并行动作语义路径；迁移期间旧入口只能服务尚未迁移的 context，且 capability report 明确区分两者。
- [ ] 任何正式评估数据的消费字段都能解析到治理 catalog 中的 asset ID 与 admission state，并在使用前验证来源与内容哈希。
