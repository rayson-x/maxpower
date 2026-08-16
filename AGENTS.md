# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Agent skills

### Issue tracker

Issues and PRDs use the local Markdown tracker under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The local tracker uses the default five triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with domain terms in `CONTEXT.md` and architectural decisions in `docs/adr/`. See `docs/agents/domain.md`.

### Rust motion product contract

Before changing the Rust Motion SDK, recognition profiles, local coordinates, pose/equipment fusion, Rep or quality reporting, motion explanation, or a client motion surface, read `docs/agents/rust-motion-trace-explainer-product-contract.md` completely. It is the top-level product contract; narrower PRDs and tickets implement slices and do not reduce its all-catalog-action or user-facing scope.
