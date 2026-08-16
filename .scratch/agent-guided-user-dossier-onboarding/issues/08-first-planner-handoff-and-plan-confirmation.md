# 08 — 首次 Planner 交接与独立计划确认

**What to build:** 档案完成后，主 Agent 启动短生命周期 PlannerHarness，使用确认后的 User dossier、Coaching level assessment、Readiness、Agent Knowledge 和规则生成首个可解释计划提案；计划只有在独立确认后才成为活动计划。

**Blocked by:** 07 — 组合档案摘要、修正与持久确认

**Status:** wontfix

- [ ] 档案完成事件向 Planner 传递确认资源引用、fact frontier、Goal Contract、assessment/readiness revision、知识版本和规则版本，不重新从聊天猜测用户事实。
- [ ] Planner 消费多维 Coaching level assessment 和 Training background 决定分化、动作复杂度、起始训练量及校准速度，不再把旧 `trainingExperience` 作为唯一或隐式 fallback。
- [ ] Planner 同时校验目标、恢复、动作联动/疲劳、日程、器械、营养/有氧和安全约束；缺少必要事实时返回具体 `needs_input` 或带校准点的保守提案。
- [ ] 有训练经验且持续四分化、具备可比力量记录的固定样本不会被默认改成普通新手两分化；任何分化改变都提供基于证据的理由。
- [ ] 首次计划展示关键依据、unknown 造成的保守项、验证信号和复核窗口，不展示内部成功概率或思维链。
- [ ] 档案确认与计划确认是两个不同的人类动作；计划确认前活动计划不变，拒绝或要求修改提案不会撤销已完成档案。
- [ ] 计划确认重新校验事实、目标、知识和规则版本；出现新 Timeline fact 或档案修正时旧 proposal 变 stale 并重新计算。
- [ ] Planner 仍是内部任务，不建立第二个可见人格、独立长期会话或直接写入权限。
