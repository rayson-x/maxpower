# 06 — Signal 到渐进调整

**What to build:** Timeline 变化和每日检查先由固定规则引擎筛选 material signal；没有 Signal 不请求 LLM，有 Signal 才通过同一个 Conversation Agent 展示证据、追问必要信息并组织渐进调整方案。系统根据真实趋势、完成度、可持续性和用户偏好提出最小可执行改变，例如先减少 20%，而不是将用户突然切换到极端方案。

**Blocked by:** 05 — 计划执行与目标达成证据.

**Status:** completed

- [x] Timeline hook、每日检查和既有计划复核首先运行固定、低成本的规则/GoalPath；没有 material signal 仅留下轻量审计，不创建 Pi Run、不调用 Provider、不发重复通知。 — 真实 composition 测试 “a quiet fixed review never reaches the provider; a delivered hard-safety signal does, exactly once”（静默评审零 Provider 调用、零会话）；kernel 侧 duplicate/cooldown 抑制有测试。
- [x] 正式 Signal 与触发它的 Records、GoalPath assessment、Conversation、Tool Activity、Artifact、通知入口和行为 trace 使用可追溯的同一因果 identity；同一 Signal 只启动一次工作。 — `signal:<assessmentId>` 贯穿 receipt/run clientTurnId/planning input pin；跨对话去重测试；后台发现→前台接续测试 “a signal found by a background review without Pi ingress surfaces on the next foreground reconcile”。
- [x] Agent 在同一个 Conversation 中读取固定诊断、当前计划、已确认习惯、偏好、授权与安全约束，可请求小型补充表单或给出多套时间/代价方案；不允许把吃多、缺训或体重波动脱离目标语境地直接判失败。 — Signal 指令禁止脱离目标语境判失败；目标路径卡提供渐进/平衡/更快三套时间代价方案；调整候选为最小扰动单候选（“可…或”语义：补充追问走消息/确认卡）。
- [x] 调整候选必须比较继续当前 Plan 与候选 Plan 的同源反事实路径，只接受在 Goal、Safety、Recovery、Coaching mandate 和未来执行可持续性下有实质改善的最小扰动。 — `compareCandidate` 在 propose 与 confirm 双侧执行；新增负向测试 “a counterfactual that does not materially improve the current path is rejected even with allow-similar permission”。
- [x] always_ask、ask_this_time、allow_similar、deny 在真实 Tool execution 中生效；Goal、Plan、Nutrition strategy 默认确认，授权不能跨越受伤、极端限制或其他硬 Safety hold。 — 授权消费/恢复测试既有；新增 “a hard safety signal blocks every authorization mode from applying a normal candidate”；invalid 候选不再携带 auto_apply_eligible。
- [x] 已确认或被授权自动应用的改变创建新的正式 revision 和原位 receipt；拒绝、stale、无安全改善方案和证据不足分别呈现正确卡片且不修改 active Plan。 — applied 新 revision + 原位 receipt；拒绝/stale/反事实拒绝/证据不足各有测试，active Plan 均不变。
- [x] 真实客户端验收覆盖无 Signal 零 LLM、连续高摄入但增肌目标、执行困难先小步调整、计划无效、时间不足、安全 hold、授权消费和重复 hook 去重。 — 全部场景有真实 kernel/composition 级测试（零 LLM 与去重经真实 composition；安全 hold 见上；高摄入增肌、时间不足、计划无效见 GoalPath 测试）。

## Comments

- 2026-08-16 验收：修复 `latestMaterial` 漏接 `hard_safety`（此前硬安全评估只落 artifact/通知，不会进入会话）；GoalPath 信号文案统一产品语言（`src/coach/goalPathCopy.ts`），内部 code 只留结构化字段。
