# 05 — 计划执行与目标达成证据

**What to build:** 用户能持续从手动入口或 Conversation 记录计划执行、自由训练、饮食显式数值、身体变化、恢复和执行困难；固定 Ledger、趋势与 GoalPath 将这些 Records 与 active Plan、Goal contract 对照，区分执行未达标、计划路径无效、时间不足、恢复问题与证据不足。Agent 解释结果和询问下一步，但不代替固定引擎判定。

**Blocked by:** 02 — 对话式记录与 Agent 上下文; 04 — 目标到首个当前阶段计划.

**Status:** completed

- [x] 本票复用 02 的 Record Module 与 04 的 active Plan/Goal contract；不得另建一套记录、营养、能量、趋势或风险计算路径。 — `RecordModule` 是唯一 admission 边界；GoalPath 快照来自同一 `projectDomainEvents`/`projectHealthTrends`；静态守卫 “manual and conversational records share one post-commit fixed Signal bridge”。
- [x] 用户可完成计划训练、记录自由训练、补充营养显式数值、提交身体/恢复/完成度反馈；手动与 Agent 两种入口落入同一正式事实和计算结果，Realtime、多模态和食物识别不在范围内。 — 手动（RecordFocus）与 Agent（record_explicit）同走 RecordModule；等价性测试通过；`clinical_context`/`subjective` 准入缺口已修复。
- [x] GoalPath 以当前 Goal contract、active Plan、正式执行事实、代表性 coverage、恢复和剩余期限为主语；减脂、增肌、塑形和力量等不同目标使用目标专用成功谓词，未记录只能产生 evidence gap，不能自动当失败。 — 目标专用谓词（physique/fat_loss/hypertrophy/strength/maintain）；测试：同一盈余在不同目标下结论相反、未记录不算失败、力量缺起点返回证据不足等。
- [x] 固定结果能区分并展示 execution shortfall、ineffective path、deadline/tempo insufficiency、recovery/safety constraint、bottleneck forecast 与 insufficient evidence；Agent 只能说明依据和提出允许的下一步。 — 新增 `tools/goal-path/safetyAndDiagnosis.test.ts`：正向 execution_failure、recovery_limited、deadline_bottleneck；既有 plan_friction、deadline/tempo、insufficient 测试；Artifact 带 `llm_explains_only` 边界。
- [x] Workout Module 与 Planning/GoalPath Module 消费同一份正式 Workout outcome、Nutrition Ledger 和趋势；历史 correction 使依赖判断/卡片 stale 并触发正确复核。 — correction→presentation stale + 提交后复核；测试 “correcting a Workout result marks an existing GoalPath presentation stale”、计划卡原位失效测试。
- [x] 真实客户端验收从首计划开始，跨多日 Records 得到不同目标专用结论，并覆盖未记录、部分营养 coverage、自由训练、结果 correction 和安全约束。 — 多日 fixture 覆盖未记录/部分 coverage/自由训练/correction；安全约束（疼痛、临床边界、极端限制、超量训练）经真实 kernel 评审测试 + 真实 composition 会话入口测试；Web E2E 覆盖首计划后的 Today/计划投影。

## Comments

- 2026-08-16 验收：补齐 `evaluateSafety` 全部硬安全路径与正向诊断测试。
