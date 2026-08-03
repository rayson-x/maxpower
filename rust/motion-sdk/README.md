# Form Coach Motion SDK（Rust / PC Web V1）

Rust owns motion state; hosts own camera/model/rendering. The public seams are deliberately narrow:

- `InferenceAdapter` supplies timestamped pose candidates and declares capabilities.
- `MotionSession` owns subject selection, canonical continuity, rep state and sealed boundaries.
- `OutputAdapter` receives immutable `MotionPacket` values; the binary contract is decoded once.
- `ExerciseProfile` configures the generic multi-joint state machine. New graph-compatible exercises do not add Rust state-machine code.
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

## Scope

PC Web is implemented. Android, iOS, device heat and throttling are intentionally unimplemented and unverified. The core avoids per-frame profile scans and runs only the selected profile, which preserves a viable native-SDK seam without claiming mobile performance evidence.
