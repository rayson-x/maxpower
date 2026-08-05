# Tickets: Mobile offline home-workout recognition

These tracer-bullet tickets implement the [technical validation spec](./PRD.md) on the existing Rust canonical SDK and keep Web, Android, and iOS recognition semantics aligned.

Work the **frontier**: any ticket whose blockers are all done.

## 01 — Seal one alternating march cycle in the Rust canonical packet

**What to build:** A selected front-view `march_in_place` profile recognizes one complete unilateral lift-and-return through the Rust session and emits the existing immutable rep evidence without changing prior exercise behavior.

**Blocked by:** None — can start immediately.

- [x] A public Rust contract test fails before implementation and passes for one left and one right march cycle.
- [x] Stationary movement and an incomplete lift do not become confirmed reps.
- [x] Profile identity, hash, boundaries and disposition appear in the canonical packet.
- [x] Existing Rust recognition tests remain green.

## 02 — Recognize all four front-view low-impact actions through the shared state graph

**What to build:** The same Rust alternating-cycle graph and exact profile selection support side step-touch, slow alternating knee raise and step jack as complete end-to-end recognition paths.

**Blocked by:** 01 — Seal one alternating march cycle in the Rust canonical packet.

- [x] Each exact action context resolves to its own versioned provisional recognition profile.
- [x] Each unilateral complete cycle counts once and left/right alternation does not double-count.
- [x] Step jack requires coordinated arm and leg evidence; side step-touch does not inherit the step-jack profile.
- [x] Unknown required landmarks pause or reject according to the canonical continuity contract.
- [x] Previously supported recognition contexts remain unchanged.

## 03 — Publish one portable native Rust recognition binding

**What to build:** Android and iOS hosts can create a Rust recognition session, select any of the four profiles, begin/finish a set, ingest BlazePose 33 observations and receive the same versioned canonical packet semantics as Web.

**Blocked by:** 02 — Recognize all four front-view low-impact actions through the shared state graph.

- [x] The native binding owns its single technical-validation session under the Rust runtime lock and rejects invalid timestamps, profiles and landmark payloads.
- [x] The binding exposes canonical packet bytes plus the SDK contract/algorithm version.
- [x] Native and WASM adapters share the same profile definitions and state graph rather than copying thresholds.
- [x] Build scripts produce the required Android and Apple Rust artifacts without committing generated binaries.

## 04 — Make Android consume Rust canonical recognition offline

**What to build:** The Android technical view uses the existing native MediaPipe camera observations but displays count, phase and lifecycle from Rust canonical packets for the selected four actions.

**Blocked by:** 03 — Publish one portable native Rust recognition binding.

- [x] The Android path no longer uses the TypeScript `RepCounter` as an authoritative counter.
- [x] A known action can be selected and installed before the recorded set begins.
- [x] The default mobile pose model is lightweight and inference works without network access.
- [x] Latest-frame scheduling is bounded and runtime metrics expose processed FPS, valid frames and explicitly unavailable dropped-frame counts.
- [x] Required-landmark loss pauses counting rather than guessing.

## 05 — Make iOS capture pose and consume Rust canonical recognition offline

**What to build:** The iOS technical view provides the same camera, MediaPipe pose event and Rust canonical recognition behavior as Android for the four selected actions.

**Blocked by:** 03 — Publish one portable native Rust recognition binding.

Deferred from the non-iOS delivery at the user's request. The common C ABI/header and universal Apple Rust XCFramework build path are retained, but an iOS client adapter or build is not claimed.

- [ ] The Expo native view implements camera preview, permission-safe lifecycle and BlazePose 33 inference on iOS.
- [ ] The same action selector and canonical packet fields drive iOS count, phase and lifecycle.
- [ ] Pose inference and recognition require no network connection.
- [ ] Latest-frame scheduling is bounded and runtime metrics use the shared schema.
- [ ] iOS no longer renders the placeholder unsupported message.

## 06 — Align Web with the four mobile profiles and validation metrics

**What to build:** Web can select and replay the same four profile identities, consume the same canonical packet outcomes and export the same technical runtime metrics used by mobile validation.

**Blocked by:** 02 — Recognize all four front-view low-impact actions through the shared state graph.

- [x] Web profile resolution installs the exact Rust profiles without automatic classification.
- [x] Existing recording, replay and default export/download behavior is retained.
- [x] Active duration derives from canonical lifecycle rather than a second UI timer.
- [x] Web reports processed FPS, valid-frame ratio and dropped/stale frames using the shared metrics schema.

## 07 — Prove semantic parity and run the validation harness

**What to build:** A repeatable harness demonstrates that the same fixtures produce equivalent recognition semantics across Rust native and Web/WASM, and it scores labeled field captures against the agreed acceptance thresholds.

**Blocked by (non-iOS delivery):** 04 — Make Android consume Rust canonical recognition offline; 06 — Align Web with the four mobile profiles and validation metrics. Ticket 05 is explicitly deferred.

- [x] Golden fixtures exercise all four actions and both sides through the shared graph; negative/incomplete and landmark-loss behavior remains covered by the canonical rep/continuity contracts.
- [x] Native and WASM hosts consume the same encoded Rust packet/profile definitions; ABI and WASM parity tests verify the public boundary.
- [x] The harness reports count error, start/stop latency, rest false positives and valid-frame ratio per action and participant.
- [x] The mobile performance report records an eight-minute run, processed FPS, dropped-frame observability, backlog, crash status and device identity without overstating unmeasured evidence.
- [x] Full Rust, TypeScript, Web/WASM and Android adapter verification passes; physical-device and participant evidence remains explicitly unmeasured until supplied.
