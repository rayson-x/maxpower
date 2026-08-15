# 08 — 完成全目录定义与当前器械能力边界验收

**What to build:** 对 248 个叶级动作执行最终矩阵验收。全部动作必须完成语义定义；自由杠铃、史密斯杠、哑铃、固定器械把手及无需器械主轨迹的动作必须成功运行完整识别链或因必要主运动超出视觉表达能力而被精确拒绝；其他器械拓扑按器械是否为必要主运动区分 catalog-only 与 pose-supported limited capability。报告按 exact action×variant×equipment×view 拆分定义覆盖、当前器械能力、准确率成熟度和用户开放状态。

**Blocked by:** 06, 07

**Status:** ready-for-agent

- [ ] 最终矩阵覆盖全部 248 个叶级动作，记录 definition completeness、equipment scope、适用 view、plan result、Rep、质量维度、Trace、拒绝原因和 capability state；每项明确归入 full executable success、pose-supported limited success、admissible visual refusal 或 unsupported-equipment catalog-only，不允许遗漏或隐式状态。
- [ ] 当前支持的自由杠铃、史密斯杠、哑铃、固定器械把手及无需器械主轨迹动作中，所有能由必备 operator 表达 identity-defining TaskPrimary 的叶级动作至少有一个适用 exact view 成功编译，并通过完整 set lifecycle 输出 sealed Rep、分维度质量和完整 Trace。
- [ ] 史密斯与自由杠铃共享刚体杠 observation 原语，但能力矩阵分别验收 exact identity、导轨约束、Rep 合同、质量规则与参考资产，不能因为追踪复用而合并结果。
- [ ] 绳索/滑轮、地雷管/T 杠、陷阱杠、壶铃、弹力带及其他未列出器械拓扑不获得设备 Adapter 或 supported-equipment coverage；器械为身份定义必要主运动时保持 `UnsupportedEquipmentTopology` catalog-only，人体主运动独立充分时最多获得 pose-supported limited Rep，器械维度保持 `cannot_judge`。
- [ ] 合法 `PlanRefusal` 只引用经测试确认无法由当前 operator 与 exact view 表达的 identity-defining relation；缺资产、缺实现、合同冲突或运行时证据缺失不得计为能力拒绝通过。
- [ ] M21 Arnold press 在哑铃 Adapter 可用后，若身份依赖的轴向旋转仍不可表达，则明确 `PlanRefusal` 且不输出 Rep；M24 cable external rotation 本轮因绳索不支持保持 catalog-only。腕、肘、哑铃或手柄轨迹不得成为旋转 TaskPrimary 或 Rep 的代理因果路径。
- [ ] 缺失器械、遮挡、左右冲突和部分质量不可观察分别产生正确的运行期 refusal 或 typed abstention，不把有限报告误报为完整质量能力。
- [ ] 最终矩阵分别报告 raw equipment detection、subject association、grip establishment/release、track continuity/geometry 和 Rep eligibility；未握持器械不得成为 fusion/turnaround/Rep 证据，手腕桥接不得计入 measured equipment accuracy。
- [ ] capability report 将 `VisualMeasuredSegment`、prediction 与 `PoseBridgeDisplayEstimate` 分开计数；只有具有受治理人类 shaft/association/grip truth 的冻结评估才能发布对应 accuracy，缺少真值时保持 `not_evaluable`。
- [ ] 最终报告分别呈现 catalog definition coverage、supported-equipment coverage、pose-supported limited coverage、unsupported-equipment catalog-only coverage、successful-plan coverage、admissible-refusal coverage、Rep/quality/trace coverage，以及仍需 held-out evidence 验证的准确率和风险—覆盖率；不发布一个混合“识别率”。
- [ ] 正式准确率或质量指标只消费通过治理 admission 的评估资产，并按 participant、source、session、view 隔离且验证来源与内容哈希。
- [ ] 用户开放仍受 exact-context evidence、质量规则、Trace completeness 和产品发布门控约束；完成本 ticket 不自动声称 248 个动作均已达到生产准确率。
