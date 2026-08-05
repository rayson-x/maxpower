# Make iOS consume Rust canonical recognition offline

Status: deferred

Blocked by: 03

Provide the equivalent iOS camera, MediaPipe and Rust canonical adapter.

- [ ] Implement camera preview, permissions and BlazePose 33 inference.
- [ ] Drive count, phase and lifecycle from canonical packet fields.
- [ ] Keep inference and recognition offline.
- [ ] Use bounded latest-frame scheduling and shared metrics.
- [ ] Replace the placeholder unsupported view.

## Comments

Deferred from this non-iOS delivery at the user's request. The common C header and Apple Rust library build path remain available without claiming an iOS client build.
