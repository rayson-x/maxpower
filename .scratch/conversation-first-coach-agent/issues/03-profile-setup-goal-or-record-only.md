# 03 — 建档开头、目标协商或 Record-only

**What to build:** 无档案用户首次进入 Coach 时，在同一 Conversation 中看到固定欢迎消息和 Baseline intake 表单。提交年龄、身高、当前体重与可选自由语言目标后，由同一 Pi Agent 根据已经知道的信息自由追问；用户可以协商并确认 Goal contract，也可以没有目标或主动选择仅记录，进入 Record-only 而不被强制生成计划。

**Blocked by:** 02 — 对话式记录与 Agent 上下文.

**Status:** completed

- [x] 本票从 02 的新 Conversation 与 Context/Capability 链开始，Profile Setup 只是受信 Conversation opening，不是独立 route、Screen、页面跳转或固定多步状态机。 — 旧页面式 Onboarding（`src/onboarding/`、`DynamicOnboardingFormCard`、`BaselineIntakeCard` 等）物理删除；`openNew` 直接写欢迎消息 + 版本化 Baseline 卡；静态守卫测试通过。
- [x] 无权威 User profile 时，Conversation Starter 直接生成欢迎 Message Item 和版本化 Baseline intake Form；字段单位、校验、敏感性、来源和 Onboarding draft 由本地 Schema/领域 Module 所有。 — 字段范围/单位迁入 `src/coach/domain.ts` 的 `validateBaselineIntake`，kernel `user.bootstrap` 在领域边界再次校验；卡片 schema 版本化（`coach/model.ts`）；goalText 经 `fieldProvenance` 进入档案。
- [x] Baseline 提交后同一个 Pi Agent 可基于目标原话、已确认事实、缺失证据、知识与工具自由决定追问、表单、比较或解释；不得重复询问已提供且仍有效的信息，也不得硬编码第二页、第三页问题顺序。 — 内部 run 指令明确要求意图理解 + 知识接地追问（`knowledge.search_installed`）+ 不重复已确认信息；无任何固定问题序列。
- [x] Agent 可用结构化 Choice/Comparison 卡与用户协商目标、期限、付出代价和安全约束；Goal contract 只有经正式确认才写入。 — `goal.propose_path` 只产出 awaiting_confirmation 卡；写入仅经 `resolve_goal_path` → `confirmGoalNegotiation`（重跑固定预览 + CAS）；测试链覆盖。
- [x] 没有目标、目标尚不清楚或用户明确只记录时，系统进入 Record-only；不得虚构 Goal contract、Plan 或 Nutrition strategy，且 Agent 仍能使用 02 的记录能力。 — `choose_record_only` 只写 receipt（“没有创建目标、计划或营养策略”）；Baseline 后 record 能力随 profile+mandate 可用。
- [x] 新开对话可预填未完成 draft 并保留 provenance/version conflict；提交、拒绝、过期和重启恢复均在同一 Conversation 原位呈现。 — 新增跨对话预填：新开对话加载用户最新未提交 draft 并延续 revision 链；测试 “a new conversation prefills the latest unsubmitted baseline draft from any earlier conversation” 与同对话重启恢复测试。
- [x] Profile/Goal 手动入口与 Agent 入口调用相同领域 Module；迁移后删除旧页面式 Onboarding、context-keyed session 和阶段机正式逻辑，并通过真实客户端验收 Baseline → 目标、Baseline → Record-only、恢复未完成 draft 三条路径。 — 唯一 intake 路径是 kernel `user.bootstrap`；三路径均有测试，Baseline→目标→首计划另经 2026-08-16 Web E2E 真实客户端验证。

## Comments

- 2026-08-16 验收：Baseline 字段校验收归领域 Module；新增跨对话 draft 预填。Record-only 在 Baseline 之前不可用是既定设计（固定开头先于一切记录）。
