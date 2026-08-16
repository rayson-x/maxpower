# 01 — Pi Conversation Agent 可持续工作台

**What to build:** 用户从 Coach 顶层入口打开一条新对话、恢复同一条对话、发送消息、停止当前工作、发送新消息改变方向，并在应用重启后继续查看同一条 Conversation。production Run 必须由 `@mariozechner/pi-agent-core` 的 Agent 执行；文本、工具活动、结构化结果和失败状态都作为稳定的 Conversation Item 原位持久化与恢复。首个可用闭环包含一项真实只读工具，证明 Pi 的 prompt → tool → result continuation → final answer 全流程，而不是只做聊天 UI。

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] 正式客户端的 Coach 顶层入口经过唯一的 Agent Conversation Module；该 Module 是移动客户端创建、发送、停止、steer、恢复和读取对话的唯一正式 Interface。 — `src/mobile/ui/ProductShell.tsx` 只调用 `PiAgentConversationModule`；`CoachDrawer` 纯 props；grep 守卫 “Coach is a conversation, not a page-context session”。
- [x] production composition 真实构造 Pi Agent，使用 Pi 原生 stream、tool continuation、abort、steer/follow-up 和 lifecycle event；Pi 不是只作为 `pi-ai` transport 或测试类型存在。 — `createMobileAccountRuntime.ts` 注入 `cloudCoach.pi`；`PiAgentConversationModule.ts` `new Agent({streamFn, steeringMode:"all", toolExecution:"sequential", beforeToolCall/afterToolCall, subscribe})`；`src/` 中唯一 `new Agent`。
- [x] 用户可在同一 Conversation 中停止正在运行的 Agent、保留已经显示的内容和已提交 receipt，并立即发送新消息；新 Run 只能在旧 Run 安全终止或收束后开始。 — 修复：`stop()` 现在立即清除 active 路由（此前 stop 后立即发送会 steer 进已 abort 的 agent）；测试 “a running Pi conversation accepts steer…” 与 “a send immediately after stop starts a new run instead of steering the aborted one”。
- [x] Conversation Items、Run 终态、部分文本、工具活动和错误恢复状态以稳定 identity 写入本地 Ledger；重启后不会依赖 Pi 内存状态，不能安全继续的 Run 显示可理解的重试/中断状态。 — 测试 “…persists one conversation across real tool continuation and restart”、“a Pi transport failure is durable as failed…”、“a run orphaned by process death becomes an explicit interrupted state…”、“an orderly app dispose terminates the active run durably as app_disposed”。
- [x] 新开 Coach 会创建新 Conversation；收起再打开保持当前 Conversation；页面切换不会改变 Conversation identity 或暂停它。 — `coachAttachment{sessionId,foreground}` 持久化恢复；路由切换只 minimize；测试 “SQLite 壳状态按用户隔离…”。
- [x] 物理删除自研 Agent runtime、Pi 到旧 ProviderEvent 的翻译层、旧 provider tool-loop 和页面 Context 决定 session 的正式路径；不得保留 fallback、双运行时或兼容开关。 — 全 `src/` grep 无 `ProviderEvent|toolLoop|AgentRuntime|CoachApplication|conversation_turn_in_progress`；残留死开关 `knowledgeToolsEnabled/actionToolsEnabled` 已移除。
- [x] 验收从真实客户端入口和 Agent Conversation Module Interface 开始，覆盖 production Adapter 与 deterministic test Adapter，验证 plain text、真实只读 tool continuation、stop、steer、重启恢复和旧路径搜索结果。 — `tools/agent-conversation/piConversationWorkbench.test.ts`（deterministic stream）+ `tools/agent-conversation/localComposition.test.ts`（真实 `createLocalConversationAdapters` + 真实 kernel/RecordModule 经 Module 入口）+ 2026-08-16 Web E2E（注册→Baseline→目标路径→确认→计划候选→确认→Today→重载→重新登录→历史恢复，console 干净，5 次本地 LLM 调用）。

## Comments

- 2026-08-16 验收：修复 send-after-stop 路由缺陷与 read() 最新 Run 的同时间戳 tie-break；补齐 orphan/dispose 重启恢复测试。
