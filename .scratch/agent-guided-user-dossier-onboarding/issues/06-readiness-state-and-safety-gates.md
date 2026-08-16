# 06 — Readiness state 与安全能力门控

**What to build:** Agent 把近期睡眠、疲劳、酸痛/疼痛、表现、压力和可用时间理解为有时效的 Readiness state，并根据证据只限制真正相关的训练、营养或有氧能力，而不把短期状态固化进 User Profile。

**Blocked by:** 04 — Agent 动态表单与行动门槛

**Status:** wontfix

- [ ] 睡眠、疲劳、局部酸痛/疼痛、近期表现和时间可用性进入带来源、观察窗口和过期条件的 Timeline/Readiness 投影，不进入永久训练等级。
- [ ] Readiness 到期或出现更新事实后重新评估；昨天睡差不会长期改变稳定 Profile 或 Coaching level assessment。
- [ ] 安全信息的 unknown、明确否认、明确限制和 stop signal 保持不同状态，客户端不得把一条总确认扩展成多个未经回答的 `false`。
- [ ] 证据不足只门控相关能力，例如可靠能量目标、空腹有氧、HIIT 或具体训练执行；不因可选状态未知而阻止保存基础档案。
- [ ] Agent 能解释需要哪项事实以及它将改变哪个行动；用户跳过后看见具体限制而非泛化警告。
- [ ] 睡眠差且腿部酸痛、其他位置可用的场景产生有时效的 readiness 结果，并能被后续首次 Planner 读取，而不是机械取消全部训练。
- [ ] Readiness 与安全门控的正向、跳过、阻止和过期结果均产生结构化行为审计。
