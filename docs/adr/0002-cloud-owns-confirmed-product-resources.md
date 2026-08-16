# Cloud is limited to identity and text LLM inference

Status: accepted

## Context

ADR 0001 establishes Pi as the only Agent loop and the local Product Kernel as the owner of deterministic planning, policy, tool execution, and auditable fact creation. V1 requires authenticated access to a metered language model without moving health or product records off the device.

## Decision

The local Product Kernel and account-scoped local Ledger are the only persistence authority for Profile, Goal, Plan, Nutrition strategy, WorkoutSession, Timeline, Daily Ledger, conversations, tools, Working Memory, and local references.

The cloud exposes identity/account lifecycle and the text-only `maxpower/coach-v1` LLM Gateway. The Gateway authenticates the account, enforces entitlement, routes Provider calls, supports cancellation/resume, and records content-free usage metadata. It does not execute tools, evaluate plans, store product resources, accept media, or commit facts.

## Consequences

- Product mutations use one local command, validation, revision, and audit path.
- No ProductData, media, replica, cache, restore, compatibility, or dual-write cloud path exists.
- LLM text cannot become a fact or Plan revision without the local typed-tool, validation, and confirmation path.
- Cross-device product recovery and multimodal services require a future ADR and are not implied by account or LLM connectivity.
