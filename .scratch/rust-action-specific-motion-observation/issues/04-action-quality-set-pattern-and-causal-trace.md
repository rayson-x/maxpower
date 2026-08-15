# 04 — 建立动作专项质量、整组模式与因果 Trace

**What to build:** 从动作定义中的语义角色编译真实的 Feature、ReferenceComparison、Rule、SetPattern 和结论链路。引擎按 exact action 判断哪些关系应该运动、哪些应该稳定、哪些属于代偿，并在整组完成后输出分维度质量与可展开的真实因果 Trace。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] TaskPrimary、CoordinatedMotion、StabilityRelation、SubstitutionGuard 与 TechniqueConstraint 被编译为对应的强类型 Feature、comparison、rule 和 set aggregation，而不是动作名称分支。
- [ ] strict barbell row 将髋/躯干大幅同相移动作为代偿证据，conventional deadlift 将髋伸与膝伸作为主任务；公开结论与 Trace 反映不同语义角色。
- [ ] Reference comparison 保留 exact context、session、source set、source Rep、版本与哈希，并执行 compare-before-update；无参考时明确输出 `NoReference`。
- [ ] 每个质量维度只能输出 `observed_acceptable`、`observed_deviation`、`cannot_judge` 或 `not_applicable`，且 presence 不得被解释为 acceptable。
- [ ] 未经 exact-context calibration 或缺少合格质量 truth 的维度可以实现 Feature、Trace 和 typed abstention，但不得仅因语义定义完整或规则结构存在就发布准确率/合格结论；普通用户反馈不成为质量标签。
- [ ] 每个用户可见结论都有真实 source→coordinate→fusion→Rep/phase→Feature→Comparison→Rule→SetPattern→Conclusion 路径；不得用装饰性依赖补齐结构。
- [ ] 删除任一真实依赖会阻止结论封存；Trace 同时保存 packet、算法、配置、推理、诊断、Bundle、Feature、Reference 与 Rule lineage。
- [ ] set aggregation 能区分单个异常、持续代偿、后程 ROM 下降、阶段变慢和左右漂移，并在 set finish 后输出整组结论。
