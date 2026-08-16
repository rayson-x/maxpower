# 09 — 可解释规划进度、知识引用与用户卡片

**What to build:** 用户看见规划正在做什么、为何提出调整、需要什么信息及确认后的影响；专业解释只使用当前 run 的可追溯证据，而不暴露思维链。

**Blocked by:** 02 — 本地 Agent 工具循环与能力合同; 05 — 风险触发的动态计划提案与确认.

**Status:** wontfix

- [ ] Planner 阶段以稳定、可渲染的 started/retrieving/evaluating/needs_input/proposal_ready/paused/failed 状态呈现。
- [ ] 提案卡展示事实依据、取舍、执行负担、下一次验证信号和确认状态；失败不会改变现行计划。
- [ ] 可见专业主张只接受本轮知识工具返回的 PassageRef，缺证据时明确范围或 cannot_judge。
