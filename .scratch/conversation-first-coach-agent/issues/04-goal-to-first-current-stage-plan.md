# 04 — 目标到首个当前阶段计划

**What to build:** 已确认目标的用户在同一 Conversation 中获得一份可执行的当前阶段计划。LLM 负责组织训练、Nutrition strategy、解释与方案表达；固定工具和 validator 负责正式事实、目标路径、能量/营养范围、安全、可达性与提交有效性。用户在卡片中确认后，新的 Plan/Nutrition revision 原子写入，业务页面自然读取该投影。

**Blocked by:** 03 — 建档开头、目标协商或 Record-only.

**Status:** completed

- [x] 本票从 03 已确认 Goal contract 的真实 Conversation 继续，不另开页面式 Planner 或绕过 Pi Tool/Conversation Item 链。 — 目标确认后同会话内部 run 组织候选；PlanScreen 只读（静态守卫 “plan is a read-only confirmed workspace…”）。
- [x] Agent 可读取固定 planning input、Daily Ledger、当前事实、恢复/安全约束与已安装知识；高风险、数值或可提交计划结论缺少固定依据时返回 insufficient evidence，而不是由模型先验补齐。 — `CurrentStagePlanningModule.readInput` 缺事实时返回 typed `{status:"insufficient_facts", missing}`（原为裸 throw）；调整侧 `candidate_not_supported_by_evidence` 有测试。
- [x] LLM 只能提交符合闭合 schema 的当前阶段候选及解释；固定 Engine 必须验证 Goal contract、营养/能量范围、训练剂量、恢复、极端限制、安全护栏和版本 pins。 — `validateAdaptivePlanCandidate`：目标绑定、能量护栏、刺激槽位组数一致、周/日剂量上限、观察合同、极端限制用语、安全 hold、mandate、知识 pins（confirm 时快照比对）。
- [x] 用户在同一 Conversation 的 Comparison/Confirmation 卡中看到候选摘要、近期安排、Nutrition strategy、依据、取舍、before/after diff 与验证结果；确认前不得写正式 Plan 或 Nutrition revision。 — `planCandidateDetails` + `CoachDrawer` 渲染；propose 提交 `domainEvents: []`。
- [x] 确认时对全部相关事实前沿执行 CAS；stale、拒绝或验证失败不会改变 active Plan，并在原卡显示可理解的恢复结果与 receipt。 — 新增测试 “a fact-frontier change between propose and confirm makes the proposal stale without touching the active Plan”（`adaptive_plan_proposal_stale`）；原卡原位 stale + 恢复文案；拒绝测试既有。
- [x] Confirm 后正式 Plan/Nutrition projection 自动供产品页面读取，但 Agent 卡不能导航、关闭对话或打开计划页面。 — 单事务提交 plan+nutrition；Web E2E 验证确认后 Today/计划页自然更新且对话不跳转；卡仅 confirm/reject。
- [x] 计划领域调用方迁到独立 Planning Module，旧 God Object 中已迁移的规划路径物理删除；真实客户端验收 Goal → candidate → fixed validation → confirmation → Plan projection，以及安全拒绝、证据不足、stale 三类负向场景。 — `CurrentStagePlanningModule` 是 Pi 侧唯一 planning 边界（kernel 是领域权威，持有正式命令；旧 CoachApplication 已删）。正向 + 三类负向均有测试；正向另经 Web E2E。

## Comments

- 2026-08-16 验收：invalid 候选不再携带 auto_apply_eligible resolution（消除授权误用隐患）；补齐 confirm 期 stale 测试。
