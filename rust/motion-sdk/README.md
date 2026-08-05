# Form Coach Motion SDK（Rust / PC Web V1）

Rust owns motion state; hosts own camera/model/rendering. The public seams are deliberately narrow:

- `InferenceAdapter` supplies timestamped pose candidates and declares capabilities.
- `MotionSession` owns subject selection, canonical continuity, rep state and sealed boundaries.
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

## Profile maturity

The built-in high-pulldown and seated-shoulder-press profiles remain `provisional`. The local evaluation corpus was visible during exploratory threshold work, so its held-out-looking metrics are not a valid independent promotion cohort. Consequently `qualityVerdict` stays `null` and the promotion count stays zero.

Locally generated `observed recognition profiles` are a separate provisional input: they use human-labelled start/peak/end boundaries only to improve segmentation, count and interference rejection for an exact action/camera tuple. They are never a standard-form trajectory, and an explicit variation/equipment selection cannot inherit a historical label where that field was unrecorded.

## Scope

PC Web and the Android offline technical-validation adapter are implemented. The Android adapter packages the lightweight MediaPipe models, sends the selected action's BlazePose 33 observations through the native Rust ABI, and consumes canonical packet semantics rather than maintaining a platform counter. The iOS client adapter remains deferred; the shared C header and Apple Rust library build path are preparatory only. Physical-device throughput, heat, throttling and participant accuracy remain unmeasured and unverified until declared field evidence is supplied. The core avoids per-frame profile scans and runs only the selected profile, so no mobile performance claim is inferred from the implementation alone.
