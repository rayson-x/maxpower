# 01 — 建立单一动作语义权威

**What to build:** 引入完整、受治理的 `ActionMotionDefinition`，使叶级 exact action 的主运动、协同运动、稳定关系、代偿关系、主体与器械轨迹、Rep/阶段语义和允许结论只在一处定义。编译器从它生成或逐字段验证 `ExecutionContract`、`RecognitionProfile`、`FeatureProgram` 与 `RulePack`，并把动作定义、机位投影和执行资产原子封装为可运行计划。此 ticket 采用 Expand 阶段：保留旧执行路径以维持现有能力，但新路径必须完成一个真实 vertical slice。

**Blocked by:** 00

**Status:** ready-for-agent

- [ ] `ActionMotionDefinition` 能完整表达 identity-defining TaskPrimary、Rep boundary、phase semantics、coordinated motion、stability、substitution、人体/器械轨迹、左右关系、允许结论及稳定的版本与内容哈希。
- [ ] `ActionMotionDefinition` 只拥有动作语义，不发明数值阈值；RecognitionProfile、Reference 与 RulePack 中的幅度、时长、走廊和相似度参数必须具有独立的 exact-context calibration/evidence lineage，并逐字段验证不改变动作角色。
- [ ] `ViewProjectionPlan` 只能把动作语义绑定到 exact camera view；不得更改动作角色、Rep 语义或以相关但不等价的代理信号替代必要主运动。
- [ ] 下游执行资产由动作定义生成或逐字段验证；任何 TaskPrimary、Rep、阶段、稳定、代偿或允许结论冲突都会使 Bundle admission 失败。
- [ ] 缺失、不完整或互相冲突的动作定义返回 `DefinitionBuildFailure` 并使构建验收失败，不得包装为合法 `PlanRefusal`。
- [ ] 只有完整定义通过 admission 后，当前视觉 operator 或机位无法表达 identity-defining motion 才能返回强类型 `PlanRefusal`。
- [ ] 至少一个属于自由杠铃、史密斯杠、哑铃或固定器械把手范围的现有 executable exact context 通过新入口完成配置、set lifecycle、Rep、质量维度和 EvidenceDerivationTrace；Trace 可解析动作定义和机位投影 lineage。
- [ ] 现有公开调用方式保持兼容，未迁移 context 在 Expand 阶段仍可运行，且不会被误报为已经采用新语义权威。
