# Local-first Agent Coach — Implementation Audit

Date: 2026-08-08

## Delivered vertical slice

- `CoachApplication` is the single UI/test facade and composes local Ledger, Agent Runtime, Action Broker, pure Kernel, Policy Gate, Context Assembler, Memory Curator, fixed Tool/Card registries and replaceable ports.
- In-memory and Expo-compatible SQLite ledgers persist sessions, artifacts, presentations, action tokens, Action Events, pending HITL and Working Memory. SQLite schema/version failures are recoverable and JSON snapshot writes are transactional.
- TodayPlan and PlanChangeProposal are immutable, deterministically hashed artifacts. Provider tool calls are restricted to fixed schemas; arbitrary patch, SQL, renderer trees and unknown tools are rejected.
- Proposal apply/reject, stale/recompute, manual/collaborative/managed policy, safety hold, one-use tokens, ActionReceipt, idempotency and compensating undo are observable through `CoachApplication`.
- Typed HITL preserves run/tool identity across application reconstruction and validates plan/mandate revisions before resume.
- Working Memory is cross-session, versioned, user-visible/editable/deletable/pinnable and non-authoritative for Kernel decisions.
- Context assembly keeps task-relevant body/training/nutrition/sleep/timeline data while redacting direct identity fields and emitting a disclosure manifest. Provider failure leaves local facts unchanged.
- Fixture Motion accepts canonical observations only, keeps confirmed/needs-review/rejected separate, uses one live presentation slot and seals SetSummary without claiming pose-derived load or RIR.
- The isolated Coach Drawer projects canonical events to AI-SDK-style parts, reconciles tool/artifact/presentation identity in place, expands from one bottom bubble to about 4/5 screen, retains trigger context and is absent on Profile.

## Explicit follow-ups

- Working Memory still needs Ledger-atomic `supersede`, `compact` and typed promotion into Profile/Timeline with ActionEvent.
- HITL persistence and typed resume are implemented, but resuming the original provider/tool loop with the same Agent run remains a follow-up.
- Action Log currently covers apply/reject/undo writes and compensating undo; meaningful read/proposal events, rule versions and the separate low-level Tool Audit remain follow-ups.
- Production ContextAssembler still needs long-history compression/token budgeting and provider-specific retention disclosure.
- Production MotionRuntime must wrap the existing canonical native bridge; this delivery deliberately does not modify Android/iOS capture, JNI or Rust motion code.
- HealthKit, Health Connect, notifications, sync backend, media encryption and end-to-end backup remain port contracts only.
- Final hardening still needs fault-injected crash tests, a real remote-thin provider contract suite and complete cross-adapter replay.
- Shared TypeScript contracts are platform-neutral; no iOS or Android build/device claim is made because the user explicitly requested no build in this phase.

## Verification

- `npm test`: 210/210 passing after the final architecture and cross-user isolation fixes.
- `npx tsc -p tsconfig.json --noEmit`: passing after the final additions.
- Existing `App.tsx`, `src/mobile/**`, capture dispatch, native bridge and Rust motion pipeline were not changed by this feature.
