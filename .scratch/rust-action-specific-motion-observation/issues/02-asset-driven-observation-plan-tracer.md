# 02 — 建立外部资产驱动的通用观测计划 Tracer

**What to build:** 把固定 Feature 白名单扩展为受治理的强类型通用计算图。编译器根据完整 `ActionMotionDefinition` 和 exact view 解析关节、线段、人体轨迹、器械轨迹、相对轨迹及 judgeability，并生成完整 `ActionObservationPlan`。用一个 Rust 源码中不存在的运行时测试动作资产证明新增动作无需动作名称专用分支。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 通用 operator registry 为每个 operator 声明强类型输入、输出、单位、scope、source requirements、coverage/confidence 与可判断性；无单位、无来源或类型不匹配的图不能编译。
- [ ] 编译顺序固定为 exact action → `ActionMotionDefinition` → `ViewProjectionPlan` → typed Feature DAG → executable plan，机位不能反向改变动作角色。
- [ ] `ActionObservationPlan` 为视频/器械、Pose 和其他 evidence channel 声明独立时间基准、最大因果年龄、背压和缺帧策略；equipment-only 帧不得复制 Pose observation、重复推进 Pose Rep 状态机或改变已经发生的 Pose timestamp。
- [ ] 成功计划中的 identity-defining TaskPrimary、必要主轨迹与 Rep boundary 全部可计算；只有非身份定义的次级质量维度可以在计划创建时带原因标记为 `cannot_judge`。
- [ ] Feature 数值存在本身不能产生 `observed_acceptable`；没有适用 comparison 和 rule 时必须拒绝质量结论。
- [ ] ActionMotionDefinition 的定性关系不能自动生成未经校准的数值门槛；缺少 exact-context threshold/reference evidence 时计划保留 provisional recognition 或 typed abstention，而不是编造 acceptable corridor。
- [ ] 仅增加一个使用自由杠铃、史密斯杠、哑铃或固定器械把手拓扑的外部动作资产，组合已有 operator、Reference policy 与 RulePack，不修改 Rust 源码、不注册动作名称分支，即可被发现并编译。
- [ ] 该测试动作通过真实 `ExecutionAssessmentEngine` set lifecycle 输出 sealed Rep、质量维度和完整 Trace。
- [ ] 对不可表达的 identity-defining relation 返回具体的强类型能力拒绝，不生成缺字段、缺主运动或依赖代理信号的半有效计划。
