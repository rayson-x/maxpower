# MaxPower Motion SDK（Rust / PC Web V1）

Rust owns motion state; hosts own camera/model/rendering. The public seams are deliberately narrow:

- `InferenceAdapter` supplies timestamped pose and equipment observations and declares capabilities.
- `MotionSession` owns subject selection, canonical continuity, subject/equipment association, rep state and sealed boundaries.
- `OutputAdapter` receives immutable `MotionPacket` values; the binary contract is decoded once.
- `ExerciseProfile` configures the generic multi-joint state machine. Its primary and secondary signals are explicit: landmark Y, a three-landmark 2D joint angle, or torso-normalized landmark distance. New graph-compatible exercises do not add Rust state-machine code or pretend that every movement is vertical.
- `ReferenceTrajectoryProfile` is a separate identity/schema. It can describe corridor evidence but cannot change a `SealedRep`.

The browser uses a dependency-injected numeric WASM ABI because MediaPipe and camera frames are browser-owned. Run:

```sh
npm run build:motion-wasm
npm run web
```

The generated WASM is local and ignored by Git. `RUST SDK · ACTIVE` in the header means canonical data, target state and supported rep profiles are Rust-authoritative. `TS FALLBACK · DIAGNOSTIC` is explicit and is not silently presented as Rust.

## Data contract

Renderer, recorder, counter and analyzer synchronously receive the same frozen Web motion packet and canonical content hash. Unknown landmarks do not retain coordinates and are not rendered. Recording metadata stores the same canonical frames, scheduler gaps, hashes and `SealedRep` boundaries used on screen.

Packet `MOTN/1.7` adds the `EQP1` equipment extension. `EquipmentFusionEngine` associates current detector observations with the Rust-locked subject, owns stable equipment track ids and publishes explicit refusal reasons. It may use reliable wrists for optional hand association, but it never changes canonical pose or fills an unknown joint from equipment. No observation produces `cannot_judge`; current v0.1 mirror/static rejection depends on Adapter flags and does not replace a trained equipment detector.

Packet `MOTN/1.8` keeps every 1.7 field unchanged and appends `QLT1 | u32 length | UTF-8 JSON`. QLT1 contains immutable Rust-authored three-endpoint Rep proposals and the eight separate assessment dimensions. Clients decode, render and export these proposals; they do not recalculate quality. Equipment-constrained pose remains `predicted`, so one equipment observation can never corroborate itself as a second measured pose channel.

## Profile maturity

The built-in high-pulldown and seated-shoulder-press profiles remain `provisional`. The local evaluation corpus was visible during exploratory threshold work, so its held-out-looking metrics are not a valid independent promotion cohort. Consequently `qualityVerdict` stays `null` and the promotion count stays zero.

Locally generated `observed recognition profiles` are a separate provisional input: they use human-labelled start/peak/end boundaries only to improve segmentation, count and interference rejection for an exact action/camera tuple. They are never a standard-form trajectory, and an explicit variation/equipment selection cannot inherit a historical label where that field was unrecorded.

## Scope

Web, Android and iOS have YOLOX + RTMPose Halpe-26 pose Adapters feeding the same Rust canonical ABI. The Rust/C, Web, Android JNI and iOS bridge interfaces accept pose and equipment observations in one frame transaction. The current Android/iOS live camera Adapters intentionally submit an empty equipment list because no trained device equipment detector is installed yet; therefore this interface work is not evidence of live equipment recognition. Physical-device throughput, heat, throttling and participant accuracy remain unmeasured and unverified until declared field evidence is supplied. The core avoids per-frame profile scans and runs only the selected profile, so no mobile performance claim is inferred from the implementation alone.
