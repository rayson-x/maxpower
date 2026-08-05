# Publish one portable native Rust recognition binding

Status: completed

Blocked by: 02

Expose session setup, exact profile selection, set lifecycle, BlazePose 33 ingestion and canonical packet transfer through the Rust C ABI.

- [x] Invalid profiles, landmark payloads and non-monotonic timestamps are rejected.
- [x] Packet bytes and contract version are exported.
- [x] Native and WASM hosts share the same Rust profiles and state graph.
- [x] Android and Apple Rust build paths do not commit generated binaries.

## Comments

The runtime lock owns one technical-validation session. A shared fixture compares native and WASM packet semantics.
