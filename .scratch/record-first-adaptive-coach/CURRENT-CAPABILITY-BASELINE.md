Status: confirmed

# Current Capability Baseline

## Purpose

This document records what the default MaxPower client can actually do before new functional tickets are planned. A source file, isolated evaluator, prototype, or manually injected test adapter does not count as a completed product capability.

The audit uses four states:

- **Default-wired** — reached by the shipped mobile composition through `CoachApplication`, persisted in the canonical Ledger, and projected back to the client.
- **Partially wired** — a real path exists, but it does not satisfy the requested business semantics or one of the required entrances/exits is missing.
- **Isolated/reference** — implementation and tests exist, but the shipped composition does not call it.
- **Missing** — the requested domain concept or end-to-end path does not exist.

## Executive conclusion

MaxPower does not need a new Record or Timeline foundation. The existing Timeline is already the strongest reusable part of this feature. The next plan must start above it, by making existing Records produce one plan-independent Daily Health Ledger and by replacing parallel calculation and evaluation paths.

The current codebase has substantial infrastructure, but the requested adaptive product loop is not yet connected:

- Foundation maturity — Timeline, provenance/corrections, planned workout execution, Agent runtime/cards, Goal/Plan revisions: roughly **65–75%** of the reusable foundation exists.
- Requested capabilities considered individually: roughly **45–55%** are present in some form, including partial and isolated implementations.
- Requested default-client experience from record through calculation, goal-specific evaluation, adaptive planning, delivery, learning, and pause: roughly **25–35%** is connected end to end.

These are functional-maturity estimates, not source-line or ticket-count estimates. The end-to-end percentage is lower because several missing seams sit on every business flow: a single Daily Health Ledger, optional Goal/Plan state, goal-specific current-plan evaluation, LLM plan-candidate generation followed by deterministic validation, and outcome-driven adaptation.

## Current default business flows

### Manual Record

```text
RecordFocus
  -> recordTimelineFact / confirmMealObservation
    -> append-only Timeline + correction/provenance rules
      -> queue Timeline risk check
        -> foreground/background settles newest queued check
          -> default fat-loss evaluator
            -> optional future-plan preview when at risk

Separately:
Timeline nutrition/activity
  -> NutritionDayLedger + DailyIntakeBudget
    -> Today/Plan nutrition cards
```

The Timeline branch is real. The calculation branch is not a unified Daily Health Ledger and the risk branch does not use the current Plan, Nutrition strategy, Readiness state, or goal-specific default policies.

### Agent Record

```text
Coach drawer / onboarding conversation
  -> typed ToolRegistry call
    -> direct Record when the statement is clear and mandate permits
       OR immutable confirmation card for estimates/ambiguous input
      -> same Timeline write path
        -> same queued default risk check
```

The same Timeline admission rules are reused. However, a generic risk result created after an Agent Record is not consistently attached to that same conversation as a new inline decision card. Tools that explicitly request a planning preview do present one; ordinary Record tools do not complete the same conversational review loop.

### Background work

```text
best-effort native wake
  -> repair recipes / import authorized health data / morning recovery prompt
    -> settle a Timeline risk check only when a Timeline change already queued one
```

There is no independent daily long-term review of tracking silence, repeated non-execution, body trend, deadline bottleneck, or unchanged-signal cooldown. A day with no new Record creates no evaluation, which is correct for the failure denominator but insufficient for detecting prolonged tracking silence.

### Onboarding and first Plan

```text
full-screen onboarding surface
  -> required baseline including free-language goal
    -> dynamic intake and dossier confirmation
      -> required Goal contract + Coaching mandate
        -> deterministic AgentKnowledgePlanningModule
          -> first-plan confirmation
            -> normal App
```

The durable conversation/thread projection exists, but the production onboarding UI still renders only the latest messages/current card rather than the full append-preserving item history. Onboarding always proceeds toward a first Plan. There is no confirmed no-goal route into a record-first Home.

### Training

```text
Today planned session
  -> prepare WorkoutSession with mandatory PlannedSessionRef
    -> execute/confirm/skip/correct sets
      -> performed outcome and Timeline integration
```

Manual users can log an unplanned training `reportedSession` with exercises, sets, load, reps and RIR. They cannot start the full WorkoutSession experience without a Plan reference. The existing `record_only` workout mode means “record sets without Coach camera monitoring”; it does not mean “product without an Active Goal/Plan”.

## Capability matrix

| Capability | Current default behavior | State | Planning decision |
| --- | --- | --- | --- |
| Timeline Record foundation | Training, activity, nutrition, sleep, body, recovery, symptom, schedule and rest facts are append-only with provenance, confidence, timezone, correction, source mutation, tombstone, import/export and sync semantics. | Default-wired | Reuse; do not rebuild. |
| Manual Record entry | The mobile Record drawer writes strength/cardio, food, sleep, recovery and body facts through `CoachApplication`. | Default-wired | Preserve as an acceptance entrance. |
| Agent Record entry | Typed tools can write clear delegated statements or present confirmation drafts; existing nutrition-specific estimate/provider paths also exist. | Default-wired at domain seam; client review loop partial | Reuse the write seam for text and structured fields; delete nutrition recognition/estimate providers and connect post-Record review to the same thread. |
| Manual/Agent equivalence | Both end at Timeline, but manual food entry, Agent food drafts and generic Agent Record drafts do not share one draft/validation representation. | Partially wired | Converge before validation, not only after commit. |
| Nutrition day accounting | Confirmed Timeline meals project energy, protein, carbohydrate and fat with no-log/partial/logged coverage and correction handling. | Default-wired but Plan-dependent | Reuse projection behavior inside the new Ledger. |
| Plan-independent Daily Health Ledger | No versioned artifact combines nutrition, activity, training, body, sleep, recovery, coverage and uncertainty for users without a Plan. | Missing | First major product gap above Timeline. |
| Energy accounting | `dailyEnergyBudget` estimates BMR/NEAT/EAT/TEF/TDEE; `DailyIntakeBudget` separately adjusts a Nutrition strategy target with activity calories. They are not one source of truth and do not expose a signed intake-minus-expenditure range. | Partially wired / duplicated | Select one calculator boundary, migrate consumers, then remove duplicates. |
| Macro nutrients | Energy/protein/carbohydrate/fat are formal fields and appear in client cards. | Default-wired | Extend rather than replace. |
| Fiber, sodium, potassium and micronutrients | No formal nutrient schema, food-entry fields, aggregation, targets, coverage, or client projection exists. | Missing | Add explicit user-entered nutrient fields and aggregation through the single Ledger; V1 has no reference-data provider. |
| Food provenance and quantities | Manual/label/import/estimate sources, portions, confirmed estimates and food lists exist. A small product food library also exists. | Partially wired but contrary to the V1 source boundary | Keep descriptive identity and confirmed manual provenance; delete model/provider estimates and automatic food-composition lookup instead of preserving compatibility. |
| Record-only product state | Timeline APIs work without a Plan, but onboarding requires a Goal contract and the Home projection treats a missing Plan as `planner_hold`. | Missing as a coherent user state | Add optional Active Goal/Plan state and record-first Home projection. |
| Free training | Manual unplanned training can be recorded directly to Timeline. Full WorkoutSession prepare/activate flow requires a Plan reference. | Partially wired | Extend WorkoutSession to allow an explicit freestyle source while preserving the same performed Record. |
| Planned workout execution | Planned session start, current set, confirmation, skip, replacement, rest, pause/resume, outcome correction and completion APIs exist. | Default-wired | Reuse as the planned branch; downstream tickets must rerun it. |
| Realtime finalization | Canonical motion sets use the sole Timeline admission path and do not create a second history. | Default-wired for supported contexts | Preserve as another Record ingress. |
| Full-screen onboarding conversation | A dedicated onboarding surface and durable Thread -> Turn -> Item projection exist. The product screen keeps only a short visible message window and current local card state instead of consuming the full thread projection. | Partially wired | Use the existing conversation projection as the client source of truth. |
| Dynamic goal/no-goal routing | Goal narrative is mandatory; dossier completion creates Goal contract and first-plan pending state. No route bypasses Plan creation when the user has no actionable goal. | Missing | Add goal-intent clarification and optional Goal activation. |
| Goal contract and revisions | Goal contract, deadline/cost fields, corrections and stale-plan behavior exist. | Default-wired for current goal types | Reuse; expand route/path negotiation artifacts. |
| Coaching mandate | Manual/collaborative/managed modes, scopes, limits, locks and local settings authorization exist. Some managed plan actions exist, but nutrition changes and newer planning previews remain separately confirmation-bound. | Partially wired | Normalize durable “ask/allow once/allow similar” behavior at the new module boundary. |
| First-plan generation | The first plan is generated by deterministic `AgentKnowledgePlanningModule`, not by an LLM candidate-generation loop. | Partially wired but contrary to the new responsibility split | Retain knowledge/tools/validators; move plan organization to bounded LLM candidates. |
| Deterministic plan validation | Planner invariants, knowledge pins, safety checks, semantic diffs, stale confirmation and proposal artifacts exist. | Partially wired | Reuse behind one candidate-validation interface. |
| User close/pause Plan | A generic aggregate archive command can hide a Plan, but there is no Plan-specific deactivate command, client action, Coach tool, reminder shutdown, or record-first transition. | Missing | Add one shared manual/Agent deactivate path. |
| Timeline change Hook | Every Timeline append/correction/source change queues and coalesces a risk check; shipped foreground/background composition settles it. | Default-wired admission, partial evaluation | Keep trigger admission; replace the evaluator and widen the versioned snapshot. |
| Daily scheduled review | Native background work is best-effort and only settles a pending Timeline check. It does not evaluate unchanged long-term state or tracking silence. | Missing | Add independent cadence using the same review module and dedupe policy. |
| Default plan-success evaluation | Shipped composition always installs `createFatLossTimelineRiskAssessment`. Its snapshot contains Goal contract + Timeline only, not Active Plan or Ledger. Non-fat-loss goals return insufficient evidence. | Missing for requested semantics | Replace the production seam; do not wrap the fat-loss evaluator again. |
| Goal-specific risk | Hypertrophy/physique predicates and comparable measurement logic exist in `goalSpecificRisk`. | Isolated/reference | Migrate policies behind the single default Goal-path interface. |
| Execution continuity and plateau | Logic distinguishes low coverage, repeated execution failure, recovery limitation, inadequate observation and a candidate response plateau. | Isolated/reference | Preserve rules, but build its snapshot from canonical Ledger/Plan outcomes. |
| Current-versus-candidate forecast | Existing replanning computes a semantic Plan diff and directional forecast scenarios. It does not first forecast the current Active Plan and require a candidate to materially improve that forecast. | Missing | Required fixed validation gate after LLM candidate generation. |
| Missing-data semantics | Timeline and nutrition correctly preserve unknown/no-log/partial states; isolated continuity rules do not count missing entries as failures. | Default-wired in foundation; not unified | Carry these semantics into the Ledger and review engine. |
| Agent delivery after a Signal | Explicit adaptation tools can show proposal cards. Generic Hook-created risk artifacts/previews are not consistently attached to the originating thread, and manual Signals do not have a complete notification/card delivery contract. | Partially wired | Separate deterministic decision from channel-specific delivery while preserving one outcome. |
| Preference and memory | Explicit exercise preferences affect Planner ranking; Working memory is versioned, reviewable, pinnable and included in model context. | Partially wired | Reuse storage; add outcome-linked strategy history and executability learning. |
| Learning from actual behavior | No default process links a plan candidate to acceptance, execution burden, duration, response and later selection preference. | Missing | Add plan-outcome history and deterministic features before letting LLM use it. |
| Goal completion and post-goal pause | Phase transition/completion concepts exist, but the requested user-confirmed completion -> maintain/new goal/pause -> record-first loop is not connected. | Partially wired / missing client loop | Implement after Goal-path and Plan deactivation exist. |

## Important naming and ownership decisions

1. Keep **Timeline** as the sole durable history of confirmed Records.
2. Introduce **Daily Health Ledger** as a calculation artifact projected from Timeline. It is not a second event store.
3. Do not reuse `WorkoutExecutionMode = "record_only" | "coach_monitor"` for product planning state. Rename only if needed; otherwise define the product state independently.
4. Define the plan-success question as: “Given this Goal contract, Active Plan, Ledger evidence, Readiness state and remaining time, is the user still on a healthy and executable path?” A meal or missed session is only evidence, never the subject of the judgement.
5. LLM may generate a Plan candidate and explain trade-offs. Fixed modules own nutrient/energy math, goal-path evaluation, safety, invariant checks, material-improvement comparison, stale checks and commit validity.
6. V1 nutrition math only aggregates user-confirmed structured values. Text Agent may fill the shared form but no multimodal/OCR, barcode, food database, food-name/portion inference or meal estimation path is in scope.
7. Realtime Agent is outside this ticket set. Existing motion code is not an implementation dependency; only the source-neutral admission boundary for a future finalized Workout Record must remain available.

## Verified evidence

The audit inspected the shipped mobile composition, not only exported modules. The production account runtime creates `CoachApplication` without a goal-specific risk override, so the default fat-loss evaluator is the actual shipped evaluator.

Verification run on 2026-08-15:

- `npx tsc -p tsconfig.test.json` — passed.
- 52 focused tests across Timeline, Nutrition day ledger, product projection, onboarding, Agent conversation, Timeline risk admission and isolated execution-continuity behavior — 52 passed, 0 failed.
- The combined run that also included the broad workout execution suite did not terminate in the audit window and was interrupted. No pass claim is made for that suite in this baseline; planned-workout capability above is based on the public application flow, existing focused test coverage and source inspection.

## Gate before ticket planning

Before any tickets are published or old tickets are superseded, product confirmation is required for this baseline, especially these conclusions:

1. Timeline and current Record ingress are reused, not rebuilt.
2. The first functional slice starts with an existing Timeline Record producing a plan-independent Daily Health Ledger and visible record-first client result.
3. No-Goal/Plan state is a product projection, not the existing workout `record_only` mode.
4. Existing goal-specific and execution-continuity evaluators count as reference implementations until default composition uses them through one Goal-path interface.
5. Existing first-plan generation does not satisfy the agreed LLM-planning responsibility because it is currently deterministic.
6. Old PRDs and tickets remain untouched until the replacement ticket set is approved.
