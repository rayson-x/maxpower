Status: ready-for-agent

# Rust 每组自标定局部动作坐标与视角归一化轨迹

## Problem Statement

用户在真实健身房里只能预设“正面、左前斜方、右前斜方”等粗机位，无法可靠知道相机相对人体、卧推凳或器械的精确角度。正斜方拍摄时，现实中正常运动的杠铃和人体轨迹在屏幕中天然可能倾斜，左右端点也会因透视深度不同产生像素高度差。当前部分识别与报告仍直接消费屏幕 `x/y`、杠铃中心 `y` 或被压平的器械框，因此同一动作换一个斜视角后会改变信号语义；页面还可能把真实斜杠轴画成水平线，造成“识别正确但证据展示错误”或“屏幕不水平就被误判为动作不平衡”。

MaxPower 当前能够从客户端可运行的 YOLOX + RTMPose Halpe-26 流得到二维人体骨架，并在 Rust 内跟踪带有两个端点的杠铃轴，也已经能够在现有卧推语料上识别 Rep 和主要反向点。但它仍属于 view-aware 2D，不具备从任意单目视频恢复真实三维动作或无损生成虚拟正面的能力。现有左前/右前斜方卧推证据也来自单一用户和已经参与过调参、审核的数据，只能证明当前 touched benchmark 可工作，不能证明陌生用户、陌生场地或任意角度的泛化。

用户需要 Rust 在不知道精确拍摄角度、只知道预设动作和粗机位的情况下，按每一组的真实可见运动自标定一套局部动作坐标。Recognition Profile、Rep/阶段识别和后续动作质量规则应消费这个坐标中的规范轨迹，而不是把屏幕水平/垂直当作动作水平/垂直。器械与骨架必须共同参与理解离心、向心、端点和稳定性，但不得把一个通道伪造成另一个独立真值，也不得为了得到结论而制造缺失点或掩盖证据冲突。

## Solution

在 Rust Motion SDK 中新增一个深模块，负责每组自标定的 `LocalMotionCoordinate`。客户端仍按时间顺序提交一次实时视觉观测；模块依据已选动作、变式、器械和粗机位，结合准备阶段的杠铃轴/人体几何以及本组开始后的真实运动方向，建立并冻结二维局部动作轴、横向轴、原点和稳定尺度。它不要求精确相机角度，也不声称恢复世界重力或真实三维空间。

原始 Halpe-26 点、原始杠铃端点、置信度和来源全部保留。局部坐标层在其上追加器械进度、骨架进度、横向漂移、左右端点相对各自基线的进度、杠轴相对准备位的动态角度、通道一致性、可观测性和弃权理由。器械和骨架先独立归一化、独立形成证据，再根据动作契约和各自不确定性做晚期融合；低置信腕点可以由器械约束形成明确标记的预测证据，但该预测不能再次被当作独立骨架证据参与融合。

Recognition Profile 新增对命名规范特征的引用能力。卧推等杠铃推举优先使用杠铃中心沿动作轴的进度识别离心/向心和反向点，并使用独立肩肘腕轨迹验证人体策略；没有可靠器械时可以使用声明支持的骨架特征，两个通道冲突时按具体结论输出冲突或 `cannot_judge`，而不是强行平均。每个 sealed Rep 封存三个端点及其完整规范特征快照，供既有训练执行评估规则和人工审核消费。

首个可验收范围是杠铃卧推的 `front`、`front_oblique_left` 和 `front_oblique_right`。现有精确 45 度名称只作为兼容别名，不再暗示相机真的处于 45 度。功能先以 shadow 模式与当前 `center_y` 路径并行运行，不改变正式计数；通过冻结测试后，Profile 才切换为规范轨迹。Web、Android 和 iOS 都通过同一 Rust 生命周期与 CanonicalMotionOutput 获得相同语义，平台层不实现第二套坐标、Rep、端点或质量判断。

## User Stories

1. As a trainee, I want to select only the exercise, variation, equipment and a coarse camera view, so that I do not need to measure an exact camera angle before every set.
2. As a trainee, I want a front-oblique recording to be understood even when the barbell is visibly slanted on screen, so that normal perspective is not treated as a technique error.
3. As a trainee, I want the detected barbell to be drawn using its measured endpoints, so that the overlay matches the actual shaft instead of forcing a horizontal line.
4. As a trainee, I want Rep and phase recognition to follow motion relative to the exercise rather than screen vertical, so that a tilted phone or oblique view does not redefine the movement.
5. As a trainee, I want the system to preserve useful recognition when the exact view angle differs between sets, so that realistic camera placement remains usable.
6. As a trainee, I want left-front and right-front oblique views to share one rule family while retaining their handedness, so that mirrored geometry does not swap anatomical sides.
7. As a trainee, I want each set to calibrate from its own preparation and early movement evidence, so that another session's crop or camera placement is not silently reused.
8. As a trainee, I want the coordinate frame to remain fixed after calibration, so that fatigue-related path drift is not absorbed and hidden by continuous recalibration.
9. As a trainee, I want the first Rep marked provisional when calibration evidence is not ready, so that an uncertain estimate is not presented as fully measured.
10. As a trainee, I want camera movement or a subject switch to degrade or reset the coordinate frame explicitly, so that stale calibration cannot corrupt later Reps.
11. As a trainee, I want a new set to start a fresh calibration lifecycle, so that movement from the previous set cannot leak into the next one.
12. As a trainee, I want barbell and skeleton evidence both used for concentric and eccentric understanding, so that low-confidence wrist points do not make the system ignore a clear equipment path.
13. As a trainee, I want equipment evidence and pose evidence kept distinguishable, so that I can understand which observation supported each phase and endpoint.
14. As a trainee, I want disagreements between equipment and pose exposed, so that the product does not manufacture a confident answer from conflicting observations.
15. As a trainee, I want low-confidence or occluded landmarks to remain unknown unless a prediction is explicitly labelled, so that a plausible-looking skeleton is not mistaken for a measurement.
16. As a trainee, I want an equipment-derived wrist estimate excluded from independent pose corroboration, so that the same observation is not counted twice.
17. As a trainee, I want each Rep to preserve start, primary turnaround and end-return snapshots, so that I can review the exact evidence at every endpoint.
18. As a trainee, I want the report to distinguish `occurred_at` from `confirmed_at`, so that causal confirmation delay is not confused with the actual phase time.
19. As a trainee, I want per-Rep range compared with a stable set scale, so that a shortened late Rep remains visible instead of being normalized back to a full range.
20. As a trainee, I want left and right bar endpoints compared with their own preparation baselines, so that static perspective slope is not mistaken for dynamic imbalance.
21. As a trainee, I want repeated endpoint timing differences and path drift available as structured evidence, so that later rules can evaluate persistent rather than single-frame deviations.
22. As a trainee, I want an explicit `cannot_judge` result when the requested dimension is not observable from the selected view, so that missing evidence does not become a negative judgement.
23. As a trainee, I want the product to call an oblique-view difference a projected difference, so that it does not claim true three-dimensional height or strength.
24. As a trainee, I want lateral views to suppress unsupported barbell left/right balance claims, so that overlapping endpoints are not overinterpreted.
25. As a reviewer, I want to toggle raw observations and view-normalized evidence independently, so that I can verify the transformation without losing the source image.
26. As a reviewer, I want the page to label raw bar angle, baseline-corrected angle and normalized endpoint residual separately, so that different geometric meanings are not collapsed.
27. As a reviewer, I want every coordinate frame to expose its state, confidence, scale source and failure reason, so that I can tell whether a result was measured, provisional, frozen or degraded.
28. As a reviewer, I want the selected action context and coarse view shown with every result, so that a Profile cannot silently run under the wrong semantics.
29. As a reviewer, I want the same video replayed once in chronological order, so that review represents realtime causal behavior rather than repeated offline fitting.
30. As a reviewer, I want predictions frozen before human labels are revealed, so that phase accuracy is not inflated by same-video truth replay.
31. As a reviewer, I want front and synchronized oblique recordings compared by Rep identity and timestamp, so that oblique-view accuracy can be measured against independent evidence.
32. As a reviewer, I want all rejected or abstained observations retained in denominators and reports, so that difficult mirror and occlusion cases cannot disappear from accuracy claims.
33. As a reviewer, I want results bucketed by front, left-front oblique, right-front oblique, mirror, occlusion and confidence, so that the worst view is visible.
34. As a reviewer, I want current touched-benchmark evidence labelled as such, so that it cannot be presented as unseen-user generalization.
35. As a reviewer, I want the existing personal annotations reused for Rep start/end scoring without being exposed during inference, so that completed annotation work remains useful.
36. As an algorithm maintainer, I want one Rust module to own local coordinate estimation, so that Web, Android and iOS cannot drift into different geometry implementations.
37. As an algorithm maintainer, I want the module to consume full ordered bar-axis geometry rather than an axis-aligned bounding box, so that oblique shaft information is not discarded.
38. As an algorithm maintainer, I want the module to consume raw pose source, confidence and unknown semantics, so that predicted and measured landmarks remain distinguishable.
39. As an algorithm maintainer, I want action-specific priors to initialize but not dictate the observed motion axis, so that one bar-normal assumption is not copied to squats, deadlifts and rows.
40. As an algorithm maintainer, I want scale frozen at set level from robust visible geometry, so that per-Rep normalization does not erase range-of-motion decay.
41. As an algorithm maintainer, I want Recognition Profiles to reference named normalized features, so that actions can expand through data and contracts instead of hardcoded screen-coordinate rules.
42. As an algorithm maintainer, I want unsupported action/equipment/view combinations to fail closed, so that an available detector does not imply an available quality interpretation.
43. As an algorithm maintainer, I want barbell, dual-dumbbell and body-only movement represented by separate equipment adapters, so that a rigid shaft is not confused with two independent objects.
44. As an algorithm maintainer, I want barbell shoulder press to activate equipment understanding from its exact action contract, so that equipment is not omitted because of an action-name special case.
45. As an algorithm maintainer, I want legacy exact-45 view identifiers accepted as aliases for coarse oblique buckets, so that existing annotations remain readable without promising false precision.
46. As an algorithm maintainer, I want the coordinate frame identity and version included in the canonical lineage, so that a rerun can be reproduced and compared without overwriting history.
47. As a client developer, I want a single additive CanonicalMotionOutput contract for raw and normalized evidence, so that renderers only project Rust-owned semantics.
48. As a client developer, I want bounded latest-frame processing and explicit set lifecycle commands preserved, so that coordinate calibration is compatible with realtime camera streams.
49. As a client developer, I want equivalent outputs from Web/WASM and native Rust builds for identical observation streams, so that validation on Web predicts mobile algorithm behavior.
50. As a Coach Agent, I want structured normalized trajectory facts, endpoint snapshots, confidence and abstention reasons, so that I can explain observed movement without inventing biomechanics.
51. As a Coach Agent, I want the original raw evidence linked to every interpreted fact, so that a coaching suggestion remains auditable.
52. As a product owner, I want current Rep and turnaround performance to remain non-inferior during migration, so that geometric normalization does not break already working recognition.
53. As a product owner, I want empirical promotion to require a frozen cross-view evaluation, so that a visually plausible coordinate layer is not declared accurate without evidence.
54. As a product owner, I want quality capability promoted one exact action context at a time, so that architectural reuse does not become an unsupported universal accuracy claim.

## Implementation Decisions

- The feature is a view-normalized 2D capability, not true 3D reconstruction, world-gravity estimation or virtual-front synthesis. Public names, schemas and reports must use projection-aware terms and must not use `world_height`, `force`, `strength` or equivalent physical claims for these outputs.
- The highest production Seam remains the Rust set lifecycle: install one exact training intent/action context, begin the set, ingest chronologically ordered client-format observations once, and finish the set to produce immutable CanonicalMotionOutput. The new coordinate estimator is internal to this Rust boundary; clients do not call a parallel geometry service.
- Rust gains one deep `LocalMotionCoordinate` module. Its public responsibility is to accept lifecycle events and canonical pose/equipment observations and return a versioned coordinate-frame status plus normalized facts. Axis fitting, robust statistics, confidence propagation and reset rules remain hidden implementation details.
- The coordinate lifecycle is `uninitialized → provisional → learning → frozen`, with `degraded` and reset transitions. Preparation supplies initial geometry; early causal movement supplies enough displacement to disambiguate the motion direction. A frame never uses future observations. The module records why it cannot freeze or why a frozen frame degraded.
- Calibration is per training set. Subject change, explicit camera/crop/orientation change, long observation gap or material geometry discontinuity invalidates the frame. The implementation must not silently recalibrate mid-set in a way that absorbs actual trajectory drift. A new set starts clean.
- The action context supplies exercise identity, variation, equipment, side, coarse view, feed mirroring and anatomical-side mapping. `front_oblique_left` and `front_oblique_right` are coarse buckets; legacy `frontLeft45` and `frontRight45` resolve to them as compatibility aliases. Exact yaw, pitch or roll is optional diagnostic evidence, never a required input.
- The canonical input preserves all raw Halpe-26 landmarks, source, confidence, visibility/unknown state and timestamp. Missing landmarks remain unknown. Equipment-constrained or temporally predicted landmarks retain predicted provenance and prediction age.
- The canonical equipment input preserves the associated rigid bar shaft as ordered `x1/y1/x2/y2`, center, projected length, image angle, confidence, uncertainty, measured/predicted state, track identity and subject-association evidence. Conversion to a generic axis-aligned box must not remove this geometry.
- Bar endpoint order is stable over time and maps to anatomical sides only through the selected view, mirroring state and subject association. Screen-left and screen-right are never assumed to be anatomical left and right.
- The local frame contains a primary motion axis and an orthogonal cross-motion axis in the image plane. Its orientation sign is made deterministic by the action's expected preparation-to-effort direction and observed first excursion. Raw image coordinates remain available beside every projected value.
- For barbell bench and barbell press, the normal to the robust preparation bar axis is a strong initialization prior, not the final truth. The estimator combines that prior with the causally observed bar-center path and an independent pose path. Other actions provide their own action-specific path priors; the implementation must not assume that every exercise moves normal to a bar axis.
- The scale is robustly estimated from stable set-level geometry appropriate to the context, such as measured projected bar length, shoulder width or torso length. The selected scale source, sample coverage and stability are emitted. Once valid, scale is frozen for the set. Per-Rep min/max normalization to `[0,1]` is forbidden because it would erase shortened range and set drift.
- Each Rep may use its own local origin for relative endpoint displacement, but all Reps in a set use the same frozen axes and scale. Ready/preparation baselines use multiple reliable observations and robust statistics rather than the first frame.
- The module emits at least: coordinate-frame ID/version/state; primary and cross axes; scale and scale source; equipment progress and cross-path; independent pose progress and cross-path; ordered endpoint progress relative to each endpoint's own baseline; raw bar image angle; baseline-corrected dynamic angle; channel coverage; channel agreement/conflict; confidence/uncertainty; observability; provenance; and machine-readable abstention/degrade reasons.
- Equipment and pose are separate measurement channels until claim-specific fusion. They are not averaged into one trajectory before reliability is evaluated. Fusion uses action-contract applicability, temporal agreement and propagated uncertainty. A high-quality equipment phase may confirm a phase while pose quality remains unknown; a high-quality pose path may preserve a body-strategy observation while equipment is lost.
- Equipment-derived wrist repair may support rendering or a dependent kinematic estimate, but it remains `predicted` and cannot count as independent pose agreement with the same equipment observation. The packet exposes this exclusion in provenance.
- Recognition Profiles gain named normalized signal references for along-axis progress, cross-axis displacement, endpoint-relative progress, dynamic bar angle, channel agreement and context observability. Existing raw landmark signal kinds remain available for exact contexts that have not migrated.
- Profile resolution is based on the exact action × variation × equipment × coarse-view context. Whether equipment understanding is active comes from that contract. A seated shoulder press declared as barbell must receive the barbell adapter; a dumbbell variation receives two independent tracks; a body-only variation does not invent equipment evidence.
- The Rep engine consumes normalized signals only after a Profile explicitly opts in. Shadow mode computes and records local-coordinate evidence while preserving current Rep/phase behavior byte-for-byte. Promotion is a new versioned Profile/analysis release; historical packets and results remain immutable.
- The Rep engine and trajectory layer keep `occurred_at` and `confirmed_at` distinct. A turnaround can be confirmed after sufficient causal evidence without moving its occurrence timestamp to the later confirmation frame.
- Every sealed Rep includes the complete normalized feature snapshots at `start_anchor`, `primary_turnaround` and `end_return`, plus a bounded phase trajectory summary. These facts are inputs to existing training execution assessment dimensions; this feature does not introduce a composite “standardness” score.
- The client renderer can independently display raw skeleton, raw equipment shaft and normalized trajectory. The raw shaft is always drawn through measured ordered endpoints. A normalized overlay must be visually labelled and must not replace or alter the source observation.
- Web, Android and iOS use the same Rust data model and state machine. Platform code may run supported YOLOX/RTMPose backends and adapt camera frames, but it may not recalculate axes, normalize trajectories, repair landmarks, segment Reps or reinterpret sides.
- The initial production candidate is barbell bench press for front and both front-oblique buckets. Seated barbell shoulder press is the next contract-correction and expansion candidate. Squat, deadlift and row may reuse the module only after separate action priors and frozen tests. Dual dumbbells require two-track identity and are not implied by the barbell adapter.
- The feature fails closed by dimension. If the frame cannot establish a stable coordinate, endpoints are occluded, the subject/equipment association is ambiguous or a lateral view hides bilateral evidence, dependent outputs carry `cannot_judge` with reasons while unaffected Rep or phase facts may remain available.
- The current six personal bench videos and any data previously used to choose thresholds remain `touched_benchmark`. They may support regression and shadow comparison but cannot satisfy unseen-user model acceptance. Accuracy reports identify user, source, session, view bucket, mirror/occlusion bucket, run kind and excluded evidence.

## Testing Decisions

- A good test asserts externally visible Rust behavior: given an installed exact context and one chronological observation stream, inspect CanonicalMotionOutput, sealed Rep endpoints, normalized facts, provenance, confidence and abstention. It does not assert private filters, covariance matrices, thresholds or internal state fields beyond the public coordinate-frame status.
- The primary test Seam is the complete Rust set lifecycle used by clients. Deterministic unit tests for the coordinate module are allowed only for mathematical invariants and lifecycle edge cases that cannot be isolated through the full stream without obscuring the failure.
- Prior art is the existing Rust Rep engine replay, equipment fusion/visual-axis fixtures, MotionPacket contract and decoder goldens, Web/WASM single-pass replay, set lifecycle tests and cross-runtime bridge parity tests. These are extended rather than replaced with a Python interpretation path.
- A synthetic invariance suite applies translation, in-plane rotation, uniform scaling and their combinations to the same canonical pose/equipment stream. Discrete Rep/phase/endpoint outcomes must remain identical; normalized along-axis and cross-axis values must remain equal within the contract's declared floating-point tolerance; raw image coordinates must retain the transform.
- Synthetic tests also rotate and scale only the rendering viewport after canonical observations are produced and verify that canonical normalized semantics do not change.
- Causality tests truncate or modify future frames and verify all earlier emitted coordinate and phase states remain unchanged. A turnaround's confirmation can move later when future evidence is removed, but its already-emitted occurrence time cannot be rewritten using unseen future data.
- Lifecycle tests cover insufficient preparation, first-Rep provisional calibration, successful freeze, pause/resume, camera/crop/orientation change, subject switch, long gap, equipment loss, pose loss, conflict, finish-set idempotence and new-set reset.
- Provenance tests verify that measured bar evidence, measured pose evidence, predicted equipment state and equipment-derived wrist repair remain distinguishable. The same equipment observation must not increase confidence twice through a repaired wrist.
- Geometry tests preserve and round-trip ordered oblique bar endpoints. A front-oblique shaft must render with its measured slope; no adapter or report may replace it with a horizontal axis-aligned box.
- Profile contract tests verify normalized signal references resolve only for supported exact contexts, compatibility aliases preserve handedness, barbell shoulder press activates a barbell adapter, and unsupported equipment/view combinations fail closed.
- Shadow-mode tests run existing and normalized paths on identical frozen streams and assert that enabling shadow computation changes no current canonical Rep, endpoint or quality output. Shadow evidence is additive and versioned.
- Promotion tests use one frozen, preregistered candidate and compare it with the current screen-coordinate baseline on identical data. Rep precision, recall, exact-set rate and start/turnaround/end alignment must not regress in aggregate or in either oblique bucket. Every abstention and rejected candidate remains in the report denominator.
- The product acceptance target for an eligible untouched set is at least 95% Rep precision, at least 95% Rep recall and at least 95% full `start + turnaround + end` alignment at the declared 250 ms tolerance. No touched benchmark, same-video template or source-derived Profile may satisfy this gate.
- A synchronized cross-view fixture records the same set from front and at least one arbitrary front-oblique camera. The candidate sees only the oblique stream; synchronized front evidence and human endpoint review are withheld until output freezes. Tests pair the same physical Reps and report turnaround timing error, normalized ROM disagreement, cross-path disagreement, coverage and abstention.
- View normalization may be promoted only if it strictly reduces preregistered cross-view trajectory disagreement relative to raw screen-`y` in both aggregate and worst oblique bucket while preserving the Rep/phase gate. If it does not, the feature remains shadow-only; the threshold is not tuned after truth reveal.
- Mirrored-gym, bar occlusion, wrist/forearm occlusion, competing person/reflection, camera roll, left-front oblique and right-front oblique are mandatory buckets. Reports publish the worst bucket and do not average it away.
- Clean-set tests measure false projected-asymmetry or path-drift observations. Because this spec does not validate new coaching conclusions, these facts remain descriptive and cannot be promoted to a coach inference until their separate reviewed rule gate passes.
- Cross-runtime goldens feed identical client-format observations into Web/WASM and native Rust builds used by Android/iOS. Discrete semantics, timestamps, provenance and reason codes must match exactly; normalized floats must match within one declared serialization tolerance.
- Performance tests use bounded latest-frame scheduling and report processed FPS, dropped frames, maximum backlog, coordinate freeze time, per-frame Rust cost and end-to-end confirmation latency. Performance failure cannot be hidden by repeatedly replaying or resampling a video.
- Regression reports explicitly separate `touched_benchmark`, `untouched_model_acceptance` and `synchronized_cross_view_validation`. A run fails schema validation if it claims acceptance while any evaluated source influenced fitting, threshold selection, Profile choice or manual result inspection.

## Out of Scope

- Recovering true world-space 3D pose, real gravity direction, metric height, camera extrinsics or exact camera angle from a single ordinary video.
- Generating a virtual front-view skeleton or claiming what a real synchronized front camera would measure.
- Using IMU, accelerometer, gyroscope or requiring the phone to be attached to the user.
- Treating a raw or corrected 2D endpoint difference as measured strength, force, joint torque, muscle activation, injury risk or true three-dimensional bar height.
- A universal action-quality score or automatic conclusion that one side is stronger.
- Automatically classifying the exercise or camera view. The training intent/action context is selected before the set.
- Automatically turning personal workout footage into a standard-form reference or mutating a Profile from user review.
- Full support for dual dumbbells, cables, machines, bodyweight actions or every existing action in the first promotion. Their adapters and exact-context validation are separate expansions.
- A learned monocular 3D model, action-plane homography, PnP calibration or multi-camera triangulation. These remain later experiments if view-normalized 2D cannot meet the product gate.
- Replacing the existing training execution assessment contract, adding a composite score or allowing an LLM to create a second trajectory/Rep truth.
- Python vision or Python trajectory interpretation in the accepted runtime. Python may remain an explicitly labelled offline diagnostic only.

## Further Notes

- The key product distinction is between raw image evidence, view-normalized 2D evidence and estimated 3D. This specification implements only the first two and requires both to remain visible and auditable.
- Existing code already demonstrates that Rust can retain a full oblique bar axis and use a causal equipment trajectory. The main data-loss risk is in adapters that reduce this geometry to `center_y` or a horizontal bounding box before Profiles and quality rules consume it.
- Existing personal front-oblique bench evidence is suitable for regression: three oblique videos contain 30 reviewed Reps with all 30 Rep/turnaround matches and 29 full endpoint matches in the current touched evaluation. It is not unseen-user evidence and must not be quoted as generalization accuracy.
- A prior feasibility review with ACPX Claude agreed that the local coordinate layer is technically feasible and is a better MVP than premature monocular 3D. The review also identified the same required safeguards: preserve full bar geometry, freeze set scale, keep equipment and pose independent before fusion, reject double-counted repaired wrists, and validate in shadow mode before Profile migration.
- The highest-risk unknown is empirical rather than architectural: whether a causal per-set coordinate learned from arbitrary front-oblique input reduces cross-view trajectory error enough under mirrors, occlusion and fatigue. The synchronized cross-view experiment is the minimal test of that claim.
- This specification deliberately does not require a precise “45°” camera measurement. The coarse view bucket supplies observability and handedness; the movement itself supplies the local action axis.
