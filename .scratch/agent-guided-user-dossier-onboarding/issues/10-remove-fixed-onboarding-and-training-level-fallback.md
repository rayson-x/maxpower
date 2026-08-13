# 10 — 移除旧固定建档与训练等级 fallback

**What to build:** 在新建档、评估和首次计划闭环稳定后，彻底停止向新用户展示旧固定问卷、注入旧默认值或让 Planner 回退到用户自选训练等级；历史数据只作为带来源的背景证据读取。

**Blocked by:** 09 — 建档中断、冲突、过期与幂等恢复

**Status:** ready-for-agent

- [ ] 新用户没有任何入口可以回到旧固定训练起点/目标枚举/频率/场地/协作模式问卷，新路径是唯一默认入口。
- [ ] 旧页面不再代填安全否认、权限、器械、84 天期限、训练场景或其他未经确认的默认值。
- [ ] Planner 的新用户路径在缺少 Coaching level assessment 时返回 unknown/校准需求，不读取 `trainingExperience` 作为隐式业务 fallback。
- [ ] 历史 `trainingExperience` 可以作为带来源、低权重的 Training background 证据显示，但不能自动升级为新 assessment 或覆盖新事实。
- [ ] 所有新建档完成校验不再要求旧固定 sections 或旧等级字段；四项 Baseline intake 与具体行动门槛成为唯一新语义。
- [ ] 删除旧路径后，现有已完成账号、历史档案读取、活动计划和 Timeline 仍保持可用；迁移失败不会静默生成新默认值。
- [ ] 搜索和回归测试证明客户端与 Planner 不存在仍可触发旧固定新用户流程的运行时路径。
