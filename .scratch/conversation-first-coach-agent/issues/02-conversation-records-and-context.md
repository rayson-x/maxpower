# 02 — 对话式记录与 Agent 上下文

**What to build:** 用户可在已经可恢复的 Conversation 中让 Agent 读取当前档案、正式 Records、Daily Ledger、趋势、已安装知识、Working Memory 和相关旧对话；也可记录明确发生的饮食显式数值、身体数据、活动、训练结果与执行反馈。手动 UI 与 Agent 工具经同一 Record Module 写入同一份正式事实，差别只保留 actor、causation 和 Conversation trace。

**Blocked by:** 01 — Pi Conversation Agent 可持续工作台.

**Status:** completed

- [x] 本票所有行为从 01 的真实 Conversation 入口启动，并通过 Pi Agent 与正式 Tool Activity/Card 链完成；禁止直接调用领域 handler、伪造 Conversation snapshot 或另建 Agent 入口。 — `localComposition.test.ts` 全部经 `PiAgentConversationModule.execute` + `createLocalConversationAdapters` + 真实 `LocalProductKernel`/`RecordModule`。
- [x] Agent Context 按权威等级装配当前 Ledger facts、Working Memory、相关旧 Conversation refs 和最近消息；旧对话或记忆不能覆盖正式事实，长对话压缩仍保留任务、已确认决定、待处理事项与来源 refs。 — `defaultContext` 含 `authorityOrder`；测试 “confirmed facts outrank working memory in the assembled agent context”、“a long completed conversation saves deterministic recovery memory…”。
- [x] Capability manifest 按事实前沿、Safety、Coaching mandate、pending action 和 Scenario 动态收窄；工具执行时再次校验，伪造、过期或不可见工具调用被拒绝。 — 构造期收窄 + `beforeToolCall`/`assertCapability` 再校验；测试 “a capability-narrowed run blocks a forged goal tool call and never writes”。
- [x] 明确、低风险、已发生的 Record 可按授权自动写入，并在同一 Conversation 原位显示来源、正式 receipt 与 correction 入口；未来意图、建议、缺单位或含糊对象不得写成 Record。 — 测试 “a delegated recording mandate writes an explicit statement immediately with an in-place receipt”、“a conversational record flows through the production adapters into the formal Timeline only after confirmation”、“an Agent correction stays in the thread…”。
- [x] 不完整但可确认的数据保持 unknown 或进入小型 Form/Confirmation 卡；营养名称或份量不得隐式推断数值，只有用户确认的结构化营养数值进入 Ledger。 — 测试 “a nutrition record without explicit structured values is rejected before any card or write”（含混合 provenance 拒绝）、“explicit nutrition values are recorded without food inference…”。
- [x] 手动和 Agent 对同一确认数据产生等价的 Timeline/Record 投影、计算和校验；手动操作不伪造 Agent 消息或 Tool Activity。 — 测试 “manual and conversational entries admit equivalent facts while only the Agent path leaves a conversation trace”。
- [x] 已迁移的记录、上下文和工具调用路径从旧 God Object 物理移除；production 和 deterministic adapter 的端到端测试覆盖自动记录、确认、纠错、上下文权威冲突、权限拒绝与重启后 receipt 恢复。 — 六场景均有测试（纠错经 production adapter 链；receipt 重启恢复在记录 E2E 测试内断言）。

## Comments

- 2026-08-16 验收：修复 `factHasNoCompletedClaim` 阻塞 `clinical_context`/`subjective` 正式写入的准入缺口（Record drawer 的临床背景此前会在运行时抛错）。
