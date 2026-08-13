# Mobile offline home-workout recognition technical validation

Status: implemented-non-ios; physical validation unmeasured

Delivery scope update (2026-08-05): the user accepted deferring the full iOS client build. This delivery completes the shared Rust SDK/ABI, Web/WASM, Android offline adapter, validation harness, and Apple Rust library build path. The iOS client adapter is not an acceptance condition for this delivery.

## Problem Statement

MaxPower 已经能够在 PC Web 上采集骨架、生成 Rust canonical packet、录制和回放，但还不能证明普通用户在手机前完成居家低冲击动作时，系统能持续、离线并实时地识别当前指定动作、统计单侧完整次数并记录有效持续时间。

当前 Android 端已有原生 MediaPipe 骨架采集，却仍使用独立的 TypeScript 计数器；iOS 端尚未实现骨架采集；Web 端则使用 Rust/WASM canonical recognition。三个平台因此没有共享同一套动作 profile、rep boundary 和 canonical packet 语义。只在单端增加规则会造成计数口径漂移，也无法说明移动端离线性能是否成立。

本次工作只回答技术问题：在规定的设备、正面机位和站立空间下，四个低冲击居家动作能否由轻量骨架链路可靠识别，并在 Web、Android、iOS 三端保持相同的 Rust 识别行为。它不验证完整课程体验、AI 教练或动作纠正。

## Solution

在现有 Rust motion SDK 内扩展一个可移植的、确定性的交替动作识别能力，为以下四个精确动作上下文提供独立的 provisional recognition profile：原地踏步、侧步并步、慢速交替提膝和低冲击开合。

Web、Android、iOS 都将相机骨架观察送入同一 Rust canonical recognition 合约，并消费同一种 canonical packet、set lifecycle、rep disposition、profile identity 和 rep boundary。平台层只负责相机、MediaPipe 轻量模型、时间戳以及 packet 传输，不在 TypeScript、Kotlin 或 Swift 中重新计算次数。

技术验证在设备本地离线运行。已知动作由测试人员预先选择，不做自由动作分类。系统在全身可靠入镜时实时统计单侧完整动作、开始/停止和有效持续时间；关键部位出框或观测不足时保持 unknown/paused，不猜测、不补造关键点。

第一阶段使用可审计的确定性状态机。仅预留以 canonical landmark 时序窗口为输入的轻量 TCN/1D CNN 接口；本规格不训练或部署学习模型。

## User Stories

1. As a technical evaluator, I want to select one exact home-workout action before capture, so that the system validates recognition rather than automatic action classification.
2. As a technical evaluator, I want to run the validation without a network connection, so that mobile offline feasibility is established.
3. As a participant, I want the app to use a lightweight pose model, so that a normal mobile device can sustain the session.
4. As a participant, I want to perform march in place facing the camera, so that each knee or foot lift and return can be counted.
5. As a participant, I want to perform side step-touch facing the camera, so that each complete step to one side and return can be counted.
6. As a participant, I want to perform slow alternating knee raises facing the camera, so that each knee raise and return can be counted.
7. As a participant, I want to perform low-impact step jacks facing the camera, so that each single-side step-and-arm cycle can be counted.
8. As a participant, I want left and right complete cycles counted independently, so that alternating actions use one consistent rep definition.
9. As a participant, I want the system to wait for a stable observable setup before counting, so that entering the frame is not counted as exercise.
10. As a participant, I want the system to stop advancing recognition when required body parts leave the frame, so that missing evidence is not converted into false reps.
11. As a participant, I want recognition to resume after reliable visibility and movement return, so that a short recoverable interruption does not end the session.
12. As a participant, I want stationary rest to avoid generating reps, so that pauses do not inflate the count.
13. As a participant, I want the session to preserve active duration separately from wall-clock duration, so that pauses and unknown intervals remain explicit.
14. As a participant, I want the camera preview and skeleton to consume the same canonical packet used for counting, so that visible evidence and recorded results agree.
15. As a technical evaluator, I want the existing recording and replay capability retained, so that recognition errors can be reproduced.
16. As a technical evaluator, I want capture artifacts downloaded or exported by the existing flow, so that human annotations can be compared with machine results.
17. As a technical evaluator, I want every sealed rep to retain immutable start, peak and end boundaries, so that count accuracy and timing can be audited.
18. As a technical evaluator, I want rejected and needs-review candidates preserved as evidence, so that failures are diagnosable rather than silently discarded.
19. As a technical evaluator, I want profile identity and content hash stored with every result, so that results from different profile versions are never mixed.
20. As a technical evaluator, I want the same canonical fixture to produce equivalent semantic packets on Web, Android and iOS, so that platform drift is detected before field testing.
21. As a technical evaluator, I want an eight-minute uninterrupted device run, so that throughput, backlog, crash and thermal feasibility can be observed.
22. As a technical evaluator, I want processing throughput of at least 15 FPS on the selected mid-range validation phone, so that low-impact alternating phases remain observable.
23. As a technical evaluator, I want at least 90% valid canonical frames during a controlled session, so that count results are based on sustained observation.
24. As a technical evaluator, I want recognition start and stop latency no greater than one second, so that active duration and segment boundaries are useful.
25. As a technical evaluator, I want no more than one false rep in a 30-second stationary rest, so that the state machine rejects idle noise.
26. As a technical evaluator, I want rep count error no greater than 10% against manual video annotation, so that each action has a clear technical pass condition.
27. As a technical evaluator, I want at least five ordinary participants with different heights and movement amplitudes, so that the validation is not a single-person demo.
28. As a technical evaluator, I want each participant to perform every action for 45 seconds in three rounds, so that the accuracy claim has repeatable coverage.
29. As an algorithm maintainer, I want one action × variation × equipment × camera-position identity per profile, so that semantically different movement contexts never share thresholds accidentally.
30. As an algorithm maintainer, I want the four profiles to remain provisional until held-out participant captures pass, so that configured thresholds are not presented as calibrated truth.
31. As an algorithm maintainer, I want missing landmarks to remain unknown in the canonical packet, so that platform adapters never invent evidence.
32. As an algorithm maintainer, I want action expansion to happen through validated Rust profiles and a shared alternating state graph, so that platform hosts do not accumulate bespoke counters.
33. As an algorithm maintainer, I want any future temporal model to consume normalized canonical landmark windows rather than RGB video, so that it remains small and portable.
34. As a privacy-conscious participant, I want recognition to run fully on device, so that video or skeleton data is not uploaded for inference.

## Implementation Decisions

- The primary functional Seam is the existing Rust canonical recognition session: install an exact recognition profile, begin a set, ingest pose observations, finish the set, and consume immutable canonical packets. Functional tests cross this Seam and never test private threshold helpers.
- A second system Seam is required only for mobile feasibility: an eight-minute platform capture session observed through exported runtime metrics and canonical packets. This is the highest boundary at which FPS, backlog, crash and valid-frame ratio can be established.
- Rust remains the sole producer of canonical landmarks, set lifecycle, rep phase, rep candidate disposition, sealed boundaries, active profile identity and profile hash. Web, Android and iOS must not implement a second counter.
- The four exact identities are `march_in_place`, `side_step_touch`, `alternating_knee_raise`, and `step_jack`, each with front camera position, bilateral participation, no equipment and its own versioned provisional profile.
- Action identity is selected explicitly before a set. Automatic free-action classification is not part of recognition and cannot change the installed profile mid-set.
- One rep is one completed unilateral cycle. March and knee raise count a limb lift followed by return; side step-touch counts a step to one side followed by the return/bring-in; step jack counts one side step with coordinated arm opening followed by return to neutral. Left and right are separate reps.
- The SDK will add one shared alternating-cycle state graph suitable for left/right actions. It owns per-side readiness, active-side locking, return-to-neutral, refractory/anti-double-counting behavior, continuity handling and immutable sealing. The public output remains the existing rep/set packet contract.
- Profiles describe observed signals and gates only. They are recognition initializers, not normative form references, and cannot emit correctness, medical, safety or injury claims.
- The canonical packet contract must expose enough semantic information to compare results across native and WASM hosts. Contract changes are versioned and backwards decoding remains supported for archived recordings.
- The Web host continues to use Rust/WASM. Android and iOS use native bindings generated from the same Rust crate and translate platform MediaPipe observations into the shared input contract.
- Android replaces its TypeScript `RepCounter` path with canonical Rust packet consumption. iOS receives an equivalent Expo native camera view and MediaPipe pose adapter rather than an empty module.
- Platform adapters use the BlazePose 33 schema and preserve source timestamps. They may select GPU with CPU fallback, but inference delegate choice cannot change recognition semantics.
- The mobile validation default is the lightest pose model that preserves the required landmarks. Larger pose models remain diagnostic options, not the acceptance baseline.
- Runtime scheduling uses latest-frame semantics and bounded queues. The recognizer may drop stale camera frames but must never reorder timestamps or process an unbounded backlog.
- The validation setup uses a fixed phone in landscape orientation, approximately 0.8–1.2 metres high and 2–3 metres from the participant. The final criterion is complete head, hands and feet visibility with approximately 10% frame margin in an activity area of roughly 2.5 × 2 metres.
- Only one participant may be in frame. Strong backlighting and uncontrolled camera motion are excluded from the first validation condition.
- When required landmarks or target lock are unavailable, recognition pauses or returns unknown. No platform mirrors limbs, interpolates a different person or fabricates coordinates.
- Existing capture, replay, local-data and default export/download behaviour is retained. Historical exercise identities, recognition profiles, recordings and training data are not mutated or deleted.
- Active duration is derived from canonical set lifecycle intervals, not UI timers. Wall-clock session duration and observable active duration remain distinguishable.
- The optional learned-model seam accepts bounded normalized canonical landmark windows, visibility masks and timestamps, and returns advisory probabilities. It cannot replace canonical rep boundaries in this delivery and no model artifact is included.

## Testing Decisions

- Good tests assert externally visible packet semantics: selected profile identity, lifecycle transitions, confirmed/needs-review/rejected candidates, unilateral rep count, sealed boundaries, active duration and unknown behavior. They do not assert private signal calculations or threshold implementation.
- Rust contract tests are the primary recognition tests. Canonical/fixture observations cover one complete left cycle, one complete right cycle, alternating sequences, incomplete returns, stationary noise, out-of-frame gaps, subject changes and rapid direction reversals.
- Existing session, rep, continuity, subject and packet parity tests are prior art. The new tests extend those public contracts rather than creating profile-specific TypeScript counters.
- Cross-platform parity tests feed the same timestamped BlazePose 33 fixture and profile identity through native and WASM bindings, then compare semantic packet fields. Binary layout may differ only when a versioned platform envelope explicitly allows it; recognition results may not differ.
- Archived recording replay remains the evaluation route. Human labels are created from video independently of the recognizer and contain unilateral start, peak and end boundaries.
- Training/tuning and evaluation are split by whole participant capture, never by random reps from the same recording. At least one participant is held out from any profile tuning.
- Each of five or more participants performs each action for 45 seconds in three rounds, plus a 30-second stationary negative segment. Count error is measured against manual labels.
- An action passes only when count error is at most 10%, start/stop latency is at most one second, stationary false count is at most one per 30 seconds, and required evidence is retained for audit.
- The system performance run lasts eight minutes on a declared mid-range phone. It passes with at least 15 processed FPS, at least 90% valid canonical frames, no crash, no unbounded queue growth and no sustained processing backlog.
- Web, Android and iOS builds must typecheck/compile at their public adapter boundary. Where a physical Apple or Android toolchain is unavailable, build verification is reported separately from device performance and cannot be represented as measured device evidence.
- Existing recordings and profiles remain regression fixtures to ensure the alternating state graph and packet changes do not alter previously supported exercise results.

## Out of Scope

- Full course playback, a 6–8 minute consumer course experience or production onboarding.
- AI character, animation, emotional coaching, music control, TTS output or STT input beyond previously discussed future interface reservation.
- Form correction, quality scoring, strict mode, adaptive intensity or personalized coaching.
- Automatic exercise classification or automatic camera-position classification.
- Yoga, Pilates, floor exercises, strength exercises or any exercise beyond the four named standing actions.
- RGB video action-recognition models, large Transformers, cloud inference or server-side training.
- Training, quantizing or deploying the optional TCN/1D CNN.
- Calorie estimates, muscle-activation claims, medical conclusions, injury-risk claims or normative posture verdicts.
- Product polish, account systems, cloud synchronization, content management, subscriptions or analytics infrastructure.
- Claiming broad device support from a single validation phone. The first result is evidence for the declared devices and conditions only.

## Further Notes

- The supplied home-workout research identifies these four actions as the best first front-facing, low-impact candidates because their left/right phase and large projected motion are visible in a fixed consumer camera.
- The current repository already contains `onnxruntime-web` and an RTMPose pose estimator, but the current local classifier is deterministic and no temporal action model exists. This does not block the first validation.
- Pose extraction is expected to dominate mobile compute. The deterministic Rust state graph should remain small; actual end-to-end performance still requires measurement on real devices.
- The current implementation is asymmetric: Web has canonical Rust/WASM recognition, Android has native MediaPipe capture with TypeScript counting, and iOS has no capture view. Closing this asymmetry is part of this specification because otherwise three-platform semantic parity cannot be claimed.
