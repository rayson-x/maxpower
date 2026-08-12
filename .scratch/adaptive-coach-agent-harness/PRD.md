Status: ready-for-agent

# 自适应教练 Agent Harness：Timeline 驱动的风险判断、动态计划与全链路行为审计

> 来源：2026-08-12 至 2026-08-13 的产品设计、真实用户场景、教练方法调研与 Grill-Me 审查。
> 遵循：ADR 0001（本地 Coach 拥有决策与事实）、ADR 0002（云端仅保存确认资源且 LLM Gateway 只生成语言）、`CONTEXT.md` 的 Timeline、Record、Plan revision、Canonical packet 和实时运动分析不变量。

## Problem Statement

用户需要的不是一个按关键词套模板的排课工具，而是会围绕原目标、截止日、真实执行和恢复持续判断的教练 Agent。用户在首页对话中报告聚餐、睡眠差、缺训、训练表现、围度停滞或日程变化后，系统目前无法可靠地把这件事变成可追溯的 Record，判断它对按期目标的影响，并在必要时主动提供可确认的未来计划调整。

同一事件对不同 Goal contract 的意义必须不同：追求极限体脂并保肌、力量优先减脂、大体重减脂、增肌、塑形的成功条件、恢复护栏和可吸收偏差都不同。系统也不能把单次体重不动直接叫作平台期，或把未打卡自动视为不自律。

现有能力还缺少统一的行为审计链。开发者无法稳定回答：用户的事实是否进入 Timeline；为什么风险评估被触发、合并或跳过；Agent 为什么看到/选择某项工具；为何没有产生计划提案；提案是否被确认、执行并改善结果。实时训练识别和长期计划也没有足够明确的边界，可能把一次低置信观察误写为长期历史。

## Solution

建立一个本地拥有决策权的 `AgentHarness`。首页 Home Coach Agent 是唯一可见对话入口；它理解用户语言、调用受限工具、解释真实结果。`PlannerHarness` 是短生命周期的内部专项能力，不拥有用户会话或写入权限；既有确定性规划规则下沉为 `PlanningEngine`，负责训练分化、动作联动/疲劳、恢复、能量、有氧、时间、器械和安全校验。

Timeline 是用户事实的唯一触发 seam。对话、手动记录、训练 Timeline 操作、实时训练最终结果和同步导入均只作为 Capture/事实采集器；它们经确认后形成带 provenance 的 Timeline fact。每次有意义的 `TimelineChanged` 都由统一 `RiskEvaluationCoordinator` 合并并调用同一 `RiskEvaluator`。定时任务不制造事实，只检查最新事实投影，覆盖用户不打开 App 时的连续偏离和趋势停滞。

`RiskEvaluator` 使用 Goal contract、实际累计能量路径、饮食/训练执行、连续失败率、趋势、围度、恢复、可用时间和测量质量，输出内部状态 `on_path`、`at_risk`、`infeasible_under_guardrails` 或 `insufficient_evidence`。它不向用户展示未经产品结局校准的伪精确成功率。若原日期/目标路径有风险，Planner 搜索最小扰动、未来生效、通过护栏的候选计划；任何 Plan revision 仍必须经过用户确认和 Commit Validator。

实时训练形成独立低延迟执行闭环：Canonical packet 产生的 Observation 经过稳定性门控后可提示当前动作、调整下一组或触发安全暂停；这些即时提示不是 Timeline fact。仅在组/课程最终完成或用户修正后，将实际剂量和具有长期意义的结果写入 Timeline，再影响恢复与未来规划。

云端是 LLM API transport：认证、配额、幂等、取消与流转发，不拥有 Harness、Timeline、RiskEvaluator、PlannerHarness、ToolRegistry 或计划写入权。模型输入和能力清单均由本地 Harness 先组装；云端只返回文本或 Tool Call。

全链路采用可回放的决策审计，不记录模型思维链。每个关键边界保存事实来源、可用能力、选择动作、确定性 reason code、版本钉、结果和后续实际结果，使产品能分析 Agent 行为而不是猜测模型心理过程。

## User Stories

1. As a 训练用户, I want 首页 Home Coach Agent 能理解我日常报告而不是要求我进入专门规划页, so that 计划调整自然发生在我记录生活时。
2. As a 训练用户, I want 我在对话中明确说出的聚餐、睡眠、训练和日程信息被转成可查看的 Timeline Record, so that 后续计划基于真实历史。
3. As a 训练用户, I want 手动填写饮食、训练、体重、围度和恢复时走同一条 Timeline 流程, so that 对话和表单不会得出不同判断。
4. As a 训练用户, I want 我更正旧记录时保留原记录及更正来源, so that 我能理解趋势为何变化且历史不被静默篡改。
5. As a 追求极限体脂的用户, I want 一次放纵餐按我的原目标日期、保肌和恢复护栏评估, so that 系统不会机械地让我做惩罚性有氧。
6. As a 大体重减脂用户, I want 同样的放纵餐按我的目标周期和可吸收缓冲判断, so that 单次事件不会被夸大成计划失败。
7. As a 力量优先减脂用户, I want 计划调整同时保护关键动作的可比表现, so that 追回体重目标不会牺牲训练质量。
8. As a 保肌减脂用户, I want 脂肪/腰围趋势、有效抗阻训练、表现和恢复一起决定是否调整, so that 体重下降不被误当作唯一成功。
9. As a 增肌用户, I want 肌肉/围度或可比表现代理而不是单纯增重决定进展, so that 脂肪增加不会被误报为增肌成功。
10. As a 塑形用户, I want 腰围、肩腰比例、目标肌群代理和我定义的审美偏好共同进入目标, so that “宽肩窄腰”不会被缩减成一个秤重数字。
11. As a 目标日期优先的用户, I want 系统在偏离发生时主动搜索安全的未来调整并给我确认, so that 我尽量守住原目标日期。
12. As a 可接受慢一点的用户, I want 只有我明确同意后才改变目标日期、目标结果或执行负担, so that 系统不会暗中替我放慢或加严计划。
13. As a 训练用户, I want 系统区分单次失误、连续失败和持续恶化的执行趋势, so that 偶尔生活波动不会被误判为不适合计划。
14. As a 训练用户, I want 未记录被识别为证据不足而不是自动失败, so that 系统不会因信息缺失羞辱或惩罚我。
15. As a 训练用户, I want 实际累计能量路径、饮食容差、关键训练最低有效剂量和记录覆盖率共同影响风险判断, so that 计划反映真实可执行性。
16. As a 训练用户, I want 体重和围度长期不动时先判断测量噪声、执行不足和恢复问题, so that 我不会被错误地告知进入平台期。
17. As a 训练用户, I want 在高质量执行证据下的候选平台期只用一个可验证变量做未来调整, so that 系统不会不断叠加节食和有氧。
18. As a 训练用户, I want 睡眠差、局部酸痛或日程冲突能影响下一节训练及后续恢复安排, so that 分化和动作联动符合我真实状态。
19. As a 训练用户, I want 所有未来计划改变先显示理由、影响、取舍和下一次验证信号, so that 我能做知情确认。
20. As a 训练用户, I want Plan revision 在确认前不改变当前训练计划, so that 提案错误不会悄悄影响我。
21. As a 实时训练用户, I want 系统能在动作中给出姿势、节奏、下一组负荷或休息建议, so that 我能把当前训练完成得更好。
22. As a 实时训练用户, I want 单帧或低置信识别不改写我的历史或长期计划, so that 识别噪声不会伤害计划。
23. As a 实时训练用户, I want 最终完成剂量、提前结束和经我更正的训练结果进入 Timeline, so that 后续恢复和计划确实看见训练实际发生了什么。
24. As a 用户, I want 看到“正在核对记录”“正在比较方案”“需要一项信息”“方案已准备好”等阶段状态, so that 内部 Planner 工作不会看起来像聊天卡住。
25. As a 用户, I want 安全暂停和无法在护栏内守住原目标时得到清晰取舍, so that 系统不会用极端训练或饮食掩盖现实限制。
26. As a 开发者, I want 每个 Timeline 变化都有 `evaluated`、`coalesced`、`skipped`、`stale` 或 `failed` 的审计结果, so that 不触发评估也可解释。
27. As a 开发者, I want 每次 Agent 行为记录可见工具、实际选择、校验结果和 reason code, so that 可分析工具选择而不存储思维链。
28. As a 开发者, I want 风险评估、计划候选、知识引用、Plan revision、通知和用户确认通过同一因果链关联, so that 任一用户可见建议可以端到端回放。
29. As a 开发者, I want 实时提示记录稳定信号、置信度、展示/采纳情况和最终训练结果, so that 能评估提示是否有帮助且不保存无意义逐帧噪声。
30. As a 开发者, I want 同一事实快照、Goal contract、规则包和知识版本能重放相同确定性判断, so that 回归与事故排查可复现。
31. As a 开发者, I want LLM ToolResult 回到同一 Agent run 后再决定下一步, so that 模型不会在不知道工具真实结果时结束或编造解释。
32. As a 开发者, I want 可用工具由事实快照和权限装配而不是用户文本正则过滤, so that 新表达、否定和组合意图不会被硬编码路由误判。
33. As a 开发者, I want 知识查询的可见专业主张只引用当前 run 返回的 PassageRef, so that 教练解释能追溯证据与适用边界。
34. As a 产品方, I want 云端只作为 LLM API transport, so that Agent 决策、事实、计划写入和用户授权始终可在本地 CoachApplication 审计。
35. As a 产品方, I want 风险判断与未来计划调整的效果持续回填到 Timeline, so that 后续能校准风险状态和发现漏判、过度提醒或无效提案。

## Implementation Decisions

### Ownership and module boundaries

- `CoachApplication` remains the transaction and product seam. It owns typed tool execution, Coaching mandate checks, Record confirmation, proposal confirmation and immutable Plan revision creation.
- `AgentHarness` owns one visible Home Coach turn: local context assembly, capability assembly, bounded LLM/tool loop, output validation, citations and trace. The Home Coach Agent understands language and selects from supplied tools; it does not read storage or write facts/plans directly.
- `PlannerHarness.propose` is a bounded internal planning task. Its Planner Agent can retrieve evidence, compare strategies and call simulation/validation capabilities, but cannot own a user session, append a Timeline fact or commit a Plan revision.
- `PlanningEngine` is deterministic. It composes and validates candidate Training session plans against recovery constraints, muscle interaction/fatigue, energy, cardio, time, equipment and safety invariants. It does not infer user intent or choose product strategy from text.
- `ToolRegistry` remains the closed capability catalog. It validates schema, provenance, permission, mandate, risk ceiling and idempotency; LLM selection never grants authority by itself.
- The cloud LLM Gateway is transport only: authentication, entitlement, request limits, idempotency, cancellation and stream forwarding. It cannot add Coach instructions, filter tools from text, execute a business route, write a Record or create a Plan revision.

### Goal contract and achievability

- Each Goal contract stores target mode, target outcome, deadline, Goal-cycle protection constraints, measurement plan, correction envelope, execution tier and explicit slowdown consent. The default is `protect_original_path`; no actor may silently alter deadline, outcome or required pace.
- Execution tier controls trade-off weights and allowed future correction burden. It does not override recovery/safety constraints and does not constitute implicit approval to alter the contract.
- Internal achievability is the probability-like condition “target outcome at deadline AND target-mode guardrails throughout the path, given confirmed facts, planned actions, demonstrated adherence and uncertainty.” Before outcome calibration, it maps only to `on_path`, `at_risk`, `infeasible_under_guardrails` or `insufficient_evidence`; no numerical success score is shown to users.
- Goal modes have distinct target predicates and hard gates: higher-body-mass fat loss; lean/small-body-mass or lean-mass-preserving fat loss; strength-priority cut; hypertrophy; and physique/shaping. “Visible abs” is not a measurable deterministic target; it must use agreed proxies such as waist, relevant circumference, comparable photographs and user satisfaction.
- The energy model treats actual intake/activity as uncertain ranges and progressively calibrates with personal trend. A fixed `7700 kcal = 1 kg` conversion may be a short scenario estimate, never the long-horizon decision rule or a precise cardio repayment command.

### Timeline-first risk trigger

- Timeline is append-only, provenance-bearing history of Records. Conversation, manual form, Training Timeline UI, finalized real-time execution and import/sync all submit typed Timeline commands. Capture, model inference, proposal and plan are not Timeline facts.
- Corrections append superseding events and preserve original evidence. The Timeline projection resolves effective facts and exposes a monotonic `factFrontier`.
- Every accepted material Timeline change emits durable `TimelineChanged` through an outbox. `RiskEvaluationCoordinator` deduplicates/coalesces by user, fact frontier and goal/plan revision, then evaluates one projected snapshot.
- A clock emits `RiskEvaluationDue` and never invents a fact. Policy-driven daily reconciliation, weekly trend review and deadline/critical-session look-ahead inspect the latest Timeline snapshot without creating punitive failure records.
- Cosmetic reorder, unconfirmed drafts and low-confidence realtime observations do not launch a full forecast. Material deltas include confirmed intake deviation, completed/missed/rescheduled critical training, materially different final dose, recovery signal, comparable measurement, availability change and correction.

### Risk evaluation and dynamic adjustment

- `RiskEvaluator` returns achievability state, urgency, drivers, evidence quality and next action. `nextAction` is `none`, `request_evidence`, `propose_plan_change` or `safety_hold`; urgency is presentation/notification policy, not write authority.
- Execution evidence is distinct from outcome: actual cumulative energy-path ratio; `q_diet` for future intake tolerance; `q_train` for required Training session minimum effective dose; and coverage for observed records. Confirmed misses lower execution evidence; absent logging lowers coverage and widens uncertainty.
- Continuity is separately modelled with recency/criticality-weighted failure rate, consecutive confirmed critical failures, execution slope and remaining critical slots. The same count of failures has different effects when clustered near a short deadline or dispersed across a long Goal cycle.
- Stagnation diagnosis requires comparable body-mass and circumference trends to exceed measurement-noise thresholds before it can become a candidate response plateau. Low coverage means `insufficient_evidence`; high-quality execution with joint flat trend is a bounded one-variable experiment; joint flat trend plus poor recovery/performance is sustainability risk and cannot automatically intensify the plan.
- For `at_risk`, PlannerHarness compares the current path with safe, future-only candidate corrections. A candidate is valid only when it materially improves original-path achievability while passing all guardrails. If no such candidate exists, the Agent presents the explicit date/outcome/execution-burden trade-off. All future Plan revisions require fresh fact-frontier validation and user confirmation.

### Real-time execution coaching

- Real-time coaching is a separate low-latency loop driven only by Canonical packet evidence. It must not create a second rep counter, phase boundary, skeleton, trajectory truth, medical conclusion or muscle-activation claim.
- The loop has three levels: transient `Observation`; per-workout `LiveSessionState`; and durable Timeline fact. Only finalized/corrected actual dose and outcomes with a defined downstream meaning can enter Timeline.
- `RealtimeExecutionCoach` may issue a rate-limited cue, rest/technique change, current/next-set adjustment, or safety stop after confidence and temporal-stability gating. A transient cue itself is not historical evidence and does not trigger long-horizon risk evaluation.
- `ExecutionFinalizer` converts eligible final live state to a provenance-carrying workout Timeline fact. If the actual dose materially differs from the Training session plan, normal Timeline risk assessment evaluates future consequences; a future Plan revision still requires proposal and confirmation.

### LLM/tool loop, knowledge and confirmation

- Local AgentHarness builds the complete model input and versioned capability manifest before transport. Remote transport receives only that assembled input and declared tool schemas.
- The runtime must perform a bounded ToolResult loop: LLM selects visible tool → ToolRegistry validates/executes → typed result is appended to the same run → LLM may explain, query evidence, ask a material question, propose or complete. HITL suspension/resume continues with the latest valid snapshot.
- Tool guides state purpose, eligibility, non-eligibility, required factual provenance, output type, confirmation and evidence requirements. There is no execution-time regex business routing.
- Knowledge claims visible to users require PassageRefs returned during the current run, including applicability/limits. Citation validation, tool-input provenance validation, plan-invariant validation and commit validation remain independent checks.
- Planner stages emit durable user-readable state events but never private model reasoning: started, retrieving evidence, evaluating, needs input, proposal ready, paused or failed. Failure leaves the confirmed plan unchanged.

### Behavior observability and replay

- Preserve the existing content-free TraceEnvelope/outbox discipline and add an auditable `BehaviorDecisionRecord` at these decision boundaries: Timeline admission, capability visibility, tool selection/validation, materiality/coalescing, risk evaluation, Planner candidate comparison, plan validation, notification and live cue.
- Each decision record carries causal event IDs, `factFrontier`, Goal contract/Plan revision/rule/knowledge/policy versions, input references, closed reason codes, action/result, latency and expected subsequent signal. It does not store raw Chain of Thought.
- Trace correlation supports asynchronous fan-out: a conversation or Timeline event is a causation link for risk, planning, notification and later user action; a new fact frontier makes an in-flight proposal stale before presentation/commit.
- Persist both negative and positive behavior: evaluated, coalesced, skipped, stale, rejected, failed and completed must all have decision codes. Notification suppression due to preference is also observable.
- A later Timeline projection links each risk assessment/proposal to user decision and actual execution/outcome. The product initially reports associations, not causal proof that a proposal caused the later result.

## Testing Decisions

### What makes a good test

Tests assert externally observable behavior: Timeline facts/provenance, RiskAssessment, proposal/card status, Plan revision immutability, tool calls, visible stage events, behavior decision records and final projection. They do not assert prompt wording, model thought process, private chain-of-thought, regex implementation or internal simulation samples. Deterministic tests use in-memory Ledger, ScriptedLLMProvider, fixture Canonical packets and a controllable clock; real-model suites are separate regression/evaluation evidence.

### Primary test seam

The primary highest seam is **CoachApplication with Timeline command input and a ScriptedLLMProvider**. It exercises the user-visible result while retaining the real ToolRegistry, Timeline projection, RiskEvaluationCoordinator, PlannerHarness boundary, confirmation path and trace outbox. This is the agreed seam for all end-to-end scenarios; lower pure-module tests exist only for deterministic math/validation and transport contracts.

### Required scenario suites

- Conversation and manual record of the same event produce equivalent effective Timeline fact, RiskAssessment and user-visible outcome.
- Finalized realtime workout outcome affects Timeline/risk; low-confidence Observation and discarded cue do not.
- Each target mode receives the same excess-intake, missed-training and recovery event and produces appropriately different risk/proposal behavior.
- `protect_deadline` proactively produces a safe pending proposal when at risk; a user-approved slowdown path presents a distinct contract change; no case silently changes deadline/outcome.
- Single failure with remaining buffer monitors; continuous critical failures or worsening weighted failure rate reaches `at_risk`; missing data becomes evidence request rather than confirmed failure.
- Flat weight alone, changing waist with flat weight, low-coverage joint flat trend, high-coverage joint flat trend and joint flat trend with recovery decline reach their respective stagnation outcomes.
- A proposal cannot commit if Timeline fact frontier, Goal contract, rule pack, knowledge version or Plan revision changed after generation.
- A ToolResult is visible to the same LLM run before its final explanation; tools unavailable by snapshot/permission are not callable; no user-text expression bypasses ToolRegistry.
- Local model-input assembly and every remote transport forward the exact capability set; cloud transport neither routes a business action nor writes a Record.
- Every TimelineChanged has a behavior result (`evaluated`, `coalesced`, `skipped`, `stale` or `failed`); every user-visible plan adjustment can be replayed through causation IDs and version pins.
- Live cue tests check stable Canonical evidence, rate limits, user-visible cue/action and finalization linkage, never individual raw pose-frame implementation.

### Existing prior art

- CoachApplication/ScriptedLLMProvider lifecycle and proposal tests.
- GoalCyclePlanner deterministic trace and constraint tests.
- ToolRegistry schema/authorization/provenance audit tests.
- TraceRecorder, local/remote sink and outbox reconciliation tests.
- Cloud LLM provider transport, cancellation, stream resume and tool-name mapping tests.
- Canonical-packet real-time execution and workout finalization contract tests.

### Evaluation and quality gates

- Deterministic replay: same Timeline projection, Goal contract, rule/knowledge versions and deterministic engine input produces the same RiskAssessment and validation result.
- Scenario evaluation covers paraphrase, negation, ambiguity, missing data, contradictory correction, goal-mode differences, notifications and stale proposal races.
- Real-model tests score tool selection, fact provenance, unnecessary-question rate, citation validity, proposal usefulness, false-positive risk notifications and missed material deviations. They do not treat a model rationale as ground truth.
- Product monitoring tracks trigger latency, coalescing/skips, proposal acceptance/rejection, actual completion after proposal, risk-state transitions, safety holds, live-cue display/acknowledgement and later outcome associations.

## Out of Scope

- Displaying an uncalibrated numerical “success probability” to users, or claiming medical/personal outcome certainty.
- A clinical diagnosis, injury diagnosis, medical nutrition management, medication advice or automatic response to high-risk medical signals beyond safety hold and appropriate escalation.
- Automatic commitment of future Plan revisions, including in managed mode, for the dynamic-planning scenarios in this spec.
- A visual trace-analysis dashboard, raw prompt/Chain-of-Thought recording, or uploading raw camera/video data as behavior telemetry.
- Product-wide outcome calibration, causal-effect proof for plan changes, and a trained “visible abs” or aesthetic classifier; this spec creates the outcome lineage needed for later calibration.
- Replacing Canonical packet contracts, creating a second realtime rep/phase pipeline, or changing recognition-profile scientific validity rules.
- Moving Coach orchestration, Timeline ownership, tool execution, RiskEvaluator or PlannerHarness to the cloud.
- Broad redesign of existing onboarding, plan-rendering UI or nutrition database beyond the typed cards/events needed to surface this workflow.

## Further Notes

- The spec treats the four planning questions explicitly: known goal/constraints are reused; high-impact missing evidence yields at most three questions; coach knowledge adds safety/measurement/alternative-path considerations; unresolved causal questions become time-bounded one-variable experiments with predeclared signals.
- Numeric probability calibration requires held-out, completed Goal-cycle outcomes segmented by target mode, measurement protocol, training state and execution tier. Until then the four risk states are decision aids, not scientific probability claims.
- “Big-body-mass fat loss” and “heavy-lifting/strength-priority cut” are separate goal modes. The former refers to body-composition context; the latter protects specified comparable strength performance.
- All newly user-facing language uses “计划” and “行动”; it must not reintroduce “处方/prescription” terminology except when reading immutable legacy storage wire names.
- This PRD supersedes conflicting dynamic-planning assumptions in older pipeline specs, while retaining their trace, PlannerTrace, Proposal/confirmation and immutable Plan revision foundations.
