# Exercise and Stimulus Knowledge Base

_Version: 1.1.0 | Last updated: 2026-08-08 | Schema: maxpower-exercise-knowledge/v1_

This document is the canonical first-party reference for exercise identity,
stimulus contracts, muscle metadata, recognition capabilities, and programming
knowledge within MaxPower. It is a wiki entry, not a specification or medical
guide.

**Epistemic hygiene**: every claim is tagged as one of:

- **[evidence-fact]** Derived from peer-reviewed literature, accredited
  professional organisation reference (ACE, ACSM, NASM, NSCA, ExRx), or
  validated biomechanical model.
- **[product-rule]** A MaxPower design decision, convention, or threshold.
  Verifiable by reading source code; does not require external citation.
- **[unknown]** Explicitly not established. Must not be filled by inference,
  LLM generation, or marketing material.
- **[safety-boundary]** A conservative product boundary or risk-routing rule;
  not a diagnosis or evidence that an individual is unsafe.
- **[competitor-precedent]** Describes another product's public behaviour. It
  is neither effectiveness evidence nor an executable threshold.

No content in this document constitutes medical, rehabilitation, or injury
advice.

---

## Table of Contents

1. [ExerciseVariant Identity](#1-exercisevariant-identity)
2. [Equipment and Location Availability](#2-equipment-and-location-availability)
3. [StimulusSlot Contracts](#3-stimulusslot-contracts)
4. [Movement Pattern and Expected Muscle Metadata](#4-movement-pattern-and-expected-muscle-metadata)
5. [Bodyweight Difficulty Ladders and Micro-Loading](#5-bodyweight-difficulty-ladders-and-micro-loading)
6. [Ranked Substitutions Across Goals](#6-ranked-substitutions-across-goals)
7. [Custom Exercise Missing-Data Rules](#7-custom-exercise-missing-data-rules)
8. [Technique/Cue Capability Tiers](#8-techniquecue-capability-tiers)
9. [Separation of Layers](#9-separation-of-recognition-profile-trajectory-evidence-expected-muscle-metadata-and-coaching-claims)
10. [Version/Provenance Schema](#10-recommended-versionprovenance-schema)
11. [Registry Gap Analysis](#11-concrete-gaps-in-the-current-65-exercise-registry)
12. [Closed Decisions and Genuine Unknowns](#12-closed-product-decisions-and-genuine-unknowns)

---

## 1. ExerciseVariant Identity

### 1.1 What constitutes a distinct identity

**[product-rule]** An ExerciseVariant in MaxPower is the tuple:

```
movement x variation x equipment/load_mode x support x angle/stance/grip x
unilateral_context x ROM/context
```

Each axis independently creates a separate training/performance identity. Two
entries that differ in leverage, load mode, support, ROM or unilateral context
must not merge load history. Camera position is deliberately excluded: it is an
`ObservationContext` dimension used by the exact motion resolver, not part of
the training-performance identity.

Source: `src/pose/simulatedKinematicPrior.ts` `SimulatedPriorIdentity` and
`CONTEXT.md` "Different equipment, variation, side, setup, or model -> different
identity."

### 1.2 Registry schema

**[product-rule]** The `ExerciseConcept` interface (defined in
`src/pose/exerciseRegistry.ts`) carries:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` (stable snake_case) | Primary key; never renamed after creation |
| `nameZh` / `nameEn` | `string` | Display names; aliases for fuzzy match |
| `muscleGroup` | `MuscleGroup` | Top-level five-way split: chest, back, legs, shoulders, arms |
| `movementPattern` | `MovementPattern` | One of 16 canonical patterns (see section 4) |
| `equipment` | `readonly string[]` | Required equipment items |
| `variationOf` | `string \| null` | Parent exercise ID; forms acyclic tree |
| `maturity` | `ExerciseMaturity` | catalog_only, experimental, validated, suspended |
| `source` | `ExerciseSource` | Name, URL, license of origin |

### 1.3 Evidence maturity is not runtime capability

**[product-rule]**

| Maturity | Meaning | Runtime implication |
|---|---|---|
| `catalog_only` | Catalog metadata only. | None. |
| `experimental` | Some profile or evidence exists but is not promoted. | None by itself. |
| `validated` | A named evidence artifact passed its own release gate. | Still none by itself; the exact resolver must install each capability. |
| `suspended` | Evidence was withdrawn or regressed. | Exact resolver must return the declared fallback. |

Legacy 65-entry registry audit: 14 experimental, 51 catalog_only, 0 validated, 0 suspended
(total: 65).

The only runtime authority is `MotionCapabilityResolver(action × view × exact
profile identity)`. Count/phase, tempo, calibrated trajectory comparison and
evidence-linked cues are independent flags. UI labels are projections of this
set, never a second switch.

### 1.4 Variation trees

**[product-rule]** `variationOf` forms a directed acyclic tree. A child
exercise inherits its parent's movement pattern by convention but may override
muscle emphasis. Examples:

- `dumbbell_bench_press` -> variationOf `barbell_bench_press`
- `incline_dumbbell_press` -> variationOf `dumbbell_bench_press`
- `chin_up` -> variationOf `pull_up`
- `goblet_squat` -> variationOf `bodyweight_squat`

The variation tree is navigational metadata for substitution ranking; it does
**not** authorise transferring load history, recognition profiles, or trajectory
references between parent and child.

### 1.5 Naming and alias conventions

**[product-rule]**

- `id`: lowercase snake_case, alphanumeric + underscore, starts with letter.
  Regex: `^[a-z][a-z0-9_]*$`.
- `aliases`: include common Chinese and English synonyms. Used by
  `matchText()` for recogniser label resolution through longest-match with
  child-specificity preference.
- IDs are permanent. Renaming requires a migration event and tombstone.

---

## 2. Equipment and Location Availability

### 2.1 Current registry representation

**[product-rule]** The current `ExerciseConcept.equipment` field is a flat
`readonly string[]`. Examples:

- `["bodyweight"]`
- `["barbell", "bench"]`
- `["cable machine", "rope attachment"]`
- `["dumbbell or cable"]` (disjunction encoded in a single string)

This representation is sufficient for display and basic filtering but
insufficient for:

- Load ranges and discrete weight increments (e.g. dumbbell pairs available in
  2.5 kg steps from 5-40 kg).
- Temporary unavailability ("this machine is occupied today").
- Location-specific inventories (home gym vs. commercial gym vs. hotel).
- Attachment compatibility (cable machine + bar vs. rope vs. V-bar).

### 2.2 Proposed equipment profile (from research)

**[product-rule]** The workout-generation research document
(`docs/research/2026-08-08-workout-generation-agent-harness.md`) proposes a
richer `EquipmentProfileRevision`:

```ts
interface EquipmentProfileRevision {
  revisionId: string;
  locationId: string;
  validFrom: string;
  inventory: readonly EquipmentInstance[];
}

interface EquipmentInstance {
  equipmentTypeId: string;
  capabilities: readonly string[];
  loadRange?: { min: number; max: number; increment: number; unit: "kg" | "lb" };
  quantities?: number;
  attachments?: readonly string[];
  availability?: "available" | "busy" | "broken" | "unknown";
}
```

This is a design proposal, not yet implemented.

### 2.3 Equipment categories in the current 65-exercise catalog

| Equipment tag | Exercise count | Notes |
|---|---|---|
| bodyweight | 8 | Includes floor mat for glute bridge |
| barbell | 10 | Often requires rack and/or bench |
| dumbbell | 10 | Includes "dumbbell or cable" disjunctions |
| cable machine | 11 | Various attachment requirements |
| machine (specific) | 9 | leg press, leg extension, leg curl, chest press, pec deck, etc. |
| pull-up bar | 2 | pull_up, chin_up |
| bench (as accessory) | 7 | flat, incline, decline, preacher |
| other | 3 | dip station, T-bar, landmine attachment |

**[unknown]** The registry does not currently encode:

- Whether an exercise can be performed with alternative equipment (e.g.
  barbell row can substitute dumbbell rows with a bench).
- Minimum space requirements (e.g. walking lunge requires clear floor path).
- Band-based alternatives for cable exercises.

---

## 3. StimulusSlot Contracts

### 3.1 Definition

**[product-rule]** A StimulusSlot is the training intent for one slot within a
Session Prescription. It describes _what kind of stimulus_ the trainee should
receive, **not** which specific exercise to perform. The concrete exercise
selection is a downstream step that matches available ExerciseVariants against
the slot's contract.

Source: `docs/research/2026-08-08-workout-generation-agent-harness.md` section
3: "Session Prescription: a planned training session containing multiple
Stimulus Slots."

### 3.2 StimulusContract schema

**[product-rule]** The proposed contract (not yet implemented in source code):

```ts
interface StimulusContract {
  movementPattern: string;          // e.g. "horizontal_push"
  primaryMuscles: readonly string[]; // e.g. ["pectorals"]
  secondaryMuscles: readonly string[];
  stabilityDemand: "supported" | "free" | "either";
  unilateral: boolean | "either";
  prescriptionMode: "weighted_reps" | "bodyweight_reps" | "timed";
  repRange?: [number, number];
  targetRir?: number;
  fatigueCostBand: "low" | "medium" | "high";
  lockedFields: readonly string[];   // fields the user has pinned
}
```

### 3.3 Slot resolution rules

**[product-rule]** The resolution pipeline is:

1. **Hard filter**: equipment available at location, no user exclude/pain, goal
   and experience compatible, prescription mode feasible, superset
   equipment/space viable.
2. **Soft ranking**: stimulus similarity, muscle coverage, recent continuity,
   user mastery, more/less preference, equipment transition cost, novelty
   budget, optional camera observation capability.
3. **Substitution**: when the original exercise becomes infeasible (equipment
   busy, pain, user preference), find the best candidate that satisfies the
   **same StimulusContract**. Never copy load values from the original exercise
   to a substitute with different equipment or leverage.

### 3.4 Relationship to ExerciseVariant

```
Session Prescription
  └── Stimulus Slot 1: "horizontal push, chest primary, supported, 8-12 reps, 2 RIR"
       └── Resolved to: machine_chest_press (equipment available, user history)
  └── Stimulus Slot 2: "vertical pull, back primary, free, 6-10 reps, 2 RIR"
       └── Resolved to: pull_up (bodyweight progression, user capable)
```

**[product-rule]** The slot is immutable within a Plan Revision. Changing the
slot's intent requires a new Plan Revision. Swapping the resolved exercise
while preserving the slot is an exercise substitution, not a plan change.

---

## 4. Movement Pattern and Expected Muscle Metadata

### 4.1 Movement pattern taxonomy

**[product-rule]** MaxPower uses 16 canonical movement patterns
(`src/pose/exerciseRegistry.ts`):

| Pattern | Example exercises | Primary muscle region |
|---|---|---|
| `horizontal_push` | bench press, push-up, cable fly | Chest, anterior deltoids, triceps |
| `horizontal_pull` | barbell row, seated row, face pull | Back (mid), posterior deltoids, elbow flexors |
| `vertical_push` | shoulder press, landmine press, chest dip | Shoulders, triceps |
| `vertical_pull` | lat pulldown, pull-up, straight-arm pulldown | Lats, elbow flexors |
| `squat` | bodyweight squat, leg press, walking lunge | Quadriceps, gluteals, hamstrings |
| `hip_hinge` | Romanian deadlift, hip thrust, back extension | Gluteals, hamstrings, spinal erectors |
| `shoulder_abduction` | lateral raise, cable Y raise, upright row | Medial deltoids |
| `shoulder_flexion` | front raise | Anterior deltoids |
| `shoulder_horizontal_abduction` | rear delt fly | Posterior deltoids |
| `shoulder_external_rotation` | cable external rotation | Rotator cuff |
| `elbow_flexion` | biceps curl variants | Elbow flexors |
| `elbow_extension` | triceps pushdown, skull crusher | Triceps |
| `knee_flexion` | leg curl variants | Hamstrings |
| `knee_extension` | leg extension | Quadriceps |
| `ankle_plantarflexion` | calf raise | Calves |
| `locomotion` | march in place, side step-touch, step jack | Varies (full body / cardio) |

### 4.2 Expected muscle association catalog

**[product-rule]** The expected muscle association catalog
(`src/pose/expectedMuscleAssociationCatalog.ts`) contains 53 seed associations
covering all 65 exercises. Each association carries:

- **claimLevel**: always `"expected_participation"` -- never activation
  percentage or force.
- **contextRequirement**: always `"exact_exercise_identity"` -- never
  transferable across variations without explicit re-curation.
- **evidenceStatus**: `"exact_exercise_reference"` (ACE, ExRx, etc. page for
  this specific exercise) or `"curated_general_reference"` (movement-pattern-
  level knowledge applied to this exercise).
- **muscles**: array of `{ muscleId, role: "primary" | "secondary" | "stabilizer" }`.
- **phases**: typically two phases (e.g. "lowering"/"pressing", "pulling"/
  "returning") each with:
  - `expectedJointMotions`: observable joint actions in 2D video
  - `expectedMechanicalContributors`: muscles expected to contribute in that
    phase
  - `interpretationZh`: Chinese text stating the evidence boundary
- **disclaimerZh**: always states that the camera cannot directly measure
  muscle activation.

### 4.3 Muscle taxonomy

**[evidence-fact]** The 21-muscle taxonomy used by MaxPower
(`src/pose/expectedMuscleAssociationCatalog.ts` `MuscleId`):

| Region | Muscle IDs | Granularity note |
|---|---|---|
| Lower body | quadriceps, gluteals, hamstrings, calves, hip_flexors, hip_abductors, hip_adductors | Groups, not individual muscles. "Quadriceps" = rectus femoris + vasti as a unit. |
| Chest | pectorals | Combined pec major/minor. No upper/lower/inner split. |
| Shoulders | anterior_deltoids, medial_deltoids, posterior_deltoids | Three-head split reflects distinct movement patterns. |
| Back | latissimus_dorsi, scapular_retractors, upper_trapezius, lower_trapezius | Scapular retractors = rhomboids + mid trapezius. |
| Arms | triceps, elbow_flexors | "Elbow flexors" = biceps brachii + brachialis + brachioradialis as a unit. |
| Rotator cuff | rotator_cuff | SITS muscles as a unit. |
| Core | spinal_erectors, serratus_anterior, trunk_stabilizers | "Trunk stabilizers" = rectus abdominis + obliques + transverse abdominis. |

**[evidence-fact]** Sources for anatomical groupings: ACE Exercise Library
(https://www.acefitness.org/resources/everyone/exercise-library/), ACSM free
weights guidelines
(https://www.acsm.org/docs/default-source/files-for-resource-library/selecting-and-effectively-using-free-weights.pdf).

**[product-rule]** The muscle taxonomy is deliberately coarse. Finer splits
(e.g. upper vs. lower pectorals, vastus medialis vs. lateralis) would require
3D or EMG evidence that 2D video cannot provide.

### 4.4 Phase structure conventions

**[product-rule]** Shared phase templates in the muscle association catalog:

| Template | Phase IDs | Used by |
|---|---|---|
| `HORIZONTAL_PRESS_PHASES` | lowering, pressing | bench press, dumbbell press, incline press, machine press, push-up, decline bench, close-grip bench |
| `CHEST_FLY_PHASES` | opening, closing | cable fly, pec deck fly |
| `ROW_PHASES` | pulling, returning | barbell row, one-arm row, chest-supported row, single-arm cable row, T-bar row, rear delt row |
| `VERTICAL_PULL_PHASES` | pulling, returning | lat pulldown, pull-up, wide-grip pulldown, assisted pull-up, chin-up |
| `STRAIGHT_ARM_PULL_PHASES` | pulling, returning | straight-arm pulldown |
| `SQUAT_PHASES` | lowering, rising | bodyweight squat, barbell squat, leg press, front squat, goblet squat |
| `HIP_HINGE_PHASES` | lowering, rising | Romanian deadlift, conventional deadlift, back extension, glute bridge |
| `LUNGE_PHASES` | lowering, rising | walking lunge, Bulgarian split squat |
| `SHOULDER_PRESS_PHASES` | lowering, pressing | seated shoulder press, dumbbell shoulder press, Arnold press, landmine press |
| `LATERAL_RAISE_PHASES` | raising, lowering | lateral raise, single-arm cable lateral raise, cable Y raise, front raise, upright row |
| `REAR_DELT_PHASES` | opening, returning | rear delt fly |
| `FACE_PULL_PHASES` | pulling, returning | face pull |
| `CURL_PHASES` | curling, lowering | all biceps curl variants |
| `PUSHDOWN_PHASES` | pressing, returning | triceps pushdown, overhead extension, skull crusher |
| `LEG_EXTENSION_PHASES` | extending, lowering | leg extension |
| `LEG_CURL_PHASES` | curling, extending | leg curl, seated leg curl, lying leg curl |
| `HIP_THRUST_PHASES` | thrusting, lowering | hip thrust |
| `CALF_RAISE_PHASES` | raising, lowering | calf raise |
| Custom locomotion | varies per exercise | march, side step-touch, knee raise, step jack |

### 4.5 Association evidence sources

**[evidence-fact]** The catalog cites 31 sources
(`MUSCLE_ASSOCIATION_SOURCES`), including:

| Source | Kind | Scope |
|---|---|---|
| ACE Exercise Library (multiple exact-exercise pages) | exercise_reference | Exact exercises: bodyweight squat, barbell bench press, dumbbell bench press, incline press, machine chest press, push-up, barbell row, back squat, leg press, Romanian deadlift, conventional deadlift, Bulgarian split squat, leg extension, barbell biceps curl, hammer curl |
| ExRx.net (multiple pages) | exercise_reference | wide-grip lat pulldown, assisted pull-up, hip thrust, single-arm cable lateral raise, cable biceps curl, triceps pushdown |
| NASM Exercise Library | exercise_reference | face pull |
| ACSM free weights guidelines | exercise_reference | General free-weight technique principles |
| Nike calisthenics / home-no-equipment | exercise_reference | Bodyweight exercise categorisation |
| ExerciseAPI v1.1.0 | exercise_reference | Supplementary exercise metadata |
| free-exercise-db | exercise_reference | Open exercise metadata |
| OpenSim inverse dynamics | modeling_boundary | Establishes what inverse dynamics can and cannot determine from video |
| OpenCap (Uhlrich et al. 2023, PLOS Comp Bio) | modeling_boundary | Smartphone video dynamics capabilities and limitations |

---

## 5. Bodyweight Difficulty Ladders and Micro-Loading

### 5.1 Bodyweight progression ladders

**[evidence-fact]** For bodyweight exercises where external load cannot be
incrementally added, progression uses difficulty ladders. The following ladders
are derived from NSCA and ACE bodyweight progression guidelines:

#### Horizontal push (push-up family)

1. Wall push-up
2. Incline push-up (bench or elevated surface)
3. Knee push-up
4. Standard push-up
5. Decline push-up (feet elevated)
6. Diamond push-up / close-grip push-up
7. Archer push-up
8. Single-arm push-up progression

**[unknown]** The current registry contains only `push_up` (standard). The
ladder rungs above and below are not yet registered as separate ExerciseConcept
entries.

#### Vertical pull (pull-up family)

1. Dead hang (timed)
2. Assisted pull-up (machine or band)
3. Negative / eccentric-only pull-up
4. Standard pull-up
5. Chin-up (supinated grip; partially registered as `chin_up`)
6. Wide-grip pull-up
7. L-sit pull-up
8. Weighted pull-up

**[product-rule]** The registry has `pull_up`, `assisted_pull_up`, and
`chin_up`. Band-assisted, negative-only, and weighted variants are not
registered.

#### Squat family

1. Chair-assisted squat / box squat
2. Bodyweight squat (`bodyweight_squat`: registered)
3. Goblet squat (`goblet_squat`: registered)
4. Barbell back squat (`barbell_back_squat`: registered)
5. Front squat (`front_squat`: registered)
6. Bulgarian split squat (`bulgarian_split_squat`: registered; higher
   stability demand)

#### Hip hinge family

1. Glute bridge (`glute_bridge`: registered)
2. Hip thrust (`hip_thrust`: registered)
3. Romanian deadlift (`romanian_deadlift`: registered)
4. Conventional deadlift (`conventional_deadlift`: registered)

**[evidence-fact]** Bodyweight difficulty ladders are well-established in
professional certification curricula. Sources: NSCA Essentials of Strength
Training and Conditioning, 4th ed. (Haff & Triplett, 2016); ACE Personal
Trainer Manual, 6th ed. (2020).

### 5.2 Micro-loading and equipment increment constraints

**[competitor-precedent]** RP's public help material uses a 10 lb → 15 lb
dumbbell example to explain why rep progression may be preferable when the next
increment is too large. This does not establish a universal 10% safety or
physiology threshold. MaxPower's allowable increase remains a versioned
`ProductPolicy` constrained by the user's mandate and equipment increments.

Large relative increments are especially visible with:

- **Dumbbell pairs**: common commercial gym increments of 2.5 kg (5 lb) per
  dumbbell, which represents a 25% jump for a 10 kg lateral raise.
- **Fixed-weight machines**: stack increments of 5 kg (10 lb) or more.
- **Barbell loading**: minimum 2.5 kg (two 1.25 kg plates), but many gyms lack
  fractional plates.

Source: RP Strength help center -- "if next equipment increment is too large
(e.g., 10 lb to 15 lb dumbbell), use rep progression instead"
(https://help.rpstrength.com/hc/en-us/articles/32600173777815).

**[product-rule]** MaxPower's proposed progression rule (from
`docs/research/2026-08-08-hypertrophy-rules-agent-harness.md`):

> When the next discrete equipment increment exceeds the CoachingMandate's
> `maxLoadIncreasePercent`, the system uses rep progression instead of weight
> progression: add one rep per set at the current weight until the top of the
> rep range, then attempt the weight increase.

**[product-rule]** Micro-loading strategies:

| Strategy | Condition | Action |
|---|---|---|
| Weight increase | Next increment <= mandate limit AND RIR consistently above target | Increase by one equipment increment |
| Rep progression | Next increment > mandate limit OR insufficient evidence | Add 1 rep/set at current weight |
| Set progression | Rep range topped out, weight cannot increase | Add 1 set (subject to weekly volume limit) |
| Hold | Conflicting evidence, pain, or missing data | Maintain current prescription |

**[unknown]** Fractional plate availability, magnetic micro-plates, or
resistance band add-ons are not modelled in the current equipment schema.

---

## 6. Ranked Substitutions Across Goals

### 6.1 Substitution is stimulus-preserving, not exercise-name-matching

**[product-rule]** Exercise substitution in MaxPower must preserve the
StimulusContract of the original slot. The substitution ranking varies by
training goal because different goals weight the contract dimensions
differently.

### 6.2 Ranking dimensions

| Dimension | Hypertrophy weight | Strength weight | Fat-loss weight |
|---|---|---|---|
| Movement pattern match | High | Highest | Medium |
| Primary muscle coverage | Highest | High | High |
| Load/intensity capability | High | Highest | Low |
| Stability demand match | Medium | High | Low |
| Equipment transition cost | Medium | Medium | High (superset-friendly) |
| Rep range compatibility | High | Highest | Medium |
| Unilateral match | Medium | Medium | Low |
| Fatigue cost band | High | Medium | High |
| Camera observation capability | Bonus only | Bonus only | Bonus only |
| User history with candidate | Medium | Medium | Low |

**[product-rule]** Camera observation capability (whether an exact recognition
profile exists for the candidate) is always a **bonus** factor, never a hard
filter or dominant ranking signal. Training suitability always outweighs
observation convenience.

### 6.3 Substitution examples by goal

#### Hypertrophy: barbell bench press unavailable

| Rank | Substitute | Rationale |
|---|---|---|
| 1 | dumbbell_bench_press | Same pattern, same primary muscles, free-weight stability |
| 2 | machine_chest_press | Same pattern, supported stability -- acceptable if trainee prefers |
| 3 | incline_dumbbell_press | Same pattern, shifts emphasis to upper pec/anterior delt |
| 4 | cable_chest_fly | Different pattern (isolation), same primary muscle |

#### Strength: barbell back squat unavailable

| Rank | Substitute | Rationale |
|---|---|---|
| 1 | front_squat | Same pattern, barbell, high load potential |
| 2 | leg_press | Same pattern, machine, very high load potential |
| 3 | goblet_squat | Same pattern but limited load ceiling |
| 4 | bulgarian_split_squat | Same pattern, unilateral -- stability demand mismatch |

#### Fat loss: lat pulldown unavailable

| Rank | Substitute | Rationale |
|---|---|---|
| 1 | assisted_pull_up | Same pattern, sustainable in circuits |
| 2 | wide_grip_lat_pulldown | Same pattern (variation), if different machine available |
| 3 | seated_row | Different pattern but similar muscle coverage, circuit-friendly |

**[product-rule]** Substitution never copies the absolute load from the
original exercise to the substitute. A different ExerciseVariant always starts
with its own performance baseline or a conservative cold start.

### 6.4 Substitution output contract

**[product-rule]** Each substitution candidate must return (proposed, not yet
implemented):

- Candidate exercise and satisfied/deviated StimulusContract fields
- Required equipment and feasible weight range
- Whether comparable history exists
- Whether prescription needs cold start
- Impact on weekly stimulus, session time, and fatigue
- Camera observation support and its exact capability boundary
- Structured reason codes (not just natural language)

---

## 7. Custom Exercise Missing-Data Rules

### 7.1 Fitbod precedent

**[evidence-fact]** Fitbod's public documentation states that custom exercises,
even when tagged with muscle groups, do not automatically receive weight, rep,
or progression recommendations. This confirms that exercise identity and
trusted history must be precise; a muscle-group label alone is insufficient for
programming.

Source: Fitbod Metrics & Records help article
(https://help.fitbod.me/hc/en-us/articles/12732749777047).

### 7.2 MaxPower rules for custom / new exercises

**[product-rule]** When a user adds a custom exercise or selects an exercise
with no prior history:

| Data state | System behaviour |
|---|---|
| No load history for this ExerciseVariant | Conservative cold start. No load suggestion. User enters first working weight. |
| Load history exists for a variation parent | Display parent history as reference only. Do not auto-transfer load. |
| No recognition profile | Camera counting disabled. User reports reps manually. Rep disposition is `user_reported`. |
| No muscle association entry | Display "muscle association unknown". Do not guess. Exercise excluded from muscle recovery projection until manually mapped. |
| No simulated kinematic prior | No camera position recommendation. Default to user choice. |
| Incomplete equipment specification | Exclude from equipment-constrained plan generation. User can still select manually. |

**[product-rule]** The four kinds of exclusion are semantically distinct
(source: workout-generation research doc):

1. **User cannot do**: physical limitation or injury. Highest priority.
2. **User does not like**: preference. Respected in recommendations, overridable.
3. **Equipment unavailable today**: temporary. Does not affect future sessions.
4. **Do not recommend (exclude)**: soft ban on AI recommendation. User can still
   manually add.

These must not share a single boolean field.

---

## 8. Motion Capability Set and cue boundary

### 8.1 Independent capabilities

**[product-rule]** Runtime capability is an exact resolver result, not a Tier:

| Capability | Required exact evidence | Fallback when absent |
|---|---|---|
| `countPhase` | Executable RecognitionProfile selected by the canonical Rust engine | Manual record or video only |
| `tempo` | Canonical confirmed boundaries with compatible timing schema | Count only or manual record |
| `calibratedTrajectoryComparison` | Same-context calibrated reference identity and supported observed metrics | No comparison |
| `evidenceLinkedCue` | Calibrated comparison plus reviewed cue mapping for that finding | No technique cue |

One capability does not imply another. A catalog maturity field, simulated
initializer or general LLM instruction cannot promote the set.

### 8.2 Current cue implementation boundary

**[product-rule]** Generic LLM text from `src/agent/coach.ts` and current
`live-cue` transport support are not evidence-linked CoachingClaims. Until an
exact cue mapping is installed, they may explain recording or setup state but
must not claim a technique correction. A stable user-facing label such as
“仅计次节奏” is computed from `MotionCapabilitySet`.

### 8.3 What 2D video can and cannot support for cues

**[evidence-fact]** Based on the project's own 2D observability research
(`docs/reports/2d-pose-observability-and-phase-alignment-2026-08-05.md`) and
CONTEXT.md:

| Observable (with matching profile) | Not observable |
|---|---|
| Relative joint angle projection | True 3D joint angles |
| Bilateral timing and rhythm | Muscle activation or "which muscle is working" |
| Path continuity and trajectory shape | Load, force, or actual resistance |
| Rep tempo and phase timing | Scapular or spinal state behind occlusion |
| Height and lateral displacement | Injury risk or medical conclusions |
| Torso lean (angle vs. vertical) | Internal rotation under occlusion |

**[product-rule]** Cues must only reference observable evidence. "Your right
elbow projection is 12 degrees wider than your reference corridor" is
permissible. "Your chest isn't activating properly" is never permissible.

---

## 9. Separation of Recognition Profile, Trajectory Evidence, Expected Muscle Metadata, and Coaching Claims

### 9.1 Four distinct layers

**[product-rule]** MaxPower maintains strict separation between four types
of exercise knowledge. They are produced by different systems, have different
evidence requirements, and must never be conflated.

```
Layer 1: Recognition Profile
  Source: Rust canonical engine
  Purpose: Rep segmentation, counting, anti-interference
  Output: Confirmed/needs-review/rejected rep boundaries
  NOT: A standard-form reference, quality score, or coaching tool

Layer 2: Trajectory Evidence
  Source: Canonical packet + calibrated prior
  Purpose: Descriptive comparison of observed motion against same-context reference
  Output: Quality evidence cards, feature corridors, deviation observations
  NOT: A correctness verdict, activation measurement, or injury risk assessment

Layer 3: Expected Muscle Metadata
  Source: Curated catalog from professional references (ACE, ExRx, NASM, etc.)
  Purpose: Display which muscles are expected to participate in this movement
  Output: Primary/secondary/stabilizer roles, phase-level mechanical contributors
  NOT: An observation of what happened during this specific rep or set

Layer 4: Coaching Claims
  Source: Expert-reviewed cue mappings linked to trajectory evidence
  Purpose: Actionable verbal guidance during training
  Output: Short, evidence-bounded cues referencing observable deviations
  NOT: Medical advice, activation percentage, injury diagnosis, or form score
```

### 9.2 Invariants

**[product-rule]** From CONTEXT.md and the canonical packet contract:

1. **Recognition profile is not a form reference.** It configures rep
   segmentation, not technique evaluation. A simulated initializer profile may
   count reps but must never be presented as a correctness claim.
2. **Trajectory evidence is descriptive, not prescriptive.** "Your elbow angle
   at peak was 15 degrees outside your reference corridor" is evidence.
   "Your form is bad" is a claim that trajectory evidence cannot support.
3. **Muscle metadata is expected participation, not observed activation.** The
   camera sees joint trajectories, not muscles. The disclaimer "摄像头只能观察关
   节轨迹，不能直接测量肌肉激活" must accompany every muscle association display.
4. **Coaching claims require calibrated trajectory evidence.** An uncalibrated
   or simulated prior cannot generate technique cues. An exercise may display
   separately sourced expected-muscle metadata, but rep count and coaching
   feedback remain independently gated by `MotionCapabilitySet`.

### 9.3 Canonical packet boundaries

**[product-rule]** The Rust canonical packet (`src/motion/motionPacket.ts`)
carries:

- Frame-level pose landmarks with source, confidence, and continuity
- Rep boundaries (start, peak, end timestamps and frame IDs)
- Rep disposition (confirmed, needs_review, rejected) with evidence reason
- Observation findings (primary_range_below_expectation,
  secondary_range_below_expectation, cycle_faster_than_expected)
- Profile identity and hash for provenance
- Quality verdict: always `null` (never a form score)

TypeScript consumers decode and render these outcomes. They must not recompute
rep boundaries, re-segment motion, or fabricate landmarks.

---

## 10. Recommended Version/Provenance Schema

### 10.1 Exercise catalog versioning

**[product-rule]** Recommended schema for exercise catalog versioning:

```ts
interface ExerciseCatalogVersion {
  schemaId: "maxpower-exercise-catalog/v1";
  version: string;              // semver
  generatedAt: string;          // ISO 8601
  exerciseCount: number;
  contentHash: string;          // SHA-256 of deterministic serialisation
  sources: readonly {
    name: string;
    url: string | null;
    license: string;
    accessedAt: string;         // when the source was last verified
  }[];
}
```

### 10.2 Muscle association versioning

**[product-rule]** Already defined as
`EXPECTED_MUSCLE_ASSOCIATION_SCHEMA = "maxpower-expected-muscle-associations/v1"`.

Each association should carry:

```ts
interface MuscleAssociationProvenance {
  catalogSchemaVersion: string;
  exerciseId: string;
  evidenceStatus: "exact_exercise_reference" | "curated_general_reference";
  sourceIds: readonly string[];     // references into MUSCLE_ASSOCIATION_SOURCES
  curatedBy: string;                // "project-authored" or contributor ID
  curatedAt: string;                // ISO 8601
  reviewedAt?: string;              // last expert review date
}
```

### 10.3 Recognition profile versioning

**[product-rule]** Already implemented. Each profile carries:

- `identity`: `"simulated-${exerciseId}/${position}/${side}/initializer/v1"`
  or observed format like `"${identity}/wrist-spread-cycle/v2"`
- `contentHash`: bigint
- `maturity`: `"provisional"` (only value currently used)
- `schema`: `"blazepose33"`
- Coordinate unit, state machine ID, signal configuration

### 10.4 Simulated kinematic prior versioning

**[product-rule]** Already implemented:

- `schemaVersion`: `"maxpower-five-split-prior-workflow/v1"`
- `generatorVersion`: `"piecewise-cosine/v1"`
- `featureSchemaId`: `"simulated-kinematic-features/v1"`
- Identity tuple: exercise, muscle group, variation, equipment, capture
  position, training side, setup fingerprint, coordinate system, projection
  class, pose model version

### 10.5 Rule pack versioning

**[product-rule]** From the hypertrophy-rules research document: every Plan
Revision, Proposal, and Session Prescription must pin:

```ts
interface VersionPins {
  schema: string;       // event/command schema version
  compiler: string;     // rule engine version
  rulePack: string;     // hypertrophy/strength/fat-loss rule bundle digest
  catalog: string;      // exercise catalog content hash
}
```

Active mesocycles pin their rule pack. Rule upgrades produce migration
proposals; they do not silently rewrite active plans.

---

## 10.3 Domain glossary used by Wiki and runtime

| Term | Canonical meaning |
|---|---|
| `PlanRevision` / `SessionPrescription` | Planned intent; never performed data |
| `SetOutcome` / performance | What the user actually recorded or confirmed |
| `Timeline` | Multi-source facts that actually occurred |
| Activity Log | UI flow for adding activity; it commits a Timeline fact, not a second ledger |
| `RecognitionProfile` | Exact rep segmentation/count configuration |
| `ReferenceTrajectoryProfile` | Same-context comparison evidence; never a RecognitionProfile |
| `ObservationContext` | Camera view and capture conditions; not load-history identity |

## 11. Concrete Gaps in the Current ~65-Exercise Registry

The 65-entry `src/pose/exerciseRegistry.ts` remains the legacy motion/capture
registry. The installed planning catalog is now the separate typed
`maxpower.exercise-catalog` pack with 379 exact variants. The two counts must
not be merged: catalog availability does not imply a RecognitionProfile or any
runtime motion capability.

### 11.1 Missing exercise families

| Family | Gap | Impact |
|---|---|---|
| Core / abdominals | No dedicated core exercises (plank, crunch, leg raise, cable crunch, ab wheel). `trunk_stabilizers` muscle ID exists but no primary exercises target it. | Cannot program core-focused sessions or core warm-ups. |
| Chest dip (triceps emphasis) | `chest_dip` exists but no triceps-emphasis dip variant. | Triceps-focused dip stimulus cannot be distinctly programmed. |
| Trap-focused exercises | No shrug, farmer's walk, or direct upper trap work. | Upper trap stimulus gap in shoulder/pull days. |
| Forearm / grip | No wrist curl, reverse curl (as forearm-primary), or grip work. | Cannot program grip-intensive blocks or forearm specialisation. |
| Rotator cuff (additional) | Only `cable_external_rotation`. No internal rotation, prone Y/T/W, or band pull-apart. | Insufficient prehab/warm-up variety for shoulder health. |
| Glute isolation | No cable kickback, hip abduction machine, or banded work. | Limited glute isolation options beyond hip thrust/glute bridge. |

### 11.2 Missing bodyweight progressions

| Base exercise | Missing rungs | Priority |
|---|---|---|
| `push_up` | Wall, incline, knee, decline, diamond, archer | High -- essential for home/bodyweight programming |
| `pull_up` | Band-assisted, negative-only, wide-grip, weighted | High -- pull-up progression is a core trainee goal |
| `bodyweight_squat` | Pistol squat, shrimp squat, jump squat | Medium |
| `glute_bridge` | Single-leg glute bridge | Medium |
| `chest_dip` | Bench dip, weighted dip | Medium |

### 11.3 Missing equipment variants

| Exercise | Missing variant | Equipment |
|---|---|---|
| lateral_raise | Machine lateral raise | Lateral raise machine |
| leg_curl | Nordic hamstring curl | Bodyweight + partner/pad |
| calf_raise | Seated calf raise vs. standing | Separate machines |
| shoulder_press | Standing barbell OHP | Barbell + rack |
| row variants | Pendlay row | Barbell (distinct tempo/form) |
| deadlift variants | Sumo deadlift, trap bar deadlift | Barbell / trap bar |

### 11.4 Recognition and trajectory gaps

| Status | Count | Exercises |
|---|---|---|
| experimental (profile exists) | 13 | march_in_place, side_step_touch, alternating_knee_raise, step_jack, barbell_row, pull_up, lat_pulldown, seated_row, straight_arm_pulldown, bodyweight_squat, seated_shoulder_press, lateral_raise, rear_delt_fly, face_pull |
| catalog_only (no profile) | 52 | All others |
| validated | 0 | None. No exercise has completed calibration + held-out validation. |

**[product-rule]** The CONTEXT.md priority is to validate front lateral raise
or rear lat pulldown first, as these have the strongest local replay evidence.

### 11.5 Muscle association evidence gaps

| Gap | Exercises affected |
|---|---|
| No exact-exercise ACE/ExRx source | chest_dip, pec_deck_fly (ACE source exists for pec deck but mapped to cable_chest_fly parent), Arnold press, upright row, most curl/pushdown variants |
| Phase structure uses shared template without exercise-specific joint motion notes | All exercises using shared templates inherit generic `interpretationZh` |
| Missing locomotion muscle associations | march_in_place, side_step_touch, alternating_knee_raise, step_jack use pattern-level associations without per-exercise validation |

### 11.6 Equipment model gaps

| Gap | Detail |
|---|---|
| No load range data | Registry stores equipment names but not weight increments or load ranges |
| No location binding | Equipment is per-exercise, not per-location |
| No temporary availability | No way to mark equipment as busy/broken |
| Disjunctive equipment | "dumbbell or cable" encoded as a single string, not a structured OR |
| No attachment modelling | Cable machine exercises don't specify required attachments |

### 11.7 View gating and capture position gaps

**[product-rule]** All 65 exercises have capture position recommendations in
`src/pose/viewGating.ts`, but only 14 experimental exercises have recognition
profiles that actually use these positions.

---

## 12. Closed product decisions and genuine unknowns

The August 8 product discussion closed the former placeholder questions:

1. Core, cardio, mobility and recovery activities belong in the v1 offline
   catalog; inclusion never implies camera capability.
2. Bodyweight progression is a separate exact-variant directed graph. Edges
   name the changed leverage/support/ROM dimension; there is no global ladder
   or kilogram equivalence.
3. Exercise eligibility uses typed `EquipmentRequirement`; a user's
   `EquipmentProfileRevision` supplies location-specific inventory and
   availability. `all` and `any` express conjunction/disjunction.
4. `StimulusContract` includes fatigue cost and locked fields. Goal-specific
   substitution weights live in versioned Goal/Rule packs, not free-form LLM
   text and not an opaque user-specific formula.
5. Evidence-linked cues ship only for exact validated capability tuples.
   Designing a broad vocabulary does not authorize unsupported actions.
6. Custom exercises remain unmapped and manual-recording-only until exact
   metadata or evidence is explicitly reviewed; pattern neighbours are not
   silently inherited.
7. Catalog hashes are deterministic on every build. A semantic version changes
   only with an intentional additive/deprecation migration; historical pins
   remain replayable.
8. Exact variants replace deep inheritance as the performance identity.
   Navigation parents may exist, but never transfer load or motion evidence.
9. Locomotion subtypes remain exact variants under a broad pattern until
   evidence shows that Planner rules need a new pattern contract.

Genuine research queue items remain: exact source coverage for trap/forearm
roles, validation evidence for motion profiles, real equipment increments by
location, and whether review timestamps need a formal expiry policy. These are
stored as `Unknown`; none may enter an automatic rule or user-facing
effectiveness claim before review.
