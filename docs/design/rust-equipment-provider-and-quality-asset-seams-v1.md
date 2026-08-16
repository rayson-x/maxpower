# Rust Equipment Provider 与质量规则资产 seams v1

## 目标

Rust SDK 保持两个独立扩展方向：

1. 新器械观测能力通过 Equipment Provider Adapter 扩展。
2. 新动作质量知识通过版本化质量规则资产扩展。

两者都不能要求客户端、Rep 引擎或 ExecutionAssessmentEngine 增加动作名称分支。

## Equipment Provider seam

动作资产声明器械 topology。计划编译将 topology 解析为可选 `EquipmentProviderId`：

- `visual_rigid_bar_axis_v1`
- `visual_independent_dumbbells_v1`
- `visual_machine_handles_v1`

没有对应 Provider 时返回 `None`。这只表示没有器械 observation，不表示动作未审核、未开放或不可识别。动作可以在 ActionMotionDefinition 明确授权时使用 Pose 主关系计次；器械维度保持 `cannot_judge`。

Provider interface 只有三个职责：

- 声明稳定 ID、支持 topology 和输入要求。
- 消费同一帧 luma、时间戳和宽松主体 ROI。
- 输出当前帧独立测量的 raw equipment observations，以及可选的 display-only continuity。

Provider 不拥有主体归属、握持、融合、Rep、Feature 或质量判断。Pose 可以缩小搜索范围，但不能生成、移动、旋转、裁剪或晋升 measured equipment geometry。

增加一种器械 Provider 的步骤：

1. 实现 `EquipmentObservationProvider`。
2. 注册新的稳定 Provider ID 与唯一 topology。
3. 增加 raw geometry、遮挡、错误主体和 wrist-independence fixtures。
4. 通过 Provider→Fusion→Canonical→Rep→Assessment 的公开生命周期测试。

Rep 与评估引擎不需要修改。

## 质量规则资产 seam

模型训练结果不能直接成为 Rust 结论。离线流程应先把候选模型或统计结果转换为可执行、可追踪的 exact-context 资产：

- `FeatureProgram`：计算哪些观测事实，引用已注册 operator 或模型输出。
- `ReferencePolicy`：与本组前序、同次训练历史或冻结参考中的什么比较。
- `RulePack`：什么条件产生 deviation、acceptable、cannot_judge 或 not_applicable。
- `SetAggregationPolicy`：如何从多个 Rep 得到持续偏差、后程下降或孤立异常。

四类资产封装在 `QualityRuleAssetPackage`，绑定 action、view、Bundle ID 和 expected Bundle hash，并携带相同 `sourceLineage`。source lineage 保存离线产物 ID、版本和 hash，不包含 Rust 需要解释的审核状态。

Rust 在临时 catalog 上执行以下检查：

1. package、Bundle 与全部资产 hash 正确。
2. action、view 和 expected Bundle hash 精确匹配。
3. 资产类型和 source lineage 完整。
4. Feature、Rule、SetAggregation 依赖闭合。
5. 动作角色、Rep、阶段与 ActionMotionDefinition 不冲突。
6. 全 catalog 仍能编译后才原子提交。

## 训练后的交付流程

```text
视频与专业标注
→ 离线训练/统计校准
→ 冻结候选模型、阈值、参考与评估输出
→ 生成 QualityRuleAssetPackage
→ Rust 原子安装与重新编译
→ 新版本参与后续 set lifecycle
```

Rust 不负责数据审核、模型训练、准确率晋升、灰度发布或在线自我修改。用户普通反馈也不会直接修改 RulePack。

## 当前范围

基础 Provider seam 和质量资产交付 interface 已完成。仍需后续补充的是具体内容：绳索、地雷管、陷阱杠、壶铃、弹力带、杠铃片等 Provider Adapter，以及各动作/机位经过离线校准的质量规则包。这些新增工作扩展 registry 和资产，不重写通用引擎。
