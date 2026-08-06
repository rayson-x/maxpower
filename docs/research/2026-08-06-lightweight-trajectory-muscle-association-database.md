# 轻量级“运动轨迹 × 预计肌群”关联数据库

_整理日期：2026-08-06；五分化扩展：2026-08-07。数据库 schema：`form-coach-expected-muscle-associations/v1`。_

## 结论

本项目采用的是**预计肌群关联数据库**，不是肌肉激活数据库。它把一个已知的精确动作身份拆成：

1. 通常参与的主要、辅助和稳定肌群；
2. 能被骨架直接观察的关节运动；
3. 每个动作相位中可能承担机械贡献的肌群；
4. 证据来源和必须展示的能力边界。

数据库不存储激活百分比，也不允许把相近动作的肌群映射自动借给未知动作。骨架只证明“关节怎样移动”，肌群部分来自经过引用的动作知识；两者组合后只能展示“预计参与”或“可能的机械需求倾向”。

数据目录位于 [`src/pose/expectedMuscleAssociationCatalog.ts`](../../src/pose/expectedMuscleAssociationCatalog.ts)，查询与校验接口位于 [`src/pose/expectedMuscleAssociations.ts`](../../src/pose/expectedMuscleAssociations.ts)。公共查询接口通过 `exerciseId` 返回只读关联；未知动作返回 `undefined`。

## 领域术语

| 术语 | 含义 | 不等于 |
| --- | --- | --- |
| 预计肌群关联 | 精确动作及相位通常涉及的机械贡献肌群 | 当前用户实际肌肉激活 |
| 观测到的动作策略 | canonical packet 中的关节轨迹、相位、幅度、节奏和左右关系 | 肌肉力或关节力矩 |
| 机械需求倾向 | 在动作、变式、负载和机位不变时，对机械需求可能变化的条件性解释 | 激活百分比、训练效果或动作评分 |

这些术语已同步到项目 [`CONTEXT.md`](../../CONTEXT.md)。

## v1 数据结构

每条 `ExpectedMuscleAssociation` 包含：

| 字段 | 作用 |
| --- | --- |
| `exerciseId` | 必须引用 `ExerciseRegistry` 中存在的精确动作身份 |
| `claimLevel` | 固定为 `expected_participation` |
| `contextRequirement` | 固定为 `exact_exercise_identity`，禁止近邻动作自动继承 |
| `muscles` | 肌群及 `primary / secondary / stabilizer` 角色 |
| `phases` | 分相位的 `expectedJointMotions`、预计机械贡献肌群和中文解释；这里是知识库预期，不是用户实测 |
| `evidenceStatus` | 区分精确动作资料 `exact_exercise_reference` 与通用资料人工整理 `curated_general_reference` |
| `sourceIds` | 指向资料来源；只有 `exact_exercise_reference` 才表示精确动作页与记录身份一致 |
| `disclaimerZh` | 强制说明摄像头不能直接测量肌肉激活、肌肉力或训练效果 |

`activationPercent` 是显式禁止字段。加载器也会拒绝：

- 未登记的 `exerciseId`；
- 重复动作记录；
- 没有主要肌群的动作；
- 重复或未知肌群；
- 空相位、重复相位或没有可观察关节运动的相位；
- 相位引用了动作没有声明的肌群；
- 未登记的证据来源；
- `exact_exercise_reference` 没有引用 `exactExerciseId` 相同的来源；
- 缺少激活边界文案。

## v1 覆盖：48 / 48 Registry 动作

| 动作 | 主要肌群 | 轨迹相位 |
| --- | --- | --- |
| 原地踏步 `march_in_place` | 髋屈肌群、股四头肌群 | 抬腿；落脚换侧 |
| 侧步并步 `side_step_touch` | 髋外展肌群、臀肌群 | 侧向迈步；并步回收 |
| 慢速交替提膝 `alternating_knee_raise` | 髋屈肌群 | 提膝；回到站立 |
| 低冲击开合 `step_jack` | 髋外展肌群、三角肌中束 | 开步举臂；并步落臂 |
| 徒手深蹲 `bodyweight_squat` | 股四头肌群、臀肌群 | 下蹲；起立 |
| 标准俯卧撑 `push_up` | 胸肌群、肱三头肌 | 下降；推起 |
| 行走箭步蹲 `walking_lunge` | 股四头肌群、臀肌群 | 前腿下降；前腿起身 |
| 提踵 `calf_raise` | 小腿后侧肌群 | 提踵；落踵 |
| 臀推 `hip_thrust` | 臀肌群 | 伸髋抬起；屈髋下放 |

居家与可在家完成的 9 个动作继续保留，当前四个居家 Rust 识别动作都有记录。2026-08-07 扩展后，Registry 的五分化动作也实现完整覆盖：

| 分化 | 数量 | 已覆盖动作 |
| --- | ---: | --- |
| 胸 | 6 | 杠铃卧推、哑铃卧推、上斜哑铃卧推、器械推胸、绳索夹胸、俯卧撑 |
| 背 | 10 | 杠铃划船、引体向上、高位下拉、坐姿划船、直臂下拉、宽握高位下拉、单臂哑铃划船、胸托划船、单臂绳索划船、辅助引体 |
| 腿 | 15 | 4 个居家 locomotion、徒手/杠铃深蹲、腿举、罗马尼亚/传统硬拉、行走箭步、保加利亚分腿蹲、腿屈伸、腿弯举、臀推、提踵 |
| 肩 | 10 | 坐姿推肩、侧平举、后束飞鸟、面拉、前平举、单臂绳索侧平举、地雷管推举、绳索 Y 举、绳索外旋、后束划船 |
| 手臂 | 7 | 杠铃/哑铃/锤式/绳索弯举、绳索下压、过顶臂屈伸、仰卧臂屈伸 |

每个动作仍是独立 `exerciseId` 记录；共享相位模板只是数据维护方式，运行时不会按 movement pattern 或相邻变式回退。

现有 registry 尚未登记标准 plank、独立髋铰链、glute bridge 和基础瑜伽体式，所以本次没有用相近 identity 代替。它们是下一批居家优先项：先建立精确动作身份与资料，再加入关联数据库。

## 产品读取示例

```ts
import {
  EXPECTED_MUSCLE_ASSOCIATIONS,
  presentExpectedMuscleAssociation,
} from "./src/pose/expectedMuscleAssociations";

const squat = EXPECTED_MUSCLE_ASSOCIATIONS.get("bodyweight_squat");
const presentation = presentExpectedMuscleAssociation("bodyweight_squat");
```

`presentation` 适合直接映射到轻量 UI：

```text
预计参与肌群
主要：股四头肌群、臀肌群
辅助：腘绳肌群、小腿后侧肌群
稳定：躯干稳定肌群

预计参与肌群来自动作知识库；摄像头只能观察关节轨迹，
不能直接测量肌肉激活、肌肉力或训练效果。
```

若 `exerciseId` 未知，UI 应隐藏肌群卡片或显示“当前动作没有经过审核的肌群关联”，不能退回到相近动作。

## 如何与 canonical packet 组合

数据库不重新分段，也不消费原始关键点。推荐组合顺序：

1. Rust canonical packet 确认动作上下文和 rep 相位；
2. 产品读取同一 `exerciseId` 的预计肌群关联；
3. canonical packet 中某相位具备可靠轨迹证据时，才展示该相位的关节运动描述；
4. 肌群文字始终标记为知识库预计，不转写成“检测到发力”；
5. 关键点或动作身份不足时保持 unknown。

例如深蹲起立阶段可以组合为：

> 观测：髋、膝投影角在起立阶段趋向伸展。
> 预计肌群：股四头肌群、臀肌群通常为这一动作提供主要机械贡献。
> 边界：摄像头没有测量两组肌肉的实际分担或激活比例。

## 证据边界

动作和肌群的基础映射参考 [Nike 徒手训练资料](https://www.nike.com/a/what-is-calisthenics-workout)、[ACE Exercise Library](https://www.acefitness.org/resources/everyone/exercise-library/)、ACSM 自由重量资料、NASM 具体动作页和 ExRx 具体动作页。详细的逐动作来源与支持范围见 [`2026-08-07-five-split-exercise-muscle-sources.md`](./2026-08-07-five-split-exercise-muscle-sources.md)。

当前 48 条记录中，22 条有与 `exerciseId` 一致的具体动作页，标为 `exact_exercise_reference`；其余 26 条仍为 `curated_general_reference`。精确页可能只支持动作身份、目标区域和相位，不一定直接证明数据库中的 primary/secondary 角色；逐角色结论仍需阅读来源的 claim 范围，不能只看 evidenceStatus。

研究还发现若干 Registry identity 合并过宽：坐姿推肩、侧/前平举、后束飞鸟、腿弯举、提踵、过顶臂屈伸、仰卧臂屈伸和胸托划船。它们当前可以展示保守的预计肌群，但在拆分器械与姿势 identity 前不会提升为精确证据。`front_raise` 的 movement pattern 已从肩外展修正为肩屈曲；面拉和绳索外旋中的肩外旋仍只能作为普通二维骨架的弱观测。

[OpenSim 逆动力学文档](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting+Started+with+Inverse+Dynamics)明确说明，净关节力矩需要运动学、个体模型和外部负载；[OpenCap 论文](https://doi.org/10.1371/journal.pcbi.1011462)使用多机位 3D、人体模型、足地接触和优化仿真估计下肢肌肉激活。v1 数据库没有这些输入，因此只提供知识关联，不冒充 OpenSim/OpenCap 的动力学结果。

## 后续扩展规则

1. 新动作先进入 `ExerciseRegistry`，再单独建立肌群关联。
2. 墙面、上斜、跪姿和标准俯卧撑应分别建 identity，不共享一条相位记录。
3. 反向、前向、侧向和行走弓步分别建 identity。
4. 只有同动作、同变式、同负载和同机位的留出数据通过验证后，才增加“机械需求倾向”规则。
5. 任何百分比、疲劳、增肌、疼痛或伤害结论都需要数据库之外的新测量与独立验证。
