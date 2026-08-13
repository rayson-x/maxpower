Status: rust-calibration-audit-open / client-model-acceptance-data-gated

# Rust 单次因果动作理解与人工质量审核 MVP

## Problem Statement

用户已经为 50 个个人训练视频标注了动作、拍摄方向、Rep 数量以及 464 个 Rep 的开始和结束区间，但当前系统仍没有一套可信、统一且可审核的动作质量理解结果。现有能力分散在 Rust 计次/阶段逻辑、TypeScript 报告逻辑、实验性器械轨迹和历史回放脚本中；同视频模板回放也曾被误解为真实识别能力。

用户需要验证的不是离线脚本能否反复拟合视频，而是客户端可运行的 YOLOX + RTMPose Halpe-26 视觉流进入同一套 Rust Motion SDK 后，能否在看不到人工时间线的前提下进行一次单向、因果识别，冻结每个 Rep 的开始、实际反向点、返回端点和分维度动作质量解释。冻结后再揭示已有人工开始/结束标注计算真实对齐，并由用户审核 Rust 首次提出的反向点与动作质量结论。

用户不希望重新标注已有动作、方向、Rep 或开始/结束时间，也不希望系统自动训练或自动修改 Profile。页面可以把未导出的审核草稿自动保存到当前浏览器的 `localStorage`，刷新后恢复；用户最后手动导出审核 JSON，供后续离线校准和新版本盲测使用。

实现过程中已经确认一个必须写入验收语义的约束：现有 6 条卧推视频参与过阈值选择，因此它们属于 `touched_benchmark`，不能再证明未见数据泛化；其余大多数精确 action × view 上下文尚无可在排除目标来源后执行的 source-independent Profile/RulePack。现有语料仍然适合生成 Rust 首轮提案并由用户逐项校准，但不能凭这批语料启动模型通过/不通过的正式验收。

## Solution

建立一个以 Rust 为唯一动作理解权威的 MVP：所有已有视频进入同一个客户端可运行视觉输入契约，Rust 通过现有 `begin_set → causal observations → finish_set` 生命周期产生不可变 MotionPacket，并以 additive `QLT1` 扩展携带 Rep 端点、轨迹事实、八个质量维度、证据、置信度和弃权理由。TypeScript、Kotlin、Swift 与 Web 页面只解码、展示和导出，不重算第二套 Rep、端点或质量结论。

评估分成三个严格隔离、不能互相替代的证据阶段：

1. **Untouched model-acceptance evaluation**：推理时只提供动作和机位上下文，不提供人工 Rep 时间线。Rust 完成一次因果识别并冻结输出后，才揭示人工 `start/end`。目标视频、同一 source/session 及其全部衍生数据都不得参与该运行所用 Profile/RulePack 的拟合或阈值选择。只有从未参与训练、调参、规则选择或人工结果检查的新来源集合才能开启这一验收。
2. **Touched benchmark diagnostics**：已经参与阈值或策略选择的视频仍可用于回归、消融和错误定位，但产物必须标记 `touched_benchmark`、`acceptanceEligible=false`，不得使用 `blind`、`held-out` 或“泛化准确率”等表述。
3. **Full-data calibration proposal**：允许使用全部现有已标注数据，对 50 个视频、54 个上下文生成 Rust 首轮端点与逐项质量提案，供用户校准。它是人工审核队列，不是模型准确率，也不能满足 model-acceptance gate。

当前 fresh full-data calibration release 使用离线 Python ONNX 参考管线提取的 YOLOX + RTMPose Halpe-26 观测，并明确标记为 client visual acceptance 不合格。Python 不进入最终客户端验收链；Web/Android/iOS 视觉能力必须由各自 ONNX Runtime → Rust SDK 的单次因果产物另行冻结和验证。A 类审核校准 Rust 解释，不能被引用为三端视觉能力。

Rust 对每个 Rep 输出统一的 `start_anchor / primary_turnaround / end_return`。动作契约负责把两段运动命名为向心或离心，因此卧推、侧平举、划船、深蹲等可以共享端点结构，而不会被强行套用同一种阶段顺序。单侧与交替动作按每一侧的完整周期分别计 Rep，保存解剖侧；用户不需要左右交替。

质量理解采用混合结构：版本化数据 Profile 学习轨迹分布、端点走廊和同组波动；确定性的 Rust 规则引擎把可见偏差解释为任务完成、ROM、阶段控制、支撑稳定、左右协调、轨迹控制、标准变式兼容性和观测可信度。产品不输出一个掩盖原因的总分，也不把二维轨迹解释成力量、肌肉激活、力矩或伤病结论。

每个动作上下文声明能力等级：

- `quality_supported`：可输出经该上下文验证的质量结论；
- `phase_supported`：可输出 Rep 与端点提案及通用轨迹事实，但未验证的质量维度必须弃权；
- `observation_only`：只输出骨架、器械和可见运动事实；
- `unsupported`：缺少可执行输入或契约，不能强行产生结论。

所有已有动作立即进入统一管道，但按证据逐步从 observation/phase 晋级到 quality；不等待只做完卧推，也不因追求动作数量而输出未经验证的伪质量标签。

Web 审核页在 Rust 输出已经冻结后显示视频、骨架、动作/器械轨迹、三个端点和每条质量结论。审核以“每条结论”为最小单位，用户选择 `correct`、`incorrect` 或 `cannot_judge`；`corrected_value` 和备注均为可选。未导出的决定按 release ID 与冻结 hash 隔离并自动保存到当前浏览器的 `localStorage`，刷新后恢复；它不是正式审核产物。页面不在后台写入服务器或训练集、不自动更新 Profile，只有用户点击导出才生成带提案哈希和版本 lineage 的可携带审核 JSON。

## Audit Start Gates

本项目有两个不同的“审核开始”，后续文档、页面和票据不得只写“正式审核”而不说明是哪一类：

### A. Human calibration audit

目的：审核 full-data Rust proposals，形成每个 Rep 端点与每条质量结论的纠正数据。它可以在以下条件全部满足后开始：

- 当前代码重新生成一份冻结 full-data release；
- release 覆盖 50 个唯一视频、54 个上下文和既有 464 个人工 start/end 区间，不要求重标；
- 页面加载的 proposal bytes、hash、lineage 与该 release 一致，视频/帧/骨架/器械/时间线同步；
- review document、UI、只读媒体服务和导出 round-trip 测试对该 fresh release 通过；
- 生成数量和测试结果从 fresh artifacts 写回交接文档，而不是沿用旧对话中的数字。
- release 明确记录视觉观测来源；离线 Python 参考观测只能开启 Rust 规则校准，不能满足客户端视觉或端到端验收。

这一审核只回答“Rust 首轮理解哪里对、哪里错、正确值是什么”，不回答模型是否泛化。

### B. Model-acceptance audit

目的：验收训练后客户端可运行链路对陌生来源的 Rep、时间轴、端点与质量理解能力。当前状态为 `data-gated`，直到存在从未参与训练、调参、规则/策略选择或结果检查的新用户或新 source/session 集合。现有 6 条卧推只能作为 touched benchmark；其余缺少 source-independent executable Profile 的上下文必须 fail closed，不得用 full-data proposal 或 unsupported 结果替代盲测通过。

## User Stories

1. As a reviewer, I want all previously annotated personal videos to retain their existing exercise, view, Rep count and Rep start/end labels, so that I do not repeat completed annotation work.
2. As a reviewer, I want the Rust run to be unable to read human Rep time labels before inference finishes, so that the result measures recognition rather than same-video replay.
3. As a reviewer, I want each video to be processed once in chronological order, so that the test represents a live camera stream rather than repeated offline interpretation.
4. As a reviewer, I want the Rust output frozen before truth is revealed, so that scoring cannot alter the prediction being scored.
5. As a reviewer, I want untouched model-acceptance, touched-benchmark and full-data calibration results separated, so that a high replay match cannot be presented as generalization.
6. As a reviewer, I want every detected Rep to show start, primary turnaround and end return, so that I can inspect both segmentation and phase timing.
7. As a reviewer, I want existing human start/end labels overlaid only after the Rust run, so that I can see the exact timing difference without leaking truth into inference.
8. As a reviewer, I want Rust to propose the turnaround before I label it, so that my work is correction and verification rather than manual annotation from scratch.
9. As a reviewer, I want every quality conclusion reviewed independently, so that a correct endpoint and an incorrect bilateral conclusion are not collapsed into one verdict.
10. As a reviewer, I want to mark a conclusion correct, incorrect or unable to judge, so that the exported data preserves both positive and negative supervision.
11. As a reviewer, I want the correct answer to be optional when I mark a conclusion incorrect, so that I can reject a false cue even when I cannot confidently provide the replacement value.
12. As a reviewer, I want to amend an endpoint or structured quality value when I know the answer, so that later calibration has positive correction targets.
13. As a reviewer, I want Rust's original proposal to remain immutable after correction, so that future versions can be compared against the exact original error.
14. As a reviewer, I want one manual Export action to download all review events as JSON, so that I control when and how the data leaves the page.
15. As a reviewer, I do not want review clicks to trigger automatic training or Profile changes, so that one review cannot silently change later predictions.
16. As a reviewer, I want the page to show the evidence and confidence behind each conclusion, so that I can judge why Rust made it.
17. As a reviewer, I want `cannot_judge` to include a concrete reason, so that missing evidence is distinguishable from an algorithm refusal with no explanation.
18. As a reviewer, I want all twelve existing personal exercise classes to enter the same pipeline, so that the MVP is an expandable action-understanding system rather than a bench-only demo.
19. As a reviewer, I want unsupported quality dimensions to abstain while Rep or trajectory facts remain visible, so that partial capability is useful without pretending to be complete.
20. As a reviewer, I want new lower-body videos to receive action/view context separately, so that unlabeled new material does not invalidate the already complete personal annotations.
21. As a user performing unilateral or alternating work, I want each side's complete cycle counted independently, so that the system does not assume left-right alternation.
22. As a user, I want single-Rep observations separated from persistent set-level patterns, so that one noisy Rep does not immediately become a coaching conclusion.
23. As a user, I want persistent bilateral differences described as visible imbalance, so that the system does not claim a side is physiologically stronger or weaker.
24. As a user, I want lateral and oblique views to use view-appropriate observability, so that screen-space slope is not mislabeled as physical imbalance.
25. As a user, I want the system to describe movement task completion, ROM, phase control, support stability, bilateral coordination, trajectory control, standard-variant compatibility and observation confidence separately, so that no opaque standardness score hides the cause.
26. As a developer, I want Rust to be the only producer of Rep boundaries, endpoints, trajectory evidence and quality proposals, so that Web, Android and iOS cannot drift into three algorithms.
27. As a developer, I want QLT1 to be an additive MotionPacket extension, so that existing packet consumers remain compatible while new consumers can read quality proposals.
28. As a developer, I want `finish_set` to return the same sealed result when repeated, so that finalization cannot rerun analysis and change history.
29. As a developer, I want equipment-constrained pose points marked predicted rather than measured, so that one equipment observation cannot be counted twice as independent evidence.
30. As a developer, I want pose-only, equipment-only and fused frozen runs on the same inputs, so that the fusion policy is selected by evidence rather than preference.
31. As a developer, I want each Profile, RulePack, proposal and export to carry versions and content hashes, so that a result can be reproduced later.
32. As a developer, I want client projections to ignore unknown additive QLT1 fields, so that minor schema additions do not require synchronized releases.
33. As a data curator, I want `incorrect + corrected_value=null` preserved, so that false-positive suppression can learn from the review without inventing a replacement truth.
34. As a data curator, I want review exports append-only and linked to proposal hashes, so that corrections never erase the original prediction.
35. As an evaluator, I want score reports per action/view/capability bucket, so that unsupported contexts and weak views cannot be hidden in a blended accuracy number.
36. As an evaluator, I want Rep precision, recall, exact-set match and start/end timing error reported separately from turnaround and quality agreement, so that one metric cannot disguise a failure elsewhere.
37. As an evaluator, I want cannot-judge coverage and false-cue rate reported per quality conclusion, so that high accuracy cannot be achieved by refusing everything or guessing everywhere.
38. As a Realtime Agent developer, I want structured Rust evidence and deterministic neutral text, so that the Agent can explain and prioritize without creating a second visual interpretation.
39. As a Realtime Agent developer, I want unmeasured physiological claims explicitly prohibited in the proposal lineage, so that coaching language stays within visible evidence.
40. As a maintainer, I want new actions added through versioned action contracts, FeaturePrograms and RulePacks wherever existing visual primitives suffice, so that action expansion does not require a new engine for every exercise.

## Implementation Decisions

- The sole public runtime seam remains the existing Motion SDK set lifecycle: configure exact action context, begin a set, submit timestamped causal observations, finish the set, and read one immutable canonical packet lineage.
- A deep Rust `ExecutionAssessmentEngine` owns endpoint extraction, trajectory facts, comparisons, dimension rules, persistent set findings, abstention and deterministic text projections. Hosts do not call individual rules.
- Rust receives the client-runnable visual observation contract produced by YOLOX + RTMPose Halpe-26 and action-specific equipment producers. Python may generate offline comparison artifacts but is not an accepted runtime or final evaluation path.
- Input inference is strictly causal. A frame may depend only on prior state and the current observation. A turnaround stores both the frame/time where reversal occurred and the later frame/time where sufficient causal evidence confirmed it.
- The common endpoint vocabulary is `start_anchor`, `primary_turnaround` and `end_return`; an exact action contract maps the two motion phases to eccentric/concentric semantics and endpoint meaning.
- A unilateral cycle is one Rep. `anatomical_side` is stored independently for every unilateral Rep; pairing opposite sides is optional metadata and never a counting prerequisite.
- The eight proposal dimensions are movement task completion, ROM/endpoint completeness, phase control, support/trunk stability, bilateral coordination, equipment/body trajectory control, standard-variant compatibility and observation confidence.
- Every dimension and concrete finding includes a state, confidence, evidence references, applicable action/view scope, rule version and an abstain reason when unavailable. The runtime may emit `observed_acceptable`, `observed_deviation`, `cannot_judge` or `not_applicable`; it never emits an aggregate standardness score.
- Visible compensation, early reversal, incomplete return, path drift and persistent imbalance are concrete findings under the eight dimensions, not extra top-level scores.
- A standard reference, personal trajectory corridor and current-set trend are separate comparison sources. The MVP may emit facts and current-set comparisons without a validated standard reference, but standard-variant compatibility must abstain when its exact-context reference is absent.
- Load, RPE/RIR and automatic PersonalEndpointProfile construction are not required for this MVP. Review exports may support later calibration, but clicking a review option does not update any Profile.
- Equipment is part of action interpretation where the selected action declares it. Barbell is represented as a rigid axis with ordered endpoints; future dumbbell support uses independent side-associated tracks. Equipment evidence supports phase and external-load path, while pose evidence describes joint and body strategy.
- Fusion is not hard-coded as pose-first, equipment-first or a simple average. A frozen experiment compares pose-only, equipment-only and candidate fused policies on the same inputs and records the evidence class. A touched benchmark may guide calibration diagnostics but cannot establish a model-acceptance winner; any accepted policy and its evidence lineage are versioned per exact action context.
- Equipment-constrained landmark continuation remains `predicted`, never `measured`, and cannot be reused as independent corroboration for the equipment observation that created it.
- View geometry is visual-only. The MVP assumes the user-selected action and view are correct; it does not implement view mismatch detection. Rules use the selected view's observability matrix and may abstain when the needed geometry is not visible.
- Existing annotated action, view, expected count and Rep start/end data are imported without re-review. Historical peak candidates are not treated as human turnaround truth; Rust proposes turnaround and the reviewer evaluates it in this MVP.
- The proposal is serialized as an additive length-prefixed `QLT1` payload in MotionPacket. Quality objects are schema-validated, versioned and content-hashed. Existing frame, landmark, joint-angle and equipment extensions retain their semantics.
- TypeScript, Kotlin and Swift decode and project QLT1 but do not recalculate a quality conclusion, endpoint or Rep boundary. Unknown additive fields are ignored according to minor-version compatibility rules.
- A review decision is scoped to one proposal conclusion or endpoint and stores `correct`, `incorrect` or `cannot_judge`. `corrected_value` and note are optional. `incorrect` with no corrected value remains valid negative supervision.
- The review surface automatically persists an unexported draft only in browser `localStorage`, scoped by release ID and frozen hash; it does not write to the server or train. The user must still explicitly export the versioned JSON artifact containing original proposal hashes, per-conclusion decisions, optional corrections and export metadata.
- Untouched model-acceptance, touched-benchmark diagnostic and full-data calibration artifacts use distinct run kinds, directories/identities and report headings. Neither a touched result nor a full-data result can satisfy a blind acceptance criterion.
- Capability level is part of each exact action context. Unsupported quality claims count as abstentions or unsupported scope; they are never silently dropped from score denominators.
- New lower-body videos are outside the already-complete personal annotation set and require their own action/view and Rep truth before they can contribute to accuracy metrics.
- No production promotion, runtime Profile mutation or client integration is authorized by this specification. Exported reviews become inputs to a later explicit calibration/versioning workflow.

## Testing Decisions

- The highest end-to-end seam is one set replay through the real Motion SDK lifecycle: install a frozen context bundle, begin the set, submit chronologically ordered client-format visual observations exactly once, finish the set, decode the final MotionPacket/QLT1, then reveal truth and score. Tests assert external packet behavior rather than private engine functions.
- Existing MotionPacket decoder, native ABI, WASM packet, set lifecycle, equipment contract and cross-runtime parity tests are extended instead of creating parallel test harnesses.
- Contract tests verify additive QLT1 compatibility: new decoders read legacy packets, legacy-compatible readers safely skip the length-prefixed extension, unknown minor fields do not change existing Rep/equipment semantics, malformed or oversized quality payloads are rejected deterministically.
- Lifecycle tests verify that `finish_set` is idempotent, emits the same sealed proposal/hash on repetition, and never analyzes a set twice.
- Causality tests mutate or remove future frames and assert that earlier emitted state is unchanged. They also verify `occurred_at` and `confirmed_at` remain distinct and confirmation never precedes occurrence.
- Truth-leakage tests inspect the generated inference pack and fail if human Rep timestamps, historical peaks, review decisions or same-source derived templates are present before the frozen prediction artifact exists.
- Blind scoring tests group all derivatives of one source video together and exclude the target source from any fitted Profile/RulePack. Reports label participant, source, session and run-kind limitations explicitly.
- A run becomes `touched_benchmark` if any evaluated source influenced training, threshold selection, policy selection or result-driven parameter changes. Tests must reject `acceptanceEligible=true` for such a run.
- Rep tests report precision, recall, exact-set rate and start/end timing error. Turnaround tests use only newly reviewed turnaround truth and report error at declared tolerances; historical midpoint/unknown-source peaks cannot satisfy the gate.
- Quality tests score each concrete conclusion separately, including precision, recall where corrected truth exists, reviewer agreement, false findings on clean Reps, `cannot_judge` coverage and invalid-confidence calibration. A single blended quality accuracy is forbidden.
- Capability tests verify that observation-only and phase-supported contexts still expose useful facts while unsupported quality dimensions contain explicit abstain reasons.
- View-aware tests verify that lateral view does not claim bilateral bar balance and that oblique view does not reinterpret raw endpoint pixel slope as physical height without validated geometry.
- Evidence-lineage tests verify that equipment-constrained landmarks remain predicted and are not counted as an independent pose channel in fused confidence.
- Frozen ablation tests run pose-only, equipment-only and fused candidates against identical causal input and truth, then select a policy only through a declared claim-specific gate. The test must allow “no fusion candidate passes.”
- Review UI tests verify per-conclusion decisions, optional corrected values, frozen original proposal display and a single manual JSON export. They fail if a click triggers background persistence, Profile mutation or automatic training.
- Export round-trip tests validate schema/version/hash lineage and preserve `incorrect + null correction` without converting it into unknown or dropping it.
- Cross-runtime golden tests assert that Web/WASM and native builds produce equivalent structured quality semantics for identical observation streams. Platform renderers may differ visually but not in proposal values or reasons.
- Performance is measured on the causal stream with bounded latest-frame scheduling, but this MVP does not set a new user-facing mobile performance claim. Reports must expose processed FPS, dropped/backlogged observations and analysis latency so later client acceptance can set the gate.
- Existing 50-video annotations are treated as already completed truth for action, view, count and start/end. One known expected-count versus interval-count mismatch remains explicit and cannot be silently repaired by evaluation code.
- Tests use the repository's established immutable proposal/review-event, packet golden, recognition replay and manual export patterns as prior art.

## Out of Scope

- Asking the user to re-annotate existing personal-video action, view, Rep count or Rep start/end data.
- Automatic action classification or automatic camera-view validation; the MVP trusts the selected action and view.
- IMU, gravity sensor or phone-attitude input. Camera roll/view geometry uses visual evidence only when a rule needs it.
- Load-aware analysis, weight bands, RPE/RIR, subjective effort inference or automatic personal baseline construction.
- Automatic saving of review clicks, automatic training, online learning, automatic Profile mutation or production promotion.
- Full Android/iOS product UI integration. The shared Rust contract and cross-runtime parity are included; client product integration is a later feature.
- Python vision inference in the accepted runtime or final recognition chain.
- Direct claims about strength, force, joint torque, muscle activation, injury risk, pain cause or measured stimulus.
- A universal standardness score or one blended “AI recognition accuracy.”
- Enabling unvalidated quality claims for every action merely because the action can be counted.
- Treating MM-Fit group counts, historical unreviewed peak candidates, simulated priors or same-video replay as quality truth.
- Replacing the exercise-specific fusion experiment with an untested universal pose/equipment priority.
- New lower-body truth annotation beyond providing a separate queue for later work.
- Realtime Agent phrasing experiments, screenshot-vs-trajectory Agent comparison, live cue cooldown and dynamic planning integration. This MVP produces the structured evidence those later features consume.

## Further Notes

- Current inventory contains 50 unique personal videos represented by 54 exact-context records, 12 exercise classes, 464 complete Rep intervals and an expected total of 465. The context split records are intentional timeline splits, not missing annotation.
- All 54 records already contain exercise, capture position and expected count. All 464 intervals contain start, peak and end in valid order. Historical governance excludes peak as formal phase truth because the old UI did not preserve whether it came from an algorithm, midpoint or human adjustment; 193 peaks are exact interval midpoints.
- Current Rust implementation produces canonical set/Rep state, three endpoint snapshots, joint-angle and equipment evidence, plus QLT1 quality proposals. Fresh release `personal-motion-quality-review-v1` (`sha256:f3ad0153ceab61bcfa4d245e0269d38bf9c2e8e0da22cdcbfa4174bc4f12aaf2`) passed the Audit A launch gates and is open for human calibration. This implementation and review readiness are not accuracy evidence. The accepted Web harness now projects Rust QLT1 directly; legacy TypeScript five-layer reporting is outside the accepted chain and must not become a second authority.
- Current touched-benchmark diagnostics support bench phase calibration most strongly; they do not establish cross-user quality accuracy. Other actions range from phase-capable initializers to observation-only. Capability labels must describe actual verified behavior, not design intent.
- The six current bench videos are a touched benchmark because they influenced threshold tuning. Most other exact contexts cannot yet run a source-independent executable Profile after source exclusion. These are evidence constraints, not missing user annotations.
- The review export is training material only after a later process imports, validates and versions it. The exported file itself never changes the running SDK.
- This specification intentionally stops product expansion. Its immediate purpose is to produce one trustworthy full-data Rust calibration proposal and one human-exported correction artifact across the existing action inventory. A model-acceptance score is a later deliverable that begins only after untouched/new-source evidence exists.
