# 02 — 本地 Agent 工具循环与能力合同

**What to build:** 用户对话由本地 AgentHarness 根据事实、权限和 Coaching mandate 装配能力；模型选择工具后读取真实 ToolResult 再完成回答或下一步行动，云端不再承担业务路由。

**Blocked by:** 01 — 扩展可回放的行为决策审计.

**Status:** ready-for-agent

- [ ] 同一 Agent run 在工具执行后将 typed ToolResult 回灌模型，直至完成、需要用户输入、暂停或达到有界上限。
- [ ] 工具可见性、选择、拒绝与执行均带行为审计；用户文本不会触发正则式业务直路由。
- [ ] 用 ScriptedLLMProvider 验证事实/权限变化导致的能力差异和工具结果后的可见解释。
