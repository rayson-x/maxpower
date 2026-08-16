# 计划流水线与可观测性设计：从"生成一张表"到"可检测的协作演化"

> 版本：v0.1 · 日期：2026-08-10 · 状态：proposal
> 背景：用户实测 planner 输出不可信（75 分钟只排 3 动作 × 2 组 6-12 下、肌群每周一次、休息写死、输入数据不影响输出）。诊断见本文 §1。
> 关联：`agent-harness-and-domain-knowledge-gaps-v0.1.md`、`domain-knowledge-upgrade-simulation-v0.1.md`、`.scratch/agent-knowledge-runtime/PRD.md`

## 1. 诊断：为什么现在的计划"不像教练排的"

### 数据断桥（计划吃不到训练记录）

```
每组确认（actualLoad/actualReps/actualRIR）→ workout_session 聚合 ✓
→ 旧流水线曾在写 Timeline 时丢弃负荷数据（该实现已删除）
→ deriveHistory 只认 timeline.historicalSet → 生产中恒为空（GoalCyclePlanner.ts:1144）
→ hasHistory 恒 false → 负荷永远 unknown、RIR 永远 4-5、组数钳到 ≤2、动作评分无历史分
```

四个 replan 生产入口均不传 historicalPerformance；session_completed 触发器恒返回 no_change；strongestRecovery 与 1970 年比较导致恢复约束永不过期。

### 模板引擎的结构性问题（上下文不互相影响）

| 输入 | 现状 |
|---|---|
| 训练时长（75min） | `maxSlots` 只砍不加；模板写死 3 slot，75 分钟与 30 分钟同结构 |
| 力量数据（三大项基线） | 只进动作评分 +200，不影响组数/次数/频率/负荷 |
| 肌群频率 | 静态取模轮换，每肌群每周 1 次（违反知识库 ACSM ≥2 次暴露） |
| 组数 | 优先级映射 3/2/1，无历史再钳到 2——不管目标与经验 |
| 组间休息 | 写死 75-180s 表，不看目标/经验/强度 |
| 周量 | TP-VOL-BASE 的 4-8 直接组/肌群/周无消费方 |

## 2. 设计：五阶段计划流水线

```
① 生成        ② 确认/定制       ③ 水平推断        ④ 观察          ⑤ 长期演化
agent 提案 →  用户确认或修改 →  从定制+表现      →  训练记录回流 →  重排带 diff
Composer       可编辑 Proposal   推断水平           historicalSet    新 PlanRevision
```

### ① 生成：知识驱动的 Session 组装器（Composer）

替代静态 sessionTemplates 轮换表。四步，每步挂知识包规则：

1. **周刺激目标**：TP-VOL-BASE-001——增肌默认每肌群每周 4-8 直接组（默认点 6）；新手每动作 1-2 工作组；力量主项优先。版本化产品规则。
2. **分化方案**：2-3 天/周 → 全身训练（每肌群每周 ≥2 次暴露，ACSM）；4 天 → 上下肢；5-6 天 → 推拉腿。依据：等训练量下 split 与 full-body 无稳定差异，按可执行性分配。
3. **时间预算求解**：`(可用分钟 - 热身) / (工作组时长 + 组间休息)` 得到容量，按优先级把组数分配到 slot 直到满足周目标或时间耗尽。组间休息按 目标×经验×动作疲劳度 查表（版本化产品规则，非生理精确值）。
4. **逐 slot 安排**：次数区间/RIR/负荷锚定从规则包与历史查得；无历史走校准语义（TP-LOAD-CAL-001，已实现阶梯）。

75 分钟 × 每周 3 次的预期输出：全身 × 3 天（蹲/铰链/水平推/水平拉/垂直推或拉 + 核心），每课 4-5 动作 × 2-3 组，每肌群每周 6-9 组、3 次暴露。

### ② 确认/定制：计划是 Proposal，不是既成事实

- agent 生成的首课计划走与计划变更相同的 **Proposal → 确认 → 提交** 管线（复用现有 ActionBroker/PolicyGate，不自动落账）。
- 有训练经验的用户可以**修改后确认**：增删动作、改组数/次数/负荷、锁定字段。每次修改是带 provenance 的事实（directChoices + PlanRevision 的 user edit 记录）。
- 用户一个字不改直接确认也是证据（保守/信任默认值）。

### ③ 水平推断：定制行为是水平信号

用户的定制与早期表现一起沉淀为**个人知识层**条目（ticket 05 已建骨架）：

| 信号 | 推断（system_inference，带置信度与证据窗） |
|---|---|
| 主动增加组数/降低 RIR 目标 | 可能有经验，容量接受度高 |
| 自报三大项基线与首课校准 RIR 一致 | 自报可信，可作为保守锚点 |
| 大量删动作/降组数 | 时间或恢复约束被低估，或偏好简单 |
| 连续两周完成全部计划且 RIR ≥ 目标上界 | 起始剂量偏低，进入加速进阶候选 |

推断**永不直接改规则**——只作为 planner 的下一次输入约束，且全部可撤销。

### ④ 观察：训练记录回流（数据断桥修复）

1. `completeWorkoutSession` 把 user_confirmed 的组逐条写成 timeline `historicalSet` 事实（ledger 校验与 product 投影已支持该通道）。
2. 四个 replan 入口从 `projection.workouts` 组装 `historicalPerformance` 传入（comparablePerformanceRecoveryEvidence 已有现成遍历）。
3. 修 `strongestRecovery` 的 1970 过期比较（改为对比 request.currentDate）。
4. session_completed 语义：历史更新后重算，diff 非空才出新 revision（替代"永远 no_change"）。
5. missed-session 检测对照计划表 scheduledFor（未开始的课也算缺席）。

### ⑤ 长期演化：规则包驱动的自适应

已有且已测：双进阶（TP-PERF-001）、校准阶梯（TP-LOAD-CAL-001）、周量加减（TP-VOL-PROG-001）、deload 触发与内容（TP-DELOAD）。演化语义：每次重排产出带逐项 diff 的新 PlanRevision；活跃 mesocycle 钉住规则包版本，规则升级走 migration proposal。

## 3. 可观测性：每个环节可检测（PlannerTrace）

每个阶段产出一个可回放的结构化 artifact，错误输出可以反查到具体输入：

| 阶段 | Artifact | 回答的问题 |
|---|---|---|
| ① 生成 | `PlanTrace`（随 PlanRevision 幂等持久化） | 当时看到了什么输入？每个 slot 为什么是这个动作/组数/次数/负荷？候选项为什么被过滤？ |
| ② 定制 | `PlanCustomization`（提案 vs 提交的逐项 diff + 编辑 provenance） | 用户改了什么、改了哪几处？ |
| ③ 推断 | 个人知识层条目（system_inference，带证据窗与 sourceFactRefs） | 这个水平判断是从哪些事实推的、置信度多少？ |
| ④ 观察 | timeline historicalSet 事实 + 周量账本 | 哪些真实表现进了 planner 的 history？ |
| ⑤ 演化 | 每次重排的 PlanTrace + 逐项 PlanDiff + 规则包版本钉 | 这次为什么变/为什么不变（no_change 也要可追溯）？ |

**PlanTrace 内容**（①⑤共用）：

```text
输入钉：factFrontier（聚合 revision 集）、knowledgePins、规则包版本、
        request 指纹、history 条数与来源分布（为什么 hasHistory=false）
逐 slot：模板选择理由（goal × 第几场 × 器械 → 模板条目）
        候选评分表（每个候选的得分拆解 + 硬过滤原因）
        安排推导链（组数←优先级+时间+恢复+历史；次数区间←查表条目；
                   RIR←校准或工作区间及原因；负荷←锚定证据或 unknown 原因）
约束事件：恢复降级 / deload 调整 / 时间裁剪（哪个 slot 被删及原因）
周量账本：每肌群本周直接组数 vs 目标区间
结果：proposal / no_change / infeasible + reasonCodes + 逐项 diff
```

**确定性回放**：同一输入指纹必出同一 plan。配套 `tools/planning/explainPlan.ts`：输入 planId → 打印中文推理链（检测入口）。无 trace 的 plan 不允许提交（把可观测性变成不变量）。

## 4. 实施顺序

| # | 内容 | 检测方式 |
|---|---|---|
| P1 | PlannerTrace 类型 + 收集 + artifact 持久化 + explainPlan 工具 | 用例：75 分钟输入的 trace 必须显示"模板写死/时间未参与组数分配"（修复前）与"容量 12-15 组"（修复后） |
| P2 | 数据断桥修复（§2.④ 的 1-3 项） | trace 断言 history 条数 > 0、负荷 anchor 出现 |
| P3 | Session 组装器（§2.① 四步） | trace 断言周量达标、频率 ≥2、时间求解过程 |
| P4 | Proposal 化首课计划 + 定制记录（§2.②） | 定制 diff artifact 断言 |
| P5 | 水平推断（§2.③） | 个人知识条目的来源事实链断言 |
| P6 | session_completed 语义 + missed-session 检测（§2.④ 的 4-5 项） | 完成训练后 diff 非空出新 revision |

P1 先行：它是后续每一步的验证手段。

## 5. 边界与不变量（继承）

- LLM 不产生事实；planner 全确定性；同一输入指纹必出同一 plan。
- 推断（个人知识层）永不直接修改全局规则。
- 恢复/安全约束永远优先于容量目标（PLANNER_CONSTRAINT_PRIORITY 顺序不变）。
- 无 trace 不提交 plan；无证据不锚定负荷。
