# Rust motion understanding product contract

Status: authoritative product direction

Last aligned: 2026-08-14

## Why this product exists

MaxPower needs to understand how a user performed a selected exercise from ordinary camera video, not merely draw a skeleton or count screen-space motion. The product must turn observable person and equipment evidence into useful Rep counting, movement-quality conclusions, and an explanation the user can inspect.

The purpose of normalization is to make movement judgement more stable across practical camera placement. It establishes an action-local view-normalized frame for understanding the exercise. It does not reconstruct physical-world 3D, gravity, force, or a true world horizon.

The first product may be a feasibility Demo/Beta. It should reach real users early, expose its evidence limits honestly, and support governed offline improvement without pretending that unfinished accuracy or coverage is complete.

## Capability goals

For an exact supported exercise context, the product must:

- observe the selected person, visible skeleton, and applicable equipment;
- establish an action-appropriate local motion frame;
- recognize Rep and phase evidence through one causal Rust lifecycle;
- combine pose and equipment evidence without hiding disagreement or uncertainty;
- produce a useful quality assessment for the completed training set;
- preserve the per-Rep evidence and calculation chain behind that assessment;
- show the user the conclusion first and allow the derivation to be expanded; and
- refuse claims that the available evidence cannot support.

The long-term scope is every action in the active exercise catalog. Coverage may open progressively as exact contexts gain executable recognition, quality rules, trace completeness, and sufficient evidence. A visible action must never be presented as supported merely because its name exists in the catalog.

## Product scope

The primary user experience is:

1. the user selects an exercise context and performs a training set;
2. the product displays the original video evidence with the original skeleton and equipment observations;
3. Rust computes normalization, fusion, Rep, phase, features, rules, and conclusions internally;
4. after the set finishes, the user receives Rep results and an overall set-quality report; and
5. the user may expand the report to inspect the per-Rep derivation from input evidence to conclusion.

Normalization is a calculation layer, not a requirement to render a second reconstructed skeleton. Every report must disclose its evidence basis and limits.

## Responsibility boundaries

### Rust Motion SDK

Rust is the sole runtime authority for canonical motion observations, action-local normalization, pose/equipment fusion, Rep and phase decisions, movement features, quality conclusions, refusal states, and derivation traces.

Rust produces one versioned canonical output lineage. No host or client may create a second interpretation truth for the same set.

### Web, Android, and iOS clients

Clients own camera and video lifecycle, permissions, preview, user-entered context, rendering, navigation, and product presentation. They decode and project Rust output; they do not recompute normalization, Rep boundaries, features, quality conclusions, or explanations.

Client-side retention, upload consent, and media transfer are App responsibilities. They are not Rust inference responsibilities.

### Offline data and release workflow

Profiles, rules, reference material, training data, and evaluation evidence are versioned offline assets. Ordinary user feedback is not annotation truth. Runtime behavior never silently trains, rewrites thresholds, promotes a reference, or mutates itself.

## Non-negotiable principles

1. **One canonical truth.** Rendering, persistence, review, export, Rep counting, quality reporting, and explanation consume the same Rust lineage.
2. **Exact context before claims.** Similar exercise names, equipment, sides, or camera views are not interchangeable. Unsupported contexts fail explicitly.
3. **Unknown remains unknown.** Missing landmarks, equipment, context, or comparison evidence are not fabricated, mirrored, or inferred from another person.
4. **Evidence before interpretation.** Reports distinguish measured facts from cautious interpretation and preserve alternative explanations where cause is not identifiable.
5. **No false physical or physiological claims.** Monocular video is not silently converted into world 3D, force, strength, muscle activation, pain cause, injury risk, or a necessary fatigue mechanism.
6. **No opaque correctness score.** Quality remains dimensioned and evidence-bounded; low-confidence dimensions refuse judgement instead of being hidden by a composite score.
7. **Trace every conclusion.** Every user-facing conclusion must be reproducible from versioned source evidence, calculation steps, rules, comparison basis, and limitations.
8. **Immutable historical evidence.** New analysis produces a new version and never overwrites prior video, canonical packets, annotations, conclusions, or reviews.
9. **Users are product users, not annotators.** Ordinary feedback may inform product decisions but does not become training truth without a separate governed workflow.
10. **Progressive availability is honest.** An exercise is opened only when its exact context can produce real Rep output, an evidence-backed set report, and a complete derivation path. Unopened contexts remain visibly unavailable.

## Specification hierarchy

This document defines stable product direction. It is not an implementation plan, packet schema, algorithm design, accuracy report, or completion claim.

Implementation and acceptance details live in narrower specifications:

- `.scratch/rust-motion-understanding-vnext/PRD.md`: next implementation target for the complete Rust motion-understanding engine and product output.
- `.scratch/rust-local-motion-coordinate/PRD.md`: local 2D coordinate and view-normalization subsystem.
- `.scratch/rust-motion-quality-review/PRD.md`: calibration review and evidence-evaluation subsystem.
- `docs/design/local-motion-execution-rule-engine-v0.1.md`: rule-engine technical design.

Narrower specifications may stage delivery and define exact acceptance gates. They must not violate this contract's ownership, evidence, safety, traceability, or long-term catalog goals.
