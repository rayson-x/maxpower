# Cloud owns confirmed product resources

Status: accepted

## Context

ADR 0001 established `CoachApplication` as the owner of Agent orchestration, deterministic planning, policy, tool execution, and auditable fact creation while MaxPower validated a single-device product. MaxPower now requires authenticated multi-device recovery, cloud-authoritative plans and workout results, optional private media storage, and a metered cloud LLM Gateway.

Uploading the complete local Ledger snapshot or moving Agent orchestration to the server would conflate two different responsibilities. The server must not turn untrusted model text into a product fact, while the client must not claim a write is durable before the cloud has accepted it.

## Decision

`CoachApplication` continues to own reasoning, planning, Policy/HITL, typed tool execution, and the proposal of product changes. Coach conversations, messages, Agent runs, tool calls, Working Memory, and transient stream state remain local.

The Cloud ProductData API is the persistence authority for user-confirmed Profile, Plan/PlanVersion, WorkoutSession, and Result resources. A client command becomes a durable product resource only after the server validates ownership, idempotency, schema, revision, and returns a successful acknowledgement. Local SQLite is an account-scoped cache and local conversation store, not proof of a cloud commit.

The LLM Gateway is a language-generation boundary only. It authenticates the account, enforces entitlement, routes Provider calls, and records content-free usage metadata. It does not execute MaxPower tools or directly write ProductData resources.

Optional media uploads use a separate private MediaLibrary lifecycle. Video, canonical packets, keypoints, and nutrition photos never enter ProductData or LLM usage records merely because they exist locally.

## Consequences

- Existing Coach safety and transaction rules remain mandatory before a client proposes a cloud write.
- The server exposes resource commands and queries instead of accepting an opaque local Ledger snapshot.
- Conversation continuity can remain local while confirmed resources recover across devices.
- Conflicts are explicit through idempotency keys and revisions; the client must re-read or ask the user rather than silently overwrite.
- A future server-side Agent would require a separate ADR and cannot be inferred from this cloud persistence decision.
