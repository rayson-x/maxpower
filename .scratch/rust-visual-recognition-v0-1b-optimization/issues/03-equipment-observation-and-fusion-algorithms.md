# 03 — 完成通用器械观测与融合算法包

**What to build:** 器械动作能够使用独立的刚性杠铃、哑铃或机器把手 observation 进入统一融合与 Rep 证据链；人体手腕只约束归属和握持，永远不能替代器械几何。

**Blocked by:** 01 — 建立可复用识别算法模块库.

**Status:** complete — re-accepted after removing pose geometry fallbacks,
hardening raw pixel geometry, and requiring sustained common motion for grip.

## Audit context and non-negotiable constraints

- The existing person detector does not establish barbell, dumbbell or machine-handle geometry. A person/pose result is not equipment evidence.
- In the frozen diagnostic, the equipment provider emitted 30,520 track frames at about 29.4 Hz, but only 1,289 entered the local equipment channel; no rigid-bar Rep or equipment-fused turnaround was produced. The immediate bottleneck is association/canonical evidence, not nominal tracker FPS.
- A wrist is never a barbell, dumbbell, cable handle or machine handle. It may constrain subject, hand and grip association only; it may not create raw geometry, measured length, track identity, turnaround or Rep eligibility.
- This ticket defines a correct provider/evidence path. It must not claim a detector is accurate or complete until distinct equipment truth, model weights and device evaluation exist.

## Review remediation — equipment remains an independent observation

The current replay's low local-equipment coverage is not an FPS finding. This
ticket must repair canonical admission and association, not introduce a
wrist-derived pseudo-track or hide disagreement with a pose fallback.

- A real detector/geometry observation must own track identity, measured axis
  length and measured path before grip logic runs. Wrist/hand proximity may
  constrain `subject`, `hand`, and `GripEstablished`; it may never create,
  extend, reconnect, or move raw equipment geometry.
- `Conflict`, stale prediction, background rack bars, pre-grip and post-release
  tracks remain diagnostic/display evidence only. None may advance candidate
  start/turnaround/end or Rep consensus.
- The action×view plan selects the Provider requirement. The client does not
  select an equipment algorithm. Provider structural absence fails plan
  compilation; a real-frame detection/association absence is dynamic evidence
  and must surface as `CannotJudge`/typed Rep evidence rather than a hidden
  action tier.

### Completion evidence

- Frame-sequence tests cover pre-contact, real grip, release, background-bar
  competition, association conflict, short occlusion, and predicted-only
  recovery. Only an independently measured, subject-associated,
  `GripEstablished` track may participate in an equipment-primary Rep.
- Replay reports detector, tracker, canonical local-channel and fusion cadence
  separately. It does not call tracker FPS an improvement unless the measured
  evidence reaches the candidate/Rep path. The governed replay artifact is
  owned by Ticket 10; this ticket supplies the separately traceable runtime
  channels and does not invent an ungoverned performance claim.

- [x] 为 rigid bar、independent dumbbell 与 machine handle 注册统一 Provider/model descriptor、detector、tracker/geometry、association、grip 和 fusion 算法合同。
- [x] detector、tracker/geometry、prediction 与 display estimate 保留独立 provenance、来源帧、TTL、uncertainty 和可判定性；prediction/display estimate 永远不是 judgeable equipment。
- [x] raw equipment geometry 不依赖 wrist 坐标；wrist 只能参与 subject/hand/grip association，不能创建 track identity、视觉长度、measured observation 或 Rep eligibility。
- [x] 真实 track 在接触前、背景杆附近、释放后、association conflict、短时遮挡和视觉丢失时都保留正确的 observation/association 状态，且不得形成伪器械 Rep。
- [x] 满足视觉来源、连续性、主体/手部关联与 grip 合同的 measured track 才能进入 local coordinate、fusion、turnaround 和 Rep consensus。
- [x] 集成测试从帧 observation 到 canonical output 覆盖刚性杠、双独立负载和机器把手，并验证任何 wrist-only 或 predicted 路径都不能取得 judgeable equipment 地位。

## Completion evidence

The standard provider registry owns rigid-bar, dumbbell and machine-handle
implementations. Equipment Rep contracts explicitly reject raw fallback after
association conflict; visual point tracker contracts prove that a retained
wrist cannot keep an object geometry alive after pixels disappear. Ticket 10
is the sole owner of frozen, action×view cadence and accuracy reporting.

The Web provider surface is now also plan-bound: after an exact action×view
context is selected, legacy host geometry ingress is rejected. Only the
Rust-selected Provider may create raw observations for that set, so a client
cannot use a wrist-aligned box or arbitrary axis proposal to bypass provider,
association, grip and fusion provenance.

Re-acceptance proves that a lone scene edge is not a measured shaft, an
equipment-primary point coordinate cannot freeze from pose before grip, and a
single wrist-aligned frame remains `ContactCandidate`. Grip now requires
continuous contact plus two independently observed common-motion transitions;
all equipment fusion, local-coordinate and Rep contracts pass.
