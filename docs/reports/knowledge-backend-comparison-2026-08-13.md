# Legacy 与 Agent Knowledge 后端同档案 E2E 对比

日期：2026-08-13  
状态：离线测试通过；Agent Knowledge Release 保持 `shadow`，尚未接入客户端

## 结论

已修复此前阻断完整 Planner 对比的三个缺口：独立 Exercise/Domain Catalog、Action、Validator。新链路现在是：

```text
agent-knowledge/v1 Release
→ 独立领域目录与决策资产
→ AgentKnowledgePlanningModule.createInitialPlan
→ 计划验证
→ 与 Legacy Planner 同档案隔离 A/B
```

两套 Planner 接收完全相同的个人档案与目标合同，各自独立运行；没有双读、结果合并或失败时回退。旧 Planner 与新 Planner 都选择了四分化，说明本次不是靠“确认用户偏好”硬匹配，而是在 4 天频率、中级训练经验、近期可执行历史和单次训练质量约束下得到同一结构结论。

## 固定版本

- Legacy：`maxpower.core-fitness-knowledge@1.0.0#fnv1a-2848d0b7`
- Agent Knowledge：`knowledge_release.maxpower.existing-knowledge@0.1.0#sha256:f1c6a4699e1681d9d4af1cfb875e25a9d5be6a89a196a22291251791c799aefc`
- Agent Domain Catalog：379 条目
- 执行模式：`isolated_same_profile_replay`
- 运行时合并：`false`

## 同一档案

- 30 岁男性，178 cm，75 kg，居家办公；训练 1–3 年；健身房；每周 4 天、每次 60–90 分钟。
- 近期四分化；深蹲 100×3、卧推 80×5、硬拉 110×4。
- 用户估计体脂 16.5%；腰 86、胸 101、肩 113、颈 44 cm。
- 目标：12 周减脂保肌、清晰腹肌、宽肩窄腰；饮食严格；力量后轻中等有氧。

## A/B 结果

| 项目 | Legacy Planner | Agent Knowledge Planner |
|---|---|---|
| 结果 | ready | ready；6/6 Validator 通过 |
| 分化 | 胸 / 背 / 肩 / 腿 + 独立有氧日 | 胸 / 背 / 腿 / 肩 |
| 力量训练日 | 4 | 4 |
| 有氧 | 3×25 分钟，其中 2 次力量后、1 次独立 | 2×20 分钟，均在力量后，轻中等强度 |
| 热量 | 单一维持估算 2312；目标区间 1817–2065 | 休息日 1908；力量日 2345；力量+有氧日 2491；周均 2199 |
| 热效应 | 未在用户可见结果中单列 | 明示 10% 假设并纳入三种日型 |
| 体脂来源 | 未在能量结果中标出 | `user_estimate`，要求后续趋势校准 |

## Agent Knowledge 用户可见首周计划

| 日期 | 重点 | 动作与剂量 | 有氧 | 估时 |
|---|---|---|---|---:|
| 8/12 | 胸 + 三头 | 平板卧推 3×5–8；上斜卧推 2×8–12；绳索下压 2×10–15；RIR 2–3 | 20 分钟轻中等，力量后 | 53 分钟 |
| 8/13 | 背 + 二头 | 高位下拉 3×5–8；坐姿划船 3×5–8；补充下拉 2×8–12；绳索弯举 2×10–15；RIR 2–3 | — | 44 分钟 |
| 8/15 | 腿 | 深蹲 3×5–8；传统硬拉 3×5–8；反向弓步 2×8–12；坐姿腿弯举 2×10–15；RIR 2–3 | — | 44 分钟 |
| 8/17 | 肩 + 核心 | 哑铃推举 3×5–8；绳索侧平举 3×10–15；器械后束飞鸟 3×10–15；平板支撑 2×30–45 秒 | 20 分钟轻中等，力量后 | 67 分钟 |

中束与后束不是通用强加项：本档案的目标合同明确包含宽肩窄腰，且 `emphasisMuscles` 为 `lateral_deltoid`、`rear_deltoid`，所以进入肩日；腿日明确保留。

## 肌群联动疲劳与连续排期

每个动作携带计划用疲劳影响，而不是把动作只标成一个主肌群。例如：

- 平板卧推：胸 100，三头 45，前三角 45；
- 传统硬拉：臀/腘绳肌/后链 100，背部 45；
- 哑铃推举：三角肌 100，前三角 70，三头 45。

同一训练日的多个动作会合并影响，随后按每日残留系数衰减。排期验证不仅检查本周相邻训练，还检查下一轮：

| 从 → 到 | 间隔 | 峰值残留 | 阈值 | 结果 |
|---|---:|---:|---:|---|
| 胸 → 背 | 1 天 | 0 | 55 | 通过 |
| 背 → 腿 | 2 天 | 背部 38 | 55 | 通过 |
| 腿 → 肩 | 2 天 | 0 | 55 | 通过 |
| 肩 → 下一轮胸 | 2 天 | 前三角 27 | 55 | 通过 |

这解释了为什么背排在腿部硬拉之前、肩不紧接胸，以及为什么跨周也必须验证，而不是只套固定“休两天”。疲劳分值是透明的产品规划模型，不是肌电测量或医学结论；完成训练、RIR、酸痛和睡眠进入 Timeline 后仍需重算。

## 能量计算

本档案使用 Mifflin–St Jeor：BMR 约 1718 kcal。居家办公非训练基线按 1.2 得 2061 kcal。根据 75 kg、用户估计 16.5% → 目标 12%、12 周路径，所需速度约为每周体重的 0.43%，落在标准速度档；初始缺口取估算维持消耗的 15%，约 344 kcal/天，并限制在 300–500 的保守范围内。这里没有把 `7700 kcal/kg` 当作线性承诺。

食物热效应按摄入的 10% 建模，因此目标满足：

```text
摄入目标 =（居家办公基线 + 当日计划运动消耗 - 344）÷（1 - 0.10）
```

由此得到休息日 1908、力量日 2345、力量+20 分钟有氧日 2491 kcal，周均约 2199 kcal。该结果不是永久常数：体脂是用户估计，真实维持消耗也未知，需用 2–3 周同条件体重趋势、每周腰围、力量与执行率进行校准。

## 验证结果

Agent Knowledge Planner 的 6 个公开 Validator 均通过：

1. 训练频率等于可用 4 天；
2. 所有训练不超过 90 分钟；
3. 有独立腿日，且没有把胸/背/肩多个大区挤在同一天；
4. 相邻与跨周肌群残留低于阈值；
5. 动作与 full gym 条件兼容；
6. 训练日、休息日和食物热效应假设对用户可见。

## 边界与下一步

- 新 Release 仍是 `shadow`；本次只证明独立 Initial Planner 可运行、可解释、可验证，不等于已经切换客户端。
- 本次没有声称体脂 16.5% 是测量事实，也没有用单次计划承诺 12 周必达。
- 动态调整仍需复用同一 Agent Knowledge 边界接入 Timeline：训练结果、聚餐、睡眠和围度变化先成为事实，再触发重新评估与待确认计划变更。

## 复现

```bash
node tools/migrate-existing-knowledge.mjs
node tools/knowledge-contract.mjs lint

./node_modules/.bin/tsc -p tools/e2e/tsconfig.knowledge-backend-comparison.json
node --test \
  .knowledge-backend-comparison-build/tools/e2e/knowledgeBackendComparison.e2e.test.js \
  .knowledge-backend-comparison-build/tools/e2e/agentKnowledgePersonalPlan.e2e.test.js
```
