# Nutrition Strategy Knowledge Base

> **Status:** proposed first-party knowledge pack
> **Version:** `nutrition-strategy.v1-draft`
> **Reviewed through:** 2026-08-08
> **Product scope:** healthy adults doing resistance training, from novice to experienced recreational lifters
> **Out of scope:** diagnosis, treatment, rehabilitation nutrition, pregnancy/lactation nutrition, eating-disorder treatment, disease-specific diets, complete food database, supplements and competition weight cutting

This document separates scientific evidence from product policy. It is not a medical guideline and must not be presented as one. A numeric value marked **product rule** is an explainable implementation default, not a universal physiological threshold.

## 1. Evidence vocabulary

| Label | Meaning in this knowledge pack |
|---|---|
| **Evidence fact** | Directly supported by a formal position/consensus statement, government guideline, systematic review or original human study. |
| **Product rule** | A conservative implementation choice derived from evidence but not itself validated as the uniquely correct algorithm. It must be versioned and overridable. |
| **Unknown** | Evidence is insufficient, population-specific or too noisy for a deterministic claim. The Agent must expose uncertainty rather than fill the gap. |
| **Safety boundary** | The Agent must refuse automation, pause changes or direct the user to qualified help. |

Evidence applies to populations similar to those studied. Most resistance-training nutrition studies are short, small, and disproportionately represent healthy younger adults. Do not silently generalize their numeric estimates to children, pregnancy, frail older adults, elite weight-class athletes or people with medical conditions.

## 2. Foundational evidence

1. Sustained energy deficit is the primary driver of fat loss; sustained surplus supports lean-mass gain, but the magnitude and composition of gain depend on the surplus and training status. Different macronutrient patterns can produce similar body-composition outcomes when energy and adherence are comparable. **Evidence fact.** ([S1])
2. In a small eight-week trial of trained lifters, estimated maintenance, 5% surplus and 15% surplus produced similar changes in most strength and measured muscle-size outcomes, while faster mass gain was more clearly related to increased skinfold thickness. The authors recommend conservative surplus/rate-of-gain targets and explicitly note large individual variation. **Evidence fact; low-to-moderate certainty because only 17 participants completed the trial.** ([S2])
3. For healthy exercising adults, ISSN considers about 1.4–2.0 g protein/kg body mass/day sufficient for most people. Its position stand suggests 20–40 g or about 0.25 g/kg per serving, distributed roughly every 3–4 hours, while acknowledging age and meal context. **Evidence fact.** ([S3])
4. A meta-regression of resistance-training studies estimated a protein-response breakpoint near 1.62 g/kg/day, with a wide 95% confidence interval of 1.03–2.20 g/kg/day. It did not find additional average fat-free-mass gain above the breakpoint. **Evidence fact; this is a population estimate, not an individual hard ceiling.** ([S4])
5. During hypocaloric phases, lean resistance-trained athletes may require more protein. A systematic review proposed 2.3–3.1 g/kg fat-free mass/day, scaled upward with leanness and deficit severity; ISSN repeats this range for lean resistance-trained people. **Evidence fact with narrow applicability.** ([S3], [S5])
6. In athletes, a randomized comparison targeting about 0.7% versus 1.4% body-mass loss per week favored the slower condition for lean-mass and strength-related outcomes. **Evidence fact; small athletic sample and not a general obesity-treatment threshold.** ([S6])
7. The ACSM/Academy/Dietitians of Canada position recommends matching carbohydrate availability to training demand rather than applying one fixed high-carbohydrate target. Its broad daily ranges are about 3–5 g/kg for light activity and 5–7 g/kg for moderate exercise around one hour/day, with higher ranges for high-volume endurance work. **Evidence fact; broad ranges, not resistance-training minimums.** ([S7], [S8])
8. The same sports-nutrition position describes athletes' fat intake as commonly 20–35% of total energy. WHO's public-health guidance says adults should receive at least 15% of energy from fat and generally no more than 30% to reduce unhealthy weight gain, with unsaturated fats preferred and saturated/trans fats limited. **Evidence fact; WHO's upper bound is a population-health recommendation, not a sports-performance ceiling.** ([S7], [S9])
9. Intermittent energy restriction/diet breaks have not consistently improved fat loss or fat-free-mass retention versus continuous restriction. In the ICECAP randomized trial, the two approaches produced similar body composition and performance, though intermittent restriction improved some appetite measures. A smaller refeed trial reported better fat-free-mass retention, illustrating uncertainty rather than a universal advantage. **Evidence fact.** ([S10], [S11])
10. Low energy availability can impair physiological and psychological function, health and performance in people of any gender. The IOC emphasizes that REDs is a clinical, multifactorial diagnosis and that no single self-reported energy-availability value should diagnose it. **Evidence fact.** ([S12])
11. Adherence is a causal interpretation problem: failure to observe an expected trend does not prove that maintenance energy changed. Modeling of trial data found intermittent non-adherence could account for early plateaus, and NIDDK recommends regular monitoring, feedback and plans adapted to the person's preferences and barriers. **Evidence fact supporting an adherence gate, not a validated percentage threshold.** ([S13], [S14])

## 3. Required inputs and confidence

The Strategy Engine must never invent missing measurements. It can produce a provisional strategy from a minimum profile, then increase confidence as observations accumulate.

### 3.1 Minimum profile

- Adult age confirmation.
- Current body mass and desired direction: gain, maintain or lose.
- Primary training goal: hypertrophy, strength, or fat loss with lean-mass retention.
- Approximate weekly training frequency, training duration and presence of endurance work.
- User-selected dietary preferences/restrictions, recorded as preferences rather than nutritional facts.
- Safety screening declarations in section 10.

### 3.2 Optional professional inputs

- Estimated maintenance energy or reasonably complete intake history.
- At least 7–14 days of standardized body-mass observations.
- Fat-free mass estimate and its method/date.
- Training-day schedule, demanding sessions and deload weeks.
- Menstrual/reproductive-health observations only when the user explicitly chooses to provide them; treat as sensitive data.
- Dietitian/clinician-provided constraints, stored as external professional directives that outrank product defaults.

### 3.3 Confidence rules

- A calculated maintenance value without observed intake and weight trend is `provisional`.
- Self-reported intake is an observation with uncertainty, not ground truth.
- Wearable calorie expenditure is not accepted as measured energy expenditure; it may explain activity changes but must not directly set calories.
- Body-fat and fat-free-mass estimates retain source, date and method. If absent, do not fabricate FFM-dependent protein targets.

## 4. Goal-specific starting strategies

The following are **product rules** for healthy adults. Every generated target must preserve the evidence source, rule-pack version, input snapshot and whether it is provisional.

| Goal pack | Starting energy target | Desired trend | Protein | Notes |
|---|---:|---:|---:|---|
| Hypertrophy | estimated maintenance `+5%`; optionally up to `+10%` for novices after trend review | about `+0.25%` body mass/week; allow up to `+0.5%` only for less-trained users who accept more fat-gain risk | `1.6–2.2 g/kg/day` | Advanced trainees begin at the low end of surplus and trend. Large surplus is never sold as faster muscle gain. ([S2], [S3], [S4]) |
| Strength, stable weight | estimated maintenance to `+5%` | approximately stable to slow gain | `1.6–2.0 g/kg/day` | Strength gain does not require body-mass gain in all users. Choose maintenance for weight-class or stable-weight preference. ([S2], [S3], [S4]) |
| Fat loss with lean-mass retention | estimated maintenance `-10%` to `-20%` | ordinarily `-0.5%` to `-0.75%` body mass/week; never exceed `-1%` as an automatic target | `1.8–2.2 g/kg body mass/day`; when a credible FFM value exists and the user is lean/trained, expose `2.3–3.1 g/kg FFM/day` as the evidence-based specialist range | Leaner, more advanced users start slower. Resistance training remains part of the plan. ([S1], [S5], [S6]) |

### 4.1 Energy computation hierarchy

1. **Observed maintenance:** infer from a sufficiently complete intake log plus weight trend over at least 14 days.
2. **Known stable intake:** use a user/dietitian-provided stable intake as provisional maintenance.
3. **Equation estimate:** use a documented equation only as a provisional starting estimate. Do not display it as measured expenditure.
4. Apply the goal-pack percentage to the provisional or observed maintenance.
5. Evaluate the result against safety screening, protein/fat feasibility and user schedule before proposing it.

**Unknown:** no equation or wearable estimate is accurate enough to remove the need for trend-based calibration. The product must not promise exact TDEE.

### 4.2 Why strength is not an automatic bulk

The available surplus trial found similar squat/bench strength changes across maintenance, moderate-surplus and high-surplus conditions while the larger surplus increased skinfolds more clearly ([S2]). Therefore the strength pack uses maintenance by default and adds a small surplus only when the user also accepts body-mass gain, recovery is constrained by insufficient intake, or the plan contains a meaningful hypertrophy objective. This is a **product inference**, not proof that energy never affects strength.

## 5. Macronutrient allocation

### 5.1 Protein

1. Set protein first from the active goal pack.
2. Keep the daily target approximately constant on training and rest days. Protein is not the cycling variable.
3. Offer an optional distribution aid: three to five protein-containing eating occasions, generally separated by 3–4 hours, with roughly `0.25–0.4 g/kg` per main meal where practical. This is a usability suggestion, not a requirement for plan success. ([S3])
4. Whole-food adequacy is the default. The knowledge pack does not prescribe supplements.
5. When actual body mass makes a body-mass formula implausibly high, do not silently switch to ideal/adjusted body mass. Mark the calculation unresolved and recommend dietitian input; use credible FFM only when its source is known.

### 5.2 Fat floor

- Default operating range: `20–30%` of total energy.
- **Product floor:** do not automatically propose below `20%` of total energy.
- **Hard boundary:** never automatically propose below the WHO adult minimum of `15%` of total energy. ([S9])
- Prefer unsaturated fat sources in explanations; do not generate disease-treatment claims. WHO advises saturated fat below 10% and trans fat below 1% of energy. ([S9])

The product uses a percentage floor because the high-trust sources reviewed do not establish a universal grams-per-kilogram minimum for this population. A `0.6 g/kg` or similar value must not be introduced as evidence-backed without a future source review.

### 5.3 Carbohydrate

Carbohydrate receives remaining energy after protein and the fat floor. It is then distributed according to training demand.

- Light/rest or technique day: the ACSM broad range is `3–5 g/kg/day`.
- Around one hour/day of moderate training: the broad range is `5–7 g/kg/day`.
- High-volume endurance work may require `6–10 g/kg/day` or more, which is outside the default resistance-training pack and should invoke an endurance-specific pack. ([S7], [S8])

These ranges are **fueling references, not hard minimums**. A fat-loss energy budget may not permit them. In that case, preserve protein and the fat floor, place a larger share of available carbohydrate around the demanding session, and disclose the trade-off rather than exceeding total energy silently.

### 5.4 Training-day/rest-day distribution

**Product rule:** keep the weekly energy goal primary and shift some carbohydrate toward demanding training days.

- Training day: allocate more of the week's carbohydrate before/after the session according to preference and tolerance.
- Rest day: reduce carbohydrate only enough to fund the training-day increase; keep protein stable and preserve fat floor.
- Deload week: reduce carbohydrate only if training energy demand actually falls. A deload is not an automatic crash-diet week.
- If training quality, hunger or adherence worsens, remove day-to-day cycling before reducing weekly energy further.

No reviewed source establishes one correct training/rest-day calorie delta for recreational resistance training. The magnitude is therefore configurable and must be shown as a convenience/fueling decision.

## 6. Optional carbohydrate-cycling preset

`CarbCyclePreset` is an optional schedule representation, not a separate fat-loss mechanism.

### 6.1 Allowed claims

- It can align carbohydrate availability with demanding sessions, preferences or appetite.
- It can make weekly targets easier or harder for a particular person to follow.
- Diet breaks/refeeds may reduce hunger for some people, but trials do not show a consistent body-composition advantage over equivalent continuous restriction. ([S10], [S11])

### 6.2 Forbidden claims

- “Carb cycling burns more fat” independent of weekly energy intake.
- “Low-carb rest days reset hormones/metabolism.”
- “Refeeds prevent metabolic adaptation.”
- “Keto/very low carbohydrate is required for fat loss.”

The ISSN position stand concludes that a wide range of low-fat through low-carbohydrate approaches can improve body composition and that sustained energy balance is the dominant mechanism ([S1]).

### 6.3 Preset invariants

- Default is `off`.
- Protein stays constant across day types.
- The fat floor remains satisfied every day.
- The seven-day energy total stays equal to the non-cycling weekly target unless a separate, auditable calorie Proposal changes it.
- High-carbohydrate days are attached to named demanding sessions, not arbitrary weekdays.
- A rest/low day never becomes fasting, ketogenic or very-low-energy by implication.
- Switching the preset on or off is reversible and cannot rewrite historical intake.

## 7. Weekly trend and adherence adjustment

### 7.1 Observations

Store each weight as an immutable Timeline observation with timestamp, unit, source and measurement conditions where available. Never overwrite raw weights.

**Product rule:**

- Prefer at least three observations/week; daily observations are welcome but not required.
- Compare smoothed seven-day means or medians, never two isolated weigh-ins.
- Normally require two comparable weeks before changing calories.
- Label a trend `low_confidence` when illness, travel, menstrual-cycle water shifts, unusual sodium/carbohydrate intake, missing measurements or a recent diet break may dominate scale weight.

NIDDK supports ongoing monitoring and at least weekly weight checking, but the exact three-observation/two-week policy above is an engineering choice designed to reduce noise, not a published physiological threshold ([S14]).

### 7.2 Adherence gate

Before interpreting an off-target trend, determine whether the user had a reasonable opportunity to follow the strategy.

Inputs may include logged days, meal/energy completeness, user-reported adherence, training completion, travel/illness and hunger. Never infer dishonesty from missing logs.

**Versioned product policy:**

- `insufficient_data`: no calorie change; ask for the smallest missing fact.
- `<70% estimated adherence`: do not reduce calories or add surplus. Help remove barriers or simplify the target.
- `70–85%`: trend can support explanation, but automatic changes remain disabled.
- `>=85%` and a reliable two-week trend: the engine may propose a bounded adjustment.

The percentage bands are conservative product defaults. They are not evidence-derived biological cutoffs and must remain configurable. Evidence only supports the broader principle that adherence and regular feedback materially affect observed weight outcomes ([S13], [S14]).

### 7.3 Bounded adjustment matrix

| Goal | Reliable trend | Proposed action |
|---|---|---|
| Hypertrophy | below lower target for two weeks | add the smaller of `5% current energy` or `200 kcal/day` |
| Hypertrophy | above upper target for two weeks | subtract the smaller of `5% current energy` or `200 kcal/day` |
| Fat loss | losing slower than target for two weeks | subtract the smaller of `5% current energy` or `200 kcal/day`, or propose activity/schedule change; do not stack both automatically |
| Fat loss | losing faster than target for one week with fatigue/hunger/performance decline, or for two weeks without symptoms | add the smaller of `5% current energy` or `200 kcal/day`; assess low-energy-availability signals |
| Strength/stable | meaningful unplanned loss or recovery decline | move toward observed maintenance; do not force a bulk |
| Any | target trend achieved | no change |

Every adjustment is a `NutritionChangeProposal` with evidence window, adherence state, current and proposed values, expected effect, uncertainty, policy version and undo boundary. The `5%/200 kcal` values are **product rules** intended to avoid oscillation; they are not scientifically unique.

### 7.4 Anti-oscillation rules

- Only one primary energy variable changes per review.
- Normal adjustments are at least seven days apart; the default review cadence is 14 days.
- A calorie change never rewrites the original goal or historic plan.
- Weight trend, training performance and recovery are considered together; one noisy source cannot trigger repeated changes.
- If two consecutive adjustments fail despite high-confidence adherence, stop automatic adjustment and request a plan review rather than continuing to ratchet calories.

## 8. Coordination with training periods

| Training state | Nutrition behavior |
|---|---|
| Normal hypertrophy week | Follow active gain target; concentrate available carbohydrate around high-volume sessions. |
| Strength-intensification week | Do not automatically increase total energy; prioritize session fueling and stable body mass unless gain is authorized. |
| Deload | Recompute training-day carbohydrate allocation only if workload decreases; maintain protein and do not create an aggressive deficit. |
| Missed training week | Ask whether the disruption is temporary. Do not automatically cut food from one missed session. |
| Fat-loss phase with falling performance | First check adherence, deficit rate, sleep/recovery and carbohydrate placement. Do not conclude that more training volume is needed. |
| Transition to maintenance | Remove deficit/surplus gradually through bounded Proposals and continue trend review; do not claim a special “reverse dieting” metabolic effect. |

## 9. Explanation contract for the Agent

Every nutrition recommendation must be able to answer:

1. **What changed?** Energy, protein, fat, carbohydrate allocation or schedule.
2. **Why now?** Goal rule, observed trend, adherence, training-period change or user request.
3. **What did not change?** For example, “protein and weekly calories stay the same; only carbohydrate timing changed.”
4. **What is known versus estimated?** Measured weights, self-reported intake, provisional maintenance, or uncertain FFM.
5. **What outcome is expected and when will it be reviewed?** Never promise a body-composition result.
6. **How can it be reversed?** Link to Action Log and prior plan version.

The Agent may translate the rule output into ordinary language, but it cannot invent new thresholds, diagnose a condition or override the Safety Gate.

## 10. Refusal and professional-help boundaries

### 10.1 Refuse automated energy/macronutrient prescription

Do not generate or automatically modify a weight-change strategy when any of the following is known:

- user is under 18;
- pregnancy, trying to conceive where weight loss is requested, or lactation;
- current or suspected eating disorder, purging, laxative/diuretic misuse, compulsive restriction, or fear-driven inability to meet basic intake;
- diagnosed kidney, liver, metabolic/endocrine or other condition materially affected by diet;
- diabetes or glucose-lowering medication requiring dietary coordination;
- bariatric surgery, medically prescribed diet, or active weight-loss medication management;
- clinician has given a conflicting restriction;
- user requests dehydration, vomiting, extreme fasting, “making weight,” or other rapid weight-cutting behavior.

The response should state that the app's general fitness strategy is not appropriate for the disclosed context and suggest a registered dietitian/physician. Do not replace the refused plan with a “safer-looking” numeric prescription. ACSM's position explicitly recommends referral to a registered dietitian/nutritionist for individualized athlete nutrition, and NIDDK recommends clinician review of medical problems and medicines when planning weight loss ([S7], [S14]).

### 10.2 Pause and recommend prompt professional assessment

Pause deficit/surplus automation when the Timeline contains user-reported or observed signals such as:

- fainting, chest pain, severe dizziness, confusion or other acute symptoms;
- rapid unexplained weight change;
- repeated injuries/stress fractures;
- persistent menstrual disruption, libido/reproductive changes, marked cold intolerance or persistent fatigue alongside restriction;
- escalating food anxiety, binge/purge behavior, or inability to eat enough;
- persistent performance decline and recovery failure during continued restriction.

The product must not label these as REDs. IOC states that REDs diagnosis requires expert clinical assessment and exclusion of other causes; serious indicators may require immediate medical attention ([S12]). For urgent symptoms, advise local urgent/emergency care rather than continuing an Agent conversation.

### 10.3 Allowed general guidance after refusal

The Agent may still:

- help the user export Timeline and plan history for a clinician;
- record a clinician/dietitian directive without interpreting it;
- provide neutral product navigation;
- encourage regular eating and stopping extreme restriction without issuing calorie/macronutrient targets;
- explain which data caused the Safety Gate and how that flag can be reviewed.

## 11. Explicit unknowns and future research backlog

1. Optimal energy surplus for hypertrophy is not established; the best direct trial is small and short ([S2]).
2. There is no validated universal weekly calorie-adjustment algorithm for this product's population.
3. Carb cycling has no standardized definition and no high-certainty evidence of superior fat loss when weekly energy/protein are matched.
4. Exact carbohydrate requirements for ordinary resistance-training sessions are not well defined by the endurance-derived ACSM ranges.
5. A universal grams-per-kilogram fat floor for healthy lifters is not established by the high-trust sources reviewed.
6. Self-reported calorie intake and wearable expenditure are too uncertain to serve as sole truth.
7. FFM-based protein rules depend on a credible FFM measurement; consumer body-fat estimates can be noisy.
8. Effects may differ by sex, age, training status, adiposity, diet history and menstrual status; data are insufficient for the Agent to manufacture sex-specific corrections.

Any future rule that resolves an item above must include source, population, effective version and migration behavior. Updating a rule pack affects future Proposals only; historical plans retain their original rule version.

## 12. Suggested machine-readable entities

```ts
type EvidenceGrade = "position" | "consensus" | "systematic_review" | "original_study";

interface NutritionRuleReference {
  sourceId: string;
  grade: EvidenceGrade;
  population: string;
  limitation: string;
}

interface NutritionStrategy {
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean";
  status: "provisional" | "calibrated" | "professional_directive";
  energyKcal: { target: number; range: [number, number]; basis: string };
  proteinGrams: { target: number; basis: "body_mass" | "fat_free_mass" };
  fatGrams: { target: number; energyPercent: number };
  carbohydrateGrams: { target: number; dayType: "training" | "rest" | "deload" };
  carbCyclePreset: "off" | "training_fuel" | "diet_break";
  evidence: NutritionRuleReference[];
  rulePackVersion: string;
}

interface NutritionReviewWindow {
  startedAt: string;
  endedAt: string;
  weightTrendPercentPerWeek?: number;
  trendConfidence: "insufficient" | "low" | "usable";
  adherenceEstimate?: number;
  confounders: string[];
}
```

The rule engine emits typed strategies and Proposals. The LLM does not calculate or write these records directly.

## Sources

- [S1]: Aragon AA, et al. *International Society of Sports Nutrition position stand: diets and body composition.* JISSN. 2017. <https://doi.org/10.1186/s12970-017-0174-y>
- [S2]: Helms ER, et al. *Effect of Small and Large Energy Surpluses on Strength, Muscle, and Skinfold Thickness in Resistance-Trained Individuals.* Sports Medicine - Open. 2023. <https://doi.org/10.1186/s40798-023-00651-y>
- [S3]: Jäger R, et al. *International Society of Sports Nutrition Position Stand: protein and exercise.* JISSN. 2017. <https://doi.org/10.1186/s12970-017-0177-8>
- [S4]: Morton RW, et al. *A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains.* BJSM. 2018. <https://doi.org/10.1136/bjsports-2017-097608>
- [S5]: Helms ER, et al. *A systematic review of dietary protein during caloric restriction in resistance trained lean athletes.* IJSNEM. 2014. <https://doi.org/10.1123/ijsnem.2013-0054>
- [S6]: Garthe I, et al. *Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes.* IJSNEM. 2011. <https://doi.org/10.1123/ijsnem.21.2.97>
- [S7]: Thomas DT, Erdman KA, Burke LM. *Nutrition and Athletic Performance.* Joint position of the Academy of Nutrition and Dietetics, Dietitians of Canada and ACSM. 2016. <https://doi.org/10.1249/MSS.0000000000000852>
- [S8]: Burke LM, et al. *Carbohydrates for training and competition.* Journal of Sports Sciences. 2011. <https://doi.org/10.1080/02640414.2011.585473>
- [S9]: World Health Organization. *Healthy diet* and linked 2023 fat/carbohydrate guidelines. Updated 2026. <https://www.who.int/news-room/fact-sheets/detail/healthy-diet>
- [S10]: Peos JJ, et al. *Continuous versus Intermittent Dieting for Fat Loss and Fat-Free Mass Retention in Resistance-trained Adults: The ICECAP Trial.* MSSE. 2021. <https://doi.org/10.1249/MSS.0000000000002636>
- [S11]: Campbell BI, et al. *Intermittent Energy Restriction Attenuates the Loss of Fat Free Mass in Resistance Trained Individuals.* Journal of Functional Morphology and Kinesiology. 2020. <https://doi.org/10.3390/jfmk5010019>
- [S12]: Mountjoy M, et al. *2023 International Olympic Committee's consensus statement on Relative Energy Deficiency in Sport (REDs).* BJSM. 2023. <https://doi.org/10.1136/bjsports-2023-106994>
- [S13]: Thomas DM, et al. *Effect of dietary adherence on the body weight plateau: a mathematical model incorporating intermittent compliance.* AJCN. 2014. <https://doi.org/10.3945/ajcn.113.079822>
- [S14]: US National Institute of Diabetes and Digestive and Kidney Diseases. *Choosing a Safe & Successful Weight-loss Program.* Reviewed 2024. <https://www.niddk.nih.gov/health-information/weight-management/choosing-a-safe-successful-weight-loss-program>

[S1]: https://doi.org/10.1186/s12970-017-0174-y
[S2]: https://doi.org/10.1186/s40798-023-00651-y
[S3]: https://doi.org/10.1186/s12970-017-0177-8
[S4]: https://doi.org/10.1136/bjsports-2017-097608
[S5]: https://doi.org/10.1123/ijsnem.2013-0054
[S6]: https://doi.org/10.1123/ijsnem.21.2.97
[S7]: https://doi.org/10.1249/MSS.0000000000000852
[S8]: https://doi.org/10.1080/02640414.2011.585473
[S9]: https://www.who.int/news-room/fact-sheets/detail/healthy-diet
[S10]: https://doi.org/10.1249/MSS.0000000000002636
[S11]: https://doi.org/10.3390/jfmk5010019
[S12]: https://doi.org/10.1136/bjsports-2023-106994
[S13]: https://doi.org/10.3945/ajcn.113.079822
[S14]: https://www.niddk.nih.gov/health-information/weight-management/choosing-a-safe-successful-weight-loss-program
