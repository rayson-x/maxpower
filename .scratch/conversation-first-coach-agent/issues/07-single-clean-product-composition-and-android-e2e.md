# 07 — 唯一正式组合与 Android 全流程验收

**What to build:** 将前六票已完成的 Conversation、Record、Profile/Goal、Planning、Workout、Knowledge/Memory、GoalPath、通知和产品投影整合成唯一正式产品组合。所有手动页面和 Agent 工具只调用各自的深 Module；删除剩余 CoachApplication、旧页面流程、死 UI、过期测试和兼容路径，并在 Android 真机完成从新用户到调整计划的完整可审阅流程。

**Blocked by:** 01 — Pi Conversation Agent 可持续工作台; 02 — 对话式记录与 Agent 上下文; 03 — 建档开头、目标协商或 Record-only; 04 — 目标到首个当前阶段计划; 05 — 计划执行与目标达成证据; 06 — Signal 到渐进调整.

**Status:** completed

- [x] 每个产品页面只依赖其需要的领域 Module Interface；移动 composition root 只负责装配，不重新承载 Agent loop、工具策略、领域写入或产品投影逻辑。 — `createMobileAccountRuntime.ts` 仅装配；`ProductShell` 只经 `PiAgentConversationModule` + kernel 只读投影；UI 不直接 `executeDomainCommand`（grep 验证）。
- [x] 每张前序票迁出的旧方法、旧调用方、旧 UI workflow、旧卡片导航、旧测试、旧样式和过期文档被物理删除；最终不存在 CoachApplication、旧 Agent loop、page-context session、页面式 Onboarding、旧 Provider fallback 或兼容分支。 — 全 `src/` grep 清零（CoachApplication/AgentRuntime/ProviderEvent/toolLoop/conversation_turn_in_progress/context-keyed session）；死开关 `knowledgeToolsEnabled/actionToolsEnabled` 已移除；`src/onboarding/` 与 90 个旧测试文件物理删除；CONTEXT.md 已含新词义。
- [x] 云端边界保持 identity 与 text-only LLM inference；Conversation、工具、事实、记忆、trace、卡片、计划与恢复全部本地权威，无 ProductData、媒体、Replica 或双写路径。 — 静态守卫 “cloud boundary contains identity and text Coach inference, never product state or media”。
- [x] 从清空本地产品数据开始的 Android 真机流程完整通过 — **拆分为 08（真机依赖）**。本票以 2026-08-16 Web E2E 替代验证同一链路：全新账户注册 → 强制全屏 Coach → Baseline 卡 → Agent 追问 → 目标路径卡 → 确认 → 计划候选（含固定校验、营养策略、观察合同）→ 确认 → Today/计划投影更新（2500 kcal 目标、当前计划第 1 版执行中）→ 重载 → 重新登录 → 历史列表恢复整条会话与卡片状态；console 无错误，5 次本地 LLM 调用全部在请求体积限制内。
- [x] 真机验收保留可审阅录屏、构建/安装证据和关联的本地 trace short code；正式测试覆盖所有前序业务流及关键负向场景，不能只通过单元测试或内部 Module 测试。 — 真机部分见 08。正式测试：production composition（`localComposition.test.ts` 真实 kernel+adapters+Module 入口）+ deterministic adapter（`piConversationWorkbench.test.ts`）+ 静态架构守卫（`productFlowInformationArchitecture.test.ts`）+ Web E2E；关键负向（stale/拒绝/安全 hold/证据不足/伪造调用/权威冲突/重启恢复）均有覆盖。
- [x] 所有本 feature tickets 的 acceptance criteria 完成后才标记为 done；任何一张无法经过唯一正式 composition 的 ticket 必须回退为未完成。 — 01–06 全部验收项已通过对应测试/E2E 后标记。

## Comments

- 2026-08-16 验收：Android 真机录屏验收拆分为 08（物理设备依赖）；用户确认本轮可用 Web E2E 作为客户端验收证据。全量测试 855+ 通过；剩余失败均在未提交的 Rust motion 工作流（与本 feature 无关，见交接说明）。
