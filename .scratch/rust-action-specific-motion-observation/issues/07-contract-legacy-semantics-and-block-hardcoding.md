# 07 — 收口旧语义路径并阻止动作硬编码

**What to build:** 在现有 executable contexts 迁移后进入 Contract 阶段，删除或封闭这些 context 的旧并行动作语义入口、父动作 fallback 与动作名称专用分支。所有已迁移动作只通过 Catalog→ActionMotionDefinition→ViewProjectionPlan→ActionObservationPlan→ExecutionAssessmentEngine 路径运行；后续叶级 wave 从一开始只能走统一入口。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] 所有 executable context 只从单一动作定义编译运行；旧 RecognitionProfile、ExecutionContract、FeatureProgram 或 RulePack 不能绕过语义一致性验证直接成为动作真相。
- [ ] 删除父动作执行 fallback、模糊 action/equipment 匹配和已被新路径替代的兼容入口；未知或不精确 context 在首帧前明确失败。
- [ ] 合同测试证明下游资产新增、删除或改变 TaskPrimary、Rep、阶段、稳定、代偿或允许结论时 admission 必须失败。
- [ ] asset-only extension conformance test 在收口后仍能只增加一个动作资产，使用已有 operator 和规则组件完成计划编译、set lifecycle、Rep、质量与 Trace。
- [ ] 通用引擎不存在按 action ID/name 决定关节、轨迹、Rep 或质量的条件分支；允许的目录映射与测试 fixture 有明确边界和自动检查。
- [ ] 全部 Rust 测试、受治理 replay、native/WASM parity 和公开 SDK contract tests 通过。
- [ ] capability report 只把通过统一入口、具有真实 Rep、质量报告和完整 Trace 的 exact context 标记为 executable。
