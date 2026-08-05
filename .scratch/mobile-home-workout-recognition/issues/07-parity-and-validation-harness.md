# Prove semantic parity and run the validation harness

Status: completed

Blocked by: 04, 06

Compare Rust native and Web/WASM semantics and score supplied field/device evidence against the agreed thresholds.

- [x] Public fixtures cover four actions, both sides and negative/incomplete cases.
- [x] One shared timestamped fixture is run through native and WASM bindings and semantic packet fields are compared.
- [x] The harness reports count error, latency, rest false positives and valid-frame ratio.
- [x] Performance reports require device identity, eight-minute duration, FPS, backlog and crash status.
- [x] Missing participant or physical-device evidence stays explicitly unmeasured.

## Comments

iOS is not a blocker for this user-approved non-iOS delivery. No physical accuracy or performance pass is claimed.
