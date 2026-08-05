# Align Web with the home-workout profiles and metrics

Status: completed

Blocked by: 02

Install the same four Rust profile identities on Web and export technical runtime metrics without changing the existing capture workflow.

- [x] Exact profile resolution does not perform automatic classification.
- [x] Existing recording, replay and default export/download behavior is retained.
- [x] Active duration derives from canonical lifecycle.
- [x] Processed FPS, validity and dropped/stale frames use the shared metric schema.

## Comments

Archived recordings remain backwards-decodable through the versioned packet contract.
