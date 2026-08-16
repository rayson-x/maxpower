# 16 — 用户获得经过验证且更容易执行的调整

**What to build:** 当前计划确实需要调整时，Agent 根据正式诊断、用户真实习惯、偏好、时间和领域知识生成一个或多个小幅候选；固定引擎比较继续当前计划和采用候选的未来路径。只有安全、符合 Goal contract 且实质改善的候选才能按 Coaching mandate 询问、允许一次或自动应用。

**Blocked by:** 15 — 每日检查发现长期沉默、瓶颈和恶化趋势.

**Status:** completed

## Existing foundation and required change

- 保留 09 的 Planning Agent、固定 candidate validation、Proposal、diff、confirmation、undo、stale 和 immutable revision。
- 将现有方向性 Replanner 和分散 adjustment 入口替换为 current-versus-candidate counterfactual gate。
- 营养调整只允许改变目标带、日型、记录/行为策略和用户已提供结构化数值所支持的内容；禁止 food lookup、estimate 或 food identity inference。

## Acceptance criteria

- [x] 当前计划仍在路径上时保持计划，不为了显得主动而生成调整。
- [x] 低完成度优先降低摩擦；高完成度且观察充分但响应不足才改变刺激或营养策略。
- [x] 候选尽量只改变少数未来变量，并包含观察、推进、保持、回退和 stop 条件。
- [x] 候选使用与当前计划相同的事实、Ledger、规则、目标模型、护栏和不确定性比较。
- [x] 未显著改善、不可观察或违反护栏的候选不得成为正式 Proposal。
- [x] 无安全改善候选时展示目标、期限、行为负担和健康代价冲突，不生成更极端方案。
- [x] 食物级量化变化只能引用用户已确认营养值；未知食物只能使用定性习惯建议。
- [x] allow similar 只覆盖 mandate 明确授权的低影响范围；安全、高影响和 Goal contract 变化仍需阻止或确认。
- [x] 自动应用后显示原因、before/after、预计效果、复核时间和撤销入口。
- [x] 任一相关事实或版本变化使旧 Proposal stale；确认只创建未来 Plan/Nutrition revisions。
- [x] Agent 与手动 Plan 操作共享同一 Proposal、validation、Policy 和 commit command。
- [x] 默认客户端覆盖 hold、渐进减量、恢复 backoff、不可达、自动小调整、拒绝、stale 和 undo。
- [x] 删除旧方向性 forecast 提交、独立营养调整、managed 旁路和兼容 Adapter。

