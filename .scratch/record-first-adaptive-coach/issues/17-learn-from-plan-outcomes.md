# 17 — 后续阶段从真实行为和结果中学习

**What to build:** 系统把每次计划候选与用户接受、实际执行、持续时间、主观负担、身体响应和反馈关联起来；后续阶段优先采用用户喜欢且真正执行的方案。实际行动可以比陈旧自述更能预测可执行性，但不能静默改写用户确认的偏好或事实。

**Blocked by:** 16 — 用户获得经过验证且更容易执行的调整.

**Status:** completed

## Existing foundation and required change

- 保留 Working memory、User profile preference、Plan revisions、Planner trace 和 Timeline 的所有权边界。
- 新增唯一 Plan outcome 结构，将候选、接受、执行、负担和响应连接起来，并通过正式工具接入首次规划和调整。
- 删除 Planner 仅依赖旧自述、对话摘要或未验证 Working memory 排序候选的路径；不建立隐藏画像或第二偏好库。

## Acceptance criteria

- [x] 每个 Plan revision 可关联候选、接受/拒绝、实际执行、持续时间、负担、身体响应、反馈和后续调整。
- [x] 当前阶段进展符合路径时保持，不自动生成下一阶段或改变策略。
- [x] 高执行与预期响应保持当前习惯；高执行且充分观察无响应才允许新候选。
- [x] 低执行优先选择降低摩擦的候选；恢复恶化优先 backoff。
- [x] 用户反复执行且反馈可接受的行为提高同类候选优先级。
- [x] 食物名称和偏好只能作为行为偏好，不能学习或固化为营养成分事实。
- [x] 实际行为与表达偏好冲突时提供简短说明，不静默修改 User profile。
- [x] 未确认模式只能成为可查看、编辑、固定和忘记的 Working memory。
- [x] 用户删除偏好或记忆后，下一次规划停止使用；历史 Record 和 Plan outcome 保留。
- [x] Planning Agent 只能通过正式工具读取 outcome 与偏好，不能从对话摘要建立权威画像。
- [x] 默认客户端覆盖两阶段渐进变化、保持、推进、回退、删除记忆和 replay。
- [x] 删除旧候选排序旁路、隐式长期画像和重复偏好结构。

